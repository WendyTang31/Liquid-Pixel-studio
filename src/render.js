// 渲染层:CPU 逐像素场函数 f(p)=Σ rᵢ²/dᵢ²,阈值 ± 柔度出软边,可选 gamma。
// tile 分块加速(24px 格,球按影响半径 6r 登记入格)是 ≥30fps 红线的命根,别拆。
// 彩色模式:任一球带 c 时逐像素做"场权重混色" color=Σw·c/Σw —— 不同色的球在融合处
// 自然渐变(彩色 metaball 标准做法),透明度仍由总场值决定。
// 预览版(固定 W×H、复用缓冲)与导出版(任意尺寸 + 适配映射)共用同一 fieldLoop 内核。
import { W, H, SDFSC, SDFW, SDFH } from './config.js';
import { hex2rgb } from './utils.js';
import { camPtInv } from './engine.js';

const TS=24; // tile 边长

// ── 实心场采样(solid 显示):SDF(SDFSC× 分辨率,chamfer 3≈1 SDF 像素)→ 场值。──
// 边缘软度按逻辑约 1.2px = 1.2·SDFSC·3 chamfer(随 SDFSC 缩放,软度恒定);SDF 越高分辨率边缘越细腻。
const SEDGE=3*1.2*SDFSC; // chamfer 单位(随 SDF 分辨率缩放)
function bilin(D,x,y){
  const x0=Math.max(0,Math.min(SDFW-2,x|0)), y0=Math.max(0,Math.min(SDFH-2,y|0));
  const fx=Math.min(1,Math.max(0,x-x0)), fy=Math.min(1,Math.max(0,y-y0));
  const i=y0*SDFW+x0;
  return (D[i]*(1-fx)+D[i+1]*fx)*(1-fy) + (D[i+SDFW]*(1-fx)+D[i+SDFW+1]*fx)*fy;
}
// 目标像素 → 源画布像素(经逆镜头)→ 各实心场加权求和(单位:thr 的倍数)。
// invX/invY 把目标像素映射回归一化画布坐标(处理 stretch/fit 与任意分辨率)。SDF 为 2× 分辨率。
// 动态几何位移场的粗网格缓存:behaviorDisp 是平滑场,预采样 GW×GH 一次、逐像素双线性插值,
// 把每帧的三角函数量从"每像素一次"降到"每格一次"(~百万→几百),消除加了动态几何后的卡顿。
const GW=41, GH=25;
function buildWarpGrid(warp){
  const g=new Float32Array(GW*GH*3);
  for(let j=0;j<GH;j++) for(let i=0;i<GW;i++){ const d=warp(i/(GW-1), j/(GH-1));
    const o=(j*GW+i)*3; g[o]=d.dx; g[o+1]=d.dy; g[o+2]=d.rf; }
  return g;
}
function sampleWarp(g, u, v){
  const fx=u<0?0:u>1?GW-1:u*(GW-1), fy=v<0?0:v>1?GH-1:v*(GH-1);
  const x0=fx|0, y0=fy|0, x1=x0<GW-1?x0+1:x0, y1=y0<GH-1?y0+1:y0, tx=fx-x0, ty=fy-y0;
  const i00=(y0*GW+x0)*3, i10=(y0*GW+x1)*3, i01=(y1*GW+x0)*3, i11=(y1*GW+x1)*3;
  const L=(a,b,c,d,o)=>{ const t=(g[a+o]*(1-tx)+g[b+o]*tx), u2=(g[c+o]*(1-tx)+g[d+o]*tx); return t*(1-ty)+u2*ty; };
  return [L(i00,i10,i01,i11,0), L(i00,i10,i01,i11,1), L(i00,i10,i01,i11,2)];
}
function makeSolidSampler(solids, cam, invX, invY, thr){
  if(!solids||!solids.length) return null;
  const anyWarp=solids.some(s=>s.warp); // 动态几何(停留期):位移场 warp(u,v)→{dx,dy,rf},实心整体随之晃动
  const grids = anyWarp ? solids.map(s=>s.warp?buildWarpGrid(s.warp):null) : null; // 每帧预算一次粗网格
  return (x,y)=>{
    let u=invX(x,y), v=invY(x,y);
    if(cam){ const p=camPtInv(u,v,cam); u=p[0]; v=p[1]; }
    if(!anyWarp){ // 快路径:无形变,单次坐标 + 边界判定
      const sx=u*SDFW, sy=v*SDFH;
      if(sx<-1||sy<-1||sx>SDFW||sy>SDFH) return 0;
      let f=0;
      for(const s of solids) f+=s.w*Math.min(8, bilin(s.sdf,sx,sy)/SEDGE);
      return f*thr;
    }
    let f=0;
    for(let k=0;k<solids.length;k++){ const s=solids[k];
      let su=u, sv=v, rf=1;
      if(grids[k]){ const d=sampleWarp(grids[k], u, v); su=u-d[0]; sv=v-d[1]; rf=d[2]; } // 逆向采样 → 形体整体位移
      const sx=su*SDFW, sy=sv*SDFH;
      if(sx<-1||sy<-1||sx>SDFW||sy>SDFH) continue;
      f+=s.w*Math.min(8, bilin(s.sdf,sx,sy)/SEDGE)*rf;
    }
    return f*thr;
  };
}

// 球颜色打包:任一球带 c → Float32Array(3n)(无 c 的球用帧色补),否则 null(旧路径)。
function packColors(balls, col){
  let any=false;
  for(const b of balls) if(b.c){ any=true; break; }
  if(!any) return null;
  const cols=new Float32Array(balls.length*3);
  for(let i=0;i<balls.length;i++){
    const c=balls[i].c||col;
    cols[i*3]=c[0]; cols[i*3+1]=c[1]; cols[i*3+2]=c[2];
  }
  return cols;
}

// 场求值 + 出像素。bx/by 已是目标像素坐标,br2 是半径平方(像素),bins 复用清零。
// 墨水沉积参数(从 P.ink 预算 sin/cos)。null = 关闭。
function inkParams(P){
  const k=P.ink; if(!k||!k.on||!(k.intensity>0)) return null;
  const a=(k.angle||90)*Math.PI/180;
  return { intensity:k.intensity, cosA:Math.cos(a), sinA:Math.sin(a),
    edge:Math.max(0.3,k.edge||2.6), bleed:k.bleed||0, dir:k.dir==null?0.7:k.dir, clear:k.clear||0,
    dark:Math.round(255*(1-(k.dark==null?0.85:k.dark))) }; // 墨边目标色(0.85→约 38,近黑;与底色无关)
}
function fieldLoop(d, EW, EH, tc, tr, bins, bx, by, br2, n, col, bg, P, cols, solidSamp, ink){
  for(const b of bins) b.length=0;
  for(let i=0;i<n;i++){
    const r=Math.sqrt(br2[i]), cut=Math.max(r*6,14);
    const tx0=Math.max(0,((bx[i]-cut)/TS)|0), tx1=Math.min(tc-1,((bx[i]+cut)/TS)|0);
    const ty0=Math.max(0,((by[i]-cut)/TS)|0), ty1=Math.min(tr-1,((by[i]+cut)/TS)|0);
    for(let ty=ty0;ty<=ty1;ty++) for(let tx=tx0;tx<=tx1;tx++) bins[ty*tc+tx].push(i);
  }
  const lo=P.thr-P.soft, hi=P.thr+P.soft, inv=1/(hi-lo);
  let k=0;
  for(let y=0;y<EH;y++){
    const trow=((y/TS)|0)*tc;
    for(let x=0;x<EW;x++){
      const list=bins[trow+((x/TS)|0)];
      let f=0, cr=0, cg=0, cb=0;
      if(solidSamp){ const fs=solidSamp(x,y);
        if(fs>0){ f+=fs; if(cols){ cr+=fs*col[0]; cg+=fs*col[1]; cb+=fs*col[2]; } } }
      if(cols){
        for(let j=0;j<list.length;j++){
          const i=list[j], dx=x-bx[i], dy=y-by[i];
          const w=br2[i]/(dx*dx+dy*dy+1e-6);
          f+=w; cr+=w*cols[i*3]; cg+=w*cols[i*3+1]; cb+=w*cols[i*3+2];
        }
      } else {
        for(let j=0;j<list.length;j++){
          const i=list[j], dx=x-bx[i], dy=y-by[i];
          f+=br2[i]/(dx*dx+dy*dy+1e-6);
        }
      }
      let a=(f-lo)*inv; a=a<0?0:(a>1?1:a); a=a*a*(3-2*a);
      if(P.gamma!==1) a=Math.pow(a,P.gamma);
      let R=cols&&f>1e-9?cr/f:col[0], G=cols&&f>1e-9?cg/f:col[1], B=cols&&f>1e-9?cb/f:col[2];
      let alphaMul=1;
      if(ink && a>0.006){ // 🖋 墨水沉积:边缘沉深墨(angle 侧更重),内部向背景晕染变淡 / 变透明
        let depth=f-P.thr; if(depth<0)depth=0;
        // 指数衰减 rim:墨只在【贴边缘】一薄层浓,向内快速淡去 —— 不再是"边缘一圈均匀死黑大色块"。
        const rim=Math.exp(-depth/ink.edge), rimI=1-rim; // rim:1=贴边→0=深处;rimI 反之
        const px=x/EW-0.5, py=y/EH-0.5;
        let dir=0.5+(px*ink.cosA+py*ink.sinA)*1.4; dir=dir<0?0:(dir>1?1:dir); // angle 那一侧→1
        const heavy=Math.min(0.95, rim*(0.5+ink.dir*dir)*ink.intensity);      // 边缘沉积浓度
        const washBg=rimI*ink.bleed;                                          // 内部向背景色晕染变淡
        R+=(bg[0]-R)*washBg; G+=(bg[1]-G)*washBg; B+=(bg[2]-B)*washBg;
        // 边缘向【深墨色 ink.dark】混合(不是按底色比例压暗)→ 底色再浅,墨边依旧深
        R+=(ink.dark-R)*heavy; G+=(ink.dark-G)*heavy; B+=(ink.dark-B)*heavy;
        if(ink.clear){ const cA=Math.min(1, rimI*2.5); alphaMul=1 - ink.clear*cA; } // 内部镂空(背景透明由 transBg 统一处理)
      }
      // 🫧 背景透明(P.transBg):alpha=形状覆盖度 → 只有动画图案,背景/画布色全透(投影到车上不再挡另一侧)。
      // 直通形状色(不合成背景),边缘按覆盖度羽化,叠加墨水镂空(alphaMul)。
      const outA = P.transBg ? a*alphaMul : alphaMul;
      if(P.transBg){ d[k++]=R; d[k++]=G; d[k++]=B; }
      else { d[k++]=R*a+bg[0]*(1-a); d[k++]=G*a+bg[1]*(1-a); d[k++]=B*a+bg[2]*(1-a); }
      d[k++]=outA>=0.999?255:(outA<=0?0:(outA*255)|0);
    }
  }
}

// 预览渲染器:绑定画布 ctx,持有复用的 img/bins,逐帧 render(balls,col,P)。
export function createPreviewRenderer(ctx){
  const img=ctx.createImageData(W,H);
  const tc=Math.ceil(W/TS), tr=Math.ceil(H/TS);
  const bins=Array.from({length:tc*tr},()=>[]);
  return function render(balls,col,P,solids,cam){
    const n=balls.length, bg=hex2rgb(P.colBg);
    const bx=new Float32Array(n), by=new Float32Array(n), br2=new Float32Array(n);
    for(let i=0;i<n;i++){ bx[i]=balls[i].x*W; by[i]=balls[i].y*H;
      const r=balls[i].r*W; br2[i]=r*r; }
    const ss=makeSolidSampler(solids, cam, x=>x/W, (x,y)=>y/H, P.thr);
    fieldLoop(img.data, W,H, tc,tr, bins, bx,by,br2, n, col, bg, P, packColors(balls,col), ss, inkParams(P));
    ctx.putImageData(img,0,0);
  };
}

// 任意尺寸的复用渲染器(stretch 映射):img/bins 建一次、逐帧复用 —— 3D 预览器的
// 纹理画布每帧都要重画,用 renderToImageData(每帧新分配 ImageData)会造成 GC 抖动。
export function createSizedRenderer(ctx, EW, EH){
  const img=ctx.createImageData(EW,EH);
  const tc=Math.ceil(EW/TS), tr=Math.ceil(EH/TS);
  const bins=Array.from({length:tc*tr},()=>[]);
  const rScale=Math.sqrt((EW*EH)/(W*H));
  // view={z,ox,oy}(归一化视口:可见区 [ox,ox+1/z]×[oy,oy+1/z])。缺省=满幅(z=1)。
  // 视口渲染:同样的缓冲像素只渲可见区 → 缩放后依旧清晰,开销恒定(不随缩放增大)。
  return function render(balls,col,P,solids,cam,view){
    const z=view?view.z:1, ox=view?view.ox:0, oy=view?view.oy:0;
    const n=balls.length, bg=hex2rgb(P.colBg);
    const bx=new Float32Array(n), by=new Float32Array(n), br2=new Float32Array(n);
    for(let i=0;i<n;i++){ bx[i]=(balls[i].x-ox)*z*EW; by[i]=(balls[i].y-oy)*z*EH;
      const r=balls[i].r*W*rScale*z; br2[i]=r*r; }
    const ss=makeSolidSampler(solids, cam, x=>ox+x/(EW*z), (x,y)=>oy+y/(EH*z), P.thr);
    fieldLoop(img.data, EW,EH, tc,tr, bins, bx,by,br2, n, col, bg, P, packColors(balls,col), ss, inkParams(P));
    ctx.putImageData(img,0,0);
  };
}

// 导出渲染器:任意尺寸,stretch(拉伸填满)或 fit(等比留黑)映射。半径按面积比缩放。
export function renderToImageData(ectx, EW, EH, balls, col, P, solids, cam){
  const eimg=ectx.createImageData(EW,EH), d=eimg.data, bg=hex2rgb(P.colBg);
  let mapX,mapY,rScale,invX,invY;
  if(P.fit==='stretch'){ mapX=x=>x*EW; mapY=y=>y*EH; rScale=Math.sqrt((EW*EH)/(W*H));
    invX=x=>x/EW; invY=(x,y)=>y/EH; }
  else{ const s=Math.min(EW/W,EH/H), ox=(EW-W*s)/2, oy=(EH-H*s)/2;
        mapX=x=>ox+x*W*s; mapY=y=>oy+y*H*s; rScale=s;
        invX=x=>(x-ox)/(W*s); invY=(x,y)=>(y-oy)/(H*s); }
  const n=balls.length;
  const bx=new Float32Array(n), by=new Float32Array(n), br2=new Float32Array(n);
  const tc=Math.ceil(EW/TS), tr=Math.ceil(EH/TS);
  const bins=Array.from({length:tc*tr},()=>[]);
  for(let i=0;i<n;i++){ bx[i]=mapX(balls[i].x); by[i]=mapY(balls[i].y);
    const r=balls[i].r*W*rScale; br2[i]=r*r; }
  const ss=makeSolidSampler(solids, cam, invX, invY, P.thr);
  fieldLoop(d, EW,EH, tc,tr, bins, bx,by,br2, n, col, bg, P, packColors(balls,col), ss, inkParams(P));
  ectx.putImageData(eimg,0,0);
}
