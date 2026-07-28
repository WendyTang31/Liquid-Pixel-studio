// 右属性栏:当前状态属性、选中对象、文字工具、采样/引擎/渲染/导出参数。
// 这里是"参数 UI → P"的唯一写入口;改完置脏或重采样,渲染循环下一帧自然吃到。
import { W, H, P } from '../config.js';
import { store, cur } from '../store.js';
import { $, setHint } from '../utils.js';
import { pushUndo, makeState, groupTail } from '../state.js';
import { rasterize, resample, resampleAll, updateThumb, tintGhost, shapesChanged } from '../pipeline.js';
import { renderStrip, setActive, syncStateUI } from './filmstrip.js';
import { exportPNG, toggleRecord } from '../export.js';
import { applyShapeBBox } from '../shapes.js';
import { renderLayers } from './layers.js';

// ── 选中对象小面板 ──
export function updateSelBox(){
  renderLayers(); // 图层面板与选中状态同源刷新(选中高亮/行数变化都走这一个口)
  const box=$('selBox'); const sel=store.sel;
  if(!sel){ box.innerHTML='<span class="small">（未选中 — ➤ 工具点击形状）</span>'; return; }
  const multiNote=store.selMulti?.length>1
    ? `<div class="small" style="color:var(--mint)">已多选 ${store.selMulti.length} 个 — 「排列」区可对齐/等距/等尺寸/阵列</div>` : '';
  const name={rect:'矩形',ellipse:'椭圆',text:`文字 "${sel.text}"`,
    path:`自由轮廓 · ${sel.points?.length||0} 个锚点(双击线段加点/双击手柄删点)`,
    image:`图片蒙版${sel.useAlpha?' · 按透明通道':' · 按亮度'}`}[sel.type];
  const imgCtrls = sel.type==='image' ? `
    <div class="row"><label>${sel.halftone?'黑场':'阈值'}</label><input type="range" id="selThr" min="0" max="255" value="${sel.threshold}"><div class="val" id="vSelThr">${sel.threshold}</div></div>
    <div class="row">
      <label class="ck"><input type="checkbox" id="selInvert" ${sel.invert?'checked':''}> 反相</label>
      <label class="ck" title="按灰度控制点大小(r=R·√亮度),点阵呈现照片明暗"><input type="checkbox" id="selHalf" ${sel.halftone?'checked':''}> 半调</label>
      <label class="ck" title="k-means 提取主色并逐点着色 — 彩色图标(emoji 等)可识别的关键"><input type="checkbox" id="selColorful" ${sel.colorful?'checked':''}> 彩色</label>
    </div>` : '';
  const sampCtrls = `
    <div class="row"><label style="min-width:auto">采样</label>
      <select id="selSampler" style="flex:1">
        <option value="">(跟随全局)</option>
        <option value="grid">方格网格</option><option value="hex">六角网格</option>
        <option value="poisson">泊松盘</option><option value="uniform">均匀·Lloyd</option>
        <option value="smart">智能·结构圆</option><option value="strokes">笔画·文字</option>
        <option value="stipple">灰阶点画·照片</option>
        <option value="vogel">向日葵螺旋</option>
        <option value="rings">同心环</option><option value="outline">仅轮廓</option>
      </select>
      <label style="min-width:auto" title="本形状的目标点数;留空=按间距自动">点数</label>
      <input type="text" id="selCount" value="${sel.count||''}" style="width:44px" placeholder="自动">
      <label style="min-width:auto" title="本形状点半径缩放:笔画/智能采样按系数缩放自带半径(0.7=更细更清晰),普通采样按系数缩放全局点半径;留空=1.0">半径×</label>
      <input type="text" id="selRScale" value="${sel.rscale||''}" style="width:40px" placeholder="1.0">
    </div>`;
  const num=(id,v)=>`<input type="text" id="${id}" value="${Math.round(v)}" style="width:44px">`;
  box.innerHTML=`${multiNote}<div>${name}</div>
    <div class="row" title="精确数值定位;方向键微移 1px,Shift=10px">
      <label style="min-width:auto">X</label>${num('selX',sel.x)}
      <label style="min-width:auto">Y</label>${num('selY',sel.y)}
      <label style="min-width:auto">宽</label>${num('selW',sel.w)}
      <label style="min-width:auto">高</label>${num('selH',sel.h)}
    </div>
    ${imgCtrls}
    ${sampCtrls}
    <div style="display:flex;gap:6px">
      <button id="selBool" style="flex:1">${sel.bool==='add'?'➕ 添加':'➖ 挖除'}</button>
      <button id="selDel" style="flex:1">删除 (Del)</button>
    </div>`;
  for(const [id,apply] of [
    ['selX',v=>applyShapeBBox(sel,v,sel.y,sel.w,sel.h)],
    ['selY',v=>applyShapeBBox(sel,sel.x,v,sel.w,sel.h)],
    ['selW',v=>applyShapeBBox(sel,sel.x,sel.y,v,sel.h)],
    ['selH',v=>applyShapeBBox(sel,sel.x,sel.y,sel.w,v)],
  ]){
    $(id).addEventListener('change',e=>{
      const v=parseFloat(e.target.value); if(!isFinite(v)) { updateSelBox(); return; }
      pushUndo(); apply(v); shapesChanged(cur()); updateSelBox();
    });
  }
  $('selBool').onclick=()=>{ pushUndo(); sel.bool=sel.bool==='add'?'sub':'add';
    updateSelBox(); shapesChanged(cur()); };
  $('selDel').onclick=deleteSel;
  if(sel.type==='image'){
    $('selThr').addEventListener('input',e=>{ sel.threshold=+e.target.value;
      $('vSelThr').textContent=sel.threshold; shapesChanged(cur()); });
    $('selInvert').addEventListener('change',e=>{ sel.invert=e.target.checked; shapesChanged(cur()); });
    $('selHalf').addEventListener('change',e=>{ pushUndo(); sel.halftone=e.target.checked;
      // 半调下阈值语义变为"黑场底限",二值化的高阈值会吃掉大半灰阶 —— 给个合理默认
      if(sel.halftone && sel.threshold>100) sel.threshold=26;
      updateSelBox(); shapesChanged(cur()); });
    $('selColorful').addEventListener('change',e=>{ pushUndo(); sel.colorful=e.target.checked;
      updateSelBox(); shapesChanged(cur()); });
  }
  // 逐形状采样覆盖:采样方式 + 目标点数(留空=按间距自动)
  $('selSampler').value=sel.sampler||'';
  $('selSampler').addEventListener('change',e=>{ pushUndo();
    if(e.target.value) sel.sampler=e.target.value; else delete sel.sampler;
    shapesChanged(cur()); });
  $('selCount').addEventListener('change',e=>{ pushUndo();
    const v=parseInt(e.target.value);
    if(isFinite(v)&&v>0) sel.count=Math.min(1500,v); else delete sel.count;
    shapesChanged(cur()); updateSelBox(); });
  $('selRScale').addEventListener('change',e=>{ pushUndo();
    const v=parseFloat(e.target.value);
    if(isFinite(v)&&v>0.05&&Math.abs(v-1)>0.01) sel.rscale=Math.min(4,v); else delete sel.rscale;
    shapesChanged(cur()); updateSelBox(); });
}
export function deleteSel(){
  if(!store.sel||store.mode==='play') return;
  const list=(store.selMulti?.length?store.selMulti:[store.sel]).filter(sh=>!sh.locked);
  if(!list.length){ setHint('形状已锁定 — 图层面板点 🔒 解锁后再删'); return; }
  pushUndo();
  const s=cur();
  for(const sh of list){ const i=s.shapes.indexOf(sh); if(i>=0) s.shapes.splice(i,1); }
  store.sel=null; store.selMulti=[]; updateSelBox(); shapesChanged(s);
}

// ── 参数 UI 回填(打开工程后同步滑块/下拉显示)──
export function syncUI(){
  const set=(id,v)=>{const el=$(id); if(el)el.value=v;};
  set('pSample',P.sample); set('pSpace',P.spacing); set('pJit',P.jitter); set('pDotR',P.dotR);
  set('pMatch',P.match); set('pEase',P.ease); set('pStag',P.stag); set('pAmp',P.amp);
  set('pThr',P.thr); set('pSoft',P.soft); set('pGamma',P.gamma); set('pFps',P.fps);
  set('pMatch',P.match); set('expFit',P.fit); set('colBg',P.colBg); set('pFont',P.font);
  set('pFlow',P.flow); set('pStretch',P.stretch); set('pGlow',P.glow);
  $('vFlow').textContent=(+P.flow).toFixed(2); $('vStretch').textContent=(+P.stretch).toFixed(2);
  $('vGlow').textContent=(+P.glow).toFixed(2); $('pSs2x').checked=!!P.ss2x;
  $('vSpace').textContent=P.spacing; $('vJit').textContent=(+P.jitter).toFixed(1);
  $('vDotR').textContent=(+P.dotR).toFixed(1); $('vStag').textContent=(+P.stag).toFixed(2);
  $('vAmp').textContent='.'+Math.round(P.amp*1000).toString().padStart(3,'0');
  $('vThr').textContent=(+P.thr).toFixed(2); $('vSoft').textContent=(+P.soft).toFixed(2);
  $('vGamma').textContent=(+P.gamma).toFixed(2); $('vFps').textContent=P.fps;
  $('vFont').textContent=P.font;
  $('boolBtn').textContent=P.bool==='add'?'➕':'➖';
}

// 滑块 → P 通用绑定。rs=true 的参数改动会触发全体重采样 + 缩略图刷新。
function bind(id,key,valId,fmt,rs){
  $(id).addEventListener('input',e=>{ P[key]=parseFloat(e.target.value);
    if(valId)$(valId).textContent=fmt(P[key]);
    if(rs){resampleAll(); store.states.forEach(updateThumb);} store.seqDirty=true; });
}

export function initInspector(){
  // 采样参数(改动需重采样)
  bind('pSpace','spacing','vSpace',v=>v,true);
  bind('pJit','jitter','vJit',v=>v.toFixed(1),true);
  bind('pDotR','dotR','vDotR',v=>v.toFixed(1),true);
  bind('pFont','font','vFont',v=>v);
  // 引擎/渲染参数(只需置脏)
  bind('pStag','stag','vStag',v=>v.toFixed(2));
  bind('pFlow','flow','vFlow',v=>v.toFixed(2));
  bind('pStretch','stretch','vStretch',v=>v.toFixed(2));
  bind('pAmp','amp','vAmp',v=>'.'+Math.round(v*1000).toString().padStart(3,'0'));
  bind('pThr','thr','vThr',v=>v.toFixed(2));
  bind('pSoft','soft','vSoft',v=>v.toFixed(2));
  bind('pGamma','gamma','vGamma',v=>v.toFixed(2));
  bind('pFps','fps','vFps',v=>v);
  bind('pGlow','glow','vGlow',v=>v.toFixed(2));
  $('pSs2x').addEventListener('change',e=>{ P.ss2x=e.target.checked; });
  $('pSample').onchange=e=>{P.sample=e.target.value; resampleAll(); store.seqDirty=true;};
  $('pEase').onchange=e=>{P.ease=e.target.value; store.seqDirty=true;};
  $('pMatch').onchange=e=>{P.match=e.target.value; store.seqDirty=true;};
  $('expFit').onchange=e=>P.fit=e.target.value;
  $('colBg').addEventListener('input',e=>P.colBg=e.target.value);
  $('seamless').onchange=()=>{store.seqDirty=true;};
  $('expPreset').onchange=e=>{
    if(e.target.value==='custom') return;
    const [w,h]=e.target.value.split(',');
    $('expW').value=w; $('expH').value=h; };
  ['expW','expH'].forEach(id=>$(id).addEventListener('input',()=>{$('expPreset').value='custom';}));
  $('pngBtn').onclick=exportPNG;
  $('recBtn').onclick=toggleRecord;

  // ── 当前状态属性 ──
  $('stName').addEventListener('input',e=>{ cur().name=e.target.value||'未命名'; renderStrip(); });
  $('stColor').addEventListener('input',e=>{ cur().color=e.target.value;
    tintGhost(cur()); updateThumb(cur()); store.seqDirty=true; });
  $('stHold').addEventListener('input',e=>{ cur().hold=parseFloat(e.target.value);
    $('vHold').textContent=cur().hold.toFixed(1); store.seqDirty=true; });
  $('stDur').addEventListener('input',e=>{ cur().dur=parseFloat(e.target.value);
    $('vDur').textContent=cur().dur.toFixed(1); store.seqDirty=true; });
  // ── 本段过渡覆盖:写 cur().trans,空/未勾选 = 删除键位继承全局 ──
  const setOv=(key,val)=>{ const t=cur().trans||(cur().trans={});
    if(val===undefined) delete t[key]; else t[key]=val;
    store.seqDirty=true; };
  $('trEase').onchange=e=>setOv('ease', e.target.value||undefined);
  const bindOv=(ckId,slId,valId,key)=>{
    $(ckId).addEventListener('change',e=>{
      setOv(key, e.target.checked? parseFloat($(slId).value):undefined); });
    $(slId).addEventListener('input',e=>{
      $(valId).textContent=(+e.target.value).toFixed(2);
      if($(ckId).checked) setOv(key, parseFloat(e.target.value)); });
  };
  bindOv('trStagOn','trStag','vTrStag','stag');
  bindOv('trFlowOn','trFlow','vTrFlow','flow');
  bindOv('trStrOn','trStr','vTrStr','stretch');
  // ── 📷 本状态镜头:写 cur().cam;回到全默认值时置 null(不入档,老工程格式不变)。
  //    镜头改动不重建 pairs(sampleFrame 每帧现读 states[].cam),置脏只为保险。
  const camGet=()=>cur().cam ? {...cur().cam} : {x:0.5,y:0.5,z:1,rot:0};
  const camSet=c=>{ const def=Math.abs(c.x-0.5)<1e-9&&Math.abs(c.y-0.5)<1e-9&&
      Math.abs(c.z-1)<1e-9&&Math.abs(c.rot)<1e-12;
    cur().cam=def?null:c; store.seqDirty=true; };
  const camUI=()=>{ const c=camGet();
    $('vCamZ').textContent=c.z.toFixed(2)+'×';
    $('vCamX').textContent=String(Math.round((c.x-0.5)*W));
    $('vCamY').textContent=String(Math.round((c.y-0.5)*H));
    $('vCamRot').textContent=Math.round(c.rot*180/Math.PI)+'°'; };
  $('camZ').addEventListener('input',e=>{ const c=camGet(); c.z=parseFloat(e.target.value); camSet(c); camUI(); });
  $('camX').addEventListener('input',e=>{ const c=camGet(); c.x=parseFloat(e.target.value); camSet(c); camUI(); });
  $('camY').addEventListener('input',e=>{ const c=camGet(); c.y=parseFloat(e.target.value); camSet(c); camUI(); });
  $('camRot').addEventListener('input',e=>{ const c=camGet(); c.rot=parseFloat(e.target.value)*Math.PI/180; camSet(c); camUI(); });
  $('camReset').onclick=()=>{ cur().cam=null; store.seqDirty=true; syncStateUI(); };

  // 复制状态:插到组尾之后(直接插 active+1 会落进"主状态与其姿态"之间抢走姿态)
  $('stDup').onclick=()=>{ pushUndo();
    const s=cur(), c=makeState(s.name+' 副本', s.color);
    Object.assign(c,{hold:s.hold, dur:s.dur, trans:JSON.parse(JSON.stringify(s.trans||{})),
      cam:s.cam?{...s.cam}:null, isPose:s.isPose||false, loop:s.loop?{...s.loop}:null,
      shapes:JSON.parse(JSON.stringify(s.shapes)), manual:JSON.parse(JSON.stringify(s.manual))});
    const at=(s.isPose?store.active:groupTail(store.active))+1;
    store.states.splice(at,0,c); rasterize(c); resample(c);
    setActive(at); renderStrip(); };
  // 🔁 ＋循环姿态:复制当前画面为一格姿态,挂进当前组(主状态选中时挂组尾;姿态选中时接在其后)
  $('poseAdd').onclick=()=>{ pushUndo();
    const s=cur();
    const master=s.isPose? null : s;
    const c=makeState((master?s.name:s.name.replace(/·姿态.*$/,''))+'·姿态', s.color);
    Object.assign(c,{isPose:true, hold:0.15, dur:0.3,
      shapes:JSON.parse(JSON.stringify(s.shapes)), manual:JSON.parse(JSON.stringify(s.manual))});
    const at=groupTail(store.active)+1;
    store.states.splice(at,0,c); rasterize(c); resample(c);
    if(master && !master.loop) master.loop={h0:1, d0:0.3};
    setActive(at); renderStrip();
    setHint('已加循环姿态:改动它(如闭眼),停留期间会 基→姿态→基 循环');
  };
  // 🔁 基姿态计时(主状态携带 loop{h0,d0})
  const loopSet=(k,v)=>{ const s=cur(); s.loop={h0:1,d0:0.3,...(s.loop||{})};
    s.loop[k]=v; store.seqDirty=true; };
  $('loopH0').addEventListener('input',e=>{ loopSet('h0',parseFloat(e.target.value));
    $('vLoopH0').textContent=(+e.target.value).toFixed(2); });
  $('loopD0').addEventListener('input',e=>{ loopSet('d0',parseFloat(e.target.value));
    $('vLoopD0').textContent=(+e.target.value).toFixed(2); });
  $('stDel').onclick=()=>{ if(store.states.length<=1){setHint('至少保留一个状态');return;}
    pushUndo(); store.states.splice(store.active,1);
    store.active=Math.min(store.active,store.states.length-1);
    setActive(store.active); renderStrip(); store.seqDirty=true; };
  $('stLeft').onclick=()=>{ if(store.active===0)return; pushUndo();
    [store.states[store.active-1],store.states[store.active]]=[store.states[store.active],store.states[store.active-1]];
    store.active--; renderStrip(); syncStateUI(); store.seqDirty=true; };
  $('stRight').onclick=()=>{ if(store.active>=store.states.length-1)return; pushUndo();
    [store.states[store.active],store.states[store.active+1]]=[store.states[store.active+1],store.states[store.active]];
    store.active++; renderStrip(); syncStateUI(); store.seqDirty=true; };
}
