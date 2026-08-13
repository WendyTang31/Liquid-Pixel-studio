// 右属性栏:当前状态属性、选中对象、文字工具、采样/引擎/渲染/导出参数。
// 这里是"参数 UI → P"的唯一写入口;改完置脏或重采样,渲染循环下一帧自然吃到。
import { W, H, P } from '../config.js';
import { store, cur } from '../store.js';
import { $, setHint } from '../utils.js';
import { pushUndo, makeState, groupTail } from '../state.js';
import { rasterize, resample, resampleAll, updateThumb, tintGhost, shapesChanged, mergeShapesToPath } from '../pipeline.js';
import { renderStrip, setActive, syncStateUI } from './filmstrip.js';
import { exportPNG, exportMP4, toggleRecord } from '../export.js';
import { applyShapeBBox, shapeToPath } from '../shapes.js';
import { renderLayers } from './layers.js';
import { renderGuides } from './arrange.js';
import { bezierEase, EASE } from '../engine.js';
import { LAB_FX } from '../labfx.js';

// 🧪 实验物理面板:按 LAB_FX 表生成滑块行(同 g 分组,组间插一条小标题)。
// 生成而非手写 HTML —— 20+ 个效果手写会立刻和实现脱节;这样表就是唯一事实来源。
// 中文文案由 i18n 的 MutationObserver 接手翻译,和静态文案一样处理。
function buildLabFxRows(){
  const box=$('labFxRows'); if(!box || box.childElementCount) return;
  let group=null;
  for(const s of LAB_FX){
    if(s.g!==group){ group=s.g;
      const h=document.createElement('div');
      h.className='small'; h.style.cssText='opacity:.6;margin-top:6px';
      h.textContent=group; box.appendChild(h); }
    const row=document.createElement('div'); row.className='row';
    const lab=document.createElement('label'); lab.title=s.title; lab.textContent=s.label;
    const inp=document.createElement('input');
    inp.type='range'; inp.id='lab_'+s.key; inp.min=s.min; inp.max=s.max; inp.step=s.step; inp.value=s.def;
    inp.title=s.title;
    const val=document.createElement('div'); val.className='val'; val.id='vlab_'+s.key;
    val.textContent=(+s.def).toFixed(s.dp);
    row.append(lab, inp, val); box.appendChild(row);
  }
}

// ⚡ 速度曲线预览:按当前控件值画过渡的进度曲线(端点斜率=起步/落位速度)。
function drawSpeedCurve(){
  const cv=$('trSpeedCv'); if(!cv) return; const g=cv.getContext('2d'), W=cv.width, H=cv.height;
  g.clearRect(0,0,W,H);
  const on=$('trSpeedOn')?.checked;
  const f = on ? bezierEase(+$('trSpeedIn').value, +$('trSpeedOut').value)
              : (EASE[(cur().trans?.ease)||P.ease] || EASE.smootherstep);
  g.strokeStyle='rgba(255,255,255,0.12)'; g.beginPath(); g.moveTo(2,H-2); g.lineTo(W-2,2); g.stroke(); // 匀速参考线
  g.strokeStyle='#98f5d0'; g.lineWidth=1.5; g.beginPath();
  for(let i=0;i<=W;i++){ const x=i/W, y=Math.max(0,Math.min(1,f(x)));
    const px=2+x*(W-4), py=H-2-y*(H-4); i?g.lineTo(px,py):g.moveTo(px,py); }
  g.stroke();
}
// 从 cur().trans 回填速度控件(供 syncStateUI 调用)。
export function syncSpeedUI(){
  const t=cur().trans||{}, on=(t.sIn!=null||t.sOut!=null);
  if(!$('trSpeedOn')) return;
  $('trSpeedOn').checked=on; $('trSpeedBox').style.display=on?'block':'none';
  $('trSpeedIn').value=t.sIn??0; $('vTrSpeedIn').textContent=(+(t.sIn??0)).toFixed(1);
  $('trSpeedOut').value=t.sOut??0; $('vTrSpeedOut').textContent=(+(t.sOut??0)).toFixed(1);
  drawSpeedCurve();
}

// ── 选中对象小面板 ──
export function updateSelBox(){
  renderLayers(); // 图层面板与选中状态同源刷新(选中高亮/行数变化都走这一个口)
  renderGuides();
  const box=$('selBox'); const sel=store.sel;
  if(!sel){ box.innerHTML='<span class="small">（未选中 — ➤ 工具点击形状）</span>'; return; }
  const multi=store.selMulti?.length||0;
  const anyLinked = multi>1 && (store.selMulti||[]).some(sh=>sh&&sh.linkGroup!=null);
  const multiNote=multi>1
    ? `<div class="small" style="color:var(--mint)">已多选 ${multi} 个 — 「排列」区可对齐/等距/等尺寸/阵列;下方「融合」并成一个图形,「链接」让它们在矢量变形里一起算</div>
       <button id="selMerge" style="width:100%;margin:3px 0" title="把选中的多个图形并集成【一个】矢量图形(如三角+矩形→一个完整箭头)—— 之后可整体做最短路径变形">🔗 融合为一个图形</button>
       <div style="display:flex;gap:6px">
         <button id="selLink" style="flex:1" title="链接矢量变形:默认每个图形的矢量变形【只作用于自己】,不牵连别的图形。链接后,选中的这些图形在矢量变形里作为【一组一起计算】(组内可跨图形就近配对/多对一),但仍是各自独立的图形,不合并。">🔗 链接矢量变形</button>
         ${anyLinked?`<button id="selUnlink" style="flex:1" title="解除选中图形的矢量变形链接 → 回到各自独立">✂️ 解除链接</button>`:''}
       </div>` : '';
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
      <label class="ck" title="本形状按矢量整块填充:停留时边缘=形状本来的直线/曲线(任何分辨率下零毛边,其蒙版内的点被抑制不会鼓包);过渡时整块平滑溶解成点飞走、再凝回。与其它形状/采样算法互不冲突"><input type="checkbox" id="selSolid" ${sel.solidFill?'checked':''}> 🧱实心</label>
      <label class="ck" title="描边:只画形状/照片的【轮廓线】成实体路径(不是填充、也不是点),右侧数值=线宽px。勾选即按实心渲染。取消=回到填充。"><input type="checkbox" id="selStrokeOn" ${sel.strokeW>0?'checked':''}> 🖊描边</label>
      <input type="text" id="selStrokeW" value="${sel.strokeW||''}" style="width:36px" placeholder="px" title="描边线宽(px)">
    </div>`;
  const num=(id,v)=>`<input type="text" id="${id}" value="${Math.round(v)}" style="width:44px">`;
  // 动画方式(逐方向,均存在本形状上):出场=morphOut(本→下一状态);入场=morphIn(上一状态→本)。
  // 入场存本形状上 → 即使上一帧已设置、或上一帧没有它(新出现),也能控制它怎么"来"。
  const modeOf=(sh,key)=>{ const v=sh&&sh[key];
    if(v==='dots')return'dots'; if(v==='cut')return'cut'; if(v==='vector')return'vector';
    return (key==='morphOut' && !(sh&&sh.layerId)) ? 'dots' : 'vector'; }; // 出场缺省:无图层=点阵,有图层=矢量;入场缺省=矢量
  const modeOpts=cur=>`<option value="vector" ${cur==='vector'?'selected':''}>② 矢量变形(木偶)</option>`
    +`<option value="dots" ${cur==='dots'?'selected':''}>① 点阵溶解(墨水)</option>`
    +`<option value="cut" ${cur==='cut'?'selected':''}>③ 直切(无动画)</option>`;
  box.innerHTML=`${multiNote}<div>${name}</div>
    <div class="row" title="精确数值定位;方向键微移 1px,Shift=10px">
      <label style="min-width:auto">X</label>${num('selX',sel.x)}
      <label style="min-width:auto">Y</label>${num('selY',sel.y)}
      <label style="min-width:auto">宽</label>${num('selW',sel.w)}
      <label style="min-width:auto">高</label>${num('selH',sel.h)}
    </div>
    ${imgCtrls}
    ${sampCtrls}
    ${sel.rel?`<div class="row" style="border-top:1px dashed var(--line);padding-top:5px">
      <span class="small" style="color:var(--mint)">🔗 ${({offset:'定距跟随',size:'等尺寸',centerV:'对中┃',centerH:'对中━',mirrorV:'对称┃',mirrorH:'对称━',edgegap:'📏边距标注'})[sel.rel.type]||sel.rel.type}</span>
      ${sel.rel.type==='offset'?`<label style="min-width:auto">ΔX</label><input type="text" id="relDX" value="${Math.round(sel.rel.dx)}" style="width:38px">
      <label style="min-width:auto">ΔY</label><input type="text" id="relDY" value="${Math.round(sel.rel.dy)}" style="width:38px">`:''}
      ${sel.rel.type==='edgegap'?`<label style="min-width:auto">距</label><input type="text" id="relGapV" value="${Math.round(Math.abs(sel.rel.off))}" style="width:38px">`:''}
      <button id="relOff" title="解除该约束,回到自由形状">解除</button>
    </div>`:''}
    <div style="display:flex;gap:6px">
      <button id="selBool" style="flex:1">${sel.bool==='add'?'➕ 添加':'➖ 挖除'}</button>
      <button id="selDel" style="flex:1">删除 (Del)</button>
    </div>
    ${sel.type!=='image'?`<div class="row" title="入场=本形状怎么"来"(上一状态→本状态);出场=本形状怎么"走"(本状态→下一状态)。可分别设 ①点阵溶解 ②矢量变形 ③直切(无动画·中点硬切)。入场设在本形状上,所以即使上一帧已设置、或上一帧根本没有它(新出现),也能控制它怎么出现。多选对全部生效。">
      <label style="min-width:auto" title="上一状态 → 本状态(本形状怎么"来")">入场←</label>
      <select id="selMorphIn" style="flex:1">${modeOpts(modeOf(sel,'morphIn'))}</select></div>
    <div class="row" title="本状态 → 下一状态(本形状怎么"走")">
      <label style="min-width:auto">出场→</label>
      <select id="selMorph" style="flex:1">${modeOpts(modeOf(sel,'morphOut'))}</select></div>
    <div class="row" title="矢量变形【约束】:只和自己=独立,只变到自己下一帧的形态,绝不牵连/被别的图形影响;🔗已链接=和选中的其他图形一组一起算(多选后用下方🔗链接按钮建立);🔒冻结=绝对不受任何变形影响,全程静止。">
      <label style="min-width:auto">约束</label>
      <select id="selMorphLock" style="flex:1">
        <option value="self" ${(!sel.morphLock&&sel.linkGroup==null)?'selected':''}>只和自己(独立)</option>
        ${sel.linkGroup!=null?`<option value="linked" selected>🔗 已链接组</option>`:''}
        <option value="free" ${sel.morphLock==='free'?'selected':''}>🌐 自由(可变到任意图形)</option>
        <option value="frozen" ${sel.morphLock==='frozen'?'selected':''}>🔒 冻结(绝不变形)</option>
      </select></div>
      ${multi>1?`<div class="small" style="color:var(--mint)">↑ 应用到全部 ${multi} 个选中图形</div>`:''}
    <div style="display:flex;gap:6px">
      <button id="selKey" style="flex:1" title="${(sel.layerId||multi>1)?'把选中图层复制成下一状态的关键帧(多选=一次全部,含父级链);去那里【移动控制点/摆关节】,轮廓沿最短路/弧线平滑变形过去':'先在上面选"矢量变形",再点这里在下一状态生成关键帧'}"${(sel.layerId||multi>1)?'':' disabled'}>🔑 打关键帧到下一状态${multi>1?`(×${multi})`:''}</button>
    </div>
    ${multi>1?`<button id="selKeyAll" style="width:100%;margin-top:4px" title="把选中的全部图形设为矢量图层,并让它们各自沿最短路径变形到【下一状态】已画好的图形(引擎自动按相似度就近配对)——箭头→小人这种整组转换一键完成,无需逐个打关键帧。下一状态需已画好目标图形。">🎬 全部最短路径变到下一状态</button>`:''}`:''}
    ${(sel.type==='path'||sel.type==='rect'||sel.type==='ellipse')?`<div class="row" style="border-top:1px dashed var(--line);padding-top:5px" title="🦴 FK 骨骼(AE 父子链):把本部件父接到另一部件并设一个关节点;旋转关节时本部件连同其子级绕关节【刚性弧线】摆动(手/腿不缩短、不穿透)。关节角逐状态存 → 过渡自动走弧线。圆/方选父级时会自动转成可编辑路径。">
      <label style="min-width:auto">🦴父级</label>
      <select id="rigParent" style="flex:1">
        <option value="">(不绑定)</option>
        <option value="root" ${sel.rig&&sel.rig.parent==null?'selected':''}>根关节(无父级·自转)</option>
        ${cur().shapes.map((sh,idx)=> ((sh.type==='path'||sh.type==='rect'||sh.type==='ellipse')&&sh!==sel)?`<option value="${idx}" ${sel.rig&&sh.layerId!=null&&sel.rig.parent===sh.layerId?'selected':''}>部件 ${idx+1}${sh.rig?' 🦴':''}</option>`:'').join('')}
      </select>
      <label style="min-width:auto" title="本状态该关节的旋转角(°);去下一状态改它=关键帧,过渡走弧线">角°</label>
      <input type="text" id="rigRot" value="${Math.round(sel.rig?.rot||0)}" style="width:40px" ${sel.rig?'':'disabled'}>
    </div>
    ${sel.rig?`<div class="small" style="color:var(--mint)">关节点 (${Math.round(sel.rig.pivot.x)},${Math.round(sel.rig.pivot.y)}) — 画布上拖🟡关节圈移动它 · 拖旋转手柄=摆动本关节(子级跟随)</div>`
      :(sel.type!=='path'?`<div class="small">选父级/根关节即绑定(圆/方会自动转为可编辑路径)</div>`:'')}`:''}`;
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
  // 🦴 FK 骨骼:父级下拉 + 关节角。圆/方在绑定时自动转为可编辑路径;父级若尚未绑骨骼也自动补上根 rig。
  if($('rigParent')) $('rigParent').onchange=e=>{
    pushUndo();
    const s=cur();
    const ensureLid=sh=>{ if(sh.layerId==null){ sh.layerId=store.layerSeq=(store.layerSeq||0)+1; if(!('solidFill' in sh)) sh.solidFill=true; } };
    const toPath=sh=>{ if(sh.type==='path') return sh; const np=shapeToPath(sh); if(!np) return sh;
      const i=s.shapes.indexOf(sh); if(i>=0)s.shapes[i]=np;
      if(store.sel===sh)store.sel=np; const mi=(store.selMulti||[]).indexOf(sh); if(mi>=0)store.selMulti[mi]=np; return np; };
    if(e.target.value===''){ if(store.sel.rig) delete store.sel.rig; }
    else {
      let child=toPath(store.sel);              // 圆/方 → path
      ensureLid(child);
      if(!child.rig) child.rig={ parent:null, pivot:{x:child.x+child.w/2, y:child.y}, rot:0 };
      if(e.target.value==='root'){ child.rig.parent=null; }
      else { const par=s.shapes[+e.target.value];
        // 仅给父级一个 layerId 供引用 —— 【不】自动给父级绑骨骼(不自动连锁,由你控制)。
        if(par){ ensureLid(par); child.rig.parent=par.layerId; } }
    }
    shapesChanged(s); store.seqDirty=true; updateSelBox();
    const child2=store.sel;
    const parNoRig = child2.rig && child2.rig.parent!=null && !s.shapes.some(x=>x.layerId===child2.rig.parent&&x.rig);
    setHint(!child2.rig ? '已解除骨骼'
      : parNoRig ? '🦴 已父接 —— 但父级还没设骨骼,本部件暂【独立自转】;把父级也设为「根关节/父级」它才会带动本部件(不自动连锁,你说了算)'
      : '🦴 已绑定 — 拖🟡关节圈定位关节、拖旋转手柄摆动本关节(仅本部件与其子级跟随);下一状态改角即成弧线动画');
  };
  if($('rigRot')&&sel.rig) $('rigRot').addEventListener('change',e=>{
    const v=parseFloat(e.target.value); if(!isFinite(v)) return;
    pushUndo(); store.sel.rig.rot=v; shapesChanged(cur()); store.seqDirty=true; });
  // 动画方式(逐方向、逐形状):把 mode 显式写到本形状的 key(morphOut/morphIn)。dots 无需图层;矢量/直切确保 layerId。
  // 入场存本形状上 → 即使上一帧已设出场、或上一帧根本没有它(新出现),也能控制它怎么"来"。
  const applyMode=(sh,mode,key)=>{
    if(mode!=='dots' && !sh.layerId){ sh.layerId=store.layerSeq=(store.layerSeq||0)+1; if(!('solidFill' in sh)) sh.solidFill=true; }
    sh[key]=mode; };
  const modeLabel={vector:'② 矢量变形',dots:'① 点阵溶解',cut:'③ 直切(无动画)'};
  const bindMode=(id,key,dir)=>{ if(!$(id)) return; $(id).onchange=e=>{ pushUndo();
    const targets=(multi>1?store.selMulti:[sel]).filter(sh=>sh&&sh.type!=='image');
    for(const sh of targets) applyMode(sh, e.target.value, key);
    shapesChanged(cur()); store.seqDirty=true; updateSelBox();
    setHint(`${dir} ${modeLabel[e.target.value]}:${targets.length} 个图形`); }; };
  bindMode('selMorph','morphOut','出场→');
  bindMode('selMorphIn','morphIn','入场←');
  const ensureLayer=sh=>{ if(!sh.layerId){ sh.layerId=store.layerSeq=(store.layerSeq||0)+1; if(!('solidFill' in sh)) sh.solidFill=true; } };
  // 🔒 约束:只和自己 / 冻结(链接由下面的按钮建立)。
  if($('selMorphLock')) $('selMorphLock').onchange=e=>{ pushUndo();
    const targets=(multi>1?store.selMulti:[sel]).filter(sh=>sh&&sh.type!=='image');
    for(const sh of targets){
      if(e.target.value==='frozen'){ ensureLayer(sh); sh.morphLock='frozen'; delete sh.linkGroup; }
      else if(e.target.value==='free'){ ensureLayer(sh); sh.morphLock='free'; delete sh.linkGroup; }
      else if(e.target.value==='self'){ delete sh.morphLock; delete sh.linkGroup; } // linked 选项=保持不动
    }
    shapesChanged(cur()); store.seqDirty=true; updateSelBox();
    const msg={frozen:`🔒 已冻结 ${targets.length} 个:全程静止,绝不参与变形`,
      free:`🌐 自由 ${targets.length} 个:可就近变到下一状态任意图形`,
      self:`只和自己:${targets.length} 个独立变形(只变到自己下一帧,不牵连别的)`};
    setHint(msg[e.target.value]||''); };
  // 🔗 链接矢量变形:给选中图形一个共享 linkGroup —— 组内一起算(可跨图形配对),不牵连组外。
  if($('selLink')) $('selLink').onclick=()=>{ pushUndo();
    const g=store.linkSeq=(store.linkSeq||0)+1;
    const targets=(store.selMulti||[]).filter(sh=>sh&&sh.type!=='image');
    for(const sh of targets){ ensureLayer(sh); sh.linkGroup=g; delete sh.morphLock; }
    shapesChanged(cur()); store.seqDirty=true; updateSelBox();
    setHint(`🔗 已链接 ${targets.length} 个图形为一组 — 它们在矢量变形里一起算(组内可跨图形融合/交换),不影响组外`); };
  if($('selUnlink')) $('selUnlink').onclick=()=>{ pushUndo();
    const targets=(store.selMulti||[]).filter(Boolean);
    for(const sh of targets) delete sh.linkGroup;
    shapesChanged(cur()); store.seqDirty=true; updateSelBox();
    setHint('✂️ 已解除链接 — 回到各自独立(只和自己变形)'); };
  // 🎬 全部最短路径到下一状态:选中图形与下一状态图形都设为矢量图层,引擎按相似度就近配对 →
  // 逐个沿最短路径变形(箭头→小人等整组转换,无需逐个打关键帧)。
  if($('selKeyAll')) $('selKeyAll').onclick=()=>{
    pushUndo();
    const targets=(store.selMulti||[]).filter(sh=>sh.type!=='image');
    for(const sh of targets){ if(!sh.layerId){ sh.layerId=store.layerSeq=(store.layerSeq||0)+1;
      if(!('solidFill' in sh)) sh.solidFill=true; } }
    const ni=groupTail(store.active)+1, next=store.states[ni];
    const drawable=sh=>sh.bool!=='sub'&&!sh.hidden&&sh.type!=='image';
    if(!next || !next.shapes.some(drawable)){
      shapesChanged(cur()); store.seqDirty=true; updateSelBox();
      setHint('⚠ 已把选中图形设为矢量变形,但【下一状态】还没画目标图形 —— 去下一个状态画好后即自动最短路径变形过去');
      return; }
    for(const sh of next.shapes) if(drawable(sh)&&!sh.layerId){
      sh.layerId=store.layerSeq=(store.layerSeq||0)+1; if(!('solidFill' in sh)) sh.solidFill=true; }
    rasterize(next); resample(next);
    shapesChanged(cur()); store.seqDirty=true; updateSelBox();
    setHint(`🎬 ${targets.length} 个图形 → 下一状态已按相似度配对,沿最短路径变形(▶ 预览序列查看)`);
  };
  // 🔗 融合:把多选图形并集成一个矢量 path(轮廓描摹)。
  if($('selMerge')) $('selMerge').onclick=()=>{
    const targets=(store.selMulti||[]).filter(sh=>sh.bool!=='sub'&&!sh.hidden);
    if(targets.length<2){ setHint('至少选 2 个图形才能融合'); return; }
    pushUndo();
    const merged=mergeShapesToPath(targets);
    if(!merged){ setHint('⚠ 融合失败(选中图形没有可并的实心区域)'); return; }
    const s=cur();
    // 保留其一的动画属性(layerId/solidFill),移除原图形,插入融合结果
    const keep=targets.find(t=>t.layerId)||targets[0];
    if(keep.layerId) merged.layerId=keep.layerId;
    s.shapes=s.shapes.filter(sh=>!targets.includes(sh));
    s.shapes.push(merged); store.sel=merged; store.selMulti=[merged];
    shapesChanged(s); updateSelBox();
    setHint(`🔗 已融合 ${targets.length} 个图形为一个轮廓(${merged.points.length} 锚点)`);
  };
  // 🔑 矢量图层关键帧:标记本形状为关联图层(layerId),并在下一状态生成同一图层的关键帧。
  //    去下一状态改它的形状 → 停留/过渡时该图层轮廓直接矢量变形(实心填充,不散成点)。
  if($('selKey')&&!$('selKey').disabled) $('selKey').onclick=()=>{
    pushUndo();
    const s0=cur();
    const byLid=new Map(s0.shapes.filter(sh=>sh.layerId!=null).map(sh=>[sh.layerId,sh]));
    // 多选=一次把全部选中图层都打过去;并连带其 rig 父级链(否则子级在下一状态找不到父级会跑位)。
    const wanted=new Set();
    const add=sh=>{ if(!sh||wanted.has(sh)) return; wanted.add(sh);
      if(sh.rig?.parent!=null && byLid.has(sh.rig.parent)) add(byLid.get(sh.rig.parent)); };
    for(const sh of (multi>1?store.selMulti:[sel]).filter(sh=>sh&&sh.type!=='image')) add(sh);
    for(const sh of wanted) if(!sh.layerId){ sh.layerId=store.layerSeq=(store.layerSeq||0)+1; if(!('solidFill' in sh)) sh.solidFill=true; }
    let ni=groupTail(store.active)+1;
    // 若「按组尾」会跑到序列末尾【新建一帧】,但其实紧接着就已有下一帧(例如后面是循环姿态帧)——
    // 那就并入【字面的下一帧】与它已有的图形共存,别在末尾单独造一帧。(中段有下一主状态时不受影响)
    if(ni>=store.states.length && store.active+1<store.states.length) ni=store.active+1;
    if(ni>=store.states.length) store.states.splice(ni,0,makeState(cur().name+' ▸帧', cur().color));
    const next=store.states[ni];
    let n=0;
    for(const sh of wanted) if(!next.shapes.some(x=>x.layerId===sh.layerId)){
      const c=JSON.parse(JSON.stringify({...sh, id:undefined})); c.id=store.shapeId++;
      next.shapes.push(c); n++; }
    rasterize(next); resample(next);
    shapesChanged(cur()); setActive(ni); renderStrip();
    setHint(`🔑 已把 ${wanted.size} 个图层${wanted.size>((multi>1?store.selMulti:[sel]).length)?'(含父级链)':''}复制到下一状态 —— 去那里摆关节/移动控制点即成动画`);
  };
  if(sel.rel){
    $('relOff').onclick=()=>{ pushUndo(); delete sel.rel; updateSelBox(); shapesChanged(cur()); };
    for(const [id,k] of [['relDX','dx'],['relDY','dy']]){
      const el=$(id); if(!el) continue;
      el.addEventListener('change',e=>{ const v=parseFloat(e.target.value);
        if(isFinite(v)){ pushUndo(); sel.rel[k]=v; shapesChanged(cur()); updateSelBox(); } });
    }
    const gv=$('relGapV');
    if(gv) gv.addEventListener('change',e=>{ const v=parseFloat(e.target.value);
      if(isFinite(v)&&v>=0){ pushUndo();
        sel.rel.off=(sel.rel.off===0?1:Math.sign(sel.rel.off))*v;
        shapesChanged(cur()); updateSelBox(); } });
  }
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
  $('selSolid').addEventListener('change',e=>{ pushUndo();
    if(e.target.checked) sel.solidFill=true; else delete sel.solidFill;
    shapesChanged(cur()); store.seqDirty=true;
    setHint(e.target.checked?'🧱 本形状实心:停留=矢量锐边整块;过渡=溶解为点再凝回':'本形状已回到点阵'); });
  // 🖊 描边:strokeW>0 只画轮廓成实体路径(隐含实心渲染)。勾选给默认线宽,数值可调。
  $('selStrokeOn').addEventListener('change',e=>{ pushUndo();
    if(e.target.checked){ sel.strokeW = sel.strokeW>0 ? sel.strokeW : 8; sel.solidFill=true; }
    else delete sel.strokeW;
    if($('selStrokeW')) $('selStrokeW').value = sel.strokeW||'';
    shapesChanged(cur()); store.seqDirty=true; updateSelBox();
    setHint(e.target.checked?'🖊 描边模式:只画轮廓成实体线(线宽右侧可调)':'已回到填充'); });
  $('selStrokeW').addEventListener('change',e=>{ pushUndo();
    const v=parseFloat(e.target.value);
    if(isFinite(v)&&v>0){ sel.strokeW=Math.min(200,v); sel.solidFill=true; } else delete sel.strokeW;
    if($('selStrokeOn')) $('selStrokeOn').checked=sel.strokeW>0;
    shapesChanged(cur()); store.seqDirty=true; updateSelBox(); });
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
  if($('pSilhouette')) $('pSilhouette').checked=!!P.silhouette;
  if($('transBg')) $('transBg').checked=!!P.transBg;
  if($('fxFineWave') && P.efx){ const e=P.efx; // ✦ 全局边缘几何回填
    set('fxFineWave',e.fineWave); $('vFxFineWave').textContent=(+e.fineWave).toFixed(2);
    set('fxJagged',e.jagged); $('vFxJagged').textContent=(+e.jagged).toFixed(2);
    set('fxSplatter',e.splatter); $('vFxSplatter').textContent=(+e.splatter).toFixed(2);
    set('efxScope',e.scope||'span'); if($('jagMotion')) set('jagMotion', e.jagMotion||'pulse');
    set('efxFrom', e.from>0?e.from+1:''); set('efxTo', e.to>=0?e.to+1:''); }
  if($('inkOn') && P.ink){ $('inkOn').checked=!!P.ink.on; // 🖋 墨水沉积回填
    set('inkIntensity',P.ink.intensity); $('vInkIntensity').textContent=(+P.ink.intensity).toFixed(2);
    set('inkAngle',P.ink.angle); $('vInkAngle').textContent=Math.round(P.ink.angle);
    set('inkEdge',P.ink.edge); $('vInkEdge').textContent=(+P.ink.edge).toFixed(1);
    set('inkBleed',P.ink.bleed); $('vInkBleed').textContent=(+P.ink.bleed).toFixed(2);
    set('inkDir',P.ink.dir); $('vInkDir').textContent=(+P.ink.dir).toFixed(2);
    set('inkClear',P.ink.clear||0); $('vInkClear').textContent=(+(P.ink.clear||0)).toFixed(2);
    set('inkDark',P.ink.dark==null?0.85:P.ink.dark); $('vInkDark').textContent=(+(P.ink.dark==null?0.85:P.ink.dark)).toFixed(2);
    // 范围回填。墨水按【状态 id】钉死,可能钉在【别的】frame 上 —— 那就把下拉的『仅当前状态』
    // 改写成『仅:那个状态名』,免得站在别的 frame 上看到"仅当前状态"却不上墨、令人困惑。
    if($('inkScope')){
      const sc=P.ink.scope, curOpt=$('inkScope').querySelector('option[value="cur"]');
      if(sc==null||sc==='all'){ if(curOpt) curOpt.textContent='仅当前状态'; $('inkScope').value='all'; }
      else { const idx=store.states.findIndex(s=>s.id===sc);
        if(curOpt) curOpt.textContent = idx<0 ? '仅:(已删除)' : (sc===cur().id ? '仅当前状态' : '仅:'+(store.states[idx].name||('状态'+(idx+1))));
        $('inkScope').value='cur'; }
    } }
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
  if($('pSilhouette')) $('pSilhouette').onchange=e=>{P.silhouette=e.target.checked; store.seqDirty=true;};
  if($('transBg')) $('transBg').addEventListener('change',e=>{ P.transBg=e.target.checked; }); // 背景透明(渲染 alpha=覆盖度)
  $('expFit').onchange=e=>P.fit=e.target.value;
  $('colBg').addEventListener('input',e=>P.colBg=e.target.value);
  $('seamless').onchange=()=>{store.seqDirty=true;};
  $('expPreset').onchange=e=>{
    if(e.target.value==='custom') return;
    const [w,h]=e.target.value.split(',');
    $('expW').value=w; $('expH').value=h; };
  ['expW','expH'].forEach(id=>$(id).addEventListener('input',()=>{$('expPreset').value='custom';}));
  // 📐 宽画幅导出:开关 + 画幅倍数,实时显示算出来的输出宽高。
  if($('wideOn')){
    const wp=$('widePanel'), info=$('wideInfo');
    const refresh=()=>{ const eh=parseInt($('expH').value,10)||1024, n=Math.max(1,parseFloat($('wideW').value)||5);
      if(info) info.textContent=`→ 输出 ${Math.round(eh*n)}×${eh}`; };
    const sync=()=>{ wp.style.display=$('wideOn').checked?'':'none'; if($('wideOn').checked) refresh(); };
    $('wideOn').checked=!!P.wideExport;
    $('wideOn').addEventListener('change',e=>{ P.wideExport=e.target.checked; sync();
      setHint(e.target.checked?'📐 宽画幅导出已开:小人可跑完全程不消失(在「🚶 角色」里把左右行程设宽)':'已关闭宽画幅导出'); });
    if($('wideW')) $('wideW').addEventListener('input',()=>{ P.wideW=Math.max(1,parseFloat($('wideW').value)||5); refresh(); });
    $('expH').addEventListener('input',refresh);
    sync();
  }
  $('pngBtn').onclick=exportPNG;
  $('mp4Btn').onclick=exportMP4;
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
  // ── ⚡ 速度曲线(三次贝塞尔起步/落位速度;设了 sIn/sOut 就覆盖命名缓动)──
  $('trSpeedOn').addEventListener('change',e=>{
    if(e.target.checked){ setOv('sIn', parseFloat($('trSpeedIn').value)); setOv('sOut', parseFloat($('trSpeedOut').value)); }
    else { setOv('sIn', undefined); setOv('sOut', undefined); }
    $('trSpeedBox').style.display=e.target.checked?'block':'none'; drawSpeedCurve();
  });
  for(const [slId,valId,key] of [['trSpeedIn','vTrSpeedIn','sIn'],['trSpeedOut','vTrSpeedOut','sOut']])
    $(slId).addEventListener('input',e=>{ $(valId).textContent=(+e.target.value).toFixed(1);
      if($('trSpeedOn').checked) setOv(key, parseFloat(e.target.value)); drawSpeedCurve(); });
  // 🔗 承接上一段落位速度 → 本段起步速度(关键帧处速度连续,无缝)
  $('trSeamless').onclick=()=>{
    const masters=store.states.filter(s=>!s.isPose), mi=masters.indexOf(cur());
    const prev = mi>0 ? masters[mi-1] : (($('loop')?.checked && masters.length>1) ? masters[masters.length-1] : null);
    const prevOut = prev?.trans?.sOut;
    if(prevOut==null){ setHint('上一段过渡没有设『落位』速度 —— 先给它勾选⚡速度曲线并设一个落位速度'); return; }
    setOv('sIn', prevOut); if(cur().trans.sOut==null) setOv('sOut', 0);
    syncSpeedUI();
    setHint(`🔗 本状态起步速度已承接上一段落位速度 ${(+prevOut).toFixed(1)} — 该关键帧处速度连续、无缝`);
  };
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
  // ── 🌊 动态几何:写 cur().fx[key];sampleFrame 每帧现读 states[].fx,无需重建/重采样。──
  const fxSet=(key,v)=>{ const fx=cur().fx||(cur().fx={});
    if(v) fx[key]=v; else delete fx[key]; };
  for(const [id,key,valId,dp] of [
    ['fxFreq','freq','vFxFreq',2],['fxSlosh','slosh','vFxSlosh',2],['fxSpring','spring','vFxSpring',2],
    ['fxLiquid','liquid','vFxLiquid',2],['fxRipple','ripple','vFxRipple',2],['fxTwinkle','twinkle','vFxTwinkle',2],
    ['fxWobble','wobble','vFxWobble',2],
  ]){
    $(id).addEventListener('input',e=>{ const v=parseFloat(e.target.value);
      $(valId).textContent=v.toFixed(dp);
      // 频率始终写(共享,并同步给全局边缘几何);幅度为 0 时删键。sampleFrame 现读 fx,无需 seqDirty。
      if(key==='freq'){ fxSet('freq', v); P.efx.freq=v; } else fxSet(key, v>0?v:0); });
  }
  // ✦ 边缘几何 = 【全局】效果(P.efx),非逐状态:贯穿/仅停留 + 状态区间。逐帧现读,无需 seqDirty。
  for(const [id,key,valId] of [['fxFineWave','fineWave','vFxFineWave'],['fxJagged','jagged','vFxJagged'],['fxSplatter','splatter','vFxSplatter']])
    $(id).addEventListener('input',e=>{ const v=parseFloat(e.target.value); $(valId).textContent=v.toFixed(2); P.efx[key]=v>0?v:0; });
  $('efxScope').addEventListener('change',e=>{ P.efx.scope=e.target.value; });
  if($('jagMotion')) $('jagMotion').addEventListener('change',e=>{ P.efx.jagMotion=e.target.value; }); // 🪚 锯齿动作:伸缩/流动/微颤
  const efxRange=()=>{ const f=parseInt($('efxFrom').value), t=parseInt($('efxTo').value);
    P.efx.from = isFinite(f)&&f>0 ? f-1 : 0;        // UI 1 基 → 内部 0 基
    P.efx.to   = isFinite(t)&&t>0 ? t-1 : -1; };     // 留空/非法 = 到末尾
  $('efxFrom').addEventListener('input',efxRange); $('efxTo').addEventListener('input',efxRange);
  // 🎯 波浪锚点(逐状态 fx.anchor):波浪幅度随离锚点距离增长,锚点处不动。
  $('fxAnchorOn').addEventListener('change',e=>{ const fx=cur().fx||(cur().fx={});
    if(e.target.checked){ fx.anchor={x:parseFloat($('fxAnchorX').value), y:parseFloat($('fxAnchorY').value)};
      if(fx.anchorReach==null) fx.anchorReach=parseFloat($('fxAnchorReach').value); }
    else delete fx.anchor; });
  $('fxAnchorX').addEventListener('input',e=>{ const v=parseFloat(e.target.value); $('vFxAnchorX').textContent=v.toFixed(2);
    const fx=cur().fx; if(fx&&fx.anchor) fx.anchor.x=v; });
  $('fxAnchorY').addEventListener('input',e=>{ const v=parseFloat(e.target.value); $('vFxAnchorY').textContent=v.toFixed(2);
    const fx=cur().fx; if(fx&&fx.anchor) fx.anchor.y=v; });
  $('fxAnchorReach').addEventListener('input',e=>{ const v=parseFloat(e.target.value); $('vFxAnchorReach').textContent=v.toFixed(2);
    const fx=cur().fx||(cur().fx={}); fx.anchorReach=v; });
  // ── 🧪 实验物理(labfx):滑块行、监听、回填全部由 LAB_FX 表驱动 ——
  // 单一事实来源:新增一个效果只需在 labfx.js 的表里加一行,UI 自动长出来,不用碰这里。
  buildLabFxRows();
  for(const spec of LAB_FX){
    const el=$('lab_'+spec.key); if(!el) continue;
    el.addEventListener('input',e=>{
      const v=parseFloat(e.target.value);
      $('vlab_'+spec.key).textContent=v.toFixed(spec.dp);
      // keep 项是"参数"(风向/目标点/边数/粘滞/同步度),为 0 也要留着;幅度项为 0 则删键,
      // 保证工程文件干净、hasFx 判定不被空值拖累。sampleFrame 每帧现读 fx,无需 seqDirty。
      const fx=cur().fx||(cur().fx={});
      if(spec.keep || v) fx[spec.key]=v; else delete fx[spec.key];
    });
  }
  $('labFxClear').onclick=()=>{ const fx=cur().fx; if(!fx) return;
    pushUndo();
    for(const spec of LAB_FX) delete fx[spec.key];
    syncStateUI(); };
  // 🖋 墨水沉积(全局 P.ink):按 SDF 深度上色,边缘沉墨 + 内部晕染。逐帧现读,即时生效。
  if($('inkOn')){
    $('inkOn').addEventListener('change',e=>{ P.ink.on=e.target.checked; });
    for(const [id,key,valId,dp] of [['inkIntensity','intensity','vInkIntensity',2],['inkAngle','angle','vInkAngle',0],
      ['inkEdge','edge','vInkEdge',1],['inkBleed','bleed','vInkBleed',2],['inkDir','dir','vInkDir',2],['inkClear','clear','vInkClear',2],['inkDark','dark','vInkDark',2]])
      $(id).addEventListener('input',e=>{ const v=parseFloat(e.target.value); $(valId).textContent=dp?v.toFixed(dp):Math.round(v); P.ink[key]=v; });
    // 范围:『仅当前状态』把墨水钉在当前这个 frame 的 id 上(按 id → 增删/重排不跑偏);『所有状态』恢复全局
    if($('inkScope')) $('inkScope').addEventListener('change',e=>{
      P.ink.scope = e.target.value==='cur' ? cur().id : 'all';
      setHint(e.target.value==='cur' ? `🖋 墨水沉积现在只作用于当前状态「${cur().name||''}」` : '🖋 墨水沉积:所有状态'); });
  }

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
