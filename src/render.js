// 渲染层:CPU 逐像素场函数 f(p)=Σ rᵢ²/dᵢ²,阈值 ± 柔度出软边,可选 gamma。
// tile 分块加速(24px 格,球按影响半径 6r 登记入格)是 ≥30fps 红线的命根,别拆。
// 预览版(固定 W×H、复用缓冲)与导出版(任意尺寸 + 适配映射)共用同一 fieldLoop 内核。
import { W, H } from './config.js';
import { hex2rgb } from './utils.js';

const TS=24; // tile 边长

// 场求值 + 出像素。bx/by 已是目标像素坐标,br2 是半径平方(像素),bins 复用清零。
function fieldLoop(d, EW, EH, tc, tr, bins, bx, by, br2, n, col, bg, P){
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
      let f=0;
      for(let j=0;j<list.length;j++){
        const i=list[j], dx=x-bx[i], dy=y-by[i];
        f+=br2[i]/(dx*dx+dy*dy+1e-6);
      }
      let a=(f-lo)*inv; a=a<0?0:(a>1?1:a); a=a*a*(3-2*a);
      if(P.gamma!==1) a=Math.pow(a,P.gamma);
      d[k++]=col[0]*a+bg[0]*(1-a); d[k++]=col[1]*a+bg[1]*(1-a); d[k++]=col[2]*a+bg[2]*(1-a); d[k++]=255;
    }
  }
}

// 预览渲染器:绑定画布 ctx,持有复用的 img/bins,逐帧 render(balls,col,P)。
export function createPreviewRenderer(ctx){
  const img=ctx.createImageData(W,H);
  const tc=Math.ceil(W/TS), tr=Math.ceil(H/TS);
  const bins=Array.from({length:tc*tr},()=>[]);
  return function render(balls,col,P){
    const n=balls.length, bg=hex2rgb(P.colBg);
    const bx=new Float32Array(n), by=new Float32Array(n), br2=new Float32Array(n);
    for(let i=0;i<n;i++){ bx[i]=balls[i].x*W; by[i]=balls[i].y*H;
      const r=balls[i].r*W; br2[i]=r*r; }
    fieldLoop(img.data, W,H, tc,tr, bins, bx,by,br2, n, col, bg, P);
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
  return function render(balls,col,P){
    const n=balls.length, bg=hex2rgb(P.colBg);
    const bx=new Float32Array(n), by=new Float32Array(n), br2=new Float32Array(n);
    for(let i=0;i<n;i++){ bx[i]=balls[i].x*EW; by[i]=balls[i].y*EH;
      const r=balls[i].r*W*rScale; br2[i]=r*r; }
    fieldLoop(img.data, EW,EH, tc,tr, bins, bx,by,br2, n, col, bg, P);
    ctx.putImageData(img,0,0);
  };
}

// 导出渲染器:任意尺寸,stretch(拉伸填满)或 fit(等比留黑)映射。半径按面积比缩放。
export function renderToImageData(ectx, EW, EH, balls, col, P){
  const eimg=ectx.createImageData(EW,EH), d=eimg.data, bg=hex2rgb(P.colBg);
  let mapX,mapY,rScale;
  if(P.fit==='stretch'){ mapX=x=>x*EW; mapY=y=>y*EH; rScale=Math.sqrt((EW*EH)/(W*H)); }
  else{ const s=Math.min(EW/W,EH/H), ox=(EW-W*s)/2, oy=(EH-H*s)/2;
        mapX=x=>ox+x*W*s; mapY=y=>oy+y*H*s; rScale=s; }
  const n=balls.length;
  const bx=new Float32Array(n), by=new Float32Array(n), br2=new Float32Array(n);
  const tc=Math.ceil(EW/TS), tr=Math.ceil(EH/TS);
  const bins=Array.from({length:tc*tr},()=>[]);
  for(let i=0;i<n;i++){ bx[i]=mapX(balls[i].x); by[i]=mapY(balls[i].y);
    const r=balls[i].r*W*rScale; br2[i]=r*r; }
  fieldLoop(d, EW,EH, tc,tr, bins, bx,by,br2, n, col, bg, P);
  ectx.putImageData(eimg,0,0);
}
