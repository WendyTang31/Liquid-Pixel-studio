// PS 式工作会话:每次可撤销的改动(pushUndo)后立即(去抖 400ms)把工程写入 localStorage,
// 页面隐藏/离开时同步兜底 —— 编辑永不因切页丢失,直到用户主动"🗑 全部"或另开工程。
// serialize 由 main.js 注入(避免 state↔main 的环依赖)。
let timer=null, serializeFn=null;

export function initAutosave(serialize){ serializeFn=serialize; }

export function autosaveNow(){
  if(!serializeFn) return;
  try{ localStorage.setItem('morph-autosave', JSON.stringify(serializeFn())); }catch(_){}
}

export function scheduleAutosave(){
  if(!serializeFn) return;
  clearTimeout(timer); timer=setTimeout(autosaveNow, 400);
}
