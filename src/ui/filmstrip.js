// 顶部状态胶片条:缩略图 + 名称,点击 = 编辑该状态,末尾"＋ 新状态"。
import { store, cur } from '../store.js';
import { W, H } from '../config.js';
import { $, setHint } from '../utils.js';
import { updateThumb, resample } from '../pipeline.js';
import { updateSelBox } from './inspector.js';
import { setMode } from './stage.js';
import { makeState, pushUndo } from '../state.js';

export function setActive(i){
  store.active=i; store.sel=null; updateSelBox(); syncStateUI();
  if(store.mode==='play') setMode('edit'); else renderStrip();
  setHint(`编辑「${cur().name}」`);
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
  // 📷 本状态镜头回填
  const cm=s.cam||{x:0.5,y:0.5,z:1,rot:0};
  $('camZ').value=cm.z;   $('vCamZ').textContent=(+cm.z).toFixed(2)+'×';
  $('camX').value=cm.x;   $('vCamX').textContent=String(Math.round((cm.x-0.5)*W));
  $('camY').value=cm.y;   $('vCamY').textContent=String(Math.round((cm.y-0.5)*H));
  $('camRot').value=Math.round((cm.rot||0)*180/Math.PI);
  $('vCamRot').textContent=Math.round((cm.rot||0)*180/Math.PI)+'°';
}

export function renderStrip(){
  const strip=$('strip'); strip.innerHTML='';
  store.states.forEach((s,i)=>{
    if(i>0){ const ar=document.createElement('div'); ar.className='arrow'; ar.textContent='→'; strip.appendChild(ar); }
    const chip=document.createElement('div');
    chip.className='chip'+(i===store.active&&store.mode!=='play'?' active':'');
    const th=document.createElement('canvas'); th.width=96; th.height=56;
    s.thumb=th; updateThumb(s);
    const nm=document.createElement('div'); nm.className='nm';
    nm.textContent=`${i+1} · ${s.name}`;
    chip.appendChild(th); chip.appendChild(nm);
    chip.onclick=()=>setActive(i);
    strip.appendChild(chip);
  });
  const add=document.createElement('button'); add.className='stripbtn'; add.textContent='＋ 新状态';
  add.onclick=addState;
  strip.appendChild(add);
}

// 新状态插到当前之后。(state ↔ filmstrip 的循环引用无害:两边引到的都是 hoisted 函数声明。)
function addState(){
  pushUndo();
  store.states.splice(store.active+1,0,makeState(`状态 ${store.states.length+1}`,'#98f5d0'));
  setActive(store.active+1); resample(cur()); renderStrip();
}
