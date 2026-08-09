// ledmap.js(纯函数)与画布之间的薄适配层。所有 DOM 相关的东西都在这里,ledmap 保持零依赖可单测。
// 铁律:任何一次绘制前都关掉平滑 —— 一个像素 = 一颗灯珠,插值会糊掉边缘。
import { P } from './config.js';
import { LED_W, LED_H, MODULE_MAP, transformP1toP2, transformP2toP1, makeCalibrationFrame } from './ledmap.js';

export const p2On = () => !!P.p2Export;
// 导出倍数:1×=硬件原生 128×320;N× = 原生按 128N×320N 渲染,模组网格同步放大(仍零重采样)。
export const p2Scale = () => Math.max(1, Math.round(P.p2Scale || 1));
export const p2Size = () => [LED_W * p2Scale(), LED_H * p2Scale()];
// 由全局配置组出纯函数所需的 opts(逐模组覆盖 + 侧板方向)。
// 注意:倍数【不从配置读】,而是由待变换画面的宽度反推 —— 预览是 128 宽(1×)、导出是 128N 宽(N×),
// 同一个函数两处都对,不会出现"配置说 8× 但画布只有 128 宽"导致全黑的错配。
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
  const scale=Math.max(1, Math.round(src.width / LED_W));   // 由画面宽度反推倍数
  // 方向:正向=在 P1 竖排里画;反向=照着车上的样子画,导出翻回控制器顺序。
  const fn = (P.p2Dir==='inv') ? transformP2toP1 : transformP1toP2;
  const res=fn({width:img.width,height:img.height,data:img.data}, {...p2Opts(), scale});
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
