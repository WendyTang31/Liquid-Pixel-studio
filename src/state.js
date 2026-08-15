// 数据模型 + 撤销/重做 + 工程序列化。快照只碰"可序列化部分"(不含 canvas 对象),
// 严守数据层与画布对象分离的铁律。工程读取兼容 v3 的 A/B 与 v4 的 states。
import { W, H, P, applyParams } from './config.js';
import { store, cur } from './store.js';
import { setHint, downloadBlob } from './utils.js';
import { rasterize, resample } from './pipeline.js';
import { decodeImageShape } from './image.js';
import { scheduleAutosave } from './autosave.js';
import { renderStrip, syncStateUI } from './ui/filmstrip.js';
import { updateSelBox, syncUI } from './ui/inspector.js';
import { setMode } from './ui/stage.js';
import { serializeCharacters, loadCharacters } from './characters.js';
import { renderCharacters } from './ui/charpanel.js';

// 一个状态 = 形状对象 + 手动点 + 颜色 + 停留/过渡时长 + 派生的 dots 与画布缓存。
export function makeState(name,color){
  const mask=document.createElement('canvas'); mask.width=W; mask.height=H;
  const mctx=mask.getContext('2d',{willReadFrequently:true});
  mctx.fillStyle='#000'; mctx.fillRect(0,0,W,H);
  const ghost=document.createElement('canvas'); ghost.width=W; ghost.height=H;
  return {id:store.stateId++, name, color, hold:1.0, dur:3.0, trans:{}, cam:null, fx:{}, guides:[],
          shapes:[], manual:[], dots:[], mask, mctx, ghost, thumb:null};
}

// 序列化:只留数据字段,深拷贝 shapes/manual。cam/isPose/loop 缺省时不写入,老工程原样可读。
export const serializeStates=(arr=store.states)=>arr.map(s=>({id:s.id,name:s.name,color:s.color,hold:s.hold,dur:s.dur,
  trans:JSON.parse(JSON.stringify(s.trans||{})), cam:s.cam?{...s.cam}:undefined,
  isPose:s.isPose||undefined, loop:s.loop?{...s.loop}:undefined, solid:s.solid||undefined,
  clip:s.clip?{...s.clip}:undefined,
  fx:(s.fx&&Object.keys(s.fx).length)?{...s.fx}:undefined,
  guides:s.guides?.length?JSON.parse(JSON.stringify(s.guides)):undefined,
  shapes:JSON.parse(JSON.stringify(s.shapes)), manual:JSON.parse(JSON.stringify(s.manual))}));
// 快照含角色列表 → Ctrl+Z 能撤销角色的增/删/组合/粘贴等。编辑角色帧时(撤销栈已隔离)只存帧、
// 不动角色列表,以免 hydrate 重建角色对象、打断 editingChar 引用。
const snapshot=()=> store.editingChar
  ? {states:serializeStates(), active:store.active}
  : {states:serializeStates(), active:store.active, characters:serializeCharacters()};

export function pushUndo(){ store.undoStack.push(snapshot());
  if(store.undoStack.length>60) store.undoStack.shift(); store.redoStack.length=0;
  scheduleAutosave(); } // 每个可撤销动作都触发即时存档(PS 式:编辑不因切页丢失)

// 从快照/工程重建全部状态(重新分配 id,重烧蒙版并采样)。
export function hydrate(data){
  store.states=data.states.map(d=>{
    const s=makeState(d.name,d.color);
    Object.assign(s,{id:d.id,hold:d.hold,dur:d.dur,shapes:d.shapes,manual:d.manual,
      trans:d.trans||{}, cam:d.cam||null, isPose:d.isPose||false, loop:d.loop||null,
      fx:d.fx||{}, guides:d.guides||[], clip:d.clip||null});
    // 兼容:上一版是"状态级实心",迁移为逐形状 solidFill(rasterize 会重推导 s.solid)
    if(d.solid) s.shapes.forEach(sh=>{ if(sh.bool!=='sub') sh.solidFill=true; });
    return s;
  });
  store.stateId=Math.max(1,...store.states.map(s=>s.id))+1;
  store.shapeId=Math.max(1,...store.states.flatMap(s=>s.shapes.map(sh=>sh.id||0)))+1;
  store.layerSeq=Math.max(0,...store.states.flatMap(s=>s.shapes.map(sh=>sh.layerId||0))); // 关联图层号续接,防冲突
  store.clipSeq=Math.max(0,...store.states.map(s=>s.clip?.id||0)); // 片段号续接,防冲突
  store.active=Math.min(data.active??0, store.states.length-1);
  store.sel=null; updateSelBox();
  store.states.forEach(s=>{rasterize(s); resample(s);});
  if(data.characters && !store.editingChar){ loadCharacters(data.characters); renderCharacters(); } // 🚶 撤销/重做恢复角色列表
  renderStrip(); syncStateUI(); store.seqDirty=true;
  reviveImageShapes();
}

// 图片形状的 _img(解码好的 <img>)是运行时缓存,JSON 往返(工程打开/撤销/重做)后会丢失
// 只留 imgDataURL。这里异步补解码,完了针对受影响的状态再刷一遍光栅化/采样 —— 因为按 dataURL
// 缓存(见 image.js),多数情况下命中缓存、近乎瞬时,肉眼很难察觉这次"补一帧"。
function reviveImageShapes(){
  const pending=[];
  for(const s of store.states) for(const sh of s.shapes)
    if(sh.type==='image' && !sh._img)
      pending.push(decodeImageShape(sh).then(()=>{ rasterize(s); resample(s); }));
  if(pending.length) Promise.all(pending).then(()=>{ renderStrip(); store.seqDirty=true; });
}
// 组尾:从 i 起连续 isPose 的最后一格。新增/复制状态要插到组尾之后,
// 否则会插进"主状态与其姿态"之间,把后续姿态错认给新状态。
export function groupTail(i){
  let j=i; while(j+1<store.states.length && store.states[j+1].isPose) j++; return j;
}

export function undo(){ if(!store.undoStack.length){setHint('没有可撤销的步骤');return;}
  store.redoStack.push(snapshot()); hydrate(store.undoStack.pop());
  setHint(`↩ 已撤销(剩 ${store.undoStack.length} 步)`); }
export function redo(){ if(!store.redoStack.length){setHint('没有可重做的步骤');return;}
  store.undoStack.push(snapshot()); hydrate(store.redoStack.pop());
  setHint('↪ 已重做'); }

// 3D 投影面布局随工程一起存:3D 预览器把每块投影面(位置/大小/旋转/取景框/所属车面 meshIdx/
// 擦除蒙版/车身上色)写在 localStorage['morph3d-view'],UV 取景写在 ['morph-uvlayout']。
// 保存工程时把这两块快照进 JSON,打开时再写回 localStorage —— 于是"哪块动画贴在车的哪个面、多大、
// 在哪"随工程一并保存,不再只剩当前会话的临时状态。(车模 .glb 仍需按原流程载入,布局按 meshIdx 对位恢复。)
function read3dView(){
  const out={};
  try{ const v=localStorage.getItem('morph3d-view'); if(v) out.view3d=JSON.parse(v); }catch(_){}
  try{ const u=localStorage.getItem('morph-uvlayout'); if(u) out.uvlayout=JSON.parse(u); }catch(_){}
  return out;
}
export function restore3dView(data){
  try{ if(data.view3d) localStorage.setItem('morph3d-view', JSON.stringify(data.view3d)); }catch(_){}
  try{ if(data.uvlayout) localStorage.setItem('morph-uvlayout', JSON.stringify(data.uvlayout)); }catch(_){}
}

export function saveProject(){
  const v=read3dView();
  const nDecal=v.view3d?.decals?.length||0;
  downloadBlob(new Blob([JSON.stringify(
    {version:4, states:serializeStates(store.editingChar?store._mainStates:store.states), active:store.active, params:P,
     characters:serializeCharacters(),
     view3d:v.view3d, uvlayout:v.uvlayout}, null, 2)],
    {type:'application/json'}),
    `morph-project-${new Date().toISOString().slice(0,10)}.json`);
  setHint(nDecal? `✓ 工程已保存(含 ${nDecal} 块 3D 投影面的位置/大小/所属车面),下次 📂 打开继续`
                : '✓ 工程已保存,下次 📂 打开继续');
}

export function loadProject(data){
  try{
    pushUndo();
    if(data.states){ /* v4 */
      if(data.params) applyParams(data.params);
      hydrate({states:data.states, active:data.active??0});
      loadCharacters(data.characters); renderCharacters(); // 🚶 并行角色轨随工程恢复
    } else if(data.A||data.B){ /* v3 兼容:A/B → 两个状态 */
      if(data.params) applyParams(data.params);
      const cA=data.params?.colA||'#98f5d0', cB=data.params?.colB||'#98f5d0';
      hydrate({states:[
        {id:1,name:'状态 1',color:cA,hold:1,dur:3,shapes:data.A?.shapes||[],manual:data.A?.manual||[]},
        {id:2,name:'状态 2',color:cB,hold:1,dur:3,shapes:data.B?.shapes||[],manual:data.B?.manual||[]},
      ], active:0});
    } else throw new Error('无法识别的格式');
    restore3dView(data); // 3D 投影面布局写回 localStorage,供 3D 预览器恢复
    syncUI(); setMode('play');
    const nDecal=data.view3d?.decals?.length||0;
    setHint(nDecal? `✓ 工程已载入(含 ${nDecal} 块 3D 投影面布局 — 打开「3D 预览」载入同一车模即恢复位置)`
                  : '✓ 工程已载入');
  }catch(err){ setHint('⚠ 工程文件解析失败:'+err.message); }
}
