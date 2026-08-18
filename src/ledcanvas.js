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
export const p2Opts = () => ({ rotations: P.p2Rot || [], side: P.p2Side || 'cw',
  ...(P.p2Map ? {map:P.p2Map} : {}) });   // 自定义映射表(界面可改尺寸/位置);未设则用默认表

export function makeCanvas(w=LED_W, h=LED_H){
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const x=c.getContext('2d', {willReadFrequently:true}); x.imageSmoothingEnabled=false;
  return c;
}
// 🪞 整体镜像(双边):沿【竖直中线 x=宽/2】做左右对称 —— 双边动画效果。
// 【必须在 transformCanvasP1toP2(分屏切割)之前】对 P1 画面施加:这样模组分屏拿到的已是镜像后的内容,
// 分屏/侧板旋转随之得到准确镜像。整幅(含所有帧 + 角色动画)一起镜像,因为它作用在最终 P1 画面上。
// mode:
//  'left'  = 只保留左半,镜像覆盖到右半(默认)。纯像素覆盖,与背景颜色无关 —— 图形永不丢失。
//  'right' = 只保留右半,镜像覆盖到左半。
//  'overlay' = 整幅对称叠加(旧行为):逐像素取【离背景色更远】的那份 —— 修掉旧 darken/lighten
//    亮度猜测在灰背景下把深色图形"吃掉"的 bug(背景一变灰图形消失、变白又回来)。
function hex2rgbLed(hx){ hx=(hx||'#000').replace('#',''); if(hx.length===3) hx=hx.split('').map(c=>c+c).join('');
  const n=parseInt(hx,16)||0; return [(n>>16)&255,(n>>8)&255,n&255]; }
export function mirrorSymmetricH(cv, mode='left'){
  const w=cv.width, h=cv.height;
  const ctx=cv.getContext('2d', {willReadFrequently:true}); ctx.imageSmoothingEnabled=false;
  if(mode==='left' || mode==='right'){
    const hw=w>>1;
    const tmp=makeCanvas(w,h); const tc=tmp.getContext('2d'); tc.imageSmoothingEnabled=false;
    tc.drawImage(cv,0,0);
    ctx.save(); ctx.setTransform(-1,0,0,1,w,0);          // 翻转坐标系:画到 x' = w−x
    if(mode==='left') ctx.drawImage(tmp, 0,0,hw,h, 0,0,hw,h);        // 左半 → 翻转落到右半
    else              ctx.drawImage(tmp, w-hw,0,hw,h, w-hw,0,hw,h);  // 右半 → 翻转落到左半
    ctx.restore();
    return;
  }
  // overlay(对称叠加)
  const tmp=makeCanvas(w,h); const tc=tmp.getContext('2d'); tc.imageSmoothingEnabled=false;
  tc.setTransform(-1,0,0,1,w,0); tc.drawImage(cv,0,0); tc.setTransform(1,0,0,1,0,0);   // 水平翻转副本
  if(P.transBg){ // 透明底:内容像素并集
    ctx.save(); ctx.globalCompositeOperation='source-over'; ctx.drawImage(tmp,0,0); ctx.restore();
    return;
  }
  // 不透明底:逐像素选【离背景色更远】的那份 → 深色/浅色内容都能胜出,不依赖底色亮暗猜测。
  const [br,bgc,bb]=hex2rgbLed(P.colBg);
  const a=ctx.getImageData(0,0,w,h), b=tc.getImageData(0,0,w,h), da=a.data, db=b.data;
  for(let i=0;i<da.length;i+=4){
    const d1=Math.abs(da[i]-br)+Math.abs(da[i+1]-bgc)+Math.abs(da[i+2]-bb);
    const d2=Math.abs(db[i]-br)+Math.abs(db[i+1]-bgc)+Math.abs(db[i+2]-bb);
    if(d2>d1){ da[i]=db[i]; da[i+1]=db[i+1]; da[i+2]=db[i+2]; da[i+3]=db[i+3]; }
  }
  ctx.putImageData(a,0,0);
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
