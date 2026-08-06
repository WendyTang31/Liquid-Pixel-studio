// ✏ 编辑角色帧:把某个角色的帧【临时载入主时间轴】,于是所有现成工具(画/改形状、胶片条设每帧
// 停留/过渡时长、加删帧)都能直接用来编辑这个角色。撤销栈隔离(编辑期自成一摊,不污染主工程),
// 完成后把帧写回角色、恢复主时间轴。角色的整体缩放/旋转/位移仍在角色卡片上设(合成时施加)。
import { store } from '../store.js';
import { rebuildSequence } from '../sequence.js';
import { renderStrip, setActive, syncStateUI } from './filmstrip.js';
import { rasterize, resample } from '../pipeline.js';
import { setMode } from './stage.js';
import { renderCharacters } from './charpanel.js';
import { updateSelBox } from './inspector.js';
import { makeState } from '../state.js';
import { $, setHint } from '../utils.js';

// 角色帧(轻量对象:仅 shapes/hold/dur)→ 完整可编辑状态(带蒙版/幽灵画布等)。反之编辑器工具无法作用。
function toFullStates(frames){
  return frames.map(f=>{ const s=makeState(f.name||'帧', f.color||'#000');
    s.hold=f.hold||0; s.dur=f.dur||0.1; s.shapes=f.shapes||[]; s.manual=f.manual||[];
    s.trans=f.trans||{}; s.cam=f.cam||null; s.loop=f.loop||null; s.isPose=false;
    s.fx=f.fx||{}; s.guides=f.guides||[]; return s; });
}

export function enterCharEdit(ch){
  if(!ch) return;
  if(store.editingChar) exitCharEdit();                 // 先退出上一个
  store._mainStates=store.states; store._mainActive=store.active;   // 存主时间轴
  store._savedUndo=store.undoStack; store._savedRedo=store.redoStack; // 隔离撤销栈
  store.undoStack=[]; store.redoStack=[];
  store.editingChar=ch;
  store.states=toFullStates(ch.states); store.active=0; store.sel=null; store.selMulti=[];
  store.states.forEach(s=>{ rasterize(s); resample(s); });
  rebuildSequence(); setMode('edit');
  setActive(0); renderStrip(); syncStateUI(); updateSelBox();
  renderCharacters(); showEditBanner(ch);
  setHint(`✏ 正在编辑角色「${ch.name}」的帧 —— 用工具改图形、胶片条设每帧停留/过渡;完成点顶部「✓ 完成编辑角色」`);
}
export function exitCharEdit(){
  const ch=store.editingChar; if(!ch) return;
  ch.states=store.states; ch.seqDirty=true;             // 帧写回角色 → 下次合成用新帧
  store.editingChar=null;
  store.states=store._mainStates||[]; store.active=Math.min(store._mainActive||0, (store._mainStates?.length||1)-1);
  store.undoStack=store._savedUndo||[]; store.redoStack=store._savedRedo||[];
  store._mainStates=store._savedUndo=store._savedRedo=null;
  store.sel=null; store.selMulti=[];
  store.states.forEach(s=>{ rasterize(s); resample(s); });
  rebuildSequence();
  setActive(store.active); renderStrip(); syncStateUI(); updateSelBox();
  renderCharacters(); hideEditBanner();
  setHint(`✓ 已保存角色「${ch.name}」的帧改动`);
}
export const isEditingChar=()=>!!store.editingChar;

function showEditBanner(ch){
  let b=$('charEditBanner');
  if(!b){ b=document.createElement('div'); b.id='charEditBanner';
    b.style.cssText='position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:9998;'
      +'background:#0c1a22;border:1px solid #2cc4f5;border-radius:8px;padding:6px 12px;color:#dff;'
      +'font:13px system-ui;box-shadow:0 4px 16px rgba(0,0,0,.5);display:flex;align-items:center;gap:12px';
    document.body.appendChild(b); }
  b.innerHTML='';
  const label=document.createElement('span'); label.textContent=`✏ 编辑角色帧:${ch.name}(整体缩放/旋转/走位在左侧卡片)`;
  const done=document.createElement('button'); done.textContent='✓ 完成编辑角色';
  done.style.cssText='background:#2cc4f5;border:none;border-radius:6px;color:#012;font:13px system-ui;font-weight:700;cursor:pointer;padding:4px 10px';
  done.onclick=exitCharEdit;
  b.append(label,done); b.style.display='flex';
}
function hideEditBanner(){ const b=$('charEditBanner'); if(b) b.style.display='none'; }
