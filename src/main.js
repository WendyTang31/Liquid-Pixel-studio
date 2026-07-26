// 装配层:接线顶栏按钮、初始化各 UI 模块、铺三状态启动示例、开跑主循环。
import { W, H, P } from './config.js';
import { store, cur } from './store.js';
import { $, setHint } from './utils.js';
import { makeState, pushUndo, saveProject, loadProject, serializeStates, hydrate } from './state.js';
import { rasterize, resample, measureText, shapesChanged } from './pipeline.js';
import { renderStrip, syncStateUI } from './ui/filmstrip.js';
import { syncUI, updateSelBox, initInspector } from './ui/inspector.js';
import { initToolbar } from './ui/toolbar.js';
import { initStage, setMode, startLoop } from './ui/stage.js';
import { importImageFile, importImageSequence } from './ui/imageImport.js';
import { initAutosave, autosaveNow } from './autosave.js';
import { initSkinRef } from './ui/skinRef.js';

// ── 顶栏:组操作 + 工程 ──
function initTopbar(){
  $('clearGrp').onclick=()=>{ if(store.mode==='play')return; pushUndo();
    const s=cur(); s.shapes.length=0; s.manual.length=0; store.sel=null;
    updateSelBox(); shapesChanged(s); };
  $('clearAll').onclick=()=>{ pushUndo();
    store.states.forEach(s=>{s.shapes.length=0; s.manual.length=0;});
    store.sel=null; updateSelBox();
    store.states.forEach(s=>{rasterize(s); resample(s);});
    setMode('edit'); setHint('已全部清空 ✓ (Ctrl+Z 可撤销)'); };
  $('copyBtn').onclick=()=>{ navigator.clipboard?.writeText(JSON.stringify(
    {states:store.states.map(s=>({name:s.name, color:s.color, dots:s.dots})), params:P}, null, 2));
    setHint('已复制点集(资产用;续档请用 💾 保存工程)'); };
  $('saveBtn').onclick=saveProject;
  $('openBtn').onclick=()=>$('openFile').click();
  $('openFile').addEventListener('change',e=>{
    const f=e.target.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=()=>loadProject(JSON.parse(rd.result));
    rd.readAsText(f); e.target.value='';
  });
  $('view3dBtn').onclick=()=>{
    autosave();
    try{ localStorage.setItem('morph3d-project', JSON.stringify(
      {version:4, states:serializeStates(), active:store.active, params:P})); }catch(_){}
    // 同窗切换(PS 式单窗口工作流):window.open 会造成两个编辑器实例
    // 各自定时存档、互相覆盖 —— "回来发现改动被复原"正是这么来的。
    location.href='viewer.html';
  };
  $('importImgBtn').onclick=()=>$('importImgFile').click();
  $('importImgFile').addEventListener('change',e=>{
    const fs=[...e.target.files]; e.target.value='';
    if(fs.length===1) importImageFile(fs[0]);
    else if(fs.length>1) importImageSequence(fs); // 多选 = 图像序列,每张一个状态
  });
}

// ── 启动示例:三状态循环 待机圆 → GO → 注意条 ──
function seedExample(){
  const s1=makeState('待机','#98f5d0');
  s1.shapes.push({id:store.shapeId++, type:'ellipse', x:W/2-70, y:H/2-70, w:140, h:140, bool:'add'});
  const s2=makeState('通行','#7dffb0');
  const w2=measureText('GO',130);
  s2.shapes.push({id:store.shapeId++, type:'text', text:'GO', x:W/2-w2/2, y:H/2-65, w:w2, h:130, bool:'add'});
  const s3=makeState('注意','#ffd479');
  s3.shapes.push({id:store.shapeId++, type:'rect', x:W/2-150, y:H/2-16, w:300, h:32, bool:'add'});
  store.states=[s1,s2,s3];
  store.states.forEach(s=>{rasterize(s); resample(s);});
}

// ── PS 式会话:每次改动即时存档(autosave.js 挂在 pushUndo 上)+ 隐藏/离开兜底;
//    启动时若有存档则恢复而非种子示例。参数滑块不走 pushUndo,由 15s 定时器兜住。──
initAutosave(()=>({version:4, states:serializeStates(), active:store.active, params:P}));
const autosave=autosaveNow;
function tryRestoreAutosave(){
  try{
    const raw=localStorage.getItem('morph-autosave'); if(!raw) return false;
    const d=JSON.parse(raw); if(!d.states?.length) return false;
    if(d.params) Object.assign(P, d.params);
    hydrate({states:d.states, active:d.active??0});
    return true;
  }catch(_){ return false; }
}

initToolbar();
initInspector();
initStage();
initTopbar();
initSkinRef();
const restored=tryRestoreAutosave();
if(!restored) seedExample();
renderStrip(); syncStateUI(); syncUI();
setMode('play');
startLoop();
if(restored) setHint('✓ 已恢复上次编辑(自动保存)· 若要全新开始:🗑 全部');
setInterval(autosave, 15000);
addEventListener('pagehide', autosave);
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) autosave(); });

// 调试探针:把"应用实际使用的那份"store/P 暴露给控制台/自动化。
// (Vite 对已编辑模块加 ?t= 时间戳,外部 import 会拿到另一份实例,读不到真实状态。)
import('./store.js').then(m=>import('./config.js').then(c=>{
  window.__morph={ store:m.store, P:c.P };
}));
