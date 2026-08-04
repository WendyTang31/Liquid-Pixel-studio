// PS 式工作会话:每次可撤销的改动(pushUndo)后立即(去抖 400ms)把工程写入 localStorage,
// 页面隐藏/离开时同步兜底 —— 编辑永不因切页丢失,直到用户主动"🗑 全部"或另开工程。
// serialize 由 main.js 注入(避免 state↔main 的环依赖)。
// 存档槽 key 可切换:多窗口隔离时,副窗口写自己的槽,不覆盖主窗口的 'morph-autosave'(见 main.js)。
let timer=null, serializeFn=null, key='morph-autosave';

export function initAutosave(serialize){ serializeFn=serialize; }
export function setAutosaveKey(k){ if(k) key=k; }
export function getAutosaveKey(){ return key; }

export function autosaveNow(){
  if(!serializeFn) return;
  try{ localStorage.setItem(key, JSON.stringify(serializeFn())); }catch(_){}
}

export function scheduleAutosave(){
  if(!serializeFn) return;
  clearTimeout(timer); timer=setTimeout(autosaveNow, 400);
}
