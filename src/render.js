// 渲染层:CPU 逐像素场函数 f(p)=Σ rᵢ²/dᵢ²,阈值 ± 柔度出软边,可选 gamma。
// tile 分块加速(24px 格,球按影响半径 6r 登记入格)是 ≥30fps 红线的命根,别拆。
// 彩色模式:任一球带 c 时逐像素做"场权重混色" color=Σw·c/Σw —— 不同色的球在融合处
// 自然渐变(彩色 metaball 标准做法),透明度仍由总场值决定。
// 预览版(固定 W×H、复用缓冲)与导出版(任意尺寸 + 适配映射)共用同一 fieldLoop 内核。
import { W, H, SDFSC, SDFW, SDFH } from './config.js';
import { hex2rgb } from './utils.js';
import { camPtInv } from './engine.js';

const TS=24; // tile 边长

// ── 实心场采样(solid 显示):SDF(2× 分辨率,chamfer 3≈1 SDF 像素)→ 场值。──
// 边缘软度按逻辑约 1.2px:2× SDF 下 = 1.2·SDFSC·3 chamfer;SDF 越高分辨率边缘越细腻。
const SEDGE=3*1.2*SDFSC; // chamfer 单位(随 SDF 分辨率缩放)
function bilin(D,x,y){
  const x0=Math.max(0,Math.min(SDFW-2,x|0)), y0=Math.max(0,Math.min(SDFH-2,y|0));
  const fx=Math.min(1,Math.max(0,x-x0)), fy=Math.min(1,Math.max(0,y-y0));
  const i=y0*SDFW+x0;
  return (D[i]*(1-fx)+D[i+1]*fx)*(1-fy) + (D[i+SDFW]*(1-fx)+D[i+SDFW+1]*fx)*fy;
}
// 目标像素 → 源画布像素(经逆镜头)→ 各实心场加权求和(单位:thr 的倍数)。
// invX/invY 把目标像素映射回归一化画布坐标(处理 stretch/fit 与任意分辨率)。SDF 为 2× 分辨率。
function makeSolidSampler(solids, cam, invX, invY, thr){
  if(!solids||!solids.length) return null;
  return (x,y)=>{
    let u=invX(x,y), v=invY(x,y);
    if(cam){ const p=camPtInv(u,v,cam); u=p[0]; v=p[1]; }
    const sx=u*SDFW, sy=v*SDFH;
    if(sx<-1||sy<-1||sx>SDFW||sy>SDFH) return 0;
    let f=0;
    for(const s of solids) f+=s.w*Math.min(8, bilin(s.sdf,sx,sy)/SEDGE);
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
function fieldLoop(d, EW, EH, tc, tr, bins, bx, by, br2, n, col, bg, P, cols, solidSamp){
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
      const R=cols&&f>1e-9?cr/f:col[0], G=cols&&f>1e-9?cg/f:col[1], B=cols&&f>1e-9?cb/f:col[2];
      d[k++]=R*a+bg[0]*(1-a); d[k++]=G*a+bg[1]*(1-a); d[k++]=B*a+bg[2]*(1-a); d[k++]=255;
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
    fieldLoop(img.data, W,H, tc,tr, bins, bx,by,br2, n, col, bg, P, packColors(balls,col), ss);
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
  return function render(balls,col,P,solids,cam){
    const n=balls.length, bg=hex2rgb(P.colBg);
    const bx=new Float32Array(n), by=new Float32Array(n), br2=new Float32Array(n);
    for(let i=0;i<n;i++){ bx[i]=balls[i].x*EW; by[i]=balls[i].y*EH;
      const r=balls[i].r*W*rScale; br2[i]=r*r; }
    const ss=makeSolidSampler(solids, cam, x=>x/EW, (x,y)=>y/EH, P.thr);
    fieldLoop(img.data, EW,EH, tc,tr, bins, bx,by,br2, n, col, bg, P, packColors(balls,col), ss);
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
  fieldLoop(d, EW,EH, tc,tr, bins, bx,by,br2, n, col, bg, P, packColors(balls,col), ss);
  ectx.putImageData(eimg,0,0);
}
