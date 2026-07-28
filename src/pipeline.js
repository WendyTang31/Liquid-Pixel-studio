// 管线层:形状 → 光栅化蒙版 → 采样成点。这里是数据层(shapes)与画布对象(mask/ghost/thumb)
// 唯一合法的交汇处;纯引擎/采样只吃它产出的 dots。
import { W, H } from './config.js';
import { P } from './config.js';
import { store } from './store.js';
import { $, FONT, hex2rgb } from './utils.js';
import { SAMPLERS, sampleDots, samplePtsFit, distanceField } from './samplers.js';
import { fillSmoothClosedPath } from './path.js';
import { binarize, grayscaleize, quantizeColors } from './image.js';
import { solveConstraints } from './constraints.js';

// 蒙版读取器:R 通道 >127 = 形状内(放置);G 通道 = 亮度(半调用,普通形状画白 G=255 → B=1)。
// maskReaderFor/lumReaderFor 接任意 2D 上下文(3D 预览器自建蒙版复用)。
export const maskReaderFor=mctx=>{ const d=mctx.getImageData(0,0,W,H).data;
  return (x,y)=> x>=0&&y>=0&&x<W&&y<H && d[(y*W+x)*4]>127; };
export const lumReaderFor=mctx=>{ const d=mctx.getImageData(0,0,W,H).data;
  return (x,y)=> x>=0&&y>=0&&x<W&&y<H ? d[(y*W+x)*4+1]/255 : 0; };
// 彩色读取器:量化色画布(alpha>0 处)→ [r,g,b],否则 null(用状态色)。
export const colorReaderFor=cctx=>{ const d=cctx.getImageData(0,0,W,H).data;
  return (x,y)=>{ if(x<0||y<0||x>=W||y>=H) return null;
    const i=(y*W+x)*4; return d[i+3]>64 ? [d[i],d[i+1],d[i+2]] : null; }; };
export const readMask=s=>maskReaderFor(s.mctx);

// 文字量度只依赖字体串,与具体画布无关 —— 用独立 scratch context,
// 免得像 legacy 那样依赖 states[0](初始化时序列尚空,取 states[0] 会炸)。
const _measCtx=document.createElement('canvas').getContext('2d');
export function measureText(txt,size){ _measCtx.font=FONT(size);
  return _measCtx.measureText(txt).width; }

// 彩色图片形状:懒生成量化版画布 sh._imgQ(k-means 主色 + 背景剔除;非可枚举,不进工程文件)。
function ensureQuantized(sh){
  if(sh._imgQ||!sh._img) return;
  const tw=Math.max(1,Math.round(sh._img.naturalWidth||sh._img.width));
  const th=Math.max(1,Math.round(sh._img.naturalHeight||sh._img.height));
  const q=document.createElement('canvas'); q.width=tw; q.height=th;
  const qc=q.getContext('2d',{willReadFrequently:true});
  qc.drawImage(sh._img,0,0);
  const id=qc.getImageData(0,0,tw,th);
  quantizeColors(id.data, tw, th, sh.colorK||6);
  qc.putImageData(id,0,0);
  Object.defineProperty(sh,'_imgQ',{value:q,enumerable:false,configurable:true});
}

// 把形状列表画进任意蒙版上下文(add=白,sub=黑)。colorCtx 若给出,同时把彩色图片形状的
// 量化主色画进去(sub 形状同步擦除)—— 逐点颜色采样的数据源。纯绘制,不碰 store。
export function paintShapes(c, shapes, colorCtx=null){
  shapes=shapes.filter(sh=>!sh.hidden); // 图层面板"隐藏":不进蒙版 = 不出点(sub 隐藏则恢复被挖区域)
  c.fillStyle='#000'; c.fillRect(0,0,W,H);
  if(colorCtx) colorCtx.clearRect(0,0,W,H);
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
      if(sh.colorful && sh.bool==='add'){
        ensureQuantized(sh);
        tctx.drawImage(sh._imgQ,0,0,tw,th);
        const id=tctx.getImageData(0,0,tw,th);
        // 蒙版:量化后非透明即放置,G=主色亮度(半调可叠加)
        const md=tctx.createImageData(tw,th);
        for(let i=0;i<id.data.length;i+=4){
          const a=id.data[i+3]>64;
          const v=Math.min(255,Math.round(0.2126*id.data[i]+0.7152*id.data[i+1]+0.0722*id.data[i+2]));
          md.data[i]=a?255:0; md.data[i+1]=a?(sh.halftone?v:255):0; md.data[i+2]=md.data[i+1];
          md.data[i+3]=a?255:0;
        }
        const m2=document.createElement('canvas'); m2.width=tw; m2.height=th;
        m2.getContext('2d').putImageData(md,0,0);
        c.drawImage(m2, sh.x, sh.y);
        if(colorCtx){ tctx.putImageData(id,0,0); colorCtx.drawImage(tmp, sh.x, sh.y); }
        continue;
      }
      tctx.drawImage(sh._img,0,0,tw,th);
      const id=tctx.getImageData(0,0,tw,th);
      if(sh.halftone && sh.bool==='add')
        grayscaleize(id.data,{threshold:sh.threshold, invert:sh.invert, useAlpha:sh.useAlpha});
      else
        binarize(id.data,{threshold:sh.threshold, invert:sh.invert, useAlpha:sh.useAlpha, addColor255:sh.bool==='add'});
      tctx.putImageData(id,0,0);
      c.drawImage(tmp, sh.x, sh.y); // 外部像素已置透明,drawImage 天然只覆盖"内部"区域(见 binarize 注释)
      if(colorCtx && sh.bool==='sub'){ // 挖除也要从彩色画布上擦掉
        colorCtx.save(); colorCtx.globalCompositeOperation='destination-out';
        colorCtx.drawImage(tmp, sh.x, sh.y); colorCtx.restore();
      }
    }
    else { c.font=FONT(sh.h); c.textAlign='center'; c.textBaseline='middle';
      c.fillText(sh.text, sh.x+sh.w/2, sh.y+sh.h/2); }
    // 非图片的 sub 形状同步从彩色画布擦除
    if(colorCtx && sh.bool==='sub' && sh.type!=='image'){
      colorCtx.save(); colorCtx.globalCompositeOperation='destination-out';
      colorCtx.fillStyle='#fff';
      if(sh.type==='rect') colorCtx.fillRect(sh.x,sh.y,sh.w,sh.h);
      else if(sh.type==='ellipse'){ colorCtx.beginPath();
        colorCtx.ellipse(sh.x+sh.w/2,sh.y+sh.h/2,sh.w/2,sh.h/2,0,0,7); colorCtx.fill(); }
      else if(sh.type==='path'){ if(fillSmoothClosedPath(colorCtx,sh.points)) colorCtx.fill(); }
      else { colorCtx.font=FONT(sh.h); colorCtx.textAlign='center'; colorCtx.textBaseline='middle';
        colorCtx.fillText(sh.text, sh.x+sh.w/2, sh.y+sh.h/2); }
      colorCtx.restore();
    }
  }
}

// 光栅化一个状态:形状 → 蒙版,并刷新幽灵与缩略图。
// 实心状态同步重算蒙版距离场(_sdf,运行时字段不入档)—— 实心渲染的边缘数据源。
export function rasterize(s){
  paintShapes(s.mctx, s.shapes);
  // 🧱 实心是逐形状选项(sh.solidFill):SDF 只由实心形状(带全部 sub)构成,
  // 与其它形状/采样算法互不干扰;state.solid 为派生标记(供引擎权重窗口用)。
  const solids=s.shapes.filter(sh=>sh.solidFill&&sh.bool!=='sub'&&!sh.hidden);
  s.solid=solids.length>0;
  s._sdf = s.solid ? shapesSdf([...solids, ...s.shapes.filter(sh=>sh.bool==='sub')]) : null;
  tintGhost(s); updateThumb(s);
}

// 任意形状列表 → 距离场(3D 预览器载入工程时用,编辑器直接走 rasterize)。
export function shapesSdf(shapes){
  paintShapes(_smActx, shapes);
  return distanceField(maskReaderFor(_smActx));
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

// 胶片条缩略图:蒙版乘状态色。尺寸随缩略画布走(主状态 96×56,循环姿态 68×40)。
export function updateThumb(s){
  if(!s.thumb) return;
  const c=s.thumb.getContext('2d'), tw=s.thumb.width, th=s.thumb.height;
  c.fillStyle='#000'; c.fillRect(0,0,tw,th);
  c.drawImage(s.mask,0,0,tw,th);
  c.globalCompositeOperation='multiply';
  c.fillStyle=s.color; c.fillRect(0,0,tw,th);
  c.globalCompositeOperation='source-over';
}

// 采样核心已抽到 samplers.sampleDots(纯函数,node 可测);这里转发保持既有引用路径。
export { sampleDots } from './samplers.js';

// 复用的采样草稿画布(蒙版 + 彩色各一对):resample 不再碰状态自身的显示蒙版。
const _smA=document.createElement('canvas'); _smA.width=W; _smA.height=H;
const _smActx=_smA.getContext('2d',{willReadFrequently:true});
const _scA=document.createElement('canvas'); _scA.width=W; _scA.height=H;
const _scActx=_scA.getContext('2d',{willReadFrequently:true});

// 状态级采样核心:支持逐形状采样覆盖(sh.sampler)与目标点数(sh.count)、彩色逐点色。
// 覆盖形状各自单独光栅化(带全部 sub 形状)后用自己的采样器/点数取点;其余走全局设置。
// 编辑器 resample 与 3D 预览器共用,保证两端 dots 一致。
export function stateDots(shapes, manual, Pp){
  shapes=shapes.filter(sh=>!sh.hidden); // 隐藏形状连"逐形状覆盖采样"通道也不走
  const hasOv=sh=>sh.sampler||sh.count||(sh.rscale&&Math.abs(sh.rscale-1)>0.01);
  const subs=shapes.filter(sh=>sh.bool==='sub');
  const overridden=shapes.filter(sh=>sh.bool!=='sub' && hasOv(sh));
  const defaults=shapes.filter(sh=>sh.bool!=='sub' && !hasOv(sh));
  let dots=[];
  // 默认组
  paintShapes(_smActx, [...defaults, ...subs], _scActx);
  dots=dots.concat(sampleDots(maskReaderFor(_smActx), manual, Pp,
    lumReaderFor(_smActx), colorReaderFor(_scActx)));
  // 覆盖组:逐形状独立采样
  for(const sh of overridden){
    paintShapes(_smActx, [sh, ...subs], _scActx);
    const on=maskReaderFor(_smActx), lum=lumReaderFor(_smActx), colR=colorReaderFor(_scActx);
    const pts=samplePtsFit(sh.sampler||Pp.sample, on, Pp.spacing, Pp.jitter, sh.count||null, lum);
    const base=Pp.dotR/W, rs=sh.rscale||1; // 半径×:笔画/智能缩放自带半径,普通采样缩放全局半径
    for(const p of pts){
      const d = p[2]!==undefined
        ? {x:p[0]/W, y:p[1]/H, r:p[2]*rs/W}
        : {x:p[0]/W, y:p[1]/H,
           r:base*rs*Math.sqrt(Math.max(0.06,lum(Math.round(p[0]),Math.round(p[1]))))};
      const c=colR(Math.round(p[0]),Math.round(p[1])); if(c) d.c=c;
      dots.push(d);
    }
  }
  if(dots.length>1500){ const k=Math.ceil(dots.length/1500); dots=dots.filter((_,i)=>i%k===0); }
  // 🧱 实心标记:落在实心形状蒙版内的点打 sf 标 —— 停留期间被抑制(边缘=纯矢量),
  // 过渡时随实心场衰减平滑长出(这也是根治停留↔过渡边界"点突然出现"卡顿的关键)。
  const solids=shapes.filter(sh=>sh.solidFill&&sh.bool!=='sub');
  if(solids.length){
    paintShapes(_smActx, [...solids, ...shapes.filter(sh=>sh.bool==='sub')]);
    const on=maskReaderFor(_smActx);
    for(const d of dots) if(on(Math.round(d.x*W), Math.round(d.y*H))) d.sf=1;
  }
  return dots;
}

// 采样:形状 → dots,并刷新点数显示。
export function resample(s){
  s.dots=stateDots(s.shapes, s.manual, P);
  const cnt=$('cnt');
  if(cnt) cnt.textContent=store.states.map(st=>`${st.name}: ${st.dots.length}`).join(' · ');
  store.seqDirty=true;
}
export const resampleAll=()=>store.states.forEach(resample);

// 形状变动后统一入口。live=true(拖拽中)只重烧蒙版不重采样,松手时再采样。
export function shapesChanged(s,live){ solveConstraints(s); rasterize(s); if(!live){ resample(s); store.seqDirty=true; } }
