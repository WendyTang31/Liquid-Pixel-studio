// 装配层:接线顶栏按钮、初始化各 UI 模块、铺三状态启动示例、开跑主循环。
import { W, H, P } from './config.js';
import { store, cur } from './store.js';
import { $, setHint } from './utils.js';
import { makeState, pushUndo, saveProject, loadProject, serializeStates } from './state.js';
import { rasterize, resample, measureText, shapesChanged } from './pipeline.js';
import { renderStrip, syncStateUI } from './ui/filmstrip.js';
import { syncUI, updateSelBox, initInspector } from './ui/inspector.js';
import { initToolbar } from './ui/toolbar.js';
import { initStage, setMode, startLoop } from './ui/stage.js';
import { importImageFile } from './ui/imageImport.js';

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
    try{ localStorage.setItem('morph3d-project', JSON.stringify(
      {version:4, states:serializeStates(), active:store.active, params:P})); }catch(_){}
    window.open('viewer.html','morph3d');
  };
  $('importImgBtn').onclick=()=>$('importImgFile').click();
  $('importImgFile').addEventListener('change',e=>{
    const f=e.target.files[0]; if(!f) return;
    importImageFile(f); e.target.value='';
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

initToolbar();
initInspector();
initStage();
initTopbar();
seedExample();
renderStrip(); syncStateUI(); syncUI();
setMode('play');
startLoop();

// 调试探针:把"应用实际使用的那份"store/P 暴露给控制台/自动化。
// (Vite 对已编辑模块加 ?t= 时间戳,外部 import 会拿到另一份实例,读不到真实状态。)
import('./store.js').then(m=>import('./config.js').then(c=>{
  window.__morph={ store:m.store, P:c.P };
}));
