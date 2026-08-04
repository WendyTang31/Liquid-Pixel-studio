// 🎬 动画片段面板:把当前状态所属的「片段(大图层)」整体操作 —— 总时长、缩放/移动、调速、循环圈数。
// 片段 = 连续同 clip.id 的状态(导入 SVG 循环即一个)。数学在 clip.js,这里只做 UI 回填与事件绑定。
import { store, cur } from '../store.js';
import { $, setHint } from '../utils.js';
import { pushUndo } from '../state.js';
import { rasterize, resample, updateThumb } from '../pipeline.js';
import { renderStrip } from './filmstrip.js';
import { updateSelBox } from './inspector.js';
import { clipIndicesOf, clipFrameCount, clipTotalSec, retimeClip,
         transformClip, setClipEase, setClipLoops } from '../clip.js';

const curClipId = () => cur()?.clip?.id ?? null;

// 片段所有帧重烧蒙版+采样+缩略图(缩放/移动后刷新画面),再刷胶片条与当前画布。
function refreshClip(id){
  for(const i of clipIndicesOf(store.states, id)){ const st=store.states[i]; rasterize(st); resample(st); updateThumb(st); }
  renderStrip(); updateSelBox(); store.seqDirty=true;
}

export function syncClipUI(){
  const panel=$('clipPanel'); if(!panel) return;
  const id=curClipId();
  if(id==null){ panel.style.display='none'; return; }
  panel.style.display='';
  const n=clipFrameCount(store.states, id), total=clipTotalSec(store.states, id);
  $('clipTitle').textContent=`🎬 动画片段「${cur().clip.name||'片段'}」· ${n} 帧`;
  $('clipTotal').value=Math.min(12, Math.max(0.4, total)); $('vClipTotal').textContent=total.toFixed(1);
  const loops=Math.max(1, Math.round(cur().clip.loops||1));
  $('clipLoops').value=loops; $('vClipLoops').textContent=String(loops);
  // 缓动:取片段首帧的过渡缓动作为整体显示
  const first=store.states[clipIndicesOf(store.states,id)[0]];
  $('clipEase').value=first?.trans?.ease||'';
  $('clipHint').textContent = loops>1
    ? `循环 ${loops} 圈后过渡到后面的下一段(若后面已有别的动画)`
    : '在本片段后面画/导入下一段动画,即自动无缝衔接;循环圈>1 可先走几圈再走过去';
}

let wired=false;
export function initClipPanel(){
  if(wired || !$('clipPanel')) return; wired=true;
  // 总时长:均分到各帧(把 loop 拉长到 3~10 秒)。pointerdown 存档一次,input 实时应用。
  $('clipTotal').addEventListener('pointerdown', ()=>{ if(curClipId()!=null) pushUndo(); });
  $('clipTotal').addEventListener('input', e=>{ const id=curClipId(); if(id==null) return;
    const v=+e.target.value; $('vClipTotal').textContent=v.toFixed(1);
    retimeClip(store.states, id, v); store.seqDirty=true; renderStrip();
    const s=cur(); $('stDur').value=s.dur; $('vDur').textContent=(+s.dur).toFixed(1);
    $('stHold').value=s.hold; $('vHold').textContent=(+s.hold).toFixed(1); });
  // 循环圈数
  $('clipLoops').addEventListener('pointerdown', ()=>{ if(curClipId()!=null) pushUndo(); });
  $('clipLoops').addEventListener('input', e=>{ const id=curClipId(); if(id==null) return;
    const v=Math.max(1, Math.round(+e.target.value)); $('vClipLoops').textContent=String(v);
    setClipLoops(store.states, id, v); store.seqDirty=true; syncClipUI(); });
  // 整体缩放/移动:每次点击施加一步(可连点累积)。缩放绕片段中心,移动 12px。
  const xform=(o,msg)=>{ const id=curClipId(); if(id==null) return; pushUndo();
    transformClip(store.states, id, o); refreshClip(id); setHint(msg); };
  $('clipUp').onclick  =()=>xform({scale:1.08}, '🎬 整段放大 8%');
  $('clipDown').onclick=()=>xform({scale:1/1.08}, '🎬 整段缩小');
  $('clipL').onclick=()=>xform({dx:-12}, '🎬 整段左移'); $('clipR').onclick=()=>xform({dx:12}, '🎬 整段右移');
  $('clipU').onclick=()=>xform({dy:-12}, '🎬 整段上移'); $('clipD').onclick=()=>xform({dy:12}, '🎬 整段下移');
  // 整体调速:片段内所有过渡统一缓动
  $('clipEase').onchange=e=>{ const id=curClipId(); if(id==null) return; pushUndo();
    setClipEase(store.states, id, e.target.value); store.seqDirty=true;
    setHint(e.target.value? `🎬 整段调速:${e.target.value}` : '🎬 整段恢复逐帧默认缓动'); };
}
