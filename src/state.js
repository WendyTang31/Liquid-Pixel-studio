// 数据模型 + 撤销/重做 + 工程序列化。快照只碰"可序列化部分"(不含 canvas 对象),
// 严守数据层与画布对象分离的铁律。工程读取兼容 v3 的 A/B 与 v4 的 states。
import { W, H, P } from './config.js';
import { store, cur } from './store.js';
import { setHint, downloadBlob } from './utils.js';
import { rasterize, resample } from './pipeline.js';
import { decodeImageShape } from './image.js';
import { renderStrip, syncStateUI } from './ui/filmstrip.js';
import { updateSelBox, syncUI } from './ui/inspector.js';
import { setMode } from './ui/stage.js';

// 一个状态 = 形状对象 + 手动点 + 颜色 + 停留/过渡时长 + 派生的 dots 与画布缓存。
export function makeState(name,color){
  const mask=document.createElement('canvas'); mask.width=W; mask.height=H;
  const mctx=mask.getContext('2d',{willReadFrequently:true});
  mctx.fillStyle='#000'; mctx.fillRect(0,0,W,H);
  const ghost=document.createElement('canvas'); ghost.width=W; ghost.height=H;
  return {id:store.stateId++, name, color, hold:1.0, dur:3.0, trans:{},
          shapes:[], manual:[], dots:[], mask, mctx, ghost, thumb:null};
}

// 序列化:只留数据字段,深拷贝 shapes/manual。
export const serializeStates=()=>store.states.map(s=>({id:s.id,name:s.name,color:s.color,hold:s.hold,dur:s.dur,
  trans:JSON.parse(JSON.stringify(s.trans||{})),
  shapes:JSON.parse(JSON.stringify(s.shapes)), manual:JSON.parse(JSON.stringify(s.manual))}));
const snapshot=()=>({states:serializeStates(), active:store.active});

export function pushUndo(){ store.undoStack.push(snapshot());
  if(store.undoStack.length>60) store.undoStack.shift(); store.redoStack.length=0; }

// 从快照/工程重建全部状态(重新分配 id,重烧蒙版并采样)。
export function hydrate(data){
  store.states=data.states.map(d=>{
    const s=makeState(d.name,d.color);
    Object.assign(s,{id:d.id,hold:d.hold,dur:d.dur,shapes:d.shapes,manual:d.manual,trans:d.trans||{}});
    return s;
  });
  store.stateId=Math.max(1,...store.states.map(s=>s.id))+1;
  store.shapeId=Math.max(1,...store.states.flatMap(s=>s.shapes.map(sh=>sh.id||0)))+1;
  store.active=Math.min(data.active??0, store.states.length-1);
  store.sel=null; updateSelBox();
  store.states.forEach(s=>{rasterize(s); resample(s);});
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
export function undo(){ if(!store.undoStack.length){setHint('没有可撤销的步骤');return;}
  store.redoStack.push(snapshot()); hydrate(store.undoStack.pop());
  setHint(`↩ 已撤销(剩 ${store.undoStack.length} 步)`); }
export function redo(){ if(!store.redoStack.length){setHint('没有可重做的步骤');return;}
  store.undoStack.push(snapshot()); hydrate(store.redoStack.pop());
  setHint('↪ 已重做'); }

export function saveProject(){
  downloadBlob(new Blob([JSON.stringify(
    {version:4, states:serializeStates(), active:store.active, params:P}, null, 2)],
    {type:'application/json'}),
    `morph-project-${new Date().toISOString().slice(0,10)}.json`);
  setHint('✓ 工程已保存,下次 📂 打开继续');
}

export function loadProject(data){
  try{
    pushUndo();
    if(data.states){ /* v4 */
      if(data.params) Object.assign(P, data.params);
      hydrate({states:data.states, active:data.active??0});
    } else if(data.A||data.B){ /* v3 兼容:A/B → 两个状态 */
      if(data.params) Object.assign(P, data.params);
      const cA=data.params?.colA||'#98f5d0', cB=data.params?.colB||'#98f5d0';
      hydrate({states:[
        {id:1,name:'状态 1',color:cA,hold:1,dur:3,shapes:data.A?.shapes||[],manual:data.A?.manual||[]},
        {id:2,name:'状态 2',color:cB,hold:1,dur:3,shapes:data.B?.shapes||[],manual:data.B?.manual||[]},
      ], active:0});
    } else throw new Error('无法识别的格式');
    syncUI(); setMode('play');
    setHint('✓ 工程已载入');
  }catch(err){ setHint('⚠ 工程文件解析失败:'+err.message); }
}
