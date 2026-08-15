// 🖥 输出变换面板:实时预览「动画怎么 fit 进目标画幅」+ 网格 warp(拖点)+ 镜像/旋转 + 预览缩放,所见即所得。
import { P } from '../config.js';
import { store } from '../store.js';
import { $, setHint } from '../utils.js';
import { sampleFrame, vectorSolids } from '../engine.js';
import { computeVectorPolys } from '../vector.js';
import { renderToImageData } from '../render.js';
import { charactersSolids } from '../characters.js';
import { applyOutputTransform, defaultMesh, resampleMesh } from '../outtx.js';
import { exclusiveExportMode } from './exportmode.js';
import { scheduleAutosave } from '../autosave.js';

const SRC=256;                       // 预览用的基础渲染尺寸(小、够看)
const BASE_W=330, BASE_H=210;        // 预览画布基础分辨率(缩放倍数在其上)
let srcCv, outCv, prevCanvas, prevCtx, rafOn=false, drag=-1, zoom=1;

// 🛡 归一化:保证 outTx 始终有合法的 gx/gy/mesh,且 mesh 点数与网格匹配 —— 这是「没有内部点」的根治:
// 旧存档(只有四角 corners、无 mesh)或恢复后 mesh 与 gx/gy 不一致时,补成规则网格,不再画到 undefined。
function OT(){
  const t=P.outTx;
  t.gx=Math.max(1, t.gx|0 || 1); t.gy=Math.max(1, t.gy|0 || 1);
  const need=(t.gx+1)*(t.gy+1);
  if(!Array.isArray(t.mesh) || t.mesh.length!==need) t.mesh=defaultMesh(t.gx, t.gy);
  if(t.symMirror==null) t.symMirror='off';   // 🛡 旧存档/被整体覆盖后可能缺此键 → 补默认,绝不让下拉显示'h'却渲染成关闭
  return t;
}

function baseFrame(){
  if(!srcCv){ srcCv=document.createElement('canvas'); srcCv.width=SRC; srcCv.height=SRC; }
  // 空/未构建序列时 sampleFrame 会抛 —— 捕获后返回空白帧,好让预览的【画幅 + 网格控制点】照样画出来,
  // 不至于因动画本身没内容就整块预览(含网格)一起失踪。这也是「有内容但看不到网格点」的根治之一。
  try{
    const fr=sampleFrame(store.SEQ, store.states, store.g, store.clock, P);
    const solids=(fr.solids||[]).concat(
      vectorSolids(computeVectorPolys(store.states, store.SEQ, store.g, store.clock, P), fr.seg, store.states, store.g, store.clock))
      .concat(charactersSolids(store.charClock||0, store.g)); // 🚶 与主舞台一致:角色用 charClock(暂停即停、位置对齐),而非 store.clock
    renderToImageData(srcCv.getContext('2d'), SRC, SRC, fr.balls, fr.col, P, solids, fr.cam, fr.inkW);
  }catch(_){ const c=srcCv.getContext('2d'); c.clearRect(0,0,SRC,SRC); }
  return srcCv;
}
// 目标画幅在预览画布里的摆放(等比塞进画布,居中)。
function layout(){
  const t=OT(), boxW=prevCanvas.width, boxH=prevCanvas.height;
  const s=Math.min(boxW/t.w, boxH/t.h), pw=t.w*s, ph=t.h*s;
  return { s, pw, ph, ox:(boxW-pw)/2, oy:(boxH-ph)/2 };
}
function draw(){
  if(!prevCanvas) return;
  const t=OT();
  if(!outCv) outCv=document.createElement('canvas');
  const src=baseFrame();
  applyOutputTransform(src, { w:t.w, h:t.h, fit:t.fit, mirX:t.mirX, mirY:t.mirY, rot:t.rot, warp:t.warp, gx:t.gx, gy:t.gy, mesh:t.mesh, symMirror:t.symMirror||'off', transBg:!!P.transBg }, outCv);
  const L=layout();
  prevCtx.clearRect(0,0,prevCanvas.width,prevCanvas.height);
  prevCtx.fillStyle='#0d1210'; prevCtx.fillRect(L.ox,L.oy,L.pw,L.ph);
  prevCtx.drawImage(outCv, L.ox, L.oy, L.pw, L.ph);
  prevCtx.strokeStyle='#2f6f5a'; prevCtx.lineWidth=1; prevCtx.strokeRect(L.ox+.5,L.oy+.5,L.pw-1,L.ph-1);
  if(t.warp){
    const gx=t.gx, gy=t.gy, px=(i,j)=>{ const p=t.mesh[j*(gx+1)+i]; return [L.ox+p[0]*L.pw, L.oy+p[1]*L.ph]; };
    prevCtx.strokeStyle='rgba(136,238,255,0.65)'; prevCtx.lineWidth=1;
    for(let j=0;j<=gy;j++){ prevCtx.beginPath(); for(let i=0;i<=gx;i++){ const p=px(i,j); i?prevCtx.lineTo(p[0],p[1]):prevCtx.moveTo(p[0],p[1]);} prevCtx.stroke(); }
    for(let i=0;i<=gx;i++){ prevCtx.beginPath(); for(let j=0;j<=gy;j++){ const p=px(i,j); j?prevCtx.lineTo(p[0],p[1]):prevCtx.moveTo(p[0],p[1]);} prevCtx.stroke(); }
    const r=Math.max(4, 5*Math.min(1.6,zoom));
    for(let k=0;k<t.mesh.length;k++){ const j=(k/(gx+1))|0, i=k%(gx+1), p=px(i,j);
      prevCtx.fillStyle=k===drag?'#ffd479':'#8ef';
      prevCtx.beginPath(); prevCtx.arc(p[0],p[1],r,0,6.283); prevCtx.fill();
      prevCtx.strokeStyle='#0a0a0a'; prevCtx.lineWidth=1.5; prevCtx.stroke(); }
  }
}
// 一帧渲染出错(如序列临时未构建)不能永久打断预览循环 —— 捕获后继续,下一帧自愈。
function loop(){ if(!rafOn) return; if(isVisible()){ try{ draw(); }catch(_){} } requestAnimationFrame(loop); }
function isVisible(){ return prevCanvas && prevCanvas.offsetParent!==null && $('outTxOn')?.checked; }

function hitPoint(px,py){
  const t=OT(); if(!t.warp) return -1; const L=layout();
  const R=Math.max(11, 13*Math.min(1.6,zoom));
  for(let k=0;k<t.mesh.length;k++){ const x=L.ox+t.mesh[k][0]*L.pw, y=L.oy+t.mesh[k][1]*L.ph;
    if(Math.hypot(px-x,py-y)<R) return k; }
  return -1;
}
function applyZoom(){
  if(!prevCanvas) return;
  prevCanvas.width=Math.round(BASE_W*zoom); prevCanvas.height=Math.round(BASE_H*zoom);
  prevCanvas.style.width=prevCanvas.width+'px'; prevCanvas.style.height=prevCanvas.height+'px';
  if($('outTxZoomVal')) $('outTxZoomVal').textContent=zoom.toFixed(1)+'×';
  draw();
}

export function initOutTxPanel(){
  const on=$('outTxOn'); if(!on || !P.outTx) return;
  prevCanvas=$('outTxPrev'); if(prevCanvas) prevCtx=prevCanvas.getContext('2d');
  OT();                              // 先归一化一次(修旧存档缺 mesh)
  const sync=()=>{ $('outTxPanel').style.display = on.checked ? '' : 'none';
    if(on.checked && !rafOn){ rafOn=true; requestAnimationFrame(loop); } if(!on.checked) rafOn=false; };
  on.checked=!!P.outTx.on;
  on.addEventListener('change',e=>{ P.outTx.on=e.target.checked; if(e.target.checked) exclusiveExportMode('outTxOn'); sync();
    setHint(e.target.checked?'🖥 输出变换已开(已自动关掉 P2/取景框/宽画幅):自定画幅 + 镜像/旋转/网格 warp,右侧实时预览(可缩放)':'已关闭输出变换'); });
  // 尺寸
  const bindNum=(id,key)=>{ const el=$(id); if(!el) return; el.value=P.outTx[key];
    el.addEventListener('input',()=>{ P.outTx[key]=Math.max(2, parseInt(el.value,10)||2); draw(); }); };
  bindNum('outTxW','w'); bindNum('outTxH','h');
  if($('outTx3615')) $('outTx3615').onclick=()=>{ const t=P.outTx, long=Math.max(t.w,t.h);
    t.w=Math.round(long); t.h=Math.round(long*15/36); $('outTxW').value=t.w; $('outTxH').value=t.h; draw(); };
  if($('outTxFit')){ $('outTxFit').value=P.outTx.fit; $('outTxFit').onchange=e=>{ P.outTx.fit=e.target.value; draw(); }; }
  if($('outTxRot')){ $('outTxRot').value=String(P.outTx.rot); $('outTxRot').onchange=e=>{ P.outTx.rot=parseInt(e.target.value,10)||0; draw(); }; }
  if($('outTxSymMir')){ $('outTxSymMir').value=P.outTx.symMirror||'off';
    $('outTxSymMir').onchange=e=>{ P.outTx.symMirror=e.target.value; scheduleAutosave(); draw();
      const v=e.target.value;
      setHint(v==='off'?'已关闭双边镜像'
        : (v==='hfill'||v==='vfill')?'🪞🪞 双边铺满:动画装进一半、镜像到另一半 → 填满整条宽灯带的两半(方形塞进 36:15 双边充满就用它)'
        : '🪞 双边对称叠加:整幅沿中线镜像叠加(内容已满幅时用;旋转/warp 前施加)'); }; }
  const bindCk=(id,key)=>{ const el=$(id); if(!el) return; el.checked=!!P.outTx[key];
    el.addEventListener('change',()=>{ P.outTx[key]=el.checked; if(key==='warp' && el.checked) OT(); draw(); }); };
  bindCk('outTxMirX','mirX'); bindCk('outTxMirY','mirY'); bindCk('outTxWarp','warp');
  if($('outTxWarpReset')) $('outTxWarpReset').onclick=()=>{ const t=OT(); t.mesh=defaultMesh(t.gx, t.gy); draw(); };
  // 网格密度:改格数在旧网格上重采样 → 保持当前形状,只是控制点更密。
  if($('outTxGrid')){ const t=OT(); $('outTxGrid').value=`${t.gx}x${t.gy}`;
    $('outTxGrid').onchange=e=>{ const t=OT(); const [nx,ny]=e.target.value.split('x').map(n=>parseInt(n,10)||1);
      t.mesh=resampleMesh(t.mesh, t.gx, t.gy, nx, ny); t.gx=nx; t.gy=ny;
      if(!t.warp){ t.warp=true; if($('outTxWarp')) $('outTxWarp').checked=true; } draw(); }; }
  // 🔍 预览缩放:放大画布 → 控制点更大更好拖,精细调整。画布随之变大,面板可滚动查看。
  if($('outTxZoomIn')) $('outTxZoomIn').onclick=()=>{ zoom=Math.min(4, +(zoom+0.5).toFixed(1)); applyZoom(); };
  if($('outTxZoomOut')) $('outTxZoomOut').onclick=()=>{ zoom=Math.max(1, +(zoom-0.5).toFixed(1)); applyZoom(); };
  // 拖控制点
  if(prevCanvas){
    const pos=e=>{ const r=prevCanvas.getBoundingClientRect();
      return [ (e.clientX-r.left)*prevCanvas.width/r.width, (e.clientY-r.top)*prevCanvas.height/r.height ]; };
    prevCanvas.addEventListener('pointerdown',e=>{ const [x,y]=pos(e); drag=hitPoint(x,y);
      if(drag>=0){ prevCanvas.setPointerCapture(e.pointerId); e.preventDefault(); } });
    prevCanvas.addEventListener('pointermove',e=>{ if(drag<0) return; const [x,y]=pos(e); const L=layout();
      OT().mesh[drag]=[ Math.max(-0.5,Math.min(1.5,(x-L.ox)/L.pw)), Math.max(-0.5,Math.min(1.5,(y-L.oy)/L.ph)) ]; draw(); });
    prevCanvas.addEventListener('pointerup',()=>{ drag=-1; draw(); });
  }
  applyZoom();
  sync();
}
