// 中央舞台:画布交互(画/选/移/缩/单点)、叠加层(洋葱皮/轨迹/画幅线/选框)、
// 播放模式与 requestAnimationFrame 主循环。预览渲染走 render.js 的 createPreviewRenderer。
import { W, H, P } from '../config.js';
import { store, cur } from '../store.js';
import { $, hex2rgb, setHint, getExpSize } from '../utils.js';
import { createPreviewRenderer } from '../render.js';
import { createGLRenderer } from '../render-gl.js';
import { sampleFrame, drift, camPt, camIdentity } from '../engine.js';
import { rebuildSequence } from '../sequence.js';
import { resampleAll, resample, updateThumb, shapesChanged, measureText } from '../pipeline.js';
import { pushUndo, undo, redo } from '../state.js';
import { updateSelBox, deleteSel } from './inspector.js';
import { renderStrip } from './filmstrip.js';
import { setTool } from './toolbar.js';
import { rdpSimplify, pathBBox, fillSmoothClosedPath } from '../path.js';
import { applyShapeBBox } from '../shapes.js';
import { drawSkinRef } from './skinRef.js';
import { tlTick } from './timeline.js';

let cv, ctx, previewRender, glRender=null, glCv=null;
// 双画布:#cvgl(WebGL 高分辨率场渲染,垫底)+ #cv(2D,GPU 模式下只画叠加层)。
// gpuOn 时 2D 画布每帧 clearRect 保持透明,场画面从下层透出;CPU 回退时行为与旧版一致。
const gpuOn=()=> glRender && $('useGpu')?.checked && !store.forceCpu; // 录制 WebM 时强制 CPU(captureStream 抓 2D 画布)

const HANDLE=5;
const handlePts=s=>[[s.x,s.y],[s.x+s.w,s.y],[s.x,s.y+s.h],[s.x+s.w,s.y+s.h]];
const PEN_MIN_STEP=2.5;   // 原始轨迹节流:相邻捕获点最小间距(px),避免密集到没法简化
const PEN_EPSILON=2.5;    // RDP 简化容差(px):越大锚点越少、越粗糙

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
  if(store.dragAct==='marquee'&&store.dragStart&&store.dragNow){
    ctx.strokeStyle='rgba(152,245,208,0.7)'; ctx.setLineDash([4,3]); ctx.lineWidth=1;
    ctx.strokeRect(Math.min(store.dragStart.x,store.dragNow.x), Math.min(store.dragStart.y,store.dragNow.y),
      Math.abs(store.dragNow.x-store.dragStart.x), Math.abs(store.dragNow.y-store.dragStart.y));
    ctx.setLineDash([]);
  }
  if(!store.sel) return;
  const sel=store.sel;
  if(sel.type==='path'){
    // 描边显示实际会被填充的平滑曲线,再逐锚点画小圆手柄(区别于下方整体缩放的方块手柄)
    if(fillSmoothClosedPath(ctx, sel.points)){
      ctx.strokeStyle='rgba(120,180,255,0.85)'; ctx.lineWidth=1; ctx.stroke();
    }
    ctx.fillStyle='#7ab4ff';
    for(const p of sel.points){ ctx.beginPath(); ctx.arc(p.x,p.y,3.2,0,7); ctx.fill(); }
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
  if(store.mode==='play'){
    if(store.seqDirty) rebuildSequence();
    if(store.playing){ store.g+=dt;
      if(store.g>=store.SEQ.T){ if($('loop').checked) store.g-=store.SEQ.T;
        else{ store.g=store.SEQ.T; store.playing=false; $('playBtn').textContent='▶ 播放'; } } }
    $('tVal').textContent=store.g.toFixed(1)+'s';
    const fr=sampleFrame(store.SEQ, store.states, store.g, store.clock, P);
    if(gpuOn()){ glCv.style.display='block'; glRender(fr.balls, fr.col, P); ctx.clearRect(0,0,W,H); }
    else { if(glCv) glCv.style.display='none'; previewRender(fr.balls, fr.col, P); }
    overlayTraj(fr.balls, fr.seg, fr.cam); overlayFrameGuide();
  } else {
    const s=cur();
    const editBalls=s.dots.map((b,i)=>({x:b.x+P.amp*drift(i*2.3,store.clock,P),y:b.y+P.amp*drift(i*2.3+3,store.clock,P),r:b.r,c:b.c}));
    if(gpuOn()){ glCv.style.display='block'; glRender(editBalls, hex2rgb(s.color), P); ctx.clearRect(0,0,W,H); }
    else { if(glCv) glCv.style.display='none'; previewRender(editBalls, hex2rgb(s.color), P); }
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
    if(store.dragAct==='pen'&&store.dragNow?.strokePts?.length>1){
      const pts=store.dragNow.strokePts;
      ctx.strokeStyle='rgba(152,245,208,0.85)'; ctx.lineWidth=1.3;
      ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
      for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
      ctx.stroke();
    }
    overlaySelection(); overlaySnapGuides(); overlayFrameGuide(); overlayCamFrame();
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

function onPointerDown(e){
  if(store.mode==='play') return;
  const p=ptr(e), s=cur();
  if(P.tool==='sel'){
    // 锁定的选中形状不给任何手柄/拖动入口(面板选中锁定形状时,画布只读)
    if(store.sel&&!store.sel.locked&&store.sel.type==='path'){ // 锚点手柄优先于整体缩放/移动判定
      const pts=store.sel.points;
      for(let i=0;i<pts.length;i++)
        if(Math.hypot(p.x-pts[i].x,p.y-pts[i].y)<7){
          pushUndo(); store.dragAct='pathpt'+i; store.dragStart=p; return; }
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
    if(e.shiftKey){ // Shift+点选:进出多选集合,不启动拖动
      if(hit){
        const i=store.selMulti.indexOf(hit);
        if(i>=0){ store.selMulti.splice(i,1); if(store.sel===hit) store.sel=store.selMulti[store.selMulti.length-1]||null; }
        else { store.selMulti.push(hit); store.sel=hit; }
      }
      updateSelBox(); return;
    }
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
  else if(P.tool==='pen'){ store.dragAct='pen'; store.dragStart=p; store.dragNow={strokePts:[p]}; }
  else if(P.tool==='text'){
    pushUndo();
    const txt=$('txtWord').value||'GO', h=P.font, w=measureText(txt,h);
    // 新文字默认用"笔画"采样 —— 沿字形骨架布珠,自适应笔画粗细,小字号也可读
    const sh={id:store.shapeId++, type:'text', text:txt, x:p.x-w/2, y:p.y-h/2, w, h, bool:P.bool, sampler:'strokes'};
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
  if(!store.dragAct) return;
  const p=ptr(e), s=cur();
  if(store.dragAct==='draw'){ store.dragNow=p; }
  else if(store.dragAct==='pen'){
    const pts=store.dragNow.strokePts, last=pts[pts.length-1];
    if(Math.hypot(p.x-last.x,p.y-last.y)>=PEN_MIN_STEP) pts.push(p); // 节流,避免原始轨迹过密
  }
  else if(store.dragAct.startsWith('pathpt')&&store.sel){
    const i=+store.dragAct.slice(6);
    store.sel.points[i]={x:p.x,y:p.y};
    Object.assign(store.sel, pathBBox(store.sel.points));
    shapesChanged(s,true);
  }
  else if(store.dragAct==='marquee'){ store.dragNow=p; }
  else if(store.dragAct==='move'&&store.sel){
    const dx=p.x-store.dragStart.x, dy=p.y-store.dragStart.y;
    const snapped=snapMove(store.sel, store.dragNow.ox+dx, store.dragNow.oy+dy);
    store.snapGuides=snapped.guides;
    const tx=snapped.x-store.dragNow.ox, ty=snapped.y-store.dragNow.oy;
    if(store.sel.type==='path'&&store.dragNow.origPoints){
      store.sel.points=store.dragNow.origPoints.map(pt=>({x:pt.x+tx,y:pt.y+ty}));
      Object.assign(store.sel, pathBBox(store.sel.points));
    } else {
      store.sel.x=store.dragNow.ox+tx; store.sel.y=store.dragNow.oy+ty;
    }
    for(const m of store.dragNow.multi||[]){ // 多选:其余成员同位移
      if(m.points){ m.sh.points=m.points.map(pt=>({x:pt.x+tx,y:pt.y+ty}));
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
      sel.points=origPoints.map(pt=>({x:nx+(pt.x-origX)*sx, y:ny+(pt.y-origY)*sy}));
    }
    sel.x=nx; sel.y=ny; sel.w=nw; sel.h=nh;
    shapesChanged(s,true); updateSelBox();
  }
}
function onPointerUp(e){
  if(!store.dragAct) return;
  const s=cur();
  if(store.dragAct==='draw'){
    const p=ptr(e);
    if(Math.abs(p.x-store.dragStart.x)>3||Math.abs(p.y-store.dragStart.y)>3){
      pushUndo();
      const sh={id:store.shapeId++, type:P.tool==='rect'?'rect':'ellipse',
        x:Math.min(store.dragStart.x,p.x), y:Math.min(store.dragStart.y,p.y),
        w:Math.abs(p.x-store.dragStart.x), h:Math.abs(p.y-store.dragStart.y), bool:P.bool};
      s.shapes.push(sh); store.sel=sh; updateSelBox(); shapesChanged(s);
    }
  } else if(store.dragAct==='marquee'){
    const p=ptr(e), x0=Math.min(store.dragStart.x,p.x), x1=Math.max(store.dragStart.x,p.x);
    const y0=Math.min(store.dragStart.y,p.y), y1=Math.max(store.dragStart.y,p.y);
    if(x1-x0>4||y1-y0>4){
      store.selMulti=s.shapes.filter(sh=>!sh.hidden&&!sh.locked&&
        sh.x<x1&&sh.x+sh.w>x0&&sh.y<y1&&sh.y+sh.h>y0);
      store.sel=store.selMulti[store.selMulti.length-1]||null;
      if(store.selMulti.length>1) setHint(`已框选 ${store.selMulti.length} 个形状 — 右栏「排列」可对齐/等距/阵列`);
    }
    updateSelBox();
  } else if(store.dragAct==='pen'){
    const simplified=rdpSimplify(store.dragNow.strokePts, PEN_EPSILON);
    if(simplified.length>=3){
      pushUndo();
      const sh={id:store.shapeId++, type:'path', points:simplified, bool:P.bool, ...pathBBox(simplified)};
      s.shapes.push(sh); store.sel=sh; updateSelBox(); shapesChanged(s);
      setHint(`已画一条轮廓(${simplified.length} 个锚点)· ➤ 工具可拖动锚点精修`);
    }
  } else { shapesChanged(s); }
  store.dragAct=null; store.dragStart=null; store.dragNow=null; store.snapGuides=null;
}

function onKeyDown(e){
  if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT') return;
  const k=e.key.toLowerCase();
  if((e.ctrlKey||e.metaKey)&&k==='z'){ e.shiftKey?redo():undo(); e.preventDefault(); return; }
  if((e.ctrlKey||e.metaKey)&&k==='y'){ redo(); e.preventDefault(); return; }
  if(k==='v')setTool('sel'); else if(k==='r')setTool('rect');
  else if(k==='e')setTool('ell'); else if(k==='t')setTool('text');
  else if(k==='d')setTool('dot'); else if(k==='p')setTool('pen');
  else if(e.key==='Delete'||e.key==='Backspace'){ deleteSel(); e.preventDefault(); }
  else if(e.key==='Escape'){ store.sel=null; store.selMulti=[]; updateSelBox(); }
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

// 双击编辑路径锚点:双击已有手柄=删除该点(至少保留 3 点);双击轮廓线段=在该处插入新锚点。
function onDblClick(e){
  if(store.mode==='play'||P.tool!=='sel'||!store.sel||store.sel.type!=='path'||store.sel.locked) return;
  const p=ptr(e), sel=store.sel, s=cur();
  for(let i=0;i<sel.points.length;i++){
    if(Math.hypot(p.x-sel.points[i].x,p.y-sel.points[i].y)<7){
      if(sel.points.length<=3){ setHint('轮廓至少保留 3 个锚点'); return; }
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

export function initStage(){
  cv=$('cv'); ctx=cv.getContext('2d');
  previewRender=createPreviewRenderer(ctx);
  glCv=$('cvgl');
  if(glCv){ glRender=createGLRenderer(glCv);
    if(!glRender){ const ck=$('useGpu'); if(ck){ ck.checked=false; ck.disabled=true; ck.parentElement.title='此浏览器不支持 WebGL2,已回退 CPU 渲染'; } } }
  cv.addEventListener('pointerdown',onPointerDown);
  cv.addEventListener('pointermove',onPointerMove);
  cv.addEventListener('dblclick',onDblClick);
  window.addEventListener('pointerup',onPointerUp);
  window.addEventListener('keydown',onKeyDown);
  // 播放控制条(时间轴的擦洗/改时长手势在 timeline.js)
  $('mPlay').onclick=()=>setMode(store.mode==='play'?'edit':'play');
  $('playBtn').onclick=()=>{ if(store.mode!=='play'){setMode('play');return;}
    store.playing=!store.playing; if(store.playing&&store.g>=store.SEQ.T){store.g=0;}
    $('playBtn').textContent=store.playing?'⏸ 暂停':'▶ 播放'; };
}
