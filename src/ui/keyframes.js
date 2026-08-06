// 关键帧多选(胶片条 Shift+点选)→ 复制 / 粘贴 / 整体缩放移动 / 删除。作用对象 = store.selStates。
// 粘贴的帧保留 clip 与 layerId(与原片段同链)→ 复制走路的 8 帧、往后接一份再整体右移,即"下一圈更往前走"。
import { store } from '../store.js';
import { setHint } from '../utils.js';
import { pushUndo, makeState } from '../state.js';
import { rasterize, resample, updateThumb } from '../pipeline.js';
import { renderStrip, setActive } from './filmstrip.js';
import { updateSelBox } from './inspector.js';
import { transformStates } from '../clip.js';

let clipboard=[]; // 复制的关键帧(序列化数据,可反复粘贴)
export const hasClipboard = () => clipboard.length>0;
// 作用对象:多选集合;为空则退回当前帧。升序去重。
const sel = () => { const a=(store.selStates&&store.selStates.length)?[...new Set(store.selStates)]:[store.active];
  return a.filter(i=>i>=0&&i<store.states.length).sort((x,y)=>x-y); };

function serializeState(s){
  return { name:s.name, color:s.color, hold:s.hold, dur:s.dur,
    trans:JSON.parse(JSON.stringify(s.trans||{})), cam:s.cam?{...s.cam}:null,
    isPose:s.isPose||false, loop:s.loop?{...s.loop}:null,
    fx:s.fx?{...s.fx}:{}, guides:s.guides?JSON.parse(JSON.stringify(s.guides)):[],
    clip:s.clip?{...s.clip}:null,
    shapes:JSON.parse(JSON.stringify(s.shapes)), manual:JSON.parse(JSON.stringify(s.manual||[])) };
}
function buildState(d){
  const s=makeState(d.name, d.color);
  Object.assign(s,{ hold:d.hold, dur:d.dur, trans:d.trans||{}, cam:d.cam||null,
    isPose:d.isPose||false, loop:d.loop||null, fx:d.fx||{}, guides:d.guides||[],
    clip:d.clip||null, shapes:d.shapes, manual:d.manual||[] });
  s.shapes.forEach(sh=>{ sh.id=store.shapeId++; }); // 形状 id 重分配(layerId 保留 → 与原片段同链续接木偶变形)
  return s;
}

export function copyKeyframes(){
  const idx=sel(); clipboard=idx.map(i=>serializeState(store.states[i]));
  renderStrip(); // 重绘操作条,让 📌 粘贴按钮出现
  setHint(`📋 已复制 ${clipboard.length} 个关键帧 — 📌 或 Ctrl+V 粘贴到后面`);
}
export function pasteKeyframes(){
  if(!clipboard.length){ setHint('剪贴板没有关键帧'); return; }
  pushUndo();
  let at=Math.max(...sel()); const newIdx=[];
  for(const d of clipboard){ const s=buildState(d); store.states.splice(++at,0,s);
    rasterize(s); resample(s); newIdx.push(at); }
  store.selStates=newIdx; setActive(newIdx[0]); store.selStates=newIdx; renderStrip(); store.seqDirty=true;
  setHint(`📌 已粘贴 ${clipboard.length} 帧(已选中新帧 —— 整体右移即让下一圈往前走)`);
}
// ✂ 剪切:复制到剪贴板 + 从当前时间轴删除。用于把帧从一个角色/主时间轴挪到另一个角色:
// Ctrl+X 剪 → 「＋新建角色」进它的编辑 → Ctrl+V 贴入。
export function cutKeyframes(){
  const idx=sel(); if(!idx.length) return;
  if(idx.length>=store.states.length){ setHint('⚠ 不能剪切全部帧(至少留 1 帧);想全部转移请先「＋新建角色」再逐段挪'); return; }
  clipboard=idx.map(i=>serializeState(store.states[i]));
  pushUndo();
  for(const i of [...idx].sort((a,b)=>b-a)) store.states.splice(i,1);
  store.selStates=[]; setActive(Math.max(0, Math.min(idx[0], store.states.length-1)));
  renderStrip(); store.seqDirty=true;
  setHint(`✂ 已剪切 ${clipboard.length} 帧 —— 到目标角色(可「＋新建角色」)里 Ctrl+V 贴入`);
}
export function transformKeyframes(opts){
  const idx=sel(); if(!idx.length) return; pushUndo();
  transformStates(store.states, idx, opts);
  for(const i of idx){ rasterize(store.states[i]); resample(store.states[i]); updateThumb(store.states[i]); }
  renderStrip(); updateSelBox(); store.seqDirty=true;
}
export function deleteKeyframes(){
  const idx=sel(); if(idx.length>=store.states.length){ setHint('⚠ 不能删除全部状态'); return; }
  pushUndo();
  for(const i of [...idx].sort((a,b)=>b-a)) store.states.splice(i,1);
  store.selStates=[]; setActive(Math.max(0, Math.min(idx[0], store.states.length-1)));
  renderStrip(); store.seqDirty=true;
  setHint(`🗑 已删除 ${idx.length} 个关键帧`);
}

// 键盘:Ctrl/⌘+C 复制、Ctrl/⌘+V 粘贴关键帧(焦点不在输入框、编辑模式、有多选时)。
export function initKeyframeKeys(){
  addEventListener('keydown', e=>{
    const tag=(document.activeElement?.tagName||'').toLowerCase();
    if(tag==='input'||tag==='textarea'||tag==='select'||store.mode==='play') return;
    if(!(e.ctrlKey||e.metaKey)) return;
    if(e.key==='c' && store.selStates?.length>=1){ copyKeyframes(); e.preventDefault(); }
    else if(e.key==='x' && store.selStates?.length>=1){ cutKeyframes(); e.preventDefault(); }   // ✂ 剪切帧
    else if(e.key==='v' && clipboard.length){ pasteKeyframes(); e.preventDefault(); }
  });
}
