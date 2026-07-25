// 图片导入编排:上传 → 缩放到工作分辨率 → Otsu 自动阈值 → 落地成 'image' 形状。
// 单张:加入当前状态;多张(图像序列):按文件名排序,每张自动建一个状态 ——
// 帧序列/逐帧素材直接变成状态机序列,复用全部既有管线。
import { W, H, P } from '../config.js';
import { store, cur } from '../store.js';
import { setHint } from '../utils.js';
import { pushUndo, makeState } from '../state.js';
import { shapesChanged, rasterize, resample } from '../pipeline.js';
import { luminanceHistogram, alphaHistogram, hasMeaningfulAlpha, otsuThreshold, decodeImageShape } from '../image.js';
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
