// 管线层:形状 → 光栅化蒙版 → 采样成点。这里是数据层(shapes)与画布对象(mask/ghost/thumb)
// 唯一合法的交汇处;纯引擎/采样只吃它产出的 dots。
import { W, H } from './config.js';
import { P } from './config.js';
import { store } from './store.js';
import { $, FONT, hex2rgb } from './utils.js';
import { SAMPLERS, sampleDots } from './samplers.js';
import { fillSmoothClosedPath } from './path.js';
import { binarize, grayscaleize } from './image.js';

// 蒙版读取器:R 通道 >127 = 形状内(放置);G 通道 = 亮度(半调用,普通形状画白 G=255 → B=1)。
// maskReaderFor/lumReaderFor 接任意 2D 上下文(3D 预览器自建蒙版复用)。
export const maskReaderFor=mctx=>{ const d=mctx.getImageData(0,0,W,H).data;
  return (x,y)=> x>=0&&y>=0&&x<W&&y<H && d[(y*W+x)*4]>127; };
export const lumReaderFor=mctx=>{ const d=mctx.getImageData(0,0,W,H).data;
  return (x,y)=> x>=0&&y>=0&&x<W&&y<H ? d[(y*W+x)*4+1]/255 : 0; };
export const readMask=s=>maskReaderFor(s.mctx);

// 文字量度只依赖字体串,与具体画布无关 —— 用独立 scratch context,
// 免得像 legacy 那样依赖 states[0](初始化时序列尚空,取 states[0] 会炸)。
const _measCtx=document.createElement('canvas').getContext('2d');
export function measureText(txt,size){ _measCtx.font=FONT(size);
  return _measCtx.measureText(txt).width; }

// 把形状列表画进任意蒙版上下文(add=白,sub=黑)。纯绘制,不碰 store —— 3D 预览器复用。
export function paintShapes(c, shapes){
  c.fillStyle='#000'; c.fillRect(0,0,W,H);
  for(const sh of shapes){
    c.fillStyle=sh.bool==='add'?'#fff':'#000';
    if(sh.type==='rect') c.fillRect(sh.x,sh.y,sh.w,sh.h);
    else if(sh.type==='ellipse'){ c.beginPath();
      c.ellipse(sh.x+sh.w/2,sh.y+sh.h/2,sh.w/2,sh.h/2,0,0,7); c.fill(); }
    else if(sh.type==='path'){ if(fillSmoothClosedPath(c,sh.points)) c.fill(); }
    else if(sh.type==='image'){
      if(!sh._img) continue; // 尚未解码完成(工程刚打开/撤销刚发生),跳过这一帧,解码完会再刷一次
      const tw=Math.max(1,Math.round(sh.w)), th=Math.max(1,Math.round(sh.h));
      const tmp=document.createElement('canvas'); tmp.width=tw; tmp.height=th;
      const tctx=tmp.getContext('2d',{willReadFrequently:true});
      tctx.drawImage(sh._img,0,0,tw,th);
      const id=tctx.getImageData(0,0,tw,th);
      if(sh.halftone && sh.bool==='add')
        grayscaleize(id.data,{threshold:sh.threshold, invert:sh.invert, useAlpha:sh.useAlpha});
      else
        binarize(id.data,{threshold:sh.threshold, invert:sh.invert, useAlpha:sh.useAlpha, addColor255:sh.bool==='add'});
      tctx.putImageData(id,0,0);
      c.drawImage(tmp, sh.x, sh.y); // 外部像素已置透明,drawImage 天然只覆盖"内部"区域(见 binarize 注释)
    }
    else { c.font=FONT(sh.h); c.textAlign='center'; c.textBaseline='middle';
      c.fillText(sh.text, sh.x+sh.w/2, sh.y+sh.h/2); }
  }
}

// 光栅化一个状态:形状 → 蒙版,并刷新幽灵与缩略图。
export function rasterize(s){
  paintShapes(s.mctx, s.shapes);
  tintGhost(s); updateThumb(s);
}

// 幽灵:半透明染色版蒙版,编辑时叠加做洋葱皮/参考。
export function tintGhost(s){
  const src=s.mctx.getImageData(0,0,W,H),
        out=s.ghost.getContext('2d'), od=out.createImageData(W,H),
        [r,g,b]=hex2rgb(s.color);
  for(let i=0;i<src.data.length;i+=4){
    od.data[i]=r; od.data[i+1]=g; od.data[i+2]=b;
    od.data[i+3]=src.data[i]>127?42:0;
  }
  out.putImageData(od,0,0);
}

// 胶片条缩略图(96×56):蒙版乘状态色。
export function updateThumb(s){
  if(!s.thumb) return;
  const c=s.thumb.getContext('2d');
  c.fillStyle='#000'; c.fillRect(0,0,96,56);
  c.drawImage(s.mask,0,0,96,56);
  c.globalCompositeOperation='multiply';
  c.fillStyle=s.color; c.fillRect(0,0,96,56);
  c.globalCompositeOperation='source-over';
}

// 采样核心已抽到 samplers.sampleDots(纯函数,node 可测);这里转发保持既有引用路径。
export { sampleDots } from './samplers.js';

// 采样:蒙版 → dots(带半调亮度),并刷新点数显示。
export function resample(s){
  s.dots=sampleDots(readMask(s), s.manual, P, lumReaderFor(s.mctx));
  const cnt=$('cnt');
  if(cnt) cnt.textContent=store.states.map(st=>`${st.name}: ${st.dots.length}`).join(' · ');
  store.seqDirty=true;
}
export const resampleAll=()=>store.states.forEach(resample);

// 形状变动后统一入口。live=true(拖拽中)只重烧蒙版不重采样,松手时再采样。
export function shapesChanged(s,live){ rasterize(s); if(!live){ resample(s); store.seqDirty=true; } }
