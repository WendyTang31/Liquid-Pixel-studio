// 🖥 输出变换面板:实时预览「动画怎么 fit 进目标画幅」+ 拖四角 warp + 镜像/旋转,所见即所得。
import { P } from '../config.js';
import { store } from '../store.js';
import { $, setHint } from '../utils.js';
import { sampleFrame, vectorSolids } from '../engine.js';
import { computeVectorPolys } from '../vector.js';
import { renderToImageData } from '../render.js';
import { charactersSolids } from '../characters.js';
import { applyOutputTransform, defaultMesh, resampleMesh } from '../outtx.js';
import { exclusiveExportMode } from './exportmode.js';

const SRC=256;                       // 预览用的基础渲染尺寸(小、够看)
let srcCv, outCv, prevCanvas, prevCtx, rafOn=false, drag=-1;

function baseFrame(){
  if(!srcCv){ srcCv=document.createElement('canvas'); srcCv.width=SRC; srcCv.height=SRC; }
  const fr=sampleFrame(store.SEQ, store.states, store.g, store.clock, P);
  const solids=(fr.solids||[]).concat(
    vectorSolids(computeVectorPolys(store.states, store.SEQ, store.g, store.clock, P), fr.seg, store.states, store.g, store.clock))
    .concat(charactersSolids(store.clock, store.g));
  renderToImageData(srcCv.getContext('2d'), SRC, SRC, fr.balls, fr.col, P, solids, fr.cam, fr.inkW);
  return srcCv;
}
// 预览画布里目标画幅的摆放(等比塞进 boxW×boxH,居中)。
function layout(){
  const t=P.outTx, boxW=prevCanvas.width, boxH=prevCanvas.height;
  const s=Math.min(boxW/t.w, boxH/t.h), pw=t.w*s, ph=t.h*s;
  return { s, pw, ph, ox:(boxW-pw)/2, oy:(boxH-ph)/2 };
}
function draw(){
  if(!prevCanvas) return;
  const t=P.outTx;
  if(!outCv) outCv=document.createElement('canvas');
  const src=baseFrame();
  applyOutputTransform(src, { w:t.w, h:t.h, fit:t.fit, mirX:t.mirX, mirY:t.mirY, rot:t.rot, warp:t.warp, gx:t.gx, gy:t.gy, mesh:t.mesh }, outCv);
  const L=layout();
  prevCtx.clearRect(0,0,prevCanvas.width,prevCanvas.height);
  prevCtx.fillStyle='#0d1210'; prevCtx.fillRect(L.ox,L.oy,L.pw,L.ph);
  prevCtx.drawImage(outCv, L.ox, L.oy, L.pw, L.ph);
  prevCtx.strokeStyle='#2f6f5a'; prevCtx.lineWidth=1; prevCtx.strokeRect(L.ox+.5,L.oy+.5,L.pw-1,L.ph-1);
  // warp:画网格线 + 每个控制点手柄
  if(t.warp){
    const gx=t.gx||1, gy=t.gy||1, px=(i,j)=>{ const p=t.mesh[j*(gx+1)+i]; return [L.ox+p[0]*L.pw, L.oy+p[1]*L.ph]; };
    prevCtx.strokeStyle='rgba(136,238,255,0.6)'; prevCtx.lineWidth=1;
    for(let j=0;j<=gy;j++){ prevCtx.beginPath(); for(let i=0;i<=gx;i++){ const p=px(i,j); i?prevCtx.lineTo(...p):prevCtx.moveTo(...p);} prevCtx.stroke(); }
    for(let i=0;i<=gx;i++){ prevCtx.beginPath(); for(let j=0;j<=gy;j++){ const p=px(i,j); j?prevCtx.lineTo(...p):prevCtx.moveTo(...p);} prevCtx.stroke(); }
    for(let k=0;k<t.mesh.length;k++){ const j=(k/(gx+1))|0, i=k%(gx+1), p=px(i,j);
      prevCtx.fillStyle=k===drag?'#ffd479':'#8ef';
      prevCtx.beginPath(); prevCtx.arc(p[0],p[1],4.5,0,6.283); prevCtx.fill();
      prevCtx.strokeStyle='#0a0a0a'; prevCtx.lineWidth=1; prevCtx.stroke(); }
  }
}
function loop(){ if(!rafOn) return; if(isVisible()){ draw(); } requestAnimationFrame(loop); }
function isVisible(){ return prevCanvas && prevCanvas.offsetParent!==null && $('outTxOn')?.checked; }

function cornerAt(px,py){
  const t=P.outTx; if(!t.warp) return -1; const L=layout();
  for(let k=0;k<t.mesh.length;k++){ const x=L.ox+t.mesh[k][0]*L.pw, y=L.oy+t.mesh[k][1]*L.ph;
    if(Math.hypot(px-x,py-y)<11) return k; }
  return -1;
}
export function initOutTxPanel(){
  const on=$('outTxOn'); if(!on) return;
  if(!P.outTx) return;
  prevCanvas=$('outTxPrev'); if(prevCanvas) prevCtx=prevCanvas.getContext('2d');
  const t=P.outTx;
  const sync=()=>{ $('outTxPanel').style.display = on.checked ? '' : 'none';
    if(on.checked && !rafOn){ rafOn=true; requestAnimationFrame(loop); } if(!on.checked) rafOn=false; };
  on.checked=!!t.on;
  on.addEventListener('change',e=>{ t.on=e.target.checked; if(e.target.checked) exclusiveExportMode('outTxOn'); sync();
    setHint(e.target.checked?'🖥 输出变换已开(已自动关掉 P2/取景框/宽画幅,避免叠加冲突):可自定画幅 + 镜像/旋转/四角 warp,右侧实时预览':'已关闭输出变换'); });
  // 尺寸
  const bindNum=(id,key)=>{ const el=$(id); if(!el) return; el.value=t[key];
    el.addEventListener('input',()=>{ t[key]=Math.max(2, parseInt(el.value,10)||2); draw(); }); };
  bindNum('outTxW','w'); bindNum('outTxH','h');
  if($('outTx3615')) $('outTx3615').onclick=()=>{ const long=Math.max(t.w,t.h);
    t.w=Math.round(long); t.h=Math.round(long*15/36); $('outTxW').value=t.w; $('outTxH').value=t.h; draw(); };
  if($('outTxFit')){ $('outTxFit').value=t.fit; $('outTxFit').onchange=e=>{ t.fit=e.target.value; draw(); }; }
  if($('outTxRot')){ $('outTxRot').value=String(t.rot); $('outTxRot').onchange=e=>{ t.rot=parseInt(e.target.value,10)||0; draw(); }; }
  const bindCk=(id,key)=>{ const el=$(id); if(!el) return; el.checked=!!t[key];
    el.addEventListener('change',()=>{ t[key]=el.checked; if(key==='warp' && el.checked && !t.mesh){ t.gx=t.gy=1; t.mesh=defaultMesh(1,1); } draw(); }); };
  bindCk('outTxMirX','mirX'); bindCk('outTxMirY','mirY'); bindCk('outTxWarp','warp');
  if($('outTxWarpReset')) $('outTxWarpReset').onclick=()=>{ t.mesh=defaultMesh(t.gx||1, t.gy||1); draw(); };
  // 网格密度:改格数时在旧网格上重采样 → 保持当前 warp 形状,只是控制点更密。
  if($('outTxGrid')){ $('outTxGrid').value=`${t.gx||1}x${t.gy||1}`;
    $('outTxGrid').onchange=e=>{ const [nx,ny]=e.target.value.split('x').map(n=>parseInt(n,10)||1);
      t.mesh=resampleMesh(t.mesh, t.gx||1, t.gy||1, nx, ny); t.gx=nx; t.gy=ny; if(!t.warp){ t.warp=true; $('outTxWarp').checked=true; } draw(); }; }
  // 拖四角
  if(prevCanvas){
    const pos=e=>{ const r=prevCanvas.getBoundingClientRect();
      return [ (e.clientX-r.left)*prevCanvas.width/r.width, (e.clientY-r.top)*prevCanvas.height/r.height ]; };
    prevCanvas.addEventListener('pointerdown',e=>{ const [x,y]=pos(e); drag=cornerAt(x,y);
      if(drag>=0){ prevCanvas.setPointerCapture(e.pointerId); e.preventDefault(); } });
    prevCanvas.addEventListener('pointermove',e=>{ if(drag<0) return; const [x,y]=pos(e); const L=layout();
      t.mesh[drag]=[ Math.max(-0.5,Math.min(1.5,(x-L.ox)/L.pw)), Math.max(-0.5,Math.min(1.5,(y-L.oy)/L.ph)) ]; draw(); });
    prevCanvas.addEventListener('pointerup',()=>{ drag=-1; draw(); });
  }
  sync();
}
