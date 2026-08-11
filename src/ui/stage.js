// 中央舞台:画布交互(画/选/移/缩/单点)、叠加层(洋葱皮/轨迹/画幅线/选框)、
// 播放模式与 requestAnimationFrame 主循环。预览渲染走 render.js 的 createPreviewRenderer。
import { W, H, P } from '../config.js';
import { store, cur } from '../store.js';
import { $, hex2rgb, setHint, getExpSize } from '../utils.js';
import { createSizedRenderer } from '../render.js';
import { createGLRenderer } from '../render-gl.js';
import { sampleFrame, drift, camPt, camIdentity, vectorSolids } from '../engine.js';
import { rebuildSequence } from '../sequence.js';
import { resampleAll, resample, updateThumb, shapesChanged, measureText } from '../pipeline.js';
import { pushUndo, undo, redo } from '../state.js';
import { decodeImageShape } from '../image.js';
import { updateSelBox, deleteSel } from './inspector.js';
import { renderStrip } from './filmstrip.js';
import { setTool } from './toolbar.js';
import { pathBBox, traceShapePath } from '../path.js';
import { applyShapeBBox, shapeToPath } from '../shapes.js';
import { drawSkinRef, skinWindowAt, skinHandleAt, skinCursorAt, getSelSkin, selectSkin,
  clearSkinSel, skinPushUndo, skinUndo, deleteSelSkin, persistSkin, skinFocus, setSkinFocus,
  skinHasUndo, fitSelSkin, clearSelSkinCrop } from './skinRef.js';
import { tlTick } from './timeline.js';
import { computeVectorPolys, rasterizeVectorSolids } from '../vector.js';
import { charactersSolids } from '../characters.js';
import { p2On } from '../ledcanvas.js';
import { LED_W, LED_H } from '../ledmap.js';
import { rigMatrices, rigApply, poseShapes, rigIdent } from '../rig.js';

// 🦴 选中 rig 形状时:算它摆好姿势后的世界点 + 当前关节世界位置(供叠加层显示与摆动交互)。
function riggedSel(){
  const sel=store.sel; if(!sel?.rig) return null;
  const mats=rigMatrices(cur().shapes);
  const pW = (sel.rig.parent!=null && mats.has(sel.rig.parent)) ? mats.get(sel.rig.parent) : rigIdent();
  const joint=rigApply(pW, sel.rig.pivot.x, sel.rig.pivot.y);
  const M=mats.get(sel.layerId)||rigIdent();
  const pts=(sel.points||[]).map(p=>rigApply(M,p.x,p.y));
  return {joint, pts, M};
}
const rigRotHandle=rs=>[rs.joint.x, rs.joint.y - 40/Math.max(1,store.view.z||1)];
function invAffine(M){ const [a,b,c,d,e,f]=M, det=a*d-b*c; if(Math.abs(det)<1e-9) return rigIdent();
  const ia=d/det, ib=-b/det, ic=-c/det, id=a/det;
  return [ia,ib,ic,id, -(ia*e+ic*f), -(ib*e+id*f)]; }

// ── 多选组变换:整组一个大选框,可整体移动/缩放/旋转(含 rig 的点与关节点一起变,保持相对关系)──
// 组包围盒:用【摆好姿势后】的世界点算,和画面所见一致。
function groupBBox(){
  const mem=(store.selMulti||[]).filter(Boolean); if(mem.length<2) return null;
  const posed = mem.some(sh=>sh.rig) ? new Map(poseShapes(cur().shapes).map(sh=>[sh.id,sh])) : null;
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  for(const sh of mem){ const ps=(sh.rig&&posed?.get(sh.id)?.points)||sh.points;
    if(ps&&ps.length){ for(const p of ps){ if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; } }
    else { minX=Math.min(minX,sh.x); maxX=Math.max(maxX,sh.x+sh.w); minY=Math.min(minY,sh.y); maxY=Math.max(maxY,sh.y+sh.h); } }
  return minX>maxX ? null : {x:minX,y:minY,w:Math.max(1,maxX-minX),h:Math.max(1,maxY-minY)};
}
// 记录组内每个成员的原始几何(拖动前),供整组仿射变换。
const groupRecordOrig=()=>(store.selMulti||[]).filter(Boolean).map(sh=>({sh,
  points: sh.points?sh.points.map(pt=>JSON.parse(JSON.stringify(pt))):null,
  pivot: sh.rig?{...sh.rig.pivot}:null, x:sh.x, y:sh.y, w:sh.w, h:sh.h}));
// 对每个成员施加仿射 fn(x,y)→{x,y}:path/rig 变点(含柄)与关节点;rect/ellipse/text 变包围盒。
function groupApply(orig, fn){
  for(const o of orig){ const sh=o.sh;
    if(o.points){ sh.points=o.points.map(pt=>{ const q=fn(pt.x,pt.y), r={x:q.x,y:q.y};
        if(pt.hIn){ const h=fn(pt.hIn.x,pt.hIn.y); r.hIn={x:h.x,y:h.y}; }
        if(pt.hOut){ const h=fn(pt.hOut.x,pt.hOut.y); r.hOut={x:h.x,y:h.y}; } return r; });
      if(o.pivot && sh.rig){ const q=fn(o.pivot.x,o.pivot.y); sh.rig.pivot={x:q.x,y:q.y}; }
      Object.assign(sh, pathBBox(sh.points));
    } else { const c=[fn(o.x,o.y),fn(o.x+o.w,o.y),fn(o.x+o.w,o.y+o.h),fn(o.x,o.y+o.h)];
      const xs=c.map(p=>p.x), ys=c.map(p=>p.y);
      applyShapeBBox(sh, Math.min(...xs),Math.min(...ys), Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys)); }
  }
}

let cv, ctx, previewRender, glRender=null, glCv=null;
// #cv 缓冲用 2× 逻辑分辨率(960×560)。注意:实心场是 CPU 逐像素,分辨率再高会拖垮帧率
// (4× 实测 ~196ms/帧);"放大也清晰"的正解是视口渲染(只渲可见区),而非无脑加大缓冲。
const VS=2, BW=W*VS, BH=H*VS;
// 双画布:#cvgl(WebGL 高分辨率场渲染,垫底)+ #cv(2D,GPU 模式下只画叠加层)。
// gpuOn 时 2D 画布每帧 clearRect 保持透明,场画面从下层透出;CPU 回退时行为与旧版一致。
const gpuOn=()=> glRender && $('useGpu')?.checked && !store.forceCpu; // 录制 WebM 时强制 CPU(captureStream 抓 2D 画布)

// 8 个缩放手柄(罗盘式):4 角(如 nw)双向缩放,4 边中点(如 n)单向缩放。Shift=等比。
// includes('w'/'e'/'n'/'s') 判某条边是否随手柄移动(与车面取景框同一套逻辑)。
const HMODES=['nw','ne','sw','se','n','e','s','w']; // 角在前 → 命中优先于边
const handlePt=(s,m)=>[
  m.includes('w')?s.x : m.includes('e')?s.x+s.w : s.x+s.w/2,
  m.includes('n')?s.y : m.includes('s')?s.y+s.h : s.y+s.h/2 ];
const handleList=s=>HMODES.map(m=>[...handlePt(s,m), m]); // [x,y,mode]
const handlePts=s=>handleList(s);                          // 命中/绘制:解构 [x,y] 即可(忽略 mode)
// 路径锚点变换(保留贝塞尔控制柄):平移 / 按框缩放。移动/缩放路径时不能丢柄。
const translatePt=(pt,tx,ty)=>{ const o={x:pt.x+tx,y:pt.y+ty};
  if(pt.hIn) o.hIn={x:pt.hIn.x+tx,y:pt.hIn.y+ty};
  if(pt.hOut) o.hOut={x:pt.hOut.x+tx,y:pt.hOut.y+ty}; return o; };
const scalePt=(pt,ox,oy,sx,sy,nx,ny)=>{ const S=(q)=>({x:nx+(q.x-ox)*sx, y:ny+(q.y-oy)*sy});
  const o=S(pt); if(pt.hIn)o.hIn=S(pt.hIn); if(pt.hOut)o.hOut=S(pt.hOut); return o; };
// 绕 (cx,cy) 旋转锚点(连同两根控制柄)—— 旋转手柄用。
const rotatePt=(pt,cx,cy,cos,sin)=>{ const R=q=>({x:cx+(q.x-cx)*cos-(q.y-cy)*sin, y:cy+(q.x-cx)*sin+(q.y-cy)*cos});
  const o=R(pt); if(pt.hIn)o.hIn=R(pt.hIn); if(pt.hOut)o.hOut=R(pt.hOut); return o; };
// 屏幕恒定尺度因子(缩放时手柄/控制点不随视口放大);旋转手柄在框顶中点上方的偏移(屏幕恒定)。
const izOf=()=>1/Math.max(1, store.view.z||1);
const ROT_GAP=24;
const rotHandlePt=(s,iz)=>[s.x+s.w/2, s.y - ROT_GAP*iz];
// 选区里是否有可旋转的矢量路径(旋转按 points 变换)。
const selPaths=()=>{ const set=new Set(store.selMulti||[]); if(store.sel) set.add(store.sel);
  return [...set].filter(sh=>sh&&sh.type==='path'&&!sh.locked); };
// 可旋转对象(圆/方也能转:旋转时先转成 path)。text/image 与已绑骨骼的不在此(骨骼走关节旋转)。
const rotatableSel=()=>{ const set=new Set(store.selMulti||[]); if(store.sel) set.add(store.sel);
  return [...set].filter(sh=>sh&&!sh.locked&&!sh.rig&&(sh.type==='path'||sh.type==='rect'||sh.type==='ellipse')); };
// 把形状就地替换(rect/ellipse→path),同步更新 shapes 数组与选择引用。
function replaceShape(oldSh, newSh){ const s=cur(), i=s.shapes.indexOf(oldSh);
  if(i>=0) s.shapes[i]=newSh;
  if(store.sel===oldSh) store.sel=newSh;
  const mi=(store.selMulti||[]).indexOf(oldSh); if(mi>=0) store.selMulti[mi]=newSh;
  return newSh; }
function convertShapeToPath(sh){ if(!sh||sh.type==='path') return sh; const np=shapeToPath(sh); return np?replaceShape(sh,np):sh; }
// 点 p 是否落在选中路径自身的锚点/控制柄上(Shift 拖它 = 编辑/对齐,而非进多选框选)。
function onOwnPathPoint(p){
  const sel=store.sel; if(sel?.type!=='path'||sel.locked) return false;
  const zt=Math.min(1, store.view.z||1), AH=(11/zt)**2, HH=(8/zt)**2;
  for(const pt of sel.points){
    if((p.x-pt.x)**2+(p.y-pt.y)**2<AH) return true;
    if(sel.bezier) for(const hk of ['hIn','hOut']){ const h=pt[hk];
      if(h&&(p.x-h.x)**2+(p.y-h.y)**2<HH) return true; }
  }
  return false;
}

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
// 🔩 LED 取景窗:创作画布是正方形,LED 是 2:5 长条。导出(P2)只取【画布正中这一条】,
// 且是先按方形渲染再纯裁切 → 零变形。窗外的东西不会上屏,所以画的时候要盯着这条框。
function overlayLedWindow(){
  if(store.hideOverlays || !p2On()) return;
  const r=LED_W/LED_H, w=W*r, x=(W-w)/2;      // 与导出的裁切口径完全一致(居中、满高)
  ctx.save();
  ctx.fillStyle='rgba(0,0,0,0.42)';           // 窗外压暗 = 不会上屏的区域
  ctx.fillRect(0,0,x,H); ctx.fillRect(x+w,0,W-x-w,H);
  ctx.strokeStyle='rgba(44,196,245,0.95)'; ctx.lineWidth=1.5;
  ctx.setLineDash([7,5]); ctx.strokeRect(x,0,w,H); ctx.setLineDash([]);
  // 模组分界:5 段(2/3 是并排的旋转板,占中间那 1/2 高度)
  ctx.strokeStyle='rgba(44,196,245,0.35)'; ctx.lineWidth=1;
  for(const f of [64/320, 192/320, 256/320]){ const y=H*f;
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+w,y); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(x+w/2, H*(64/320)); ctx.lineTo(x+w/2, H*(192/320)); ctx.stroke(); // 2|3 并排缝
  ctx.fillStyle='rgba(44,196,245,0.9)'; ctx.font='10px system-ui';
  ctx.fillText('LED 取景窗 128×320', x+4, 12);
  ctx.restore();
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
// 🎯 波浪锚点标记:锚点十字 + 波及半径虚线圈(编辑态可见,便于定位)。
function overlayWaveAnchor(){
  if(store.hideOverlays||store.mode==='play') return;
  const fx=cur().fx; if(!fx||!fx.anchor) return;
  const x=fx.anchor.x*W, y=fx.anchor.y*H, iz=1/Math.max(1,store.view.z), r=7*iz;
  ctx.save();
  ctx.strokeStyle='rgba(80,220,255,0.9)'; ctx.lineWidth=1.5*iz;
  ctx.setLineDash([5*iz,4*iz]); ctx.beginPath(); ctx.arc(x,y,(fx.anchorReach||0.5)*W,0,6.2832); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='rgba(80,220,255,0.3)'; ctx.beginPath(); ctx.arc(x,y,r,0,6.2832); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x-r*1.7,y); ctx.lineTo(x+r*1.7,y); ctx.moveTo(x,y-r*1.7); ctx.lineTo(x,y+r*1.7); ctx.stroke();
  ctx.restore();
}
function overlaySelection(){
  if(store.mode==='play') return;
  // 多选:整组一个大选框 + 8 缩放手柄 + 旋转手柄(整体缩放/旋转/移动),薄框标示各成员。
  if(store.selMulti && store.selMulti.length>1){
    const gb=groupBBox();
    if(gb){ const iz=1/Math.max(1,store.view.z);
      ctx.strokeStyle='rgba(120,180,255,0.35)'; ctx.lineWidth=0.7*iz; ctx.setLineDash([]);
      for(const sh of store.selMulti) if(sh) ctx.strokeRect(sh.x,sh.y,sh.w,sh.h);   // 各成员薄框
      ctx.strokeStyle='rgba(120,180,255,0.9)'; ctx.lineWidth=1*iz; ctx.strokeRect(gb.x,gb.y,gb.w,gb.h);
      ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=0.6*iz;               // 8 手柄
      for(const [hx,hy,m] of handleList(gb)){ const sz=(m.length===2?4.5:3.5)*iz;
        ctx.fillStyle='#7ab4ff'; ctx.fillRect(hx-sz/2,hy-sz/2,sz,sz); ctx.strokeRect(hx-sz/2,hy-sz/2,sz,sz); }
      const [rx,ry]=rotHandlePt(gb, iz);                                            // 旋转手柄
      ctx.strokeStyle='rgba(120,180,255,0.7)'; ctx.lineWidth=0.8*iz;
      ctx.beginPath(); ctx.moveTo(gb.x+gb.w/2, gb.y); ctx.lineTo(rx,ry); ctx.stroke();
      ctx.fillStyle='#7ab4ff'; ctx.beginPath(); ctx.arc(rx,ry,4*iz,0,7); ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.stroke();
    }
    return; // 多选时只画组框,不画单个成员的锚点/手柄
  }
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
  // 控制点(锚点/贝塞尔柄/缩放方块)按逻辑坐标画,会随视口缩放一起放大 —— 高倍率下巨大挡视线。
  // iz=1/z(仅在放大时缩小)让它们保持恒定的屏幕尺寸:100% 时如常,放大做微调时不再遮挡曲线。
  const iz=1/Math.max(1,store.view.z);
  // 🦴 rig 形状:画【摆好姿势】的轮廓 + 关节🟡 + 旋转手柄(不画常规锚点/缩放框,靠关节摆动)
  if(sel.rig){ const rs=riggedSel();
    if(rs){
      ctx.strokeStyle='rgba(120,180,255,0.9)'; ctx.lineWidth=iz;
      ctx.beginPath(); rs.pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath(); ctx.stroke();
      const [rx,ry]=rigRotHandle(rs);
      ctx.strokeStyle='rgba(120,180,255,0.7)'; ctx.lineWidth=0.8*iz;
      ctx.beginPath(); ctx.moveTo(rs.joint.x,rs.joint.y); ctx.lineTo(rx,ry); ctx.stroke();
      ctx.fillStyle='#7ab4ff'; ctx.beginPath(); ctx.arc(rx,ry,4*iz,0,7); ctx.fill();
      ctx.fillStyle='#ffd678'; ctx.strokeStyle='#161616'; ctx.lineWidth=1.4*iz;      // 关节点
      ctx.beginPath(); ctx.arc(rs.joint.x,rs.joint.y,6*iz,0,7); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#161616'; ctx.beginPath(); ctx.arc(rs.joint.x,rs.joint.y,2*iz,0,7); ctx.fill();
      return;
    }
  }
  if(sel.type==='path'){
    // 描边显示实际会被填充的曲线,再逐锚点画手柄(区别于下方整体缩放的方块手柄)
    if(traceShapePath(ctx, sel)){
      ctx.strokeStyle='rgba(120,180,255,0.85)'; ctx.lineWidth=iz; ctx.stroke();
    }
    const sp=store.selPoints||[];
    sel.points.forEach((p,pi)=>{
      // 黄色贝塞尔柄默认【隐藏】(减少遮挡);仅在 ①右键开了"显示所有控制柄" 或 ②只选中这一个锚点时显示。
      const showThis = sel.bezier && (store.showHandles || (sp.length===1 && sp[0]===pi));
      if(showThis) for(const hk of ['hIn','hOut']){ const h=p[hk]; if(!h) continue;
        ctx.strokeStyle='rgba(255,214,120,0.7)'; ctx.lineWidth=iz;
        ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(h.x,h.y); ctx.stroke();
        ctx.fillStyle='#ffd678'; ctx.beginPath(); ctx.arc(h.x,h.y,2.8*iz,0,7); ctx.fill(); }
      const selP = sp.includes(pi); // 选中的控制点:白心高亮(可多选一组,一起拖=rig 整只手)
      ctx.fillStyle = selP?'#ffffff':'#7ab4ff';
      ctx.beginPath(); ctx.arc(p.x,p.y,(selP?4.6:3.2)*iz,0,7); ctx.fill();
      if(selP){ ctx.strokeStyle='#7ab4ff'; ctx.lineWidth=1.6*iz; ctx.stroke(); }
    });
  }
  // 选框:细一点、淡一点,不挡视野
  ctx.strokeStyle='rgba(120,180,255,0.55)'; ctx.lineWidth=0.8*iz;
  ctx.strokeRect(sel.x,sel.y,sel.w,sel.h);
  // 8 个缩放手柄:角略大(双向),边中点略小(单向)。白描边小方块。
  ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=0.6*iz;
  for(const [hx,hy,m] of handleList(sel)){ const sz=(m.length===2?4:3.2)*iz;
    ctx.fillStyle='#7ab4ff'; ctx.fillRect(hx-sz/2,hy-sz/2,sz,sz); ctx.strokeRect(hx-sz/2,hy-sz/2,sz,sz); }
  // 🔄 旋转手柄(路径 + 圆/方):框顶中点上方的圆 + 短杆
  if(rotatableSel().length){ const [rx,ry]=rotHandlePt(sel, iz);
    ctx.strokeStyle='rgba(120,180,255,0.7)'; ctx.lineWidth=0.8*iz;
    ctx.beginPath(); ctx.moveTo(sel.x+sel.w/2, sel.y); ctx.lineTo(rx,ry); ctx.stroke();
    ctx.fillStyle='#7ab4ff'; ctx.beginPath(); ctx.arc(rx,ry,3.6*iz,0,7); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.stroke();
    if(store.dragAct==='rotate'&&store._rotHud!=null){ // 旋转角度 HUD(便于对齐 90/180)
      ctx.fillStyle='rgba(20,20,20,0.8)'; ctx.fillRect(rx+6*iz, ry-8*iz, 34*iz, 14*iz);
      ctx.fillStyle='#98f5d0'; ctx.font=`${10*iz}px system-ui`; ctx.textAlign='left';
      ctx.fillText(store._rotHud+'°', rx+9*iz, ry+2*iz); ctx.textAlign='left'; }
  }
}

// ══════════════ 主循环 ══════════════
function tick(now){
  const dt=(now-store.last)/1000; store.last=now; store.clock+=dt;
  // 叠加层按逻辑坐标绘制,经视口变换到缓冲;previewRender 的 putImageData 忽略变换、直接铺满缓冲。
  setOverlayTransform();
  const zoomed=store.view.z>1.001; // 缩放时强制 CPU 视口渲染(GL 路径未接视口)→ 放大依旧清晰
  if(store.mode==='play'){
    if(store.seqDirty) rebuildSequence();
    if(store.playing){ store.g+=dt;
      if(store.g>=store.SEQ.T){ if($('loop').checked) store.g-=store.SEQ.T;
        else{ store.g=store.SEQ.T; store.playing=false; $('playBtn').textContent='▶ 播放'; } } }
    $('tVal').textContent=store.g.toFixed(1)+'s';
    const fr=sampleFrame(store.SEQ, store.states, store.g, store.clock, P);
    // 矢量图层(AE 关联图层):独立于点阵,轮廓直接插值 → SDF solid,并入实心渲染
    // vectorSolids:矢量变形轮廓 + 挂上形变修饰器的 warp → 过渡期尖刺/锯齿等不再丢失
    const solids=(fr.solids||[]).concat(
        vectorSolids(computeVectorPolys(store.states, store.SEQ, store.g, store.clock, P),
                     fr.seg, store.states, store.g, store.clock))
      .concat(charactersSolids(store.clock)); // 🚶 并行角色轨:各自循环 + 位移,同屏合成
    // 实心场是 CPU 采样(SDF 纹理未进 GL 着色器);有实心或已缩放时走 CPU 视口渲染
    if(gpuOn() && !solids.length && !zoomed){ glCv.style.display='block'; glRender(fr.balls, fr.col, P); ctx.clearRect(0,0,W,H); }
    else { if(glCv) glCv.style.display='none'; previewRender(fr.balls, fr.col, P, solids.length?solids:null, fr.cam, store.view); }
    overlayTraj(fr.balls, fr.seg, fr.cam); overlayFrameGuide();
  } else {
    const s=cur();
    // 实心状态在编辑模式也按 SDF 显示(此前只在播放/导出/3D 生效 → 勾了实心编辑时仍看到笔画黑团)。
    // 实心蒙版内的点抑制(r=0),边缘由矢量 SDF 主导;编辑态不套镜头,SDF 与点同在画布坐标系。
    // 矢量图层的停留态已并入 s._sdf(实心显示);编辑态直接用它即可
    let solid = s.solid && s._sdf ? [{sdf:s._sdf, w:1}] : null;
    const chSolids=charactersSolids(store.clock);       // 🚶 编辑态也显示角色(便于摆位/调走动)
    if(chSolids.length) solid=(solid||[]).concat(chSolids);
    const editBalls=s.dots.map((b,i)=>({x:b.x+P.amp*drift(i*2.3,store.clock,P),y:b.y+P.amp*drift(i*2.3+3,store.clock,P),
      r:(solid&&b.sf)?0:b.r, c:b.c}));
    if(gpuOn() && !solid && !zoomed){ glCv.style.display='block'; glRender(editBalls, hex2rgb(s.color), P); ctx.clearRect(0,0,W,H); }
    else { if(glCv) glCv.style.display='none'; previewRender(editBalls, hex2rgb(s.color), P, solid, null, store.view); }
    ctx.drawImage(s.ghost,0,0);
    overlayOnion();
    if(!store.hideOverlays && !store.editingChar && $('showSkin')?.checked) drawSkinRef(ctx); // 车面参考(UV);编辑角色帧时隐藏(那张黄底 UV 与角色无关)
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
    overlayLedWindow();  // 🔩 LED 取景窗(开了 P2 导出时):只有窗内的画面会上屏
    overlaySelection(); overlaySnapGuides(); overlayFrameGuide(); overlayCamFrame(); overlayWaveAnchor(); overlayDims();
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
function ptr(e){ const r=cv.getBoundingClientRect(), v=store.view;
  const fx=(e.clientX-r.left)/r.width, fy=(e.clientY-r.top)/r.height; // 显示内比例 → 视口 → 逻辑
  return {x:(v.ox+fx/v.z)*W, y:(v.oy+fy/v.z)*H}; }

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
  const iz=1/Math.max(1,store.view.z); // 控制点保持恒定屏幕尺寸,放大微调时不遮挡(见 overlaySelection)
  ctx.strokeStyle='rgba(152,245,208,0.9)'; ctx.lineWidth=1.4*iz; ctx.beginPath();
  ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++){ const a=pts[i-1], b=pts[i], c1=a.hOut||a, c2=b.hIn||b;
    ctx.bezierCurveTo(c1.x,c1.y,c2.x,c2.y,b.x,b.y); }
  ctx.stroke();
  if(cur2){ const a=pts[pts.length-1], c1=a.hOut||a; // 橡皮筋(到光标,尊重末锚点出柄)
    ctx.strokeStyle='rgba(152,245,208,0.45)'; ctx.setLineDash([4,3]); ctx.beginPath();
    ctx.moveTo(a.x,a.y); ctx.bezierCurveTo(c1.x,c1.y,cur2.x,cur2.y,cur2.x,cur2.y); ctx.stroke(); ctx.setLineDash([]); }
  for(const p of pts){
    for(const hk of ['hIn','hOut']){ const h=p[hk]; if(!h) continue;
      ctx.strokeStyle='rgba(255,214,120,0.7)'; ctx.lineWidth=iz;
      ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(h.x,h.y); ctx.stroke();
      ctx.fillStyle='#ffd678'; ctx.beginPath(); ctx.arc(h.x,h.y,2.6*iz,0,7); ctx.fill(); }
    ctx.fillStyle='#98f5d0'; ctx.beginPath(); ctx.arc(p.x,p.y,3*iz,0,7); ctx.fill();
  }
  // 起点强调:光标靠近时提示可闭合
  ctx.strokeStyle='#98f5d0'; ctx.lineWidth=1.5*iz;
  ctx.beginPath(); ctx.arc(pts[0].x,pts[0].y, (cur2&&Math.hypot(cur2.x-pts[0].x,cur2.y-pts[0].y)<9?6:4)*iz,0,7); ctx.stroke();
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
  if(e.button===2) return; // 右键交给 contextmenu 菜单,不走左键选择/拖动逻辑
  // 平移手势(中键 或 空格+左键)优先,且两种模式都可用
  if(e.button===1 || (store.spaceHeld && e.button===0)){
    store.panning=true; store._panStart={x:e.clientX,y:e.clientY,ox:store.view.ox,oy:store.view.oy};
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
  // Shift 默认=框选多选;但若落在【选中路径自身的锚点/柄】上,则让位给下面的点编辑(Shift=对齐拖拽)。
  if(e.shiftKey && !(P.tool==='sel' && onOwnPathPoint(p))){
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
    // 旋转手柄也要挡在 CAD 边拾取之前(否则手柄恰好落在别的形状边上时会被"拾取边"抢走)
    const onRotateHandle = rotatableSel().length && store.sel && (()=>{ const [rx,ry]=rotHandlePt(store.sel, izOf());
      return (p.x-rx)**2+(p.y-ry)**2 < (10/Math.max(1,store.view.z||1))**2; })();
    // 多选组框范围(含手柄)整体挡在 CAD 边拾取之前 —— 否则组缩放手柄落在成员边上会被"拾取边"抢走。
    const onGroup = store.selMulti && store.selMulti.length>1 && !e.shiftKey && (()=>{
      const gb=groupBBox(); if(!gb) return false; const zt=Math.max(1,store.view.z||1), iz=izOf();
      const [rx,ry]=rotHandlePt(gb, iz); if((p.x-rx)**2+(p.y-ry)**2 < (12/zt)**2) return true;
      const pad=8/zt; return p.x>=gb.x-pad && p.x<=gb.x+gb.w+pad && p.y>=gb.y-pad && p.y<=gb.y+gb.h+pad; })();
    const ep=(!store.sel || (!onResizeHandle && !onPathVertex && !onRotateHandle && !onGroup)) ? pickEdgeAt(p,s) : null;
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
    // 走到这说明本次按下不是"拾取第一条边"、也不是 Shift 补第二条边(那两条都在上面 return 了)——
    // 任何常规选择/编辑都清掉尺寸标注的绿色边高亮,免得它一直挂着挡住画面(点边=拾取,做别的即取消)。
    edgePick=null;
    const sp0=store.selPoints||[];
    // 多选:整组一个大选框 —— 拖角/边手柄=整组缩放(Shift 等比),拖旋转手柄=整组旋转,框内=整组移动。
    // 全程连点与 rig 关节点一起变,保持相对关系(整只小人一起动,不散架)。
    if(store.selMulti && store.selMulti.length>1 && !e.shiftKey){
      const gb=groupBBox();
      if(gb){ const iz=izOf(), zt=Math.min(1,store.view.z||1), gcx=gb.x+gb.w/2, gcy=gb.y+gb.h/2;
        const [rrx,rry]=rotHandlePt(gb, iz);
        if((p.x-rrx)**2+(p.y-rry)**2 < (10/zt)**2){ pushUndo();
          for(const sh of [...store.selMulti]) if(sh.type!=='path'&&sh.type!=='text') convertShapeToPath(sh); // 旋转需要点
          store.dragAct='grouprotate'; store.dragStart=p;
          store.dragNow={cx:gcx, cy:gcy, startAng:Math.atan2(p.y-gcy,p.x-gcx), orig:groupRecordOrig()}; return; }
        const RH=(7/zt)**2; let best=null, bd=RH;
        for(const [hx,hy,m] of handleList(gb)){ const d=(p.x-hx)**2+(p.y-hy)**2; if(d<bd){bd=d;best=m;} }
        if(best){ pushUndo(); store.dragAct='groupresize:'+best; store.dragStart=p; store.dragNow={box:gb, orig:groupRecordOrig()}; return; }
        if(p.x>=gb.x&&p.x<=gb.x+gb.w&&p.y>=gb.y&&p.y<=gb.y+gb.h){ pushUndo();
          store.dragAct='groupmove'; store.dragStart=p; store.dragNow={orig:groupRecordOrig(), moved:false}; return; }
      }
    }
    // 🦴 rig 关节交互(优先):拖🟡关节=移动关节点;拖旋转手柄=摆动本关节(子级刚性跟随)
    if(store.sel?.rig && !store.sel.locked){
      const rs=riggedSel();
      if(rs){ const zt=Math.min(1,store.view.z||1);
        if((p.x-rs.joint.x)**2+(p.y-rs.joint.y)**2 < (9/zt)**2){
          pushUndo(); store.dragAct='rigpivot'; store.dragStart=p; return; }
        const [rx,ry]=rigRotHandle(rs);
        if((p.x-rx)**2+(p.y-ry)**2 < (9/zt)**2){
          pushUndo(); store.dragAct='rigrotate'; store.dragStart=p;
          store.dragNow={ jx:rs.joint.x, jy:rs.joint.y,
            startAng:Math.atan2(p.y-rs.joint.y, p.x-rs.joint.x), startRot:store.sel.rig.rot||0 };
          return; }
      }
    }
    // 锁定的选中形状不给任何手柄/拖动入口(面板选中锁定形状时,画布只读)
    if(store.sel&&!store.sel.locked&&store.sel.type==='path'&&!store.sel.rig){
      const pts=store.sel.points;
      // 命中容差:高倍不缩(维持大屏幕命中区,好点中),低倍放大 —— 治"点击不到锚点、敏感度低"。
      const zt=Math.min(1, store.view.z||1), HH=(8/zt)**2, AH=(11/zt)**2;
      // 贝塞尔柄只在【可见】时可抓(默认隐藏;右键开了"显示所有控制柄"或只选中单个锚点时才可见)。就近命中。
      const handleVisible = i => store.showHandles || (sp0.length===1 && sp0[0]===i);
      if(store.sel.bezier){
        let bh=null, bd=HH;
        for(let i=0;i<pts.length;i++){ if(!handleVisible(i)) continue;
          for(const hk of ['hOut','hIn']){ const h=pts[i][hk]; if(!h) continue;
            const d=(p.x-h.x)**2+(p.y-h.y)**2; if(d<bd){ bd=d; bh={i,hk}; } } }
        if(bh){ pushUndo(); store.dragAct='handle'; store.dragStart=p;
          store.dragNow={...bh, sym:!e.altKey}; return; }
      }
      // 锚点(就近命中):Shift+点=把该点加/减进一组;点未选中的=单选;点已选中的=保留整组;
      // 拖任一选中锚点 = 整组一起平移(一次挪整只手/整条腿,不必逐点)。
      let ba=-1, bad=AH;
      for(let i=0;i<pts.length;i++){ const d=(p.x-pts[i].x)**2+(p.y-pts[i].y)**2; if(d<bad){ bad=d; ba=i; } }
      if(ba>=0){
        const sp=store.selPoints||(store.selPoints=[]);
        if(e.shiftKey){ const k=sp.indexOf(ba); if(k>=0)sp.splice(k,1); else sp.push(ba);
          store.dragAct=null; updateSelBox();
          setHint(`已选 ${sp.length} 个控制点 — 拖任一个=整组移动 · Delete 删这组 · Shift+点继续增减`); return; }
        if(!sp.includes(ba)) store.selPoints=[ba];
        pushUndo(); store.dragAct='pathpt'; store.dragStart=p;
        store.dragNow={ grab:{x:pts[ba].x,y:pts[ba].y},
          orig:store.selPoints.map(i=>({i, pt:JSON.parse(JSON.stringify(pts[i]))})) };
        return;
      }
    }
    if(!e.shiftKey) store.selPoints=null; // 点到锚点以外(手柄/边框/形状/空白)→ 清空控制点选择
    if(store.sel&&!store.sel.locked){
      const sel=store.sel, iz=izOf(), zt=Math.min(1,store.view.z||1);
      const origBox=()=>({origX:sel.x, origY:sel.y, origW:sel.w, origH:sel.h,
        origPoints: sel.type==='path'? sel.points.map(pt=>({...pt})) : null});
      // 🔄 旋转手柄(框顶中点上方)—— 路径 + 圆/方(圆/方即时转成 path 再旋转)
      const rots=rotatableSel();
      if(rots.length){ const [rx,ry]=rotHandlePt(sel, iz);
        if((p.x-rx)**2+(p.y-ry)**2 < (10/zt)**2){
          pushUndo();
          const members=rots.map(sh=> sh.type==='path'?sh:convertShapeToPath(sh)); // 圆/方 → 可编辑 path
          const cx=store.sel.x+store.sel.w/2, cy=store.sel.y+store.sel.h/2;
          store.dragAct='rotate'; store.dragStart=p;
          store.dragNow={cx, cy, startAng:Math.atan2(p.y-cy,p.x-cx),
            members:members.map(sh=>({sh, pts:sh.points.map(pt=>({...pt}))}))};
          updateSelBox();
          return; } }
      // 8 手柄:角=双向缩放,边中点=单向缩放(Shift=等比)。就近命中,容差小于锚点 → 控制点稳赢边框。
      const RH=(7/zt)**2; let best=null, bd=RH;
      for(const [hx,hy,m] of handleList(sel)){ const d=(p.x-hx)**2+(p.y-hy)**2; if(d<bd){ bd=d; best=m; } }
      if(best){ pushUndo(); store.dragAct='resize:'+best; store.dragStart=p; store.dragNow=origBox(); return; }
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
  if(store.panning&&store._panStart){ // 平移视口(归一化,按缩放折算)
    const r=cv.getBoundingClientRect(), v=store.view;
    const dfx=(e.clientX-store._panStart.x)/r.width, dfy=(e.clientY-store._panStart.y)/r.height;
    v.ox=store._panStart.ox-dfx/v.z; v.oy=store._panStart.oy-dfy/v.z;
    clampView(); applyView(); return;
  }
  const p=ptr(e), s=cur();
  if(P.tool==='pen'&&store.penPts) store.penCursor=p; // 钢笔橡皮筋:随时记录光标
  if(!store.dragAct){
    if(store.spaceHeld){ cv.style.cursor='grab'; return; } // 空格=平移手,别被下面的悬停光标覆盖
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
    const {grab,orig}=store.dragNow;
    let nx=grab.x+(p.x-store.dragStart.x), ny=grab.y+(p.y-store.dragStart.y);
    store.snapGuides=[];
    if(e.shiftKey && orig.length===1){ // 单点 Shift 拖 = 对齐其它锚点的垂直(同 x)/水平(同 y)或中线
      const pts=store.sel.points, self=orig[0].i, TOL=6/Math.max(1,store.view.z||1);
      const cx=store.sel.x+store.sel.w/2, cy=store.sel.y+store.sel.h/2, vt=[cx], ht=[cy];
      for(let k=0;k<pts.length;k++){ if(k===self) continue; vt.push(pts[k].x); ht.push(pts[k].y); }
      let bx=null,bdx=TOL, by=null,bdy=TOL;
      for(const t of vt){ const d=Math.abs(t-nx); if(d<bdx){bdx=d;bx=t;} }
      for(const t of ht){ const d=Math.abs(t-ny); if(d<bdy){bdy=d;by=t;} }
      if(bx!=null){ nx=bx; store.snapGuides.push({axis:'v',pos:bx}); }
      if(by!=null){ ny=by; store.snapGuides.push({axis:'h',pos:by}); }
    }
    const tdx=nx-grab.x, tdy=ny-grab.y;                        // 整组(每个锚点连同两根柄)同位移
    for(const {i,pt} of orig){ const a=store.sel.points[i];
      a.x=pt.x+tdx; a.y=pt.y+tdy;
      if(pt.hIn) a.hIn={x:pt.hIn.x+tdx, y:pt.hIn.y+tdy};
      if(pt.hOut) a.hOut={x:pt.hOut.x+tdx, y:pt.hOut.y+tdy};
    }
    Object.assign(store.sel, pathBBox(store.sel.points));
    shapesChanged(s,true);
  }
  else if(store.dragAct==='groupmove'){
    const dx=p.x-store.dragStart.x, dy=p.y-store.dragStart.y;
    if(Math.abs(dx)>1||Math.abs(dy)>1) store.dragNow.moved=true;
    groupApply(store.dragNow.orig, (x,y)=>({x:x+dx, y:y+dy})); shapesChanged(s,true);
  }
  else if(store.dragAct&&store.dragAct.startsWith('groupresize:')){
    const m=store.dragAct.slice(12), o=store.dragNow, b=o.box;
    const L=b.x, R=b.x+b.w, T=b.y, B=b.y+b.h;
    let ax=(L+R)/2, ay=(T+B)/2, sx=1, sy=1;
    if(m.includes('e')){ ax=L; sx=(p.x-L)/Math.max(1,b.w); } else if(m.includes('w')){ ax=R; sx=(R-p.x)/Math.max(1,b.w); }
    if(m.includes('s')){ ay=T; sy=(p.y-T)/Math.max(1,b.h); } else if(m.includes('n')){ ay=B; sy=(B-p.y)/Math.max(1,b.h); }
    if(e.shiftKey && m.length===2){ const sc=Math.max(Math.abs(sx),Math.abs(sy)); sx=Math.sign(sx||1)*sc; sy=Math.sign(sy||1)*sc; }
    sx=Math.sign(sx||1)*Math.max(0.05,Math.abs(sx)); sy=Math.sign(sy||1)*Math.max(0.05,Math.abs(sy));
    groupApply(o.orig, (x,y)=>({x:ax+(x-ax)*sx, y:ay+(y-ay)*sy})); shapesChanged(s,true);
  }
  else if(store.dragAct==='grouprotate'){
    const o=store.dragNow; let ang=Math.atan2(p.y-o.cy,p.x-o.cx)-o.startAng;
    if(e.shiftKey) ang=Math.round(ang/(15*Math.PI/180))*(15*Math.PI/180);
    const cos=Math.cos(ang), sin=Math.sin(ang);
    groupApply(o.orig, (x,y)=>({x:o.cx+(x-o.cx)*cos-(y-o.cy)*sin, y:o.cy+(x-o.cx)*sin+(y-o.cy)*cos}));
    store._rotHud=Math.round(((ang*180/Math.PI)%360+360)%360); shapesChanged(s,true);
  }
  else if(store.dragAct==='rigpivot'&&store.sel?.rig){
    // 关节点存在【父级坐标系】;拖动是世界坐标 → 用父级世界矩阵的逆变换回去
    const mats=rigMatrices(cur().shapes);
    const pW=(store.sel.rig.parent!=null&&mats.has(store.sel.rig.parent))?mats.get(store.sel.rig.parent):rigIdent();
    const local=rigApply(invAffine(pW), p.x, p.y);
    store.sel.rig.pivot={x:local.x, y:local.y};
    shapesChanged(s,true);
  }
  else if(store.dragAct==='rigrotate'&&store.sel?.rig){
    const o=store.dragNow;
    let deg=o.startRot + (Math.atan2(p.y-o.jy, p.x-o.jx)-o.startAng)*180/Math.PI;
    if(e.shiftKey) deg=Math.round(deg/15)*15;               // Shift=15° 步进
    store.sel.rig.rot=deg; store._rotHud=Math.round(((deg%360)+360)%360);
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
  else if(store.dragAct==='rotate'&&store.sel){
    const o=store.dragNow, D=Math.PI/180;
    let ang=Math.atan2(p.y-o.cy, p.x-o.cx)-o.startAng;
    if(e.shiftKey) ang=Math.round(ang/(15*D))*(15*D);           // Shift=15° 步进
    else { const near=Math.round(ang/(90*D))*(90*D);            // 就近贴 90/180/270(轻松对齐)
      if(Math.abs(ang-near)<7*D) ang=near; }
    const cos=Math.cos(ang), sin=Math.sin(ang);
    for(const m of o.members){ m.sh.points=m.pts.map(pt=>rotatePt(pt,o.cx,o.cy,cos,sin));
      Object.assign(m.sh, pathBBox(m.sh.points)); }
    store._rotHud=Math.round(((ang/D)%360+360)%360);            // 角度 HUD(overlay 显示)
    shapesChanged(s,true); updateSelBox();
  }
  else if(store.dragAct&&store.dragAct.startsWith('resize:')&&store.sel){
    const sel=store.sel, m=store.dragAct.slice(7), o=store.dragNow;
    const MIN=sel.type==='text'?14:8, corner=(m.length===2), ar=o.origW/Math.max(1e-6,o.origH);
    let x0=o.origX, y0=o.origY, x1=o.origX+o.origW, y1=o.origY+o.origH;
    if(e.shiftKey){ // 等比:锚定对角/对边,锁原始宽高比
      const ax=m.includes('w')?x1 : m.includes('e')?x0 : (x0+x1)/2;
      const ay=m.includes('n')?y1 : m.includes('s')?y0 : (y0+y1)/2;
      let cw, ch;
      if(corner){ cw=Math.abs(p.x-ax); ch=Math.abs(p.y-ay); if(cw/Math.max(1e-6,ch)>ar) ch=cw/ar; else cw=ch*ar; }
      else if(m==='w'||m==='e'){ cw=Math.abs(p.x-ax); ch=cw/ar; }
      else { ch=Math.abs(p.y-ay); cw=ch*ar; }
      cw=Math.max(MIN,cw); ch=Math.max(MIN,ch);
      x0=m.includes('e')?ax : m.includes('w')?ax-cw : ax-cw/2; x1=x0+cw;
      y0=m.includes('s')?ay : m.includes('n')?ay-ch : ay-ch/2; y1=y0+ch;
    } else {
      if(m.includes('w')) x0=Math.min(p.x, x1-MIN);
      if(m.includes('e')) x1=Math.max(p.x, x0+MIN);
      if(m.includes('n')) y0=Math.min(p.y, y1-MIN);
      if(m.includes('s')) y1=Math.max(p.y, y0+MIN);
    }
    let nx=x0, ny=y0, nw=x1-x0, nh=y1-y0;
    if(sel.type==='text'){ nh=Math.max(14,nh); nw=measureText(sel.text,nh);
      nx=m.includes('w')?x1-nw : m.includes('e')?x0 : (o.origX+o.origW/2)-nw/2; }
    else if(sel.type==='path'&&o.origPoints){
      const sx=o.origW<1e-6?1:nw/o.origW, sy=o.origH<1e-6?1:nh/o.origH;
      sel.points=o.origPoints.map(pt=>scalePt(pt,o.origX,o.origY,sx,sy,nx,ny));
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
  // 组框内点击(未拖动)= 选中光标下的单个成员(从多选切到单选);否则保持整组
  if(store.dragAct==='groupmove' && store.dragNow && !store.dragNow.moved){
    const p=ptr(e); let hit=null;
    for(let i=s.shapes.length-1;i>=0;i--){ const sh=s.shapes[i]; if(sh.hidden||sh.locked) continue;
      if(p.x>=sh.x&&p.x<=sh.x+sh.w&&p.y>=sh.y&&p.y<=sh.y+sh.h){ hit=sh; break; } }
    if(hit){ store.sel=hit; store.selMulti=[hit]; }
    updateSelBox(); store.dragAct=null; store.dragStart=null; store.dragNow=null; return;
  }
  if(store.dragAct==='groupmove'||store.dragAct==='grouprotate'||store.dragAct?.startsWith('groupresize')){
    shapesChanged(s); store.dragAct=null; store.dragStart=null; store.dragNow=null; store._rotHud=null; return;
  }
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
  store.dragAct=null; store.dragStart=null; store.dragNow=null; store.snapGuides=null; store._rotHud=null;
}

let shapeClipboard=null; // Ctrl+C 的形状快照(JSON 深拷贝,可跨状态/图层粘贴)
function onKeyDown(e){
  if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT') return;
  const k=e.key.toLowerCase();
  // 取景框语境:选中框时 Delete 删它;焦点在取景框(含刚删除后)时 Ctrl+Z 撤销取景框操作
  const skinOn=$('showSkin')?.checked;
  if(skinOn && getSelSkin() && (e.key==='Delete'||e.key==='Backspace')){
    if(deleteSelSkin()) setHint('🗑 取景框已从 2D 叠加移除(要恢复回 3D 再 🗺同步) · Ctrl+Z 撤销'); e.preventDefault(); return; }
  if(skinOn && getSelSkin() && k==='f' && !e.ctrlKey && !e.metaKey){ // F=适配内容铺满;Shift+F=还原
    if(e.shiftKey){ if(clearSelSkinCrop()) setHint('↺ 车面参考已还原完整 UV'); }
    else if(fitSelSkin()) setHint('🔍 车面参考已裁剪到 UV 岛并铺满取景框(纯显示,不影响 3D 映射) · Shift+F 还原');
    e.preventDefault(); return; }
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
  else if(e.key==='Delete'||e.key==='Backspace'){
    // 选中了一组控制点 → 只删这些锚点(保留 ≥3 个,图形仍成面);否则删整个图形
    const sp=store.selPoints||[];
    if(store.sel?.type==='path' && sp.length && !store.sel.locked && store.sel.points.length-sp.length>=3){
      pushUndo();
      for(const i of [...sp].sort((a,b)=>b-a)) store.sel.points.splice(i,1);
      store.selPoints=null; Object.assign(store.sel, pathBBox(store.sel.points));
      shapesChanged(cur()); updateSelBox();
    } else deleteSel();
    e.preventDefault(); }
  else if(e.key==='Escape'){ store.sel=null; store.selMulti=[]; store.selPoints=null; edgePick=null; clearSkinSel(); closeDimInput(); updateSelBox(); }
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
  if(P.tool!=='sel'||!store.sel||store.sel.locked) return;
  // 双击圆/方 → 转成可编辑 path(随即可加删锚点、调曲率),与钢笔一致
  if(store.sel.type==='rect'||store.sel.type==='ellipse'){
    const q=ptr(e); if(q.x>=store.sel.x&&q.x<=store.sel.x+store.sel.w&&q.y>=store.sel.y&&q.y<=store.sel.y+store.sel.h){
      pushUndo(); convertShapeToPath(store.sel); shapesChanged(cur()); updateSelBox();
      setHint('已转为可编辑路径 — 双击线段加锚点 · 双击锚点转尖角⇄光滑 · 右键更多'); }
    return;
  }
  if(store.sel.type!=='path') return;
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

// ── 画布缩放/平移(视口渲染:只渲可见区,缩放后清晰、开销恒定;数据不变)──
function applyView(){ const zv=$('zoomVal'); if(zv) zv.textContent=Math.round(store.view.z*100)+'%'; }
function clampView(){
  const v=store.view; v.z=Math.max(1,Math.min(8,v.z));
  const s=1/v.z; v.ox=Math.min(1-s, Math.max(0, v.ox)); v.oy=Math.min(1-s, Math.max(0, v.oy));
  if(v.z<=1.0001){ v.ox=0; v.oy=0; }
}
// 以光标为中心缩放:光标下的归一化点在缩放前后保持不动。
function zoomAt(clientX, clientY, factor){
  const r=cv.getBoundingClientRect(), v=store.view;
  const fx=(clientX-r.left)/r.width, fy=(clientY-r.top)/r.height; // 画布显示内的比例
  const nx=v.ox+fx/v.z, ny=v.oy+fy/v.z;                          // 光标下的归一化坐标
  v.z=Math.max(1,Math.min(8,v.z*factor));
  v.ox=nx-fx/v.z; v.oy=ny-fy/v.z; clampView(); applyView();
}
function resetView(){ store.view={z:1,ox:0,oy:0}; applyView(); }
// 叠加层变换:逻辑坐标(0..W)→ 缓冲像素(按视口)。z=1,ox=0 时退化为 setTransform(VS,…)。
function setOverlayTransform(){ const v=store.view;
  ctx.setTransform(v.z*VS, 0, 0, v.z*VS, -v.ox*v.z*BW, -v.oy*v.z*BH); }

export function initStage(){
  cv=$('cv'); cv.width=BW; cv.height=BH; ctx=cv.getContext('2d'); // 4× 缓冲(1920×1120),缩放更清晰
  previewRender=createSizedRenderer(ctx, BW, BH);
  glCv=$('cvgl');
  if(glCv){ glCv.width=BW; glCv.height=BH; glRender=createGLRenderer(glCv); // GL 分辨率对齐
    if(!glRender){ const ck=$('useGpu'); if(ck){ ck.checked=false; ck.disabled=true; ck.parentElement.title='此浏览器不支持 WebGL2,已回退 CPU 渲染'; } } }
  cv.addEventListener('pointerdown',onPointerDown);
  cv.addEventListener('pointermove',onPointerMove);
  cv.addEventListener('dblclick',onDblClick);
  // 右键菜单:控制柄默认隐藏,右键这里开/关"显示所有控制柄";另有"全选控制点"便于 rig 整体移动。
  let ctxMenu=null; const closeCtx=()=>{ if(ctxMenu){ ctxMenu.remove(); ctxMenu=null; } };
  cv.addEventListener('contextmenu',e=>{
    if(store.mode!=='edit') return;
    const p=ptr(e), s=cur();
    const under=shapeUnder(p,s);
    const isEditable=sh=>sh&&(sh.type==='path'||sh.type==='rect'||sh.type==='ellipse');
    const target = isEditable(store.sel) ? store.sel : (isEditable(under)?under:null);
    if(!target){ return; } // 仅对 path/圆/方弹菜单,其它交给浏览器默认
    e.preventDefault(); closeCtx();
    store.sel=target; if(!store.selMulti?.includes(target)) store.selMulti=[target]; updateSelBox();
    ctxMenu=document.createElement('div');
    ctxMenu.style.cssText=`position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:#1b1f1e;`+
      `border:1px solid #2f3a37;border-radius:6px;padding:4px;min-width:230px;font:12px system-ui;color:#dfe;box-shadow:0 6px 22px rgba(0,0,0,.55)`;
    const item=(label,fn)=>{ const b=document.createElement('div'); b.textContent=label;
      b.style.cssText='padding:7px 10px;border-radius:4px;cursor:pointer';
      b.onmouseenter=()=>b.style.background='#2a3330'; b.onmouseleave=()=>b.style.background='';
      b.onclick=()=>{ fn(); closeCtx(); }; ctxMenu.appendChild(b); };
    if(target.type!=='path'){
      // 圆/方:转成可编辑 path → 解锁钢笔全部功能(锚点/手柄/多选/旋转/骨骼)
      item('✏ 转为可编辑路径(启用锚点/旋转/骨骼)', ()=>{ pushUndo();
        const np=convertShapeToPath(target); shapesChanged(cur()); updateSelBox();
        setHint(`已转为可编辑路径(${np.points.length} 锚点)— 现在可加删锚点/拖控制柄/多选/旋转/绑骨骼`); });
    } else {
      const path=target;
      item(`${store.showHandles?'☑':'☐'} 显示所有控制柄(曲率黄点)`, ()=>{ store.showHandles=!store.showHandles;
        setHint(store.showHandles?'已显示所有控制柄 — 再右键可关闭':'已隐藏控制柄(只留锚点,不挡视野;单选一个锚点仍会显示它的柄)'); });
      item(`◎ 全选所有控制点(${path.points.length} 个)— 便于整体 rig`, ()=>{ store.selPoints=path.points.map((_,i)=>i);
        setHint(`已全选 ${path.points.length} 个控制点 — 拖任一个整体移动 · Shift+点可减选到"一只手/一条腿"`); });
      item('✕ 取消控制点选择', ()=>{ store.selPoints=null; });
    }
    document.body.appendChild(ctxMenu);
  });
  window.addEventListener('pointerdown',e=>{ if(ctxMenu && !ctxMenu.contains(e.target)) closeCtx(); }, true);
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
