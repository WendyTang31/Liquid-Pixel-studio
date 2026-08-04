// 图片导入编排:上传 → 缩放到工作分辨率 → Otsu 自动阈值 → 落地成 'image' 形状。
// 单张:加入当前状态;多张(图像序列):按文件名排序,每张自动建一个状态 ——
// 帧序列/逐帧素材直接变成状态机序列,复用全部既有管线。
import { W, H, P } from '../config.js';
import { store, cur } from '../store.js';
import { setHint } from '../utils.js';
import { pushUndo, makeState } from '../state.js';
import { shapesChanged, rasterize, resample } from '../pipeline.js';
import { luminanceHistogram, alphaHistogram, hasMeaningfulAlpha, otsuThreshold, decodeImageShape } from '../image.js';
import { importSvgShapes, importSvgAnimation, svgHasAnimation } from '../svg.js';
import { updateSelBox } from './inspector.js';
import { renderStrip, setActive } from './filmstrip.js';

const WORK_MAX=480;  // 工作分辨率上限:与画布同级即可,更高分辨率对最终蒙版无意义
const FIT_MAX=300;   // 导入后默认摆放尺寸上限(画布内留边距,可再拖拽缩放)

// 文件 → 已解码好的 'image' 形状(不入任何状态,由调用方安置)。
async function fileToImageShape(file){
  const dataURL=await new Promise((res,rej)=>{ const rd=new FileReader();
    rd.onload=()=>res(rd.result); rd.onerror=rej; rd.readAsDataURL(file); });
  const rawImg=await new Promise((res,rej)=>{ const img=new Image();
    img.onload=()=>res(img); img.onerror=rej; img.src=dataURL; });
  const scale=Math.min(1, WORK_MAX/Math.max(rawImg.width,rawImg.height));
  const ww=Math.max(1,Math.round(rawImg.width*scale)), wh=Math.max(1,Math.round(rawImg.height*scale));
  const work=document.createElement('canvas'); work.width=ww; work.height=wh;
  const wctx=work.getContext('2d',{willReadFrequently:true});
  wctx.drawImage(rawImg,0,0,ww,wh);
  const id=wctx.getImageData(0,0,ww,wh);
  const useAlpha=hasMeaningfulAlpha(id.data);
  const hist=useAlpha?alphaHistogram(id.data):luminanceHistogram(id.data);
  const threshold=otsuThreshold(hist);
  const fitScale=Math.min(1, FIT_MAX/Math.max(ww,wh));
  const dw=ww*fitScale, dh=wh*fitScale;
  const sh={ id:store.shapeId++, type:'image', x:(W-dw)/2, y:(H-dh)/2, w:dw, h:dh,
    bool:'add', imgDataURL:work.toDataURL('image/png'), threshold, invert:false, useAlpha };
  await decodeImageShape(sh); // 立即解码好,首次光栅化就能画出来,不留一帧空白
  return {sh, ww, wh};
}

export async function importImageFile(file){
  setHint('导入中…');
  const {sh, ww, wh}=await fileToImageShape(file);
  sh.bool=P.bool;
  const s=cur();
  pushUndo();
  s.shapes.push(sh); store.sel=sh; updateSelBox(); shapesChanged(s);
  setHint(`✓ 已导入图片(${ww}×${wh},自动阈值 ${sh.threshold}${sh.useAlpha?' · 按透明通道':''})`);
}

// SVG 导入(Illustrator 等):矢量轮廓带控制点 → 本工具 path 形状(锚点/贝塞尔柄保真)。
// 每个子路径成一个 path(实心显示);多个 = 多选,可「融合」并成一个、或整组木偶变形/贴车身。
// 含 SMIL 动画(<animateTransform> 骨架,如走路循环)→ 采样成多状态关键帧序列,无缝复现。
export async function importSvgFile(file){
  setHint('导入 SVG 中…');
  let text;
  try{ text=await file.text(); }catch(err){ setHint('⚠ 读取失败:'+err.message); return; }
  const base=file.name.replace(/\.[^.]+$/,'');
  // ── 动画 SVG:采样关键帧 → 每帧一个状态,肢体按 layerId 木偶变形无缝衔接 ──
  if(svgHasAnimation(text)){
    let anim;
    try{ anim=importSvgAnimation(text, W, H,
      ()=>store.layerSeq=(store.layerSeq||0)+1, ()=>store.shapeId++); }
    catch(err){ setHint('⚠ '+err.message); return; }
    if(anim && anim.frames.length){
      pushUndo();
      let at=store.active;
      const dur=Math.max(0.06, anim.cycleSec/anim.frames.length); // 逐帧过渡=周期/帧数,还原真实节奏
      const clipId=store.clipSeq=(store.clipSeq||0)+1; // 8 帧归为一个「动画片段(大图层)」,可整体缩放/移动/调速/循环
      anim.frames.forEach((shapes,i)=>{
        const st=makeState(`${base} ${i+1}`, cur().color);
        st.hold=0; st.dur=dur;
        st.clip={ id:clipId, name:base, loops:1 };
        st.shapes.push(...shapes);
        store.states.splice(++at, 0, st);
        rasterize(st); resample(st);
      });
      store.sel=null; updateSelBox();
      setActive(at); renderStrip(); store.seqDirty=true;
      const nLimb=anim.frames[0].length;
      setHint(`✓ 已导入 SVG 动画:${anim.frames.length} 帧关键帧 · ${nLimb} 个肢体(周期 ${anim.cycleSec.toFixed(2)}s,相邻帧木偶变形,无缝循环)`);
      return;
    }
  }
  let shapes;
  try{ shapes=importSvgShapes(text, W, H, ()=>store.shapeId++); }
  catch(err){ setHint('⚠ '+err.message); return; }
  if(!shapes.length){ setHint('⚠ 该 SVG 没有可导入的矢量形状'); return; }
  const s=cur();
  pushUndo();
  for(const sh of shapes) s.shapes.push(sh);
  store.sel=shapes[shapes.length-1]; store.selMulti=shapes.length>1?[...shapes]:[shapes[0]];
  updateSelBox(); shapesChanged(s);
  const nAnchor=shapes.reduce((a,sh)=>a+sh.points.length,0);
  setHint(`✓ 已导入 SVG:${shapes.length} 个矢量图形 · 共 ${nAnchor} 锚点(可编辑控制点 · 多选可「融合」/整组木偶变形)`);
}

// 图像序列:每张一个状态,插在当前状态之后,短停留/短过渡适合逐帧素材(可再逐个调)。
export async function importImageSequence(files){
  const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  setHint(`序列导入中 0/${sorted.length}…`);
  pushUndo();
  let at=store.active;
  for(let i=0;i<sorted.length;i++){
    const {sh}=await fileToImageShape(sorted[i]);
    const st=makeState(sorted[i].name.replace(/\.[^.]+$/,''), cur().color);
    st.hold=0.2; st.dur=0.8;
    st.shapes.push(sh);
    store.states.splice(++at, 0, st);
    rasterize(st); resample(st);
    setHint(`序列导入中 ${i+1}/${sorted.length}…`);
  }
  store.sel=null; updateSelBox();
  setActive(at); renderStrip(); store.seqDirty=true;
  setHint(`✓ 已按文件名顺序导入 ${sorted.length} 帧为 ${sorted.length} 个状态(停留0.2s/过渡0.8s,可逐个调整)`);
}
