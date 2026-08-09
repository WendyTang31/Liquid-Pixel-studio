// ledmap.js(纯函数)与画布之间的薄适配层。所有 DOM 相关的东西都在这里,ledmap 保持零依赖可单测。
// 铁律:任何一次绘制前都关掉平滑 —— 一个像素 = 一颗灯珠,插值会糊掉边缘。
import { P } from './config.js';
import { LED_W, LED_H, MODULE_MAP, transformP1toP2, makeCalibrationFrame } from './ledmap.js';

export const p2On = () => !!P.p2Export;
// 由全局配置组出纯函数所需的 opts(逐模组覆盖 + 侧板方向)。
export const p2Opts = () => ({ rotations: P.p2Rot || [], side: P.p2Side || 'cw' });

export function makeCanvas(w=LED_W, h=LED_H){
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const x=c.getContext('2d', {willReadFrequently:true}); x.imageSmoothingEnabled=false;
  return c;
}
// 源画布 → 新画布(P2 布局)。out 可复用以免每帧新建。
export function transformCanvasP1toP2(src, out){
  const sctx=src.getContext('2d', {willReadFrequently:true});
  sctx.imageSmoothingEnabled=false;
  const img=sctx.getImageData(0,0,src.width,src.height);
  const res=transformP1toP2({width:img.width,height:img.height,data:img.data}, p2Opts());
  const dst=out||makeCanvas(res.width,res.height);
  if(dst.width!==res.width||dst.height!==res.height){ dst.width=res.width; dst.height=res.height; }
  const dctx=dst.getContext('2d', {willReadFrequently:true});
  dctx.imageSmoothingEnabled=false;
  const outImg=dctx.createImageData(res.width,res.height);
  outImg.data.set(res.data);
  dctx.putImageData(outImg,0,0);
  return dst;
}
// 校准帧(P1 布局)→ 画布。
export function calibrationCanvas(out){
  const cal=makeCalibrationFrame(MODULE_MAP, LED_W, LED_H);
  const dst=out||makeCanvas(LED_W,LED_H);
  const ctx=dst.getContext('2d', {willReadFrequently:true});
  ctx.imageSmoothingEnabled=false;
  const img=ctx.createImageData(cal.width,cal.height);
  img.data.set(cal.data);
  ctx.putImageData(img,0,0);
  return dst;
}
