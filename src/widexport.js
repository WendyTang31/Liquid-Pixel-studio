// 📐 宽画幅导出:世界横向拉长成 worldW 个 480 基准方,角色(小人)可从左跑到右【跑完全程不消失】,
// 且【不牺牲分辨率、不缩小图形】—— 因为不是把方形拉伸,而是真正加宽了世界、逐像素以原始密度渲染。
//
// 为什么要单独写一套渲染:主渲染把矢量/角色 poly 光栅化进【固定 480² 的 SDF】,超出 480 的部分被裁掉 ——
// 这正是小人跑出画面就消失的根因。这里把所有 poly 光栅化进一张【和世界一样宽】的连续 SDF(无接缝),
// 再按世界坐标逐像素采样。基准方居中,角色 poly 的 x 可任意延展。复刻 render.js 的软边+着色+墨水沉积。
import { W, H, SDFSC, P } from './config.js';
import { distanceField } from './samplers.js';
import { hex2rgb } from './utils.js';

// 墨水沉积参数(与 render.js inkParams 同口径;w=逐帧权重)。null=关闭。
function inkParams(w=1){
  const k=P.ink; if(!k||!k.on||!(k.intensity>0)||w<=0.004) return null;
  const a=(k.angle||90)*Math.PI/180;
  return { intensity:k.intensity*w, cosA:Math.cos(a), sinA:Math.sin(a),
    edge:Math.max(0.3,k.edge||2.6), bleed:k.bleed||0, dir:k.dir==null?0.7:k.dir, clear:k.clear||0,
    dark:Math.round(255*(1-(k.dark==null?0.85:k.dark))) };
}
// 宽 SDF 双线性采样(维度随传入 MW/MH)。
function bilinW(D,x,y,MW,MH){
  const x0=Math.max(0,Math.min(MW-2,x|0)), y0=Math.max(0,Math.min(MH-2,y|0));
  const fx=Math.min(1,Math.max(0,x-x0)), fy=Math.min(1,Math.max(0,y-y0));
  const i=y0*MW+x0;
  return (D[i]*(1-fx)+D[i+1]*fx)*(1-fy) + (D[i+MW]*(1-fx)+D[i+MW+1]*fx)*fy;
}

// worldW = 世界宽度(以 480 方为单位,≥1)。返回导出建议宽度 EW(= worldW·EH,保证像素密度=方形,不拉伸)。
export const wideEW = (EH, worldW) => Math.max(2, Math.round(EH * Math.max(1, worldW)));

// 逐帧渲染进 octx(尺寸 EW×EH)。polys=[{poly,col,strokeW}](主矢量 + 角色,均为 480 画布坐标);
// balls=主 metaball 球(归一化,居中方内);col=帧色;inkW=墨水逐帧权重。
export function renderWideFrame(octx, EW, EH, worldW, balls, col, polys, inkW){
  const bg=hex2rgb(P.colBg), ink=inkParams(inkW);
  const worldPxW = worldW*W;                          // 世界总宽(世界 px)
  const leftPad  = (worldW-1)/2*W;                    // 基准方左边缘在世界里的 x(基准方居中)
  // SDF 分辨率:随世界加宽而降 chamfer 倍率,避免 MW 过大拖垮导出(封顶 ~5000)。
  const sdfScale = Math.max(1, Math.min(SDFSC, Math.floor(5000/Math.max(1,worldPxW))||1));
  const MW=Math.max(2,Math.round(worldPxW*sdfScale)), MH=Math.max(2,Math.round(H*sdfScale));
  const SEDGE=3*1.2*sdfScale;
  // 1) 光栅化所有 poly 进宽掩膜(世界坐标)→ 宽 SDF。
  const mc=document.createElement('canvas'); mc.width=MW; mc.height=MH;
  const mx=mc.getContext('2d',{willReadFrequently:true});
  mx.fillStyle='#000'; mx.fillRect(0,0,MW,MH);
  mx.fillStyle='#fff'; mx.strokeStyle='#fff'; mx.lineJoin='round'; mx.lineCap='round';
  const wx = x => (leftPad + x)*sdfScale;             // 480 画布 x → 宽掩膜像素 x(居中偏移)
  const wy = y => y*sdfScale;
  for(const {poly, strokeW} of (polys||[])){ if(!poly?.length) continue;
    mx.beginPath(); mx.moveTo(wx(poly[0].x), wy(poly[0].y));
    for(let i=1;i<poly.length;i++) mx.lineTo(wx(poly[i].x), wy(poly[i].y));
    mx.closePath();
    if(strokeW>0){ mx.lineWidth=strokeW*sdfScale; mx.stroke(); } else mx.fill(); }
  const md=mx.getImageData(0,0,MW,MH).data;
  const on=(x,y)=> x>=0&&y>=0&&x<MW&&y<MH && md[(y*MW+x)*4]>127;
  const sdf=distanceField(on, MW, MH);
  const hasSolid = polys && polys.length;
  // 2) 球预备(主 metaball,居中方内;导出角色时通常为空)。像素坐标 = 居中方内 + 世界偏移。
  const n=balls?balls.length:0;
  const bx=new Float32Array(n), by=new Float32Array(n), br2=new Float32Array(n);
  const bcols = n && balls.some(b=>b.c) ? new Float32Array(n*3) : null;
  const xOff=(EW-EH)/2;                                // 居中方在宽画布里的左边缘像素
  for(let i=0;i<n;i++){ const b=balls[i];
    bx[i]=b.x*EH + xOff; by[i]=b.y*EH; const r=b.r*EH; br2[i]=r*r;
    if(bcols){ const c=b.c||col; bcols[i*3]=c[0]; bcols[i*3+1]=c[1]; bcols[i*3+2]=c[2]; } }
  // 3) 宽场循环。
  const img=octx.createImageData(EW,EH), d=img.data;
  const lo=P.thr-P.soft, hi=P.thr+P.soft, inv=1/(hi-lo);
  const sxK=MW/EW, syK=MH/EH;
  let k=0;
  for(let y=0;y<EH;y++){
    for(let x=0;x<EW;x++){
      let f=0, cr=0, cg=0, cb=0;
      if(hasSolid){ const fs=Math.min(8, bilinW(sdf, x*sxK, y*syK, MW, MH)/SEDGE)*P.thr;
        if(fs>0){ f+=fs; cr+=fs*col[0]; cg+=fs*col[1]; cb+=fs*col[2]; } }
      for(let i=0;i<n;i++){ const dx=x-bx[i], dy=y-by[i], wgt=br2[i]/(dx*dx+dy*dy+1e-6);
        f+=wgt; if(bcols){ cr+=wgt*bcols[i*3]; cg+=wgt*bcols[i*3+1]; cb+=wgt*bcols[i*3+2]; }
        else { cr+=wgt*col[0]; cg+=wgt*col[1]; cb+=wgt*col[2]; } }
      let a=(f-lo)*inv; a=a<0?0:(a>1?1:a); a=a*a*(3-2*a);
      if(P.gamma!==1) a=Math.pow(a,P.gamma);
      let R=f>1e-9?cr/f:col[0], G=f>1e-9?cg/f:col[1], B=f>1e-9?cb/f:col[2];
      let alphaMul=1;
      if(ink && a>0.006){
        let depth=f-P.thr; if(depth<0)depth=0;
        const rim=Math.exp(-depth/ink.edge), rimI=1-rim;
        const px=x/EW-0.5, py=y/EH-0.5;
        let dir=0.5+(px*ink.cosA+py*ink.sinA)*1.4; dir=dir<0?0:(dir>1?1:dir);
        const heavy=Math.min(0.95, rim*(0.5+ink.dir*dir)*ink.intensity);
        const washBg=rimI*ink.bleed;
        R+=(bg[0]-R)*washBg; G+=(bg[1]-G)*washBg; B+=(bg[2]-B)*washBg;
        R+=(ink.dark-R)*heavy; G+=(ink.dark-G)*heavy; B+=(ink.dark-B)*heavy;
        if(ink.clear){ const cA=Math.min(1, rimI*2.5); alphaMul=1 - ink.clear*cA; }
      }
      const outA = P.transBg ? a*alphaMul : alphaMul;
      if(P.transBg){ d[k++]=R; d[k++]=G; d[k++]=B; }
      else { d[k++]=R*a+bg[0]*(1-a); d[k++]=G*a+bg[1]*(1-a); d[k++]=B*a+bg[2]*(1-a); }
      d[k++]=outA>=0.999?255:(outA<=0?0:(outA*255)|0);
    }
  }
  octx.putImageData(img,0,0);
}
