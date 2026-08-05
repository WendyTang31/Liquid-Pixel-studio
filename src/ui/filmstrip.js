// 顶部状态胶片条:缩略图 + 名称,点击 = 编辑该状态,末尾"＋ 新状态"。
import { store, cur } from '../store.js';
import { W, H } from '../config.js';
import { $, setHint } from '../utils.js';
import { updateThumb, resample } from '../pipeline.js';
import { updateSelBox, syncSpeedUI } from './inspector.js';
import { syncClipUI } from './clipPanel.js';
import { copyKeyframes, pasteKeyframes, transformKeyframes, deleteKeyframes, hasClipboard } from './keyframes.js';
import { setMode } from './stage.js';
import { makeState, pushUndo, groupTail } from '../state.js';
import { LAB_FX } from '../labfx.js';

export function setActive(i){
  store.active=i; store.selStates=[i]; store.sel=null; updateSelBox(); syncStateUI();
  if(store.mode==='play') setMode('edit'); else renderStrip();
  setHint(`编辑「${cur().name}」`);
}

// 胶片条点选:普通点=单选;Shift+点=从当前帧到该帧【范围多选】(复制/粘贴/整体缩放移动的作用对象)。
function onChip(i, e){
  if(e.shiftKey){
    const a=store.active, lo=Math.min(a,i), hi=Math.max(a,i);
    store.selStates=[]; for(let k=lo;k<=hi;k++) store.selStates.push(k);
    store.sel=null; updateSelBox(); renderStrip();
    setHint(`选中 ${store.selStates.length} 个关键帧 —— 📋复制/📌粘贴、或整体移动/缩放`);
  } else setActive(i);
}

// 右属性栏"当前状态"区回填(含本段过渡覆盖控件)。
export function syncStateUI(){
  const s=cur();
  $('stName').value=s.name; $('stColor').value=s.color;
  $('stHold').value=s.hold; $('vHold').textContent=(+s.hold).toFixed(1);
  $('stDur').value=s.dur; $('vDur').textContent=(+s.dur).toFixed(1);
  const t=s.trans||{};
  $('trEase').value=t.ease||'';
  const syncOv=(ckId,slId,valId,key,dflt)=>{
    const has=t[key]!==undefined;
    $(ckId).checked=has;
    $(slId).value=has?t[key]:dflt;
    $(valId).textContent=(+(has?t[key]:dflt)).toFixed(2);
  };
  syncOv('trStagOn','trStag','vTrStag','stag',0.3);
  syncOv('trFlowOn','trFlow','vTrFlow','flow',0);
  syncOv('trStrOn','trStr','vTrStr','stretch',0);
  syncSpeedUI(); // ⚡ 速度曲线控件回填
  // 🔁 子循环控件回填:主状态(带姿态)显示基姿态计时;姿态状态显示提示
  const i=store.states.indexOf(s);
  const hasPoses=!s.isPose && store.states[i+1]?.isPose;
  const lt=$('loopTiming'), lh=$('loopHint');
  if(lt){
    lt.style.display=hasPoses?'':'none';
    if(hasPoses){
      const lp=s.loop||{};
      $('loopH0').value=lp.h0??1; $('vLoopH0').textContent=(+(lp.h0??1)).toFixed(2);
      $('loopD0').value=lp.d0??0.3; $('vLoopD0').textContent=(+(lp.d0??0.3)).toFixed(2);
    }
    lh.textContent = s.isPose
      ? '正在编辑循环姿态:上方"停留/过渡"= 本姿态在循环内的时长(眨眼闭合可设 0.05/0.1)'
      : hasPoses ? '停留期间按整数圈循环:基→姿态→…→基,与前后过渡无缝'
      : '给本状态加"循环姿态"可做眨眼/走路等微动作(在停留期间循环)';
  }
  // 🌊 动态几何回填
  const fx=s.fx||{};
  const fxg=(id,valId,k,def)=>{ const v=fx[k]??def; $(id).value=v; $(valId).textContent=(+v).toFixed(2); };
  fxg('fxFreq','vFxFreq','freq',0.6); fxg('fxSlosh','vFxSlosh','slosh',0);
  fxg('fxSpring','vFxSpring','spring',0); fxg('fxLiquid','vFxLiquid','liquid',0);
  fxg('fxRipple','vFxRipple','ripple',0); fxg('fxTwinkle','vFxTwinkle','twinkle',0);
  fxg('fxWobble','vFxWobble','wobble',0);
  // 🧪 实验物理回填:同样由 LAB_FX 表驱动,面板未生成时(极早期调用)静默跳过。
  for(const s of LAB_FX){ const el=$('lab_'+s.key); if(!el) continue;
    const v=fx[s.key]??s.def; el.value=v; $('vlab_'+s.key).textContent=(+v).toFixed(s.dp); }
  // 📷 本状态镜头回填
  const cm=s.cam||{x:0.5,y:0.5,z:1,rot:0};
  $('camZ').value=cm.z;   $('vCamZ').textContent=(+cm.z).toFixed(2)+'×';
  $('camX').value=cm.x;   $('vCamX').textContent=String(Math.round((cm.x-0.5)*W));
  $('camY').value=cm.y;   $('vCamY').textContent=String(Math.round((cm.y-0.5)*H));
  $('camRot').value=Math.round((cm.rot||0)*180/Math.PI);
  $('vCamRot').textContent=Math.round((cm.rot||0)*180/Math.PI)+'°';
  syncClipUI(); // 🎬 动画片段面板回填(当前状态属于片段时显示)
}

export function renderStrip(){
  const strip=$('strip'); strip.innerHTML='';
  let mNo=0; // 主状态序号(姿态不占号)
  store.states.forEach((s,i)=>{
    if(i>0){ const ar=document.createElement('div'); ar.className='arrow';
      ar.textContent=s.isPose?'·':'→'; strip.appendChild(ar); }
    const chip=document.createElement('div');
    chip.className='chip'+(s.isPose?' pose':'')+(i===store.active&&store.mode!=='play'?' active':'');
    if(store.selStates?.length>1 && store.selStates.includes(i)) chip.style.boxShadow='0 0 0 2px var(--mint)';
    const th=document.createElement('canvas');
    if(s.isPose){ th.width=68; th.height=40; } else { th.width=96; th.height=56; }
    s.thumb=th; updateThumb(s);
    const nm=document.createElement('div'); nm.className='nm';
    nm.textContent=s.isPose?`🔁 ${s.name}`:`${++mNo} · ${s.name}`;
    if(s.isPose) chip.title='循环姿态:归属左侧主状态,停留期间循环回放';
    chip.appendChild(th); chip.appendChild(nm);
    chip.onclick=(e)=>onChip(i,e);
    strip.appendChild(chip);
  });
  const add=document.createElement('button'); add.className='stripbtn'; add.textContent='＋ 新状态';
  add.onclick=addState;
  strip.appendChild(add);
  // 🎬 关键帧多选操作条(Shift+点选 ≥2 帧时出现):复制/粘贴/整体移动缩放/删除
  if(store.selStates?.length>1){
    const bar=document.createElement('div');
    bar.style.cssText='display:inline-flex;align-items:center;gap:4px;margin-left:10px;padding:4px 8px;'
      +'background:rgba(152,245,208,.08);border:1px solid var(--mint);border-radius:8px;white-space:nowrap';
    const tag=document.createElement('span'); tag.textContent=`${store.selStates.length} 帧`;
    tag.style.cssText='color:var(--mint);font-size:12px;margin-right:2px'; bar.appendChild(tag);
    const btn=(txt,title,fn)=>{ const b=document.createElement('button'); b.textContent=txt; b.title=title;
      b.style.cssText='padding:2px 7px;font-size:12px'; b.onclick=fn; bar.appendChild(b); };
    btn('📋','复制选中关键帧 (Ctrl+C)', copyKeyframes);
    if(hasClipboard()) btn('📌','粘贴到选区之后 (Ctrl+V) —— 往后接一份,右移即让动作往前走', pasteKeyframes);
    btn('＋','整段放大', ()=>transformKeyframes({scale:1.08}));
    btn('－','整段缩小', ()=>transformKeyframes({scale:1/1.08}));
    btn('←','左移', ()=>transformKeyframes({dx:-14}));
    btn('→','右移(往前走)', ()=>transformKeyframes({dx:14}));
    btn('↑','上移', ()=>transformKeyframes({dy:-14}));
    btn('↓','下移', ()=>transformKeyframes({dy:14}));
    btn('🗑','删除选中关键帧', deleteKeyframes);
    strip.appendChild(bar);
  }
}

// 新状态插到当前之后。(state ↔ filmstrip 的循环引用无害:两边引到的都是 hoisted 函数声明。)
function addState(){
  pushUndo();
  const at=groupTail(store.active)+1; // 落在组尾之后,别插进主状态与其姿态之间
  store.states.splice(at,0,makeState(`状态 ${store.states.length+1}`,'#98f5d0'));
  setActive(at); resample(cur()); renderStrip();
}
