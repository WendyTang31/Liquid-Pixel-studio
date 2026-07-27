// 底部时间轴(AE 式):每个状态铺成 [停留段][过渡段] 胶囊条,宽度 ∝ 时长。
// 拖任意处 = 擦洗;拖段右缘 = 改该段时长(与右栏滑杆双向同步);双击停留段 = 编辑该状态。
// 纯 UI:读 store.states / 写 hold·dur·g,段的划分规则与 engine.buildSequence 完全一致
// (hold≤0.01 不成段、seamless 补尾→首),否则条宽与真实播放时间会对不上。
import { store, cur } from '../store.js';
import { $ } from '../utils.js';
import { rebuildSequence } from '../sequence.js';
import { setMode } from './stage.js';
import { setActive, syncStateUI } from './filmstrip.js';

let sig='';           // DOM 重建签名:时长/颜色/名称/顺序变了才重建,playhead 每帧都动
let act=null;         // 进行中的手势 {kind:'scrub'} | {kind:'resize', i, field, startX, startVal, T0}

// 与 buildSequence 同规则的段列表(不含 pairs,纯排布用)。
function layoutSegs(){
  const N=store.states.length, seam=$('seamless').checked;
  const segs=[];
  store.states.forEach((s,i)=>{
    if(s.hold>0.01) segs.push({type:'hold', i, dur:s.hold});
    if(i<N-1 || (seam&&N>1)) segs.push({type:'trans', i, dur:s.dur});
  });
  if(!segs.length) segs.push({type:'hold', i:0, dur:1});
  let T=0; segs.forEach(sg=>{sg.t0=T; T+=sg.dur;});
  return {segs, T};
}

function sigOf(){
  return $('seamless').checked+'|'+store.active+'|'+store.mode+'|'+
    store.states.map(s=>`${s.id}:${s.hold}:${s.dur}:${s.color}:${s.name}`).join('|');
}

function rebuild(){
  const track=$('tlTrack');
  [...track.querySelectorAll('.seg')].forEach(e=>e.remove());
  const {segs,T}=layoutSegs();
  for(const sg of segs){
    const s=store.states[sg.i];
    const el=document.createElement('div');
    el.className=`seg ${sg.type}`+(sg.type==='hold'&&sg.i===store.active?' active':'');
    el.style.left=(sg.t0/T*100)+'%';
    el.style.width=(sg.dur/T*100)+'%';
    if(sg.type==='hold'){
      el.style.background=s.color+'2e';
      el.innerHTML=`<span class="lb">${sg.i+1}·${escapeHtml(s.name)} <i>${s.hold.toFixed(1)}s</i></span>`;
      el.title=`「${s.name}」停留 ${s.hold.toFixed(1)}s · 双击编辑该状态`;
      el.ondblclick=()=>setActive(sg.i);
    } else {
      el.innerHTML=`<span class="lb dim">➝ <i>${s.dur.toFixed(1)}s</i></span>`;
      el.title=`「${s.name}」→ 下一状态 过渡 ${s.dur.toFixed(1)}s`;
    }
    // 右缘时长手柄
    const h=document.createElement('div'); h.className='hdl';
    h.dataset.i=sg.i; h.dataset.field=sg.type==='hold'?'hold':'dur';
    el.appendChild(h);
    track.appendChild(el);
  }
}

// 每帧调用:签名变了重建条;播放头跟随 g。
export function tlTick(){
  const sg=sigOf(); if(sg!==sig){ sig=sg; rebuild(); }
  const ph=$('tlPh');
  if(store.mode==='play' && store.SEQ.T>0){
    ph.style.display='block';
    ph.style.left=(Math.min(1,store.g/store.SEQ.T)*100)+'%';
  } else ph.style.display='none';
}

function scrubTo(clientX){
  const track=$('tlTrack'), r=track.getBoundingClientRect();
  const frac=Math.max(0,Math.min(1,(clientX-r.left)/r.width));
  if(store.mode!=='play') setMode('play');
  if(store.seqDirty) rebuildSequence();
  store.g=frac*store.SEQ.T; store.playing=false;
  $('playBtn').textContent='▶ 播放';
}

export function initTimeline(){
  const track=$('tlTrack');
  track.addEventListener('pointerdown',e=>{
    if(e.target.classList.contains('hdl')){
      const i=+e.target.dataset.i, field=e.target.dataset.field;
      act={kind:'resize', i, field, startX:e.clientX,
           startVal:store.states[i][field], T0:layoutSegs().T};
    } else {
      act={kind:'scrub'}; scrubTo(e.clientX);
    }
    track.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  track.addEventListener('pointermove',e=>{
    if(!act) return;
    if(act.kind==='scrub'){ scrubTo(e.clientX); return; }
    const track=$('tlTrack');
    const dt=(e.clientX-act.startX)/track.clientWidth*act.T0;
    const s=store.states[act.i];
    // 与右栏滑杆同量程,免得两处显示打架
    const v=Math.round((act.startVal+dt)*10)/10;
    s[act.field] = act.field==='hold' ? Math.max(0,Math.min(5,v)) : Math.max(0.5,Math.min(8,v));
    store.seqDirty=true;
    if(act.i===store.active) syncStateUI();
  });
  const end=()=>{ act=null; };
  track.addEventListener('pointerup',end);
  track.addEventListener('pointercancel',end);
}

const escapeHtml=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
