// 装配层:接线顶栏按钮、初始化各 UI 模块、铺三状态启动示例、开跑主循环。
import { W, H, P } from './config.js';
import { store, cur } from './store.js';
import { $, setHint } from './utils.js';
import { makeState, pushUndo, saveProject, loadProject, serializeStates, hydrate } from './state.js';
import { rasterize, resample, measureText, shapesChanged } from './pipeline.js';
import { renderStrip, syncStateUI } from './ui/filmstrip.js';
import { syncUI, updateSelBox, initInspector } from './ui/inspector.js';
import { initClipPanel } from './ui/clipPanel.js';
import { initKeyframeKeys } from './ui/keyframes.js';
import { initToolbar } from './ui/toolbar.js';
import { initStage, setMode, startLoop } from './ui/stage.js';
import { importImageFile, importImageSequence, importSvgFile } from './ui/imageImport.js';
import { initAutosave, autosaveNow, setAutosaveKey } from './autosave.js';
import { initSkinRef } from './ui/skinRef.js';
import { initTimeline } from './ui/timeline.js';
import { renderLayers } from './ui/layers.js';
import { initArrange } from './ui/arrange.js';
import { initI18n } from './i18n.js';
import { serializeCharacters, loadCharacters } from './characters.js';
import { renderCharacters } from './ui/charpanel.js';

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
  function openProjectFile(f){ if(!f) return;
    const rd=new FileReader();
    rd.onload=()=>{ try{ loadProject(JSON.parse(rd.result)); setHint('✓ 已打开工程:'+f.name); }
      catch(err){ setHint('⚠ 工程解析失败:'+err.message+'(需是本工具「💾 保存工程」导出的 .json)'); } };
    rd.readAsText(f);
  }
  $('openBtn').onclick=()=>$('openFile').click();
  $('openFile').addEventListener('change',e=>{ openProjectFile(e.target.files[0]); e.target.value=''; });
  // 🗂 拖拽文件到编辑器直接打开:.json = 打开工程;.svg = 导入 SVG;图片 = 导入图片。
  addEventListener('dragover',e=>{ if(e.dataTransfer && [...e.dataTransfer.types].includes('Files')){
    e.preventDefault(); e.dataTransfer.dropEffect='copy'; document.body.classList.add('drag-over'); } });
  addEventListener('dragend',()=>document.body.classList.remove('drag-over'));
  addEventListener('dragleave',e=>{ if(!e.relatedTarget) document.body.classList.remove('drag-over'); });
  addEventListener('drop',e=>{
    const files=[...(e.dataTransfer?.files||[])]; if(!files.length) return; // 内部拖拽(图层排序)无文件 → 放行
    e.preventDefault(); document.body.classList.remove('drag-over');
    const f=files[0], n=f.name.toLowerCase();
    if(n.endsWith('.json')) openProjectFile(f);
    else if(n.endsWith('.svg')) importSvgFile(f);
    else if(/\.(png|jpe?g|webp|gif|bmp|avif)$/.test(n)) importImageFile(f);
    else setHint('⚠ 不支持的文件:'+f.name+' —— 可拖入 .json 工程 / .svg / 图片');
  });
  $('view3dBtn').onclick=()=>{
    autosave();
    try{ localStorage.setItem('morph3d-project', JSON.stringify(
      {version:4, states:serializeStates(store.editingChar?store._mainStates:store.states), active:store.active, params:P, characters:serializeCharacters()})); }catch(_){}
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
  $('importSvgBtn').onclick=()=>$('importSvgFile').click();
  $('importSvgFile').addEventListener('change',e=>{
    const f=e.target.files[0]; e.target.value='';
    if(f) importSvgFile(f); // Illustrator SVG → 带控制点的矢量 path 形状
  });
}

// ── 启动示例:三状态循环 待机圆 → GO → 注意条 ──
function seedExample(){
  const s1=makeState('待机','#98f5d0');
  s1.shapes.push({id:store.shapeId++, type:'ellipse', x:W/2-70, y:H/2-70, w:140, h:140, bool:'add'});
  const s2=makeState('通行','#7dffb0');
  const w2=measureText('GO',130);
  s2.shapes.push({id:store.shapeId++, type:'text', text:'GO', x:W/2-w2/2, y:H/2-65, w:w2, h:130, bool:'add', solidFill:true});
  const s3=makeState('注意','#ffd479');
  s3.shapes.push({id:store.shapeId++, type:'rect', x:W/2-150, y:H/2-16, w:300, h:32, bool:'add'});
  store.states=[s1,s2,s3];
  store.states.forEach(s=>{rasterize(s); resample(s);});
}

// ── PS 式会话:每次改动即时存档(autosave.js 挂在 pushUndo 上)+ 隐藏/离开兜底;
//    启动时若有存档则恢复而非种子示例。参数滑块不走 pushUndo,由 15s 定时器兜住。──
initAutosave(()=>({version:4, states:serializeStates(store.editingChar?store._mainStates:store.states), active:store.active, params:P, characters:serializeCharacters()}));
const autosave=autosaveNow;

// ── 多窗口隔离:每个标签页各自独立会话。第二个窗口不覆盖、也不"同步"第一个的进度 ——
//   主窗口(第一个开的)用共享槽 'morph-autosave'(保留"关掉再开继续");副窗口(已有活动窗口时新开的)
//   用自己的槽,启动即新文件、编辑只写自己槽 → 互不干扰。用 localStorage 心跳判定谁是主/副(同步、无需 await)。
const TAB_ID=(()=>{ let t=null; try{ t=sessionStorage.getItem('morph-tab'); }catch(_){}
  if(!t){ t='t'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); try{ sessionStorage.setItem('morph-tab',t); }catch(_){} }
  return t; })();
const HB='morph-tabs';
function liveTabs(){ let m={}; try{ m=JSON.parse(localStorage.getItem(HB)||'{}'); }catch(_){}
  const now=Date.now(), live={}; for(const k in m) if(now-m[k]<7000) live[k]=m[k]; return live; }
function beat(){ try{ const m=liveTabs(); m[TAB_ID]=Date.now(); localStorage.setItem(HB, JSON.stringify(m)); }catch(_){} }
// ⚠ 存档槽 key【只在本标签页首次加载时决定一次】,随后钉死在 sessionStorage —— 跨"编辑↔3D 预览"
// 来回导航都用同一个槽。否则每次加载都重算主/副,若心跳状态变了(如在 3D 里待久了心跳过期)判定翻转,
// 存进 A 槽、取自 B 槽 → 正在做的新工程"凭空变成另一个文件"。这正是之前丢工程的根因。
let AUTOSAVE_KEY=null;
try{ AUTOSAVE_KEY=sessionStorage.getItem('morph-akey'); }catch(_){}
if(!AUTOSAVE_KEY){
  const isSecondary=Object.keys(liveTabs()).some(id=>id!==TAB_ID); // 首开时已有别的活动窗口 → 本页为副窗口
  AUTOSAVE_KEY = isSecondary ? 'morph-autosave:'+TAB_ID : 'morph-autosave';
  try{ sessionStorage.setItem('morph-akey', AUTOSAVE_KEY); }catch(_){}
}
setAutosaveKey(AUTOSAVE_KEY);
beat(); setInterval(beat, 3000);
addEventListener('beforeunload', ()=>{ try{ const m=liveTabs(); delete m[TAB_ID]; localStorage.setItem(HB, JSON.stringify(m)); }catch(_){} });
// (不再自动删除任何 morph-autosave* 存档槽:标签页切到 3D 预览时没有心跳、会被误判为已关闭,
//  删掉它的槽 = 回到编辑器时工程消失。孤儿槽只是几 KB,宁可留着也不冒丢工程的风险。)

function tryRestoreAutosave(){
  try{
    const raw=localStorage.getItem(AUTOSAVE_KEY); if(!raw) return false; // 副窗口首开时自己槽为空 → 返回 false → 新文件
    const d=JSON.parse(raw); if(!d.states?.length) return false;
    if(d.params) Object.assign(P, d.params);
    hydrate({states:d.states, active:d.active??0});
    loadCharacters(d.characters); renderCharacters();   // 🚶 并行角色轨随会话恢复
    return true;
  }catch(_){ return false; }
}

// ── 右栏分区折叠:把每个 .sec 标题与其后的兄弟节点包成一组,点标题开合,状态入 localStorage。
//    在 DOM 上动态包裹而非改写 index.html —— 各控件 id 与既有绑定完全不动。──
function initFoldableSections(){
  const props=document.querySelector('.props');
  const secs=[...props.querySelectorAll(':scope > .sec')];
  let folds={}; try{ folds=JSON.parse(localStorage.getItem('morph-folds')||'{}'); }catch(_){}
  secs.forEach((sec,i)=>{
    const body=document.createElement('div'); body.className='secbody';
    let n=sec.nextSibling;
    while(n && !(n.nodeType===1 && n.classList?.contains('sec'))){
      const nx=n.nextSibling;
      if(n.nodeType===1 && n.classList?.contains('divider')) break; // 分隔线留在组外
      body.appendChild(n); n=nx;
    }
    sec.after(body);
    const apply=f=>{ body.classList.toggle('folded',f); sec.classList.toggle('folded',f); };
    apply(!!folds[i]);
    sec.addEventListener('click',()=>{ folds[i]=!body.classList.contains('folded');
      apply(folds[i]);
      try{ localStorage.setItem('morph-folds', JSON.stringify(folds)); }catch(_){} });
  });
}

initToolbar();
initInspector();
initClipPanel();
initKeyframeKeys();
initStage();
initTopbar();
initSkinRef();
initTimeline();
initArrange();
initFoldableSections();
const restored=tryRestoreAutosave();
if(!restored) seedExample();
renderStrip(); syncStateUI(); syncUI(); renderLayers(); renderCharacters();
setMode('play');
startLoop();
if(restored) setHint('✓ 已恢复上次编辑(自动保存)· 若要全新开始:🗑 全部');
initI18n(); // 界面语言(在初始 DOM 与首批动态文案就绪后应用)
setInterval(autosave, 15000);
addEventListener('pagehide', autosave);
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) autosave(); });

// 调试探针:把"应用实际使用的那份"store/P 暴露给控制台/自动化。
// (Vite 对已编辑模块加 ?t= 时间戳,外部 import 会拿到另一份实例,读不到真实状态。)
import('./store.js').then(m=>import('./config.js').then(c=>{
  window.__morph={ store:m.store, P:c.P };
}));
