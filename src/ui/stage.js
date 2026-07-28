// 中央舞台:画布交互(画/选/移/缩/单点)、叠加层(洋葱皮/轨迹/画幅线/选框)、
// 播放模式与 requestAnimationFrame 主循环。预览渲染走 render.js 的 createPreviewRenderer。
import { W, H, P } from '../config.js';
import { store, cur } from '../store.js';
import { $, hex2rgb, setHint, getExpSize } from '../utils.js';
import { createSizedRenderer } from '../render.js';
import { createGLRenderer } from '../render-gl.js';
import { sampleFrame, drift, camPt, camIdentity } from '../engine.js';
import { rebuildSequence } from '../sequence.js';
import { resampleAll, resample, updateThumb, shapesChanged, measureText } from '../pipeline.js';
import { pushUndo, undo, redo } from '../state.js';
import { decodeImageShape } from '../image.js';
import { updateSelBox, deleteSel } from './inspector.js';
import { renderStrip } from './filmstrip.js';
import { setTool } from './toolbar.js';
import { pathBBox, traceShapePath } from '../path.js';
import { applyShapeBBox } from '../shapes.js';
import { drawSkinRef, skinWindowAt, skinHandleAt, skinCursorAt, getSelSkin, selectSkin,
  clearSkinSel, skinPushUndo, skinUndo, deleteSelSkin, persistSkin, skinFocus, setSkinFocus,
  skinHasUndo } from './skinRef.js';
import { tlTick } from './timeline.js';
import { computeVectorPolys, staticVectorPolys, rasterizeVectorSolids } from '../vector.js';

let cv, ctx, previewRender, glRender=null, glCv=null;
// #cv 缓冲用 2× 逻辑分辨率(960×560)提升基础清晰度;叠加层用 VS 缩放变换按逻辑坐标绘制。
const BW=W*2, BH=H*2, VS=2;
// 双画布:#cvgl(WebGL 高分辨率场渲染,垫底)+ #cv(2D,GPU 模式下只画叠加层)。
// gpuOn 时 2D 画布每帧 clearRect 保持透明,场画面从下层透出;CPU 回退时行为与旧版一致。
const gpuOn=()=> glRender && $('useGpu')?.checked && !store.forceCpu; // 录制 WebM 时强制 CPU(captureStream 抓 2D 画布)

const HANDLE=5;
const handlePts=s=>[[s.x,s.y],[s.x+s.w,s.y],[s.x,s.y+s.h],[s.x+s.w,s.y+s.h]];
// 路径锚点变换(保留贝塞尔控制柄):平移 / 按框缩放。移动/缩放路径时不能丢柄。
const translatePt=(pt,tx,ty)=>{ const o={x:pt.x+tx,y:pt.y+ty};
  if(pt.hIn) o.hIn={x:pt.hIn.x+tx,y:pt.hIn.y+ty};
  if(pt.hOut) o.hOut={x:pt.hOut.x+tx,y:pt.hOut.y+ty}; return o; };
const scalePt=(pt,ox,oy,sx,sy,nx,ny)=>{ const S=(q)=>({x:nx+(q.x-ox)*sx, y:ny+(q.y-oy)*sy});
  const o=S(pt); if(pt.hIn)o.hIn=S(pt.hIn); if(pt.hOut)o.hOut=S(pt.hOut); return o; };

// 智能吸附:移动中的形状的 左/中/右(上/中/下)贴近画布中线或其它形状的边与中心 4px 内
// 时磁吸到位,同时记录参考线供叠加层高亮 —— PPT/Figma 式对齐体验。
const SNAP=4;
function snapMove(sel, px, py){
  const s=cur();
  const vT=[W/2], hT=[H/2];
  for(const sh of s.shapes){ if(sh===sel) continue;
    vT.push(sh.x, sh.x+sh.w/2, sh.x+sh.w);
    hT.push(sh.y, sh.y+sh.h/2, sh.y+sh.h); }
  const guides=[];
  let bx=null, bdx=SNAP+0.001;
  for(const t of vT) for(const off of [0, sel.w/2, sel.w]){
    const d=Math.abs(t-(px+off)); if(d<bdx){ bdx=d; bx=t-off; guides[0]={axis:'v',pos:t}; } }
  let by=null, bdy=SNAP+0.001;
  for(const t of hT) for(const off of [0, sel.h/2, sel.h]){
    const d=Math.abs(t-(py+off)); if(d<bdy){ bdy=d; by=t-off; guides[1]={axis:'h',pos:t}; } }
  return { x: bx??px, y: by??py, guides: guides.filter(Boolean) };
}
function overlaySnapGuides(){
  if(!store.snapGuides?.length) return;
  ctx.strokeStyle='rgba(152,245,208,0.85)'; ctx.setLineDash([6,4]); ctx.lineWidth=1;
  for(const gd of store.snapGuides){
    ctx.beginPath();
    if(gd.axis==='v'){ ctx.moveTo(gd.pos,0); ctx.lineTo(gd.pos,H); }
    else { ctx.moveTo(0,gd.pos); ctx.lineTo(W,gd.pos); }
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// 路径最近线段:返回最近的相邻锚点对索引(环形,与 fillSmoothClosedPath 的闭合方式一致)及距离,
// 供双击"在线段上插入锚点"命中测试用。
function nearestPathSegment(points,p){
  const n=points.length; let best=-1,bd=Infinity;
  for(let i=0;i<n;i++){
    const a=points[i], b=points[(i+1)%n];
    const dx=b.x-a.x, dy=b.y-a.y, len2=dx*dx+dy*dy;
    const t=len2<1e-9?0:Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2));
    const d=Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
    if(d<bd){bd=d;best=i;}
  }
  return {index:best, dist:bd};
}

// ══════════════ 叠加层 ══════════════
function overlayOnion(){
  if(store.hideOverlays||!$('showOnion').checked||store.mode==='play') return;
  const N=store.states.length;
  if(N<2) return;
  const prev=store.states[(store.active-1+N)%N], next=store.states[(store.active+1)%N];
  if(prev!==cur()) ctx.drawImage(prev.ghost,0,0);
  if(next!==cur()&&next!==prev) ctx.drawImage(next.ghost,0,0);
}
function overlayTraj(curBalls,seg,cam){
  if(store.hideOverlays||!$('showTraj').checked||!seg||seg.type!=='trans') return;
  const pairs=seg.pairs, step=Math.ceil(pairs.length/350);
  ctx.lineWidth=0.6;
  for(let i=0;i<pairs.length;i+=step){
    const p=pairs[i];
    // 端点过一遍镜头变换,轨迹线才与(已被镜头变换的)球画面对齐
    const [ax,ay]=camPt(p.a.x,p.a.y,cam), [bx,by]=camPt(p.b.x,p.b.y,cam);
    ctx.strokeStyle='rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.moveTo(ax*W,ay*H); ctx.lineTo(bx*W,by*H); ctx.stroke();
    if(curBalls&&curBalls[i]){ ctx.fillStyle='rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(curBalls[i].x*W,curBalls[i].y*H,1.2,0,7); ctx.fill(); }
  }
}
function overlayFrameGuide(){
  if(store.hideOverlays||!$('showFrame').checked) return;
  const [EW,EH]=getExpSize(), ar=EW/EH, ar0=W/H;
  let gw,gh;
  if(ar>ar0){ gw=W; gh=W/ar; } else { gh=H; gw=H*ar; }
  ctx.strokeStyle='rgba(255,200,80,0.55)'; ctx.setLineDash([5,4]); ctx.lineWidth=1;
  ctx.strokeRect((W-gw)/2,(H-gh)/2,gw,gh); ctx.setLineDash([]);
}
// 📷 取景框:编辑模式下把本状态镜头的可见区域画出来(播放/导出时该区域被放大填满全幅)。
// 屏幕 = R(rot)·(p−c)·z + 中心,故取景框 = 以 c 为中心、W/z×H/z、旋转 −rot 的矩形。
function overlayCamFrame(){
  if(store.hideOverlays||store.mode==='play') return;
  const cm=cur().cam;
  if(camIdentity(cm)) return;
  ctx.save();
  ctx.translate(cm.x*W, cm.y*H); ctx.rotate(-(cm.rot||0));
  const z=cm.z||1;
  ctx.strokeStyle='rgba(160,150,255,0.85)'; ctx.setLineDash([7,5]); ctx.lineWidth=1.2;
  ctx.strokeRect(-W/(2*z), -H/(2*z), W/z, H/z);
  ctx.setLineDash([]);
  ctx.font='11px sans-serif'; ctx.fillStyle='rgba(160,150,255,0.9)';
  ctx.fillText('📷', -W/(2*z)+4, -H/(2*z)+13);
  ctx.restore();
}
function overlaySelection(){
  if(store.mode==='play') return;
  // 多选成员薄框 + 框选进行中的虚线矩形
  for(const sh of store.selMulti||[]){ if(sh===store.sel) continue;
    ctx.strokeStyle='rgba(120,180,255,0.5)'; ctx.lineWidth=1;
    ctx.strokeRect(sh.x,sh.y,sh.w,sh.h); }
  if((store.dragAct==='marquee'||store.dragAct==='shiftsel')&&store.dragStart&&store.dragNow){
    ctx.strokeStyle='rgba(152,245,208,0.7)'; ctx.setLineDash([4,3]); ctx.lineWidth=1;
    ctx.strokeRect(Math.min(store.dragStart.x,store.dragNow.x), Math.min(store.dragStart.y,store.dragNow.y),
      Math.abs(store.dragNow.x-store.dragStart.x), Math.abs(store.dragNow.y-store.dragStart.y));
    ctx.setLineDash([]);
  }
  if(!store.sel) return;
  const sel=store.sel;
  if(sel.type==='path'){
    // 描边显示实际会被填充的曲线,再逐锚点画手柄(区别于下方整体缩放的方块手柄)
    if(traceShapePath(ctx, sel)){
      ctx.strokeStyle='rgba(120,180,255,0.85)'; ctx.lineWidth=1; ctx.stroke();
    }
    for(const p of sel.points){
      if(sel.bezier) for(const hk of ['hIn','hOut']){ const h=p[hk]; if(!h) continue;
        ctx.strokeStyle='rgba(255,214,120,0.7)'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(h.x,h.y); ctx.stroke();
        ctx.fillStyle='#ffd678'; ctx.beginPath(); ctx.arc(h.x,h.y,2.8,0,7); ctx.fill(); }
      ctx.fillStyle='#7ab4ff'; ctx.beginPath(); ctx.arc(p.x,p.y,3.2,0,7); ctx.fill();
    }
  }
  ctx.strokeStyle='rgba(120,180,255,0.95)'; ctx.lineWidth=1;
  ctx.strokeRect(sel.x,sel.y,sel.w,sel.h);
  ctx.fillStyle='#7ab4ff';
  for(const [hx,hy] of handlePts(sel))
    ctx.fillRect(hx-HANDLE/2,hy-HANDLE/2,HANDLE,HANDLE);
}

// ══════════════ 主循环 ══════════════
function tick(now){
  const dt=(now-store.last)/1000; store.last=now; store.clock+=dt;
  // 叠加层按逻辑坐标(480×280)绘制,统一 VS 缩放到 960×560 缓冲;
  // previewRender 的 putImageData 忽略变换、直接铺满缓冲,不受影响。
  ctx.setTransform(VS,0,0,VS,0,0);
  if(store.mode==='play'){
    if(store.seqDirty) rebuildSequence();
    if(store.playing){ store.g+=dt;
      if(store.g>=store.SEQ.T){ if($('loop').checked) store.g-=store.SEQ.T;
        else{ store.g=store.SEQ.T; store.playing=false; $('playBtn').textContent='▶ 播放'; } } }
    $('tVal').textContent=store.g.toFixed(1)+'s';
    const fr=sampleFrame(store.SEQ, store.states, store.g, store.clock, P);
    // 矢量图层(AE 关联图层):独立于点阵,轮廓直接插值 → SDF solid,并入实心渲染
    const solids=(fr.solids||[]).concat(rasterizeVectorSolids(computeVectorPolys(store.states, store.SEQ, store.g)));
    // 实心场是 CPU 采样(SDF 纹理未进 GL 着色器),该帧有实心即回退 CPU 渲染
    if(gpuOn() && !solids.length){ glCv.style.display='block'; glRender(fr.balls, fr.col, P); ctx.clearRect(0,0,W,H); }
    else { if(glCv) glCv.style.display='none'; previewRender(fr.balls, fr.col, P, solids.length?solids:null, fr.cam); }
    overlayTraj(fr.balls, fr.seg, fr.cam); overlayFrameGuide();
  } else {
    const s=cur();
    // 实心状态在编辑模式也按 SDF 显示(此前只在播放/导出/3D 生效 → 勾了实心编辑时仍看到笔画黑团)。
    // 实心蒙版内的点抑制(r=0),边缘由矢量 SDF 主导;编辑态不套镜头,SDF 与点同在画布坐标系。
    let solid = s.solid && s._sdf ? [{sdf:s._sdf, w:1}] : [];
    solid=solid.concat(rasterizeVectorSolids(staticVectorPolys(s))); // 矢量图层静态轮廓
    if(!solid.length) solid=null;
    const editBalls=s.dots.map((b,i)=>({x:b.x+P.amp*drift(i*2.3,store.clock,P),y:b.y+P.amp*drift(i*2.3+3,store.clock,P),
      r:(solid&&b.sf)?0:b.r, c:b.c}));
    if(gpuOn() && !solid){ glCv.style.display='block'; glRender(editBalls, hex2rgb(s.color), P); ctx.clearRect(0,0,W,H); }
    else { if(glCv) glCv.style.display='none'; previewRender(editBalls, hex2rgb(s.color), P, solid, null); }
    ctx.drawImage(s.ghost,0,0);
    overlayOnion();
    if(!store.hideOverlays && $('showSkin')?.checked) drawSkinRef(ctx); // 车面参考(UV 皮肤式)
    if(store.dragAct==='draw'&&store.dragStart&&store.dragNow){
      ctx.strokeStyle='rgba(152,245,208,0.8)'; ctx.setLineDash([4,3]); ctx.lineWidth=1;
      const x0=store.dragStart.x,y0=store.dragStart.y,x1=store.dragNow.x,y1=store.dragNow.y;
      ctx.beginPath();
      if(P.tool==='rect') ctx.rect(Math.min(x0,x1),Math.min(y0,y1),Math.abs(x1-x0),Math.abs(y1-y0));
      else ctx.ellipse((x0+x1)/2,(y0+y1)/2,Math.abs(x1-x0)/2,Math.abs(y1-y0)/2,0,0,7);
      ctx.stroke(); ctx.setLineDash([]);
    }
    if(store.penPts?.length) overlayPen();
    // 中线(青色长虚线 + 位置标注)
    if(!store.hideOverlays) for(const g of cur().guides||[]){
      ctx.strokeStyle='rgba(120,230,255,0.55)'; ctx.setLineDash([9,6]); ctx.lineWidth=1;
      ctx.beginPath();
      if(g.a==='v'){ ctx.moveTo(g.p,0); ctx.lineTo(g.p,H); } else { ctx.moveTo(0,g.p); ctx.lineTo(W,g.p); }
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle='rgba(120,230,255,0.8)'; ctx.font='9px system-ui';
      if(g.a==='v') ctx.fillText(Math.round(g.p), g.p+3, 10); else ctx.fillText(Math.round(g.p), 3, g.p-3);
    }
    overlaySelection(); overlaySnapGuides(); overlayFrameGuide(); overlayCamFrame(); overlayDims();
  }
  tlTick(); // AE 式时间轴:签名变化时重建段条,播放头逐帧跟随
  requestAnimationFrame(tick);
}
export function startLoop(){ store.last=performance.now(); requestAnimationFrame(tick); }

// ══════════════ 模式切换 ══════════════
export function setMode(m){ store.mode=m;
  $('mPlay').classList.toggle('active',m==='play');
  if(m==='play'){ store.sel=null; store.selMulti=[]; updateSelBox();
    resampleAll(); rebuildSequence(); store.g=0;
    store.playing=true; $('playBtn').textContent='⏸ 暂停';
    $('mPlay').textContent='✏ 回到编辑';
    setHint(`预览序列 · 共 ${store.states.length} 个状态 · 总时长 ${store.SEQ.T.toFixed(1)}s`);
  } else {
    store.playing=false; $('playBtn').textContent='▶ 播放';
    $('mPlay').textContent='▶ 预览序列';
    setHint(`编辑「${cur().name}」`);
  }
  renderStrip();
}

// ══════════════ 指针交互 ══════════════
function ptr(e){ const r=cv.getBoundingClientRect();
  return {x:(e.clientX-r.left)/r.width*W, y:(e.clientY-r.top)/r.height*H}; }

// ── CAD 式边拾取与尺寸标注(Fusion 流程:点边 1 → Shift+点边 2/中线 → 输入距离 → Enter)──
let edgePick=null;   // 第一条被拾取的边 {sh,edge,axis,pos} 或中线 {g,axis,pos}
const EDGE_HIT=4;
function pickEdgeAt(p,s){
  for(let i=s.shapes.length-1;i>=0;i--){ const sh=s.shapes[i];
    if(sh.hidden||sh.locked) continue;
    const inY=p.y>sh.y-EDGE_HIT&&p.y<sh.y+sh.h+EDGE_HIT, inX=p.x>sh.x-EDGE_HIT&&p.x<sh.x+sh.w+EDGE_HIT;
    if(inY&&Math.abs(p.x-sh.x)<EDGE_HIT) return {sh,edge:'l',axis:'x',pos:sh.x};
    if(inY&&Math.abs(p.x-(sh.x+sh.w))<EDGE_HIT) return {sh,edge:'r',axis:'x',pos:sh.x+sh.w};
    if(inX&&Math.abs(p.y-sh.y)<EDGE_HIT) return {sh,edge:'t',axis:'y',pos:sh.y};
    if(inX&&Math.abs(p.y-(sh.y+sh.h))<EDGE_HIT) return {sh,edge:'b',axis:'y',pos:sh.y+sh.h};
  }
  for(const g of s.guides||[]){
    if(g.a==='v'&&Math.abs(p.x-g.p)<EDGE_HIT) return {g,axis:'x',pos:g.p};
    if(g.a==='h'&&Math.abs(p.y-g.p)<EDGE_HIT) return {g,axis:'y',pos:g.p};
  }
  return null;
}
// 浮动尺寸输入框(Fusion 的 fx 框):Enter 落成持久 edgegap 约束,Esc 取消。
function openDimInput(a,b){
  if(a.axis!==b.axis){ setHint('两条边方向不一致(都需竖直边或都需水平边)'); edgePick=null; return; }
  // 被驱动方 = 后拾取的形状边;若后拾取的是中线,则先拾取的形状被驱动
  const dep=b.sh?b:a, ref=b.sh?a:b;
  if(!dep.sh){ setHint('两条都是中线,无法标注(至少一条是形状边)'); edgePick=null; return; }
  closeDimInput();
  const off0=dep.pos-ref.pos;
  const inp=document.createElement('input');
  inp.type='text'; inp.id='dimInp'; inp.value=String(Math.round(Math.abs(off0)));
  const r=cv.getBoundingClientRect(), host=cv.parentElement;
  const mx=(a.pos+b.pos)/2/(a.axis==='x'?W:1), my=a.axis==='x'?(p2y(a,b)):(a.pos+b.pos)/2/H;
  inp.style.cssText=`position:absolute;width:64px;z-index:9;font-size:12px;text-align:center;
    left:${a.axis==='x'?((a.pos+b.pos)/2/W*100):50}%;top:${a.axis==='y'?((a.pos+b.pos)/2/H*100):50}%;
    transform:translate(-50%,-50%);background:#1e1e1e;color:#98f5d0;border:1px solid #98f5d0;border-radius:5px;`;
  host.appendChild(inp); inp.focus(); inp.select();
  inp.onkeydown=ev=>{
    ev.stopPropagation();
    if(ev.key==='Escape'){ closeDimInput(); edgePick=null; return; }
    if(ev.key!=='Enter') return;
    const v=parseFloat(inp.value);
    if(!isFinite(v)||v<0){ setHint('请输入非负距离(px)'); return; }
    pushUndo();
    const sgn=off0===0?1:Math.sign(off0);
    dep.sh.rel={type:'edgegap', myEdge:dep.edge, off:sgn*v,
      ...(ref.sh?{ref:ref.sh.id, refEdge:ref.edge}:{gref:ref.g.id})};
    closeDimInput(); edgePick=null;
    shapesChanged(cur()); updateSelBox();
    setHint(`📏 已标注:边距 ${v}px 持久成立(拖参照,它跟着走;选中后可改/解除)`);
  };
  inp.onblur=()=>{ closeDimInput(); };
}
const p2y=()=>50; // 简化:竖直边标注框放画布纵向中部
function closeDimInput(){ document.getElementById('dimInp')?.remove(); }

// 尺寸标注叠加:被 edgegap 约束的形状,画出 参照边↔本边 的标注线与数值(CAD 风格)。
function overlayDims(){
  if(store.hideOverlays||store.mode==='play') return;
  const s=cur(), byId=new Map(s.shapes.map(x=>[x.id,x]));
  ctx.font='10px system-ui';
  for(const sh of s.shapes){
    const r=sh.rel; if(!r||r.type!=='edgegap') continue;
    let pos=null;
    if(r.ref!=null){ const ref=byId.get(r.ref); if(ref) pos=({l:ref.x,r:ref.x+ref.w,t:ref.y,b:ref.y+ref.h})[r.refEdge]; }
    else { const g=(s.guides||[]).find(x=>x.id===r.gref); if(g) pos=g.p; }
    if(pos==null) continue;
    const my=({l:sh.x,r:sh.x+sh.w,t:sh.y,b:sh.y+sh.h})[r.myEdge];
    const horiz=(r.myEdge==='l'||r.myEdge==='r');
    const lat=horiz? sh.y+sh.h/2 : sh.x+sh.w/2;   // 标注线放本形状中部
    ctx.strokeStyle='rgba(255,214,120,0.85)'; ctx.lineWidth=1;
    ctx.beginPath();
    if(horiz){ ctx.moveTo(pos,lat); ctx.lineTo(my,lat);
      ctx.moveTo(pos,lat-4); ctx.lineTo(pos,lat+4); ctx.moveTo(my,lat-4); ctx.lineTo(my,lat+4); }
    else { ctx.moveTo(lat,pos); ctx.lineTo(lat,my);
      ctx.moveTo(lat-4,pos); ctx.lineTo(lat+4,pos); ctx.moveTo(lat-4,my); ctx.lineTo(lat+4,my); }
    ctx.stroke();
    const label=`${Math.round(Math.abs(r.off))}`;
    const tx=horiz?(pos+my)/2:lat, ty=horiz?lat-4:(pos+my)/2-4;
    ctx.fillStyle='rgba(20,20,20,0.85)';
    const tw=ctx.measureText(label).width;
    ctx.fillRect(tx-tw/2-3,ty-9,tw+6,12);
    ctx.fillStyle='#ffd678'; ctx.textAlign='center'; ctx.fillText(label,tx,ty); ctx.textAlign='left';
  }
  // 已拾取的第一条边:高亮
  if(edgePick){
    ctx.strokeStyle='#98f5d0'; ctx.lineWidth=2.5;
    ctx.beginPath();
    if(edgePick.g){ if(edgePick.g.a==='v'){ctx.moveTo(edgePick.pos,0);ctx.lineTo(edgePick.pos,H);} else {ctx.moveTo(0,edgePick.pos);ctx.lineTo(W,edgePick.pos);} }
    else { const sh=edgePick.sh;
      if(edgePick.axis==='x'){ ctx.moveTo(edgePick.pos,sh.y); ctx.lineTo(edgePick.pos,sh.y+sh.h); }
      else { ctx.moveTo(sh.x,edgePick.pos); ctx.lineTo(sh.x+sh.w,edgePick.pos); } }
    ctx.stroke();
  }
}

// 光标下是否有图案(形状):已选形状的缩放手柄/路径锚点,或任一未隐藏未锁形状的包围盒。
// 供"图案优先于取景框"判定用 —— 与下方形状命中逻辑同规则。
// 钢笔进行中的预览:已放锚点的贝塞尔折线 + 控制柄 + 从末锚点到光标的橡皮筋;起点高亮(可闭合)。
function overlayPen(){
  const pts=store.penPts, cur2=store.penCursor;
  ctx.strokeStyle='rgba(152,245,208,0.9)'; ctx.lineWidth=1.4; ctx.beginPath();
  ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++){ const a=pts[i-1], b=pts[i], c1=a.hOut||a, c2=b.hIn||b;
    ctx.bezierCurveTo(c1.x,c1.y,c2.x,c2.y,b.x,b.y); }
  ctx.stroke();
  if(cur2){ const a=pts[pts.length-1], c1=a.hOut||a; // 橡皮筋(到光标,尊重末锚点出柄)
    ctx.strokeStyle='rgba(152,245,208,0.45)'; ctx.setLineDash([4,3]); ctx.beginPath();
    ctx.moveTo(a.x,a.y); ctx.bezierCurveTo(c1.x,c1.y,cur2.x,cur2.y,cur2.x,cur2.y); ctx.stroke(); ctx.setLineDash([]); }
  for(const p of pts){
    for(const hk of ['hIn','hOut']){ const h=p[hk]; if(!h) continue;
      ctx.strokeStyle='rgba(255,214,120,0.7)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(h.x,h.y); ctx.stroke();
      ctx.fillStyle='#ffd678'; ctx.beginPath(); ctx.arc(h.x,h.y,2.6,0,7); ctx.fill(); }
    ctx.fillStyle='#98f5d0'; ctx.beginPath(); ctx.arc(p.x,p.y,3,0,7); ctx.fill();
  }
  // 起点强调:光标靠近时提示可闭合
  ctx.strokeStyle='#98f5d0'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.arc(pts[0].x,pts[0].y, cur2&&Math.hypot(cur2.x-pts[0].x,cur2.y-pts[0].y)<9?6:4,0,7); ctx.stroke();
}

function finishPen(s){
  const pts=store.penPts; store.penPts=null; store.penCursor=null; store.dragAct=null;
  if(pts && pts.length>=2){
    pushUndo();
    const sh={id:store.shapeId++, type:'path', bezier:true, points:pts, bool:P.bool, solidFill:true, ...pathBBox(pts)};
    s.shapes.push(sh); store.sel=sh; store.selMulti=[sh]; updateSelBox(); shapesChanged(s);
    setHint(`✓ 贝塞尔轮廓完成(${pts.length} 锚点)· ➤ 拖锚点/黄色控制柄精修 · Alt 拖柄断开对称`);
  }
}
function cancelPen(){ store.penPts=null; store.penCursor=null;
  if(store.dragAct==='penpull') store.dragAct=null; setHint('已取消钢笔'); }

function shapeUnder(p,s){
  if(store.sel){
    if(handlePts(store.sel).some(([hx,hy])=>Math.abs(p.x-hx)<7&&Math.abs(p.y-hy)<7)) return store.sel;
    if(store.sel.type==='path' && store.sel.points.some(pt=>Math.hypot(p.x-pt.x,p.y-pt.y)<7)) return store.sel;
  }
  for(let i=s.shapes.length-1;i>=0;i--){ const sh=s.shapes[i];
    if(sh.hidden||sh.locked) continue;
    if(p.x>=sh.x&&p.x<=sh.x+sh.w&&p.y>=sh.y&&p.y<=sh.y+sh.h) return sh; }
  return null;
}

function onPointerDown(e){
  // 平移手势(中键 或 空格+左键)优先,且两种模式都可用
  if(e.button===1 || (store.spaceHeld && e.button===0)){
    store.panning=true; store._panStart={x:e.clientX,y:e.clientY,px:store.view.px,py:store.view.py};
    if(cv) cv.style.cursor='grabbing'; e.preventDefault(); return;
  }
  if(store.mode==='play') return;
  const p=ptr(e), s=cur();
  if(store.penPts && P.tool!=='pen') finishPen(s); // 切了别的工具还有半截钢笔 → 先收尾
  // Shift = 选择手势,任意工具通用:松手时移动 <4px 判点选切换,否则判框选加选。
  // 不再要求先切 ➤ 工具、也不再要求从空白处起手 —— 画布被大形状铺满时依然可框选。
  // 车面取景框(UV 读画区):点选 → 拖动=移动 / 拖角边=缩放 / Shift+角=等比;独立撤销/删除。
  // 放在 shift 手势之前 —— 选中取景框后 Shift+拖角要走等比缩放,而非形状框选。
  if($('showSkin')?.checked){
    const sel=getSelSkin();
    // 图案优先:光标下有图案(或已选图案的手柄/锚点)时,取景框的"边框移动/点选"一律让位 ——
    // UV 参考是最底层背景,盖住图案也不夺取选择;只有角/边手柄缩放(在框轮廓上,刻意抓取)才生效。
    const shapeHere = P.tool==='sel' && !!shapeUnder(p,s);
    const startWin=(win,mode)=>{ skinPushUndo(); store.dragAct='skinwin';
      store.dragNow={p:win, mode, offX:p.x-win.cx*W, offY:p.y-win.cy*H,
        sx:win.cx, sy:win.cy, sw:win.cw, sh:win.ch, aspect:win.cw/Math.max(1e-6,win.ch)}; };
    if(sel){ const m=skinHandleAt(sel,p.x,p.y);
      if(m==='move'){ if(!shapeHere){ startWin(sel,'move'); return; } }   // 边框移动让位图案
      else if(m){ startWin(sel,m); return; } }                            // 角/边手柄缩放照旧
    const hit=(!shapeHere)?skinWindowAt(p.x,p.y):null;
    if(hit){ selectSkin(hit); store.sel=null; store.selMulti=[]; updateSelBox();
      startWin(hit, skinHandleAt(hit,p.x,p.y)||'move');
      setHint('已选中取景框 — 拖边框=移动 · 拖角/边手柄=缩放 · Shift+角=等比 · Delete 删除 · Ctrl+Z 撤销 · Esc 取消 ·(框内可直接选/画图案)');
      return; }
    if(sel && !e.shiftKey){ clearSkinSel(); } // 点框内/图案上取消取景框选中(不拦截后续绘制/框选)
  }
  setSkinFocus(false); // 走到这说明本次按下不是取景框操作 → 离开取景框语境,Ctrl+Z 回到形状
  if(e.shiftKey){
    store.dragAct='shiftsel'; store.dragStart=p; store.dragNow=p;
    store._shiftBase=[...(store.selMulti||[])];
    return;
  }
  if(P.tool==='sel'){
    // 中线拖动 / CAD 边拾取:优先级低于已选形状的缩放手柄、路径锚点/贝塞尔控制柄 ——
    // 否则路径包围盒的边会盖住落在其上的锚点(如左上锚点),导致锚点拖不动。
    const onResizeHandle = store.sel && handlePts(store.sel).some(([hx,hy])=>Math.abs(p.x-hx)<7&&Math.abs(p.y-hy)<7);
    const onPathVertex = store.sel?.type==='path' && store.sel.points.some(pt=>{
      if(Math.hypot(p.x-pt.x,p.y-pt.y)<7) return true;
      return store.sel.bezier && ['hIn','hOut'].some(hk=>pt[hk]&&Math.hypot(p.x-pt[hk].x,p.y-pt[hk].y)<6);
    });
    const ep=(!store.sel || (!onResizeHandle && !onPathVertex)) ? pickEdgeAt(p,s) : null;
    if(ep?.g){ pushUndo(); store.dragAct='guidedrag'; store.dragNow={g:ep.g}; return; }
    if(ep?.sh){
      edgePick=ep; store.sel=ep.sh;
      if(!store.selMulti.includes(ep.sh)) store.selMulti=[ep.sh];
      updateSelBox();
      setHint('已拾取一条边 — Shift+点另一条边/中线 → 输入距离 → Enter 落成标注');
      return;
    }
  }
  if(P.tool==='sel'){
    // 锁定的选中形状不给任何手柄/拖动入口(面板选中锁定形状时,画布只读)
    if(store.sel&&!store.sel.locked&&store.sel.type==='path'){
      const pts=store.sel.points;
      // 贝塞尔控制柄优先(拖柄=调曲率;Alt=断开对称,单独调一侧)
      if(store.sel.bezier){
        for(let i=0;i<pts.length;i++) for(const hk of ['hOut','hIn']){
          const h=pts[i][hk];
          if(h&&Math.hypot(p.x-h.x,p.y-h.y)<6){
            pushUndo(); store.dragAct='handle'; store.dragStart=p;
            store.dragNow={i,hk,sym:!e.altKey}; return; }
        }
      }
      // 再判锚点(拖锚点=移动该点连同其两根柄)
      for(let i=0;i<pts.length;i++)
        if(Math.hypot(p.x-pts[i].x,p.y-pts[i].y)<7){
          pushUndo(); store.dragAct='pathpt'; store.dragStart=p;
          store.dragNow={i, orig:JSON.parse(JSON.stringify(pts[i]))}; return; }
    }
    if(store.sel&&!store.sel.locked){
      const hs=handlePts(store.sel);
      for(let i=0;i<4;i++)
        if(Math.abs(p.x-hs[i][0])<7&&Math.abs(p.y-hs[i][1])<7){
          pushUndo(); store.dragAct='resize'+i; store.dragStart=p;
          store.dragNow=store.sel.type==='path'
            ? {origX:store.sel.x,origY:store.sel.y,origW:store.sel.w,origH:store.sel.h,
               origPoints:store.sel.points.map(pt=>({...pt}))}
            : null;
          return; }
    }
    let hit=null;
    for(let i=s.shapes.length-1;i>=0;i--){ const sh=s.shapes[i];
      if(sh.hidden||sh.locked) continue; // 隐藏/锁定的形状画布上不参与命中
      if(p.x>=sh.x&&p.x<=sh.x+sh.w&&p.y>=sh.y&&p.y<=sh.y+sh.h){ hit=sh; break; } }
    store.sel=hit;
    if(!hit){ // 空处按下 = 框选(松手时圈中的进多选)
      store.selMulti=[]; updateSelBox();
      store.dragAct='marquee'; store.dragStart=p; store.dragNow=p; return;
    }
    if(!store.selMulti.includes(hit)) store.selMulti=[hit];
    updateSelBox();
    pushUndo(); store.dragAct='move'; store.dragStart=p;
    store.dragNow={ox:hit.x,oy:hit.y,
      origPoints:hit.type==='path'?hit.points.map(pt=>({...pt})):null,
      // 多选整体拖动:记全体初始包围盒,同位移一起走
      multi:store.selMulti.filter(sh=>sh!==hit&&!sh.locked).map(sh=>({sh,x:sh.x,y:sh.y,
        points:sh.type==='path'?sh.points.map(pt=>({...pt})):null}))};
  }
  else if(P.tool==='rect'||P.tool==='ell'){ store.dragAct='draw'; store.dragStart=p; store.dragNow=p; }
  else if(P.tool==='pen'){
    // AE 式贝塞尔钢笔:点=放尖角锚点,点后拖=拉出对称控制柄(光滑点);点回起点或 Enter/双击=闭合完成。
    const pen=store.penPts;
    if(pen && pen.length>=2 && Math.hypot(p.x-pen[0].x,p.y-pen[0].y)<9){ finishPen(s); return; }
    if(!store.penPts){ store.penPts=[]; setHint('钢笔:点=尖角 · 点后拖=曲线柄 · 点回起点/Enter/双击=闭合 · Esc 取消'); }
    const a={x:p.x,y:p.y}; store.penPts.push(a);
    store.dragAct='penpull'; store.dragStart=p; store.dragNow={anchor:a};
  }
  else if(P.tool==='text'){
    pushUndo();
    const txt=$('txtWord').value||'GO', h=P.font, w=measureText(txt,h);
    // 新文字默认"实心字形填充":停留期按矢量字形路径实心显示(边缘清晰锐利,如印刷字),
    // 过渡时整块溶解成点云飞向下一状态 —— 采样继承全局(面填充,溶解均匀)。
    // 想要纯点阵文字:取消勾选 🧱实心,并把采样改回"笔画·文字"。
    const sh={id:store.shapeId++, type:'text', text:txt, x:p.x-w/2, y:p.y-h/2, w, h, bool:P.bool, solidFill:true};
    s.shapes.push(sh); store.sel=sh; updateSelBox(); shapesChanged(s);
  }
  else if(P.tool==='dot'){
    pushUndo();
    const hit=s.manual.findIndex(m=>((m.x-p.x/W)**2+(m.y-p.y/H)**2)<(P.dotR/W*2.2)**2);
    if(hit>=0) s.manual.splice(hit,1); else s.manual.push({x:p.x/W,y:p.y/H});
    resample(s); updateThumb(s);
  }
}
function onPointerMove(e){
  if(store.panning&&store._panStart){ // 平移画布视图
    store.view.px=store._panStart.px+(e.clientX-store._panStart.x);
    store.view.py=store._panStart.py+(e.clientY-store._panStart.y);
    clampPan(); applyView(); return;
  }
  const p=ptr(e), s=cur();
  if(P.tool==='pen'&&store.penPts) store.penCursor=p; // 钢笔橡皮筋:随时记录光标
  if(!store.dragAct){
    // 悬停反馈:车面取景框(移动/缩放)、可拾取的边、可拖的中线
    if(store.mode!=='edit'){ cv.style.cursor=''; return; }
    let c='';
    if($('showSkin')?.checked) c=skinCursorAt(p.x,p.y);
    if(!c&&P.tool==='sel'){ const ep=pickEdgeAt(p,s);
      if(ep) c=ep.g?(ep.g.a==='v'?'ew-resize':'ns-resize'):'pointer'; }
    cv.style.cursor=c;
    return;
  }
  if(store.dragAct==='draw'){ store.dragNow=p; }
  else if(store.dragAct==='penpull'&&store.dragNow.anchor){
    // 点后拖:拉出对称控制柄(光滑锚点);拖动幅度太小则保持尖角
    const a=store.dragNow.anchor;
    if(Math.hypot(p.x-store.dragStart.x,p.y-store.dragStart.y)>3){
      a.hOut={x:p.x,y:p.y}; a.hIn={x:2*a.x-p.x, y:2*a.y-p.y};
    } else { delete a.hOut; delete a.hIn; }
  }
  else if(store.dragAct==='handle'&&store.sel){
    const {i,hk,sym}=store.dragNow, a=store.sel.points[i];
    a[hk]={x:p.x,y:p.y};
    if(sym){ const other=hk==='hOut'?'hIn':'hOut'; a[other]={x:2*a.x-p.x, y:2*a.y-p.y}; } // 对称联动
    Object.assign(store.sel, pathBBox(store.sel.points));
    shapesChanged(s,true);
  }
  else if(store.dragAct==='pathpt'&&store.sel){
    const {i,orig}=store.dragNow, a=store.sel.points[i];
    const dx=p.x-store.dragStart.x, dy=p.y-store.dragStart.y;
    a.x=orig.x+dx; a.y=orig.y+dy;                              // 锚点连同两根柄整体平移
    if(orig.hIn) a.hIn={x:orig.hIn.x+dx, y:orig.hIn.y+dy};
    if(orig.hOut) a.hOut={x:orig.hOut.x+dx, y:orig.hOut.y+dy};
    Object.assign(store.sel, pathBBox(store.sel.points));
    shapesChanged(s,true);
  }
  else if(store.dragAct==='marquee'||store.dragAct==='shiftsel'){ store.dragNow=p; }
  else if(store.dragAct==='skinwin'){
    const d=store.dragNow, w=d.p, MIN=0.03;
    if(d.mode==='move'){
      w.cx=Math.min(Math.max(0,(p.x-d.offX)/W),1-w.cw);
      w.cy=Math.min(Math.max(0,(p.y-d.offY)/H),1-w.ch);
    } else {
      // 四边固定,按手柄方向推动对应边;角手柄推两边。归一化坐标。
      const nx=p.x/W, ny=p.y/H, m=d.mode;
      let x0=d.sx, y0=d.sy, x1=d.sx+d.sw, y1=d.sy+d.sh;
      const corner=(m.length===2);
      if(e.shiftKey && corner){
        // 等比:锚定对角,按对角线较大需求缩放,锁定原始宽高比
        const ax=m.includes('w')?x1:x0, ay=m.includes('n')?y1:y0;
        let cw=Math.abs(nx-ax), ch=Math.abs(ny-ay);
        if(cw/Math.max(1e-6,ch) > d.aspect) ch=cw/d.aspect; else cw=ch*d.aspect;
        x0=m.includes('e')?ax:ax-cw; x1=m.includes('e')?ax+cw:ax;
        y0=m.includes('s')?ay:ay-ch; y1=m.includes('s')?ay+ch:ay;
      } else {
        if(m.includes('w')) x0=Math.min(nx, x1-MIN);
        if(m.includes('e')) x1=Math.max(nx, x0+MIN);
        if(m.includes('n')) y0=Math.min(ny, y1-MIN);
        if(m.includes('s')) y1=Math.max(ny, y0+MIN);
      }
      w.cx=Math.max(0,Math.min(x0,1-MIN)); w.cy=Math.max(0,Math.min(y0,1-MIN));
      w.cw=Math.max(MIN,Math.min(x1,1)-w.cx); w.ch=Math.max(MIN,Math.min(y1,1)-w.cy);
    }
  }
  else if(store.dragAct==='guidedrag'){
    const g=store.dragNow.g;
    g.p=Math.round(g.a==='v'?Math.min(W,Math.max(0,p.x)):Math.min(H,Math.max(0,p.y)));
    shapesChanged(s,true); // 对中/边距约束跟着中线实时重解
  }
  else if(store.dragAct==='move'&&store.sel){
    const dx=p.x-store.dragStart.x, dy=p.y-store.dragStart.y;
    const snapped=snapMove(store.sel, store.dragNow.ox+dx, store.dragNow.oy+dy);
    store.snapGuides=snapped.guides;
    const tx=snapped.x-store.dragNow.ox, ty=snapped.y-store.dragNow.oy;
    if(store.sel.type==='path'&&store.dragNow.origPoints){
      store.sel.points=store.dragNow.origPoints.map(pt=>translatePt(pt,tx,ty));
      Object.assign(store.sel, pathBBox(store.sel.points));
    } else {
      store.sel.x=store.dragNow.ox+tx; store.sel.y=store.dragNow.oy+ty;
    }
    for(const m of store.dragNow.multi||[]){ // 多选:其余成员同位移
      if(m.points){ m.sh.points=m.points.map(pt=>translatePt(pt,tx,ty));
        Object.assign(m.sh, pathBBox(m.sh.points)); }
      else { m.sh.x=m.x+tx; m.sh.y=m.y+ty; }
    }
    shapesChanged(s,true);
  }
  else if(store.dragAct&&store.dragAct.startsWith('resize')&&store.sel){
    const sel=store.sel, i=+store.dragAct[6];
    const fx=(i===0||i===2)? sel.x+sel.w : sel.x;
    const fy=(i===0||i===1)? sel.y+sel.h : sel.y;
    let nx=Math.min(p.x,fx), ny=Math.min(p.y,fy),
        nw=Math.max(8,Math.abs(p.x-fx)), nh=Math.max(8,Math.abs(p.y-fy));
    if(sel.type==='text'){ nh=Math.max(14,nh); nw=measureText(sel.text,nh);
      nx=(i===0||i===2)? fx-nw : fx; }
    else if(sel.type==='path'&&store.dragNow?.origPoints){
      const {origX,origY,origW,origH,origPoints}=store.dragNow;
      const sx=origW<1e-6?1:nw/origW, sy=origH<1e-6?1:nh/origH;
      sel.points=origPoints.map(pt=>scalePt(pt,origX,origY,sx,sy,nx,ny));
    }
    sel.x=nx; sel.y=ny; sel.w=nw; sel.h=nh;
    shapesChanged(s,true); updateSelBox();
  }
}
function onPointerUp(e){
  if(store.panning){ store.panning=false; store._panStart=null;
    if(cv) cv.style.cursor=store.spaceHeld?'grab':''; return; }
  if(!store.dragAct) return;
  const s=cur();
  if(store.dragAct==='skinwin'){ persistSkin();
    setHint('✓ 取景框已保存 — 回 3D 时该部件按新窗口读画(UV 层自动重映射)');
    store.dragAct=null; store.dragStart=null; store.dragNow=null; return; }
  if(store.dragAct==='guidedrag'){ shapesChanged(s); updateSelBox();
    store.dragAct=null; store.dragStart=null; store.dragNow=null; return; }
  if(store.dragAct==='draw'){
    const p=ptr(e);
    if(Math.abs(p.x-store.dragStart.x)>3||Math.abs(p.y-store.dragStart.y)>3){
      pushUndo();
      // 新矩形/椭圆默认实心矢量填充(不是点阵);想要点阵取消 🧱实心
      const sh={id:store.shapeId++, type:P.tool==='rect'?'rect':'ellipse',
        x:Math.min(store.dragStart.x,p.x), y:Math.min(store.dragStart.y,p.y),
        w:Math.abs(p.x-store.dragStart.x), h:Math.abs(p.y-store.dragStart.y), bool:P.bool, solidFill:true};
      s.shapes.push(sh); store.sel=sh; updateSelBox(); shapesChanged(s);
    }
  } else if(store.dragAct==='marquee'||store.dragAct==='shiftsel'){
    const p=ptr(e), x0=Math.min(store.dragStart.x,p.x), x1=Math.max(store.dragStart.x,p.x);
    const y0=Math.min(store.dragStart.y,p.y), y1=Math.max(store.dragStart.y,p.y);
    const moved=(x1-x0>4||y1-y0>4);
    if(moved){
      const inBox=s.shapes.filter(sh=>!sh.hidden&&!sh.locked&&
        sh.x<x1&&sh.x+sh.w>x0&&sh.y<y1&&sh.y+sh.h>y0);
      // Shift 框选 = 在原有选择上加选;普通框选 = 重选
      const base=store.dragAct==='shiftsel'?(store._shiftBase||[]):[];
      store.selMulti=[...base, ...inBox.filter(sh=>!base.includes(sh))];
      store.sel=store.selMulti[store.selMulti.length-1]||null;
      if(store.selMulti.length>1) setHint(`已选 ${store.selMulti.length} 个形状 — 右栏「排列」可对齐/等距/阵列`);
    } else if(store.dragAct==='shiftsel'){
      // 有第一条边在手:Shift+点优先判"第二条边"(边带很窄,不与常规选择冲突)
      if(edgePick){
        const ep2=pickEdgeAt(p,s);
        if(ep2 && !(ep2.sh&&ep2.sh===edgePick.sh) && !(ep2.g&&ep2.g===edgePick.g)){
          openDimInput(edgePick, ep2);
          store.dragAct=null; store.dragStart=null; store.dragNow=null; return;
        }
      }
      // Shift+点选:命中即切换进出多选集合
      let hit=null;
      for(let i=s.shapes.length-1;i>=0;i--){ const sh=s.shapes[i];
        if(sh.hidden||sh.locked) continue;
        if(p.x>=sh.x&&p.x<=sh.x+sh.w&&p.y>=sh.y&&p.y<=sh.y+sh.h){ hit=sh; break; } }
      if(hit){
        const i=store.selMulti.indexOf(hit);
        if(i>=0){ store.selMulti.splice(i,1);
          if(store.sel===hit) store.sel=store.selMulti[store.selMulti.length-1]||null; }
        else { store.selMulti.push(hit); store.sel=hit; }
        if(store.selMulti.length>1) setHint(`已选 ${store.selMulti.length} 个形状(Shift+点选可继续增减)`);
      }
    }
    updateSelBox();
  } else if(store.dragAct==='penpull'){
    // 锚点已提交进 store.penPts,松手保持钢笔进行中(等待下一个点或闭合)
  } else { shapesChanged(s); }
  store.dragAct=null; store.dragStart=null; store.dragNow=null; store.snapGuides=null;
}

let shapeClipboard=null; // Ctrl+C 的形状快照(JSON 深拷贝,可跨状态/图层粘贴)
function onKeyDown(e){
  if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT') return;
  const k=e.key.toLowerCase();
  // 取景框语境:选中框时 Delete 删它;焦点在取景框(含刚删除后)时 Ctrl+Z 撤销取景框操作
  const skinOn=$('showSkin')?.checked;
  if(skinOn && getSelSkin() && (e.key==='Delete'||e.key==='Backspace')){
    if(deleteSelSkin()) setHint('🗑 取景框已从 2D 叠加移除(要恢复回 3D 再 🗺同步) · Ctrl+Z 撤销'); e.preventDefault(); return; }
  if(skinOn && skinFocus() && skinHasUndo() && (e.ctrlKey||e.metaKey)&&k==='z'){
    if(skinUndo()) setHint('↩ 取景框已撤销'); e.preventDefault(); return; }
  if((e.ctrlKey||e.metaKey)&&k==='z'){ e.shiftKey?redo():undo(); e.preventDefault(); return; }
  if((e.ctrlKey||e.metaKey)&&k==='y'){ redo(); e.preventDefault(); return; }
  if((e.ctrlKey||e.metaKey)&&k==='c' && store.mode==='edit'){
    const list=store.selMulti?.length?store.selMulti:(store.sel?[store.sel]:[]);
    if(list.length){ shapeClipboard=JSON.parse(JSON.stringify(list));
      setHint(`已复制 ${list.length} 个形状 — 切到任意状态 Ctrl+V 粘贴`); e.preventDefault(); }
    return;
  }
  if((e.ctrlKey||e.metaKey)&&k==='v' && store.mode==='edit' && shapeClipboard?.length){
    pushUndo();
    const s=cur(), made=[];
    for(const src of shapeClipboard){
      const c=JSON.parse(JSON.stringify(src));
      c.id=store.shapeId++; delete c.rel; // 约束引用不跨状态,粘贴即自由形状
      if(c.type==='path') c.points=c.points.map(pt=>({x:pt.x+8,y:pt.y+8}));
      c.x+=8; c.y+=8;                     // 轻微错位,肉眼可辨"粘出来了"
      s.shapes.push(c); made.push(c);
    }
    store.selMulti=made; store.sel=made[made.length-1];
    // 图片形状:_img 运行时缓存不随 JSON 走,补解码(dataURL 缓存命中近乎瞬时)
    const pend=made.filter(sh=>sh.type==='image'&&!sh._img).map(sh=>decodeImageShape(sh));
    if(pend.length) Promise.all(pend).then(()=>shapesChanged(s));
    shapesChanged(s); updateSelBox();
    setHint(`已粘贴 ${made.length} 个形状(含实心/采样等属性)`);
    e.preventDefault(); return;
  }
  // 钢笔进行中:Enter 闭合完成,Esc 取消(优先于普通工具切换/取消)
  if(store.penPts){
    if(e.key==='Enter'){ finishPen(cur()); e.preventDefault(); return; }
    if(e.key==='Escape'){ cancelPen(); e.preventDefault(); return; }
  }
  if(store.penPts && 'vretdp'.includes(k)) finishPen(cur()); // 切工具键先收尾钢笔
  if(k==='v')setTool('sel'); else if(k==='r')setTool('rect');
  else if(k==='e')setTool('ell'); else if(k==='t')setTool('text');
  else if(k==='d')setTool('dot'); else if(k==='p')setTool('pen');
  else if(e.key==='Delete'||e.key==='Backspace'){ deleteSel(); e.preventDefault(); }
  else if(e.key==='Escape'){ store.sel=null; store.selMulti=[]; edgePick=null; clearSkinSel(); closeDimInput(); updateSelBox(); }
  else if(e.key.startsWith('Arrow') && store.sel && !store.sel.locked && store.mode==='edit'){
    const step=e.shiftKey?10:1;
    const dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0;
    const dy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;
    // 连续按键只在间隔 >800ms 时压一次撤销栈,避免长按把 60 步历史冲光
    const now=performance.now();
    if(!store._lastNudge || now-store._lastNudge>800) pushUndo();
    store._lastNudge=now;
    const list=store.selMulti?.length?store.selMulti.filter(sh=>!sh.locked):[store.sel];
    for(const sh of list) applyShapeBBox(sh, sh.x+dx, sh.y+dy, sh.w, sh.h);
    shapesChanged(cur()); updateSelBox();
    e.preventDefault();
  }
}

// 双击:钢笔进行中=闭合完成;否则编辑选中路径的锚点 ——
// 双击锚点=删(至少留 2/贝塞尔 2、平滑 3);双击贝塞尔尖角锚点=切换尖角⇄光滑;双击轮廓线段=插入锚点。
function onDblClick(e){
  if(store.mode==='play') return;
  if(store.penPts){ finishPen(cur()); return; }
  if(P.tool!=='sel'||!store.sel||store.sel.type!=='path'||store.sel.locked) return;
  const p=ptr(e), sel=store.sel, s=cur(), min=sel.bezier?2:3;
  for(let i=0;i<sel.points.length;i++){
    const a=sel.points[i];
    if(Math.hypot(p.x-a.x,p.y-a.y)<7){
      if(sel.bezier && (a.hIn||a.hOut)){ // 光滑锚点 → 双击转尖角
        pushUndo(); delete a.hIn; delete a.hOut; shapesChanged(s); setHint('锚点已转为尖角'); return; }
      if(sel.bezier){ // 尖角锚点 → 双击生成对称柄(转光滑)
        const prev=sel.points[(i-1+sel.points.length)%sel.points.length], nx=sel.points[(i+1)%sel.points.length];
        const tx=(nx.x-prev.x)*0.18, ty=(nx.y-prev.y)*0.18;
        pushUndo(); a.hOut={x:a.x+tx,y:a.y+ty}; a.hIn={x:a.x-tx,y:a.y-ty};
        shapesChanged(s); setHint('锚点已转为光滑(拖黄色控制柄调曲率)'); return;
      }
      if(sel.points.length<=min){ setHint(`轮廓至少保留 ${min} 个锚点`); return; }
      pushUndo(); sel.points.splice(i,1); Object.assign(sel, pathBBox(sel.points));
      updateSelBox(); shapesChanged(s); return;
    }
  }
  const {index,dist}=nearestPathSegment(sel.points,p);
  if(dist<10){
    pushUndo(); sel.points.splice(index+1,0,{x:p.x,y:p.y}); Object.assign(sel, pathBBox(sel.points));
    updateSelBox(); shapesChanged(s);
  }
}

// ── 画布缩放/平移(矢量数据 → 放大只是看得更细,不改数据;CSS 变换,ptr() 经 rect 自适应)──
function applyView(){
  const v=store.view, wrap=$('cwrap');
  if(wrap) wrap.style.transform=`translate(${v.px}px,${v.py}px) scale(${v.z})`;
  const zv=$('zoomVal'); if(zv) zv.textContent=Math.round(v.z*100)+'%';
}
function clampPan(){
  const v=store.view, st=$('cwrap')?.parentElement; if(!st) return;
  const w=st.clientWidth, h=st.clientHeight;
  v.px=Math.min(0, Math.max(w-w*v.z, v.px));   // 保证画布始终盖满舞台,不露黑边
  v.py=Math.min(0, Math.max(h-h*v.z, v.py));
  if(v.z<=1){ v.px=0; v.py=0; }
}
function zoomAt(clientX, clientY, factor){
  const st=$('cwrap')?.parentElement; if(!st) return;
  const r=st.getBoundingClientRect(), cx=clientX-r.left, cy=clientY-r.top, v=store.view;
  const nz=Math.max(1, Math.min(8, v.z*factor));
  const lx=(cx-v.px)/v.z, ly=(cy-v.py)/v.z;  // 光标下的画布局部点(缩放前)
  v.z=nz; v.px=cx-lx*nz; v.py=cy-ly*nz;       // 保持该点在光标下不动
  clampPan(); applyView();
}
function resetView(){ store.view={z:1,px:0,py:0}; applyView(); }

export function initStage(){
  cv=$('cv'); ctx=cv.getContext('2d');
  previewRender=createSizedRenderer(ctx, BW, BH); // 2× 缓冲,基础更清晰
  glCv=$('cvgl');
  if(glCv){ glRender=createGLRenderer(glCv);
    if(!glRender){ const ck=$('useGpu'); if(ck){ ck.checked=false; ck.disabled=true; ck.parentElement.title='此浏览器不支持 WebGL2,已回退 CPU 渲染'; } } }
  cv.addEventListener('pointerdown',onPointerDown);
  cv.addEventListener('pointermove',onPointerMove);
  cv.addEventListener('dblclick',onDblClick);
  window.addEventListener('pointerup',onPointerUp);
  window.addEventListener('keydown',onKeyDown);
  // 缩放/平移:滚轮(以光标为中心)、中键/空格拖平移、按钮
  const st=$('cwrap')?.parentElement;
  if(st) st.addEventListener('wheel',e=>{ e.preventDefault();
    zoomAt(e.clientX,e.clientY, e.deltaY<0?1.15:1/1.15); }, {passive:false});
  $('zoomIn').onclick=()=>{ const r=st.getBoundingClientRect(); zoomAt(r.left+r.width/2,r.top+r.height/2,1.25); };
  $('zoomOut').onclick=()=>{ const r=st.getBoundingClientRect(); zoomAt(r.left+r.width/2,r.top+r.height/2,1/1.25); };
  $('zoomReset').onclick=resetView;
  window.addEventListener('keydown',e=>{ if(e.code==='Space'&&e.target.tagName!=='INPUT'){ store.spaceHeld=true; if(cv) cv.style.cursor='grab'; e.preventDefault(); } });
  window.addEventListener('keyup',e=>{ if(e.code==='Space'){ store.spaceHeld=false; if(cv) cv.style.cursor=''; } });
  applyView();
  // 播放控制条(时间轴的擦洗/改时长手势在 timeline.js)
  $('mPlay').onclick=()=>setMode(store.mode==='play'?'edit':'play');
  $('playBtn').onclick=()=>{ if(store.mode!=='play'){setMode('play');return;}
    store.playing=!store.playing; if(store.playing&&store.g>=store.SEQ.T){store.g=0;}
    $('playBtn').textContent=store.playing?'⏸ 暂停':'▶ 播放'; };
}
