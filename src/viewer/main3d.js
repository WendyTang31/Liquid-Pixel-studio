// 3D 车模预览器 · Rhino 式交互:
//   选择工具点投影面 → 出现操纵球(gumball):拖箭头沿表面切向移动、拖圆环绕法线旋转、
//   拖中心方块缩放;双击车身重新放置。放置/画笔/橡皮/上色为独立工具模式。
//   右侧面板 = 投影面图层列表 + 属性 + "画面分区"切割编辑器(把同一动画切给各面,
//   分区相邻 → 球跨面连续跑动;每面都是自身表面的正投影,无斜投影拉伸)。
//   Ctrl+Z 撤销视图操作;Delete 删当前投影面。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { W, H, P } from '../config.js';
import { buildSequence, sampleFrame } from '../engine.js';
import { createSizedRenderer } from '../render.js';
import { paintShapes, maskReaderFor, lumReaderFor, sampleDots } from '../pipeline.js';
import { decodeImageShape } from '../image.js';
import { downloadBlob, hex2rgb } from '../utils.js';

const $=id=>document.getElementById(id);
const hint=msg=>{ $('hint').textContent=msg; };
const DEC_COLORS=['#98f5d0','#7ab4ff','#ffd479','#ff9a9a','#d59aff','#9affe2'];

/* ══════════════ IndexedDB ══════════════ */
function idbOpen(){ return new Promise((res,rej)=>{ const q=indexedDB.open('morph-studio',1);
  q.onupgradeneeded=()=>q.result.createObjectStore('files');
  q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error); }); }
async function idbPut(key,val){ const db=await idbOpen(); return new Promise((res,rej)=>{
  const tx=db.transaction('files','readwrite'); tx.objectStore('files').put(val,key);
  tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
async function idbGet(key){ const db=await idbOpen(); return new Promise((res,rej)=>{
  const rq=db.transaction('files').objectStore('files').get(key);
  rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); }); }

/* ══════════════ 动画纹理 + 笔刷蒙版 ══════════════ */
const TEXW=960, TEXH=560;
const texCanvas=document.createElement('canvas'); texCanvas.width=TEXW; texCanvas.height=TEXH;
const texCtx=texCanvas.getContext('2d');
const renderTex=createSizedRenderer(texCtx, TEXW, TEXH);
texCtx.fillStyle='#0a0a0a'; texCtx.fillRect(0,0,TEXW,TEXH);
texCtx.fillStyle='#98f5d0'; texCtx.font='30px system-ui'; texCtx.textAlign='center';
texCtx.fillText('等待工程 — 编辑器点「🚗 3D 预览」或 📂 载入', TEXW/2, TEXH/2);
const screenTex=new THREE.CanvasTexture(texCanvas);
screenTex.colorSpace=THREE.SRGBColorSpace;

const maskCanvas=document.createElement('canvas'); maskCanvas.width=TEXW; maskCanvas.height=TEXH;
const maskCtx=maskCanvas.getContext('2d');
maskCtx.fillStyle='#fff'; maskCtx.fillRect(0,0,TEXW,TEXH);
const maskTex=new THREE.CanvasTexture(maskCanvas);

let states=null, SEQ=null, g=0, last=performance.now(), clock=0;

async function loadProjectData(data){
  if(data.params) Object.assign(P, data.params);
  let raw=data.states;
  if(!raw && (data.A||data.B)){
    raw=[{name:'状态 1',color:data.params?.colA||'#98f5d0',hold:1,dur:3,shapes:data.A?.shapes||[],manual:data.A?.manual||[]},
         {name:'状态 2',color:data.params?.colB||'#98f5d0',hold:1,dur:3,shapes:data.B?.shapes||[],manual:data.B?.manual||[]}];
  }
  if(!raw) throw new Error('无法识别的工程格式');
  const mask=document.createElement('canvas'); mask.width=W; mask.height=H;
  const mctx=mask.getContext('2d',{willReadFrequently:true});
  const out=[];
  for(const d of raw){
    for(const sh of d.shapes) if(sh.type==='image') await decodeImageShape(sh);
    paintShapes(mctx, d.shapes);
    out.push({name:d.name, color:d.color, hold:d.hold, dur:d.dur, trans:d.trans||{},
      dots:sampleDots(maskReaderFor(mctx), d.manual||[], P, lumReaderFor(mctx))});
  }
  states=out; SEQ=buildSequence(states, true, P); g=0;
  hint(`✓ 工程已载入:${states.length} 个状态 · 循环 ${SEQ.T.toFixed(1)}s`);
}

/* ══════════════ 场景 ══════════════ */
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x0a0a0a);
scene.fog=new THREE.Fog(0x0a0a0a, 16, 34);
const camera=new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 100);
camera.position.set(-5.2, 2.4, 5.4);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.15;
$('scene').appendChild(renderer.domElement);
const controls=new OrbitControls(camera, renderer.domElement);
controls.target.set(0,0.8,0); controls.enableDamping=true; controls.maxPolarAngle=Math.PI/2-0.03;

const pmrem=new THREE.PMREMGenerator(renderer);
scene.environment=pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0x99aabb, 0x151515, 0.5));
const key=new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(4,7,3); scene.add(key);
const fill=new THREE.DirectionalLight(0x8899ff, 0.4); fill.position.set(-5,3,-4); scene.add(fill);
const ground=new THREE.Mesh(new THREE.CircleGeometry(26,48),
  new THREE.MeshStandardMaterial({color:0x101114, roughness:0.85, metalness:0.15}));
ground.rotation.x=-Math.PI/2; scene.add(ground);

const screenMat=new THREE.MeshBasicMaterial({map:screenTex, alphaMap:maskTex, toneMapped:false,
  transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4});

let carGroup=new THREE.Group();
function buildDemoCar(){
  const g0=new THREE.Group();
  const body=new THREE.MeshStandardMaterial({color:0x1a1e24, metalness:0.85, roughness:0.32});
  const dark=new THREE.MeshStandardMaterial({color:0x0c0d10, metalness:0.4, roughness:0.7});
  const mk=(geo,mat,x,y,z)=>{const m=new THREE.Mesh(geo,mat); m.position.set(x,y,z); g0.add(m); return m;};
  mk(new THREE.BoxGeometry(4.2,0.85,1.85), body, 0,0.72,0);
  mk(new THREE.BoxGeometry(2.15,0.62,1.62), dark, -0.25,1.44,0);
  for(const [wx,wz] of [[1.35,0.92],[1.35,-0.92],[-1.35,0.92],[-1.35,-0.92]]){
    const wheel=new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.42,0.3,24), dark);
    wheel.rotation.x=Math.PI/2; wheel.position.set(wx,0.42,wz); g0.add(wheel);
  }
  return g0;
}
carGroup=buildDemoCar(); scene.add(carGroup);
const meshList=()=>{ const l=[]; carGroup.traverse(o=>{ if(o.isMesh&&!o.userData.isDecal) l.push(o); }); return l; };

async function loadModelBlob(blob, persist){
  hint('载入模型中…');
  const url=URL.createObjectURL(blob);
  try{
    const gltf=await new GLTFLoader().loadAsync(url);
    scene.remove(carGroup); clearAllDecals(); origMats.clear(); carColors.length=0;
    carGroup=gltf.scene;
    const box=new THREE.Box3().setFromObject(carGroup);
    const size=box.getSize(new THREE.Vector3()), c=box.getCenter(new THREE.Vector3());
    const s=4.6/Math.max(size.x,size.y,size.z);
    carGroup.scale.setScalar(s);
    carGroup.position.set(-c.x*s, -box.min.y*s, -c.z*s);
    scene.add(carGroup);
    if(persist) idbPut('model', blob).catch(()=>{});
    hint('✓ 模型已载入 — 📍 放置工具点击车身');
    return true;
  }catch(err){ hint('⚠ 模型载入失败:'+err.message+'(建议自包含 .glb)'); return false; }
  finally{ URL.revokeObjectURL(url); }
}

/* ══════════════ 投影面数据 ══════════════ */
const decals=[]; let activeDecal=0, selected=false;
function newDecal(){ return {mesh:null, localPoint:null, localNormal:null,
  sz:1.2, rot:0, du:0, dv:0, cx:0, cy:0, cw:1, ch:1, obj:null}; }
decals.push(newDecal());
const serializeDecal=d=>({ meshIdx:d.mesh?meshList().indexOf(d.mesh):-1,
  p:d.localPoint?.toArray()||null, n:d.localNormal?.toArray()||null,
  sz:d.sz, rot:d.rot, du:d.du, dv:d.dv, cx:d.cx, cy:d.cy, cw:d.cw, ch:d.ch });
function removeObj(d){ if(d.obj){ d.obj.removeFromParent(); d.obj.geometry.dispose(); d.obj=null; } }
function clearAllDecals(){ for(const d of decals){ removeObj(d); d.mesh=null; d.localPoint=null; } }

// 表面局部坐标系(世界):锚点(含切向偏移)、法线、切向、副切向。gumball 与投影共用。
function decalFrame(d){
  carGroup.updateMatrixWorld(true);
  const toWorld=carGroup.matrixWorld;
  const nrmMat=new THREE.Matrix3().getNormalMatrix(toWorld);
  const point=d.localPoint.clone().applyMatrix4(toWorld);
  const n=d.localNormal.clone().applyMatrix3(nrmMat).normalize();
  const upRef=Math.abs(n.y)>0.94? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
  const tan=new THREE.Vector3().crossVectors(upRef,n).normalize();
  const bit=new THREE.Vector3().crossVectors(n,tan).normalize();
  point.add(tan.clone().multiplyScalar(d.du)).add(bit.clone().multiplyScalar(d.dv));
  return {point,n,tan,bit,toWorld};
}

function projectDecal(d){
  if(!d.mesh||!d.localPoint) return;
  removeObj(d);
  const {point,n,bit,toWorld}=decalFrame(d);
  // 贴片纵横比 = 分区实际像素比,分区怎么切贴片就怎么长
  const w=d.sz, h=d.sz*(TEXH*d.ch)/(TEXW*d.cw);
  const helper=new THREE.Object3D();
  helper.position.copy(point);
  helper.lookAt(point.clone().add(n));
  helper.rotateZ(d.rot*Math.PI/180);
  const geo=new DecalGeometry(d.mesh, point, helper.rotation, new THREE.Vector3(w,h,w*0.7));
  // uv 窗口(双轴):本面只显示动画画面的分区矩形(flipY:v=1 对应画布顶部)
  const uv=geo.attributes.uv;
  for(let i=0;i<uv.count;i++){
    uv.setX(i, d.cx + uv.getX(i)*d.cw);
    uv.setY(i, (1-d.cy-d.ch) + uv.getY(i)*d.ch);
  }
  uv.needsUpdate=true;
  const obj=new THREE.Mesh(geo, screenMat);
  obj.renderOrder=1; obj.userData.isDecal=true;
  obj.applyMatrix4(toWorld.clone().invert());
  carGroup.add(obj);
  d.obj=obj;
}

function placeDecalAt(hit){
  const d=decals[activeDecal];
  d.mesh=hit.object;
  const toLocal=carGroup.matrixWorld.clone().invert();
  d.localPoint=hit.point.clone().applyMatrix4(toLocal);
  const wn=hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
  d.localNormal=wn.applyMatrix3(new THREE.Matrix3().getNormalMatrix(toLocal)).normalize();
  d.du=0; d.dv=0;
  projectDecal(d);
  selected=true; syncPanel(); saveViewState();
  hint(`✓ 投影面 ${activeDecal+1} 已放置 — 🖱选择工具拖操纵球微调`);
}

/* ══════════════ 视图撤销(Ctrl+Z)══════════════ */
const viewUndoStack=[];
function viewSnapshot(){ return { decals:decals.map(serializeDecal), active:activeDecal,
  mask:maskCanvas.toDataURL('image/png'), carColors:carColors.map(c=>({...c})) }; }
function pushViewUndo(){ viewUndoStack.push(viewSnapshot());
  if(viewUndoStack.length>30) viewUndoStack.shift(); }
async function restoreView(s){
  for(const d of decals) removeObj(d);
  decals.length=0;
  for(const sd of s.decals){
    const d=newDecal();
    Object.assign(d,{sz:sd.sz,rot:sd.rot,du:sd.du,dv:sd.dv,cx:sd.cx,cy:sd.cy,cw:sd.cw,ch:sd.ch});
    const m=meshList()[sd.meshIdx];
    if(m&&sd.p&&sd.n){ d.mesh=m;
      d.localPoint=new THREE.Vector3().fromArray(sd.p);
      d.localNormal=new THREE.Vector3().fromArray(sd.n); }
    decals.push(d);
  }
  if(!decals.length) decals.push(newDecal());
  activeDecal=Math.min(s.active,decals.length-1);
  await new Promise(res=>{ const img=new Image();
    img.onload=()=>{ maskCtx.clearRect(0,0,TEXW,TEXH); maskCtx.drawImage(img,0,0);
      maskTex.needsUpdate=true; res(); };
    img.onerror=res; img.src=s.mask; });
  for(const [mesh,mat] of origMats) mesh.material=mat; // 车色还原再重放
  origMats.clear(); carColors.length=0;
  for(const c of s.carColors) applyCarColor(c.meshIdx, c.hex, false);
  for(const d of decals) projectDecal(d);
  syncPanel();
}
async function undoView(){
  const s=viewUndoStack.pop();
  if(!s){ hint('没有可撤销的 3D 操作'); return; }
  await restoreView(s); saveViewState(); hint('↩ 已撤销');
}

/* ══════════════ 车身上色(动画背景色 → 车漆)══════════════ */
const origMats=new Map(); const carColors=[];
function applyCarColor(meshIdx, hex, record=true){
  const mesh=meshList()[meshIdx]; if(!mesh) return;
  if(!origMats.has(mesh)) origMats.set(mesh, mesh.material);
  const m=(Array.isArray(mesh.material)?mesh.material[0]:mesh.material).clone();
  m.color=new THREE.Color(hex);
  mesh.material=m;
  if(record){ const ex=carColors.find(c=>c.meshIdx===meshIdx);
    if(ex) ex.hex=hex; else carColors.push({meshIdx,hex}); }
}

/* ══════════════ Gumball 操纵球 ══════════════ */
const gumball=new THREE.Group(); gumball.visible=false; scene.add(gumball);
{
  const mat=c=>new THREE.MeshBasicMaterial({color:c, depthTest:false, transparent:true, opacity:0.92});
  const mkArrow=(color,axis)=>{
    const grp=new THREE.Group();
    const shaft=new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,0.42,10), mat(color));
    shaft.position.y=0.21;
    const head=new THREE.Mesh(new THREE.ConeGeometry(0.055,0.14,12), mat(color));
    head.position.y=0.48;
    grp.add(shaft,head);
    grp.traverse(o=>{ o.userData.gizmo=axis; o.renderOrder=999; });
    return grp;
  };
  const aU=mkArrow(0xff6666,'u'); aU.rotation.z=-Math.PI/2; gumball.add(aU);   // +X = 切向
  const aV=mkArrow(0x66ff88,'v'); gumball.add(aV);                              // +Y = 副切向
  const ring=new THREE.Mesh(new THREE.TorusGeometry(0.34,0.016,8,48), mat(0x66aaff));
  ring.userData.gizmo='rot'; ring.renderOrder=999; gumball.add(ring);           // XY 面 = 绕法线
  const cube=new THREE.Mesh(new THREE.BoxGeometry(0.09,0.09,0.09), mat(0xffd479));
  cube.userData.gizmo='scale'; cube.renderOrder=999; gumball.add(cube);
}
function updateGumball(){
  const d=decals[activeDecal];
  if(!selected||!d?.obj){ gumball.visible=false; return; }
  const {point,n,tan,bit}=decalFrame(d);
  gumball.position.copy(point.clone().add(n.clone().multiplyScalar(0.05)));
  const m=new THREE.Matrix4().makeBasis(tan,bit,n);
  gumball.quaternion.setFromRotationMatrix(m);
  gumball.scale.setScalar(camera.position.distanceTo(point)*0.16);
  gumball.visible=true;
}
const toScreen=v=>{ const p=v.clone().project(camera);
  return {x:(p.x+1)/2*innerWidth, y:(1-p.y)/2*innerHeight}; };

/* ══════════════ 工具模式 ══════════════ */
let mode='sel';
const MODE_BTN={sel:'tSel',place:'tPlace',brush:'tBrush',erase:'tErase',paint:'tPaint'};
function setMode3(m){ mode=m;
  for(const [k,id] of Object.entries(MODE_BTN)) $(id).classList.toggle('on',k===m);
  controls.enabled=(m!=='brush'&&m!=='erase');
  hint({sel:'🖱 点投影面选中出现操纵球;拖箭头移动/圆环旋转/方块缩放;双击车身重新放置',
        place:'📍 点击车身,放置当前投影面',
        brush:'🖌 拖动把被擦掉的区域涂回来(粗细/羽化在右侧)',
        erase:'🧽 拖动擦除不想显示动画的区域',
        paint:'🎨 点击车身部件,涂成动画背景色'}[m]);
}
for(const [k,id] of Object.entries(MODE_BTN)) $(id).onclick=()=>setMode3(k);

/* ══════════════ 笔刷(软边 + 连续描边)══════════════ */
let lastStamp=null;
function stampBrush(x,y,white){
  const R=+$('eraSl').value, feather=+$('featherSl').value;
  const inner=Math.max(0.5, R*(1-feather));
  const grad=maskCtx.createRadialGradient(x,y,inner,x,y,R);
  const col=white?'255,255,255':'0,0,0';
  grad.addColorStop(0,`rgba(${col},1)`);
  grad.addColorStop(1,`rgba(${col},0)`);
  maskCtx.fillStyle=grad;
  maskCtx.beginPath(); maskCtx.arc(x,y,R,0,7); maskCtx.fill();
}
function strokeTo(x,y,white){
  // 沿运动轨迹按 0.35R 步进补章 —— 消除快速拖动时的扇贝状锯齿边
  const R=+$('eraSl').value, step=Math.max(2,R*0.35);
  if(lastStamp){
    const dx=x-lastStamp.x, dy=y-lastStamp.y, dist=Math.hypot(dx,dy);
    for(let t=step;t<dist;t+=step) stampBrush(lastStamp.x+dx*t/dist, lastStamp.y+dy*t/dist, white);
  }
  stampBrush(x,y,white);
  lastStamp={x,y};
  maskTex.needsUpdate=true;
}
$('eraSl').addEventListener('input',e=>{ $('eraV').textContent=e.target.value; });
$('featherSl').addEventListener('input',e=>{ $('featherV').textContent=(+e.target.value).toFixed(2); });
$('clearErase').onclick=()=>{ pushViewUndo();
  maskCtx.fillStyle='#fff'; maskCtx.fillRect(0,0,TEXW,TEXH);
  maskTex.needsUpdate=true; saveViewState(); hint('↺ 已恢复全部被擦区域'); };

/* ══════════════ 指针交互 ══════════════ */
const ray=new THREE.Raycaster(), ptr=new THREE.Vector2();
function rayFromEvent(e){
  ptr.x=(e.clientX/innerWidth)*2-1; ptr.y=-(e.clientY/innerHeight)*2+1;
  camera.updateMatrixWorld(); carGroup.updateMatrixWorld(true);
  ray.setFromCamera(ptr,camera);
}
function brushHitUV(e){
  rayFromEvent(e);
  const objs=decals.filter(d=>d.obj).map(d=>d.obj);
  const hit=ray.intersectObjects(objs,false)[0];
  return hit?.uv||null;
}
let downAt=null, painting=false, gizmoDrag=null, projThrottle=0;
renderer.domElement.addEventListener('pointerdown',e=>{
  downAt=[e.clientX,e.clientY];
  if(mode==='brush'||mode==='erase'){
    pushViewUndo(); painting=true; lastStamp=null;
    const uv=brushHitUV(e); if(uv) strokeTo(uv.x*TEXW,(1-uv.y)*TEXH, mode==='brush');
    return;
  }
  if(mode==='sel'&&selected&&gumball.visible){
    rayFromEvent(e);
    const gHit=ray.intersectObject(gumball,true)[0];
    if(gHit?.object.userData.gizmo){
      const d=decals[activeDecal], {point,tan,bit}=decalFrame(d);
      const sp=toScreen(point);
      const uPx=toScreen(point.clone().add(tan.clone().multiplyScalar(0.5)));
      const vPx=toScreen(point.clone().add(bit.clone().multiplyScalar(0.5)));
      pushViewUndo();
      gizmoDrag={ type:gHit.object.userData.gizmo,
        sx:e.clientX, sy:e.clientY, cx:sp.x, cy:sp.y,
        du0:d.du, dv0:d.dv, rot0:d.rot, sz0:d.sz,
        uDir:{x:uPx.x-sp.x, y:uPx.y-sp.y}, vDir:{x:vPx.x-sp.x, y:vPx.y-sp.y},
        a0:Math.atan2(e.clientY-sp.y, e.clientX-sp.x) };
      controls.enabled=false;
    }
  }
});
renderer.domElement.addEventListener('pointermove',e=>{
  if(painting){ const uv=brushHitUV(e); if(uv) strokeTo(uv.x*TEXW,(1-uv.y)*TEXH, mode==='brush'); return; }
  if(gizmoDrag){
    const d=decals[activeDecal], gd=gizmoDrag;
    const dx=e.clientX-gd.sx, dy=e.clientY-gd.sy;
    if(gd.type==='u'||gd.type==='v'){
      const dir=gd.type==='u'?gd.uDir:gd.vDir;
      const len2=dir.x*dir.x+dir.y*dir.y;
      const worldDelta=len2>1e-6 ? (dx*dir.x+dy*dir.y)/len2*0.5 : 0; // dir 对应 0.5 世界单位
      if(gd.type==='u') d.du=gd.du0+worldDelta; else d.dv=gd.dv0+worldDelta;
    } else if(gd.type==='rot'){
      const a1=Math.atan2(e.clientY-gd.cy, e.clientX-gd.cx);
      d.rot=Math.round(gd.rot0 - (a1-gd.a0)*180/Math.PI);
      if(d.rot>180)d.rot-=360; if(d.rot<-180)d.rot+=360;
    } else if(gd.type==='scale'){
      d.sz=Math.min(3,Math.max(0.3, gd.sz0*(1-(dy)*0.005)));
    }
    const now=performance.now();
    if(now-projThrottle>90){ projThrottle=now; projectDecal(d); } // 大网格贴花重建有成本,拖动中限频
    syncSliders();
  }
});
addEventListener('pointerup',e=>{
  if(painting){ painting=false; lastStamp=null; saveViewState(); return; }
  if(gizmoDrag){ projectDecal(decals[activeDecal]); gizmoDrag=null;
    controls.enabled=true; saveViewState(); return; }
  if(!downAt || Math.hypot(e.clientX-downAt[0], e.clientY-downAt[1])>5) return;
  if(e.target!==renderer.domElement) return;
  rayFromEvent(e);
  if(mode==='place'){
    const hit=ray.intersectObject(carGroup,true).find(h=>h.object.isMesh && !h.object.userData.isDecal && h.face);
    if(hit){ pushViewUndo(); placeDecalAt(hit); setMode3('sel'); }
    return;
  }
  if(mode==='paint'){
    const hit=ray.intersectObject(carGroup,true).find(h=>h.object.isMesh && !h.object.userData.isDecal);
    if(hit){ pushViewUndo();
      applyCarColor(meshList().indexOf(hit.object), P.colBg);
      saveViewState(); hint(`🎨 「${hit.object.name||'部件'}」已涂成动画背景色 ${P.colBg}`); }
    return;
  }
  if(mode==='sel'){
    // 点投影面 = 选中;点空白/车身 = 取消选中(移动只走操纵球,杜绝误拖)
    const dHit=ray.intersectObjects(decals.filter(d=>d.obj).map(d=>d.obj),false)[0];
    if(dHit){ activeDecal=decals.findIndex(d=>d.obj===dHit.object); selected=true; syncPanel(); }
    else { selected=false; syncPanel(); }
  }
});
renderer.domElement.addEventListener('dblclick',e=>{
  if(mode!=='sel') return;
  rayFromEvent(e);
  const hit=ray.intersectObject(carGroup,true).find(h=>h.object.isMesh && !h.object.userData.isDecal && h.face);
  if(hit){ pushViewUndo(); placeDecalAt(hit); }
});

/* ══════════════ 快捷键 ══════════════ */
addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT') return;
  const k=e.key.toLowerCase();
  if((e.ctrlKey||e.metaKey)&&k==='z'){ undoView(); e.preventDefault(); return; }
  if(k==='q')setMode3('sel'); else if(k==='w')setMode3('place');
  else if(k==='b')setMode3('brush'); else if(k==='e')setMode3('erase');
  else if(k==='c')setMode3('paint');
  else if(e.key==='Delete'||e.key==='Backspace'){ delActiveDecal(); e.preventDefault(); }
  else if(e.key==='Escape'){ selected=false; syncPanel(); }
});

/* ══════════════ 右面板:图层列表 + 属性 + 分区切割器 ══════════════ */
function syncSliders(){
  const d=decals[activeDecal];
  $('szSl').value=d.sz; $('szV').textContent=d.sz.toFixed(2);
  $('rotSl').value=d.rot; $('rotV').textContent=d.rot+'°';
  $('uSl').value=d.du; $('uV').textContent=d.du.toFixed(2);
  $('vSl').value=d.dv; $('vV').textContent=d.dv.toFixed(2);
}
function syncPanel(){
  syncSliders();
  const list=$('decList'); list.innerHTML='';
  decals.forEach((d,i)=>{
    const row=document.createElement('div');
    row.className='lay'+(i===activeDecal?' on':'');
    row.innerHTML=`<span class="sw" style="background:${DEC_COLORS[i%DEC_COLORS.length]}"></span>
      <span class="nm">投影面 ${i+1}</span><span class="st">${d.obj?'已放置':'未放置'}</span>`;
    row.onclick=()=>{ activeDecal=i; selected=!!d.obj; syncPanel(); };
    list.appendChild(row);
  });
}
$('addDec').onclick=()=>{ pushViewUndo(); decals.push(newDecal()); activeDecal=decals.length-1;
  selected=false; syncPanel(); setMode3('place'); saveViewState(); };
function delActiveDecal(){
  if(decals.length<=1){ hint('至少保留一块投影面'); return; }
  pushViewUndo();
  removeObj(decals[activeDecal]); decals.splice(activeDecal,1);
  activeDecal=Math.min(activeDecal,decals.length-1);
  syncPanel(); saveViewState();
}
$('delDec').onclick=delActiveDecal;
const sliderKeys={szSl:'sz',rotSl:'rot',uSl:'du',vSl:'dv'};
for(const [id,keyName] of Object.entries(sliderKeys)){
  $(id).addEventListener('pointerdown',pushViewUndo);
  $(id).addEventListener('input',e=>{ const d=decals[activeDecal];
    d[keyName]=+e.target.value; syncSliders(); projectDecal(d); });
  $(id).addEventListener('change',saveViewState);
}

/* ── 分区切割器:动画缩略图上拖矩形,把画面切给各投影面 ── */
const cutCv=$('cutCv'), cutCtx=cutCv.getContext('2d');
const CUTW=cutCv.width, CUTH=cutCv.height;
let cutDrag=null;
function drawCut(){
  cutCtx.drawImage(texCanvas,0,0,CUTW,CUTH);
  decals.forEach((d,i)=>{
    const x=d.cx*CUTW, y=d.cy*CUTH, w=d.cw*CUTW, h=d.ch*CUTH;
    cutCtx.strokeStyle=DEC_COLORS[i%DEC_COLORS.length];
    cutCtx.lineWidth=i===activeDecal?2:1;
    cutCtx.setLineDash(i===activeDecal?[]:[4,3]);
    cutCtx.strokeRect(x+0.5,y+0.5,w-1,h-1);
    cutCtx.setLineDash([]);
    if(i===activeDecal){ cutCtx.fillStyle=DEC_COLORS[i%DEC_COLORS.length];
      cutCtx.fillRect(x+w-7,y+h-7,7,7); } // 右下角缩放柄
    cutCtx.font='10px system-ui'; cutCtx.fillStyle=DEC_COLORS[i%DEC_COLORS.length];
    cutCtx.fillText(String(i+1), x+4, y+12);
  });
}
cutCv.addEventListener('pointerdown',e=>{
  const r=cutCv.getBoundingClientRect();
  const mx=(e.clientX-r.left)/r.width*CUTW, my=(e.clientY-r.top)/r.height*CUTH;
  // 优先当前面的缩放柄,再命中任意面矩形(选中之)
  const a=decals[activeDecal];
  const ax=a.cx*CUTW, ay=a.cy*CUTH, aw=a.cw*CUTW, ah=a.ch*CUTH;
  if(Math.abs(mx-(ax+aw))<9 && Math.abs(my-(ay+ah))<9){
    pushViewUndo(); cutDrag={type:'resize'}; cutCv.setPointerCapture(e.pointerId); return;
  }
  for(let i=decals.length-1;i>=0;i--){
    const d=decals[i], x=d.cx*CUTW, y=d.cy*CUTH, w=d.cw*CUTW, h=d.ch*CUTH;
    if(mx>=x&&mx<=x+w&&my>=y&&my<=y+h){
      activeDecal=i; selected=!!d.obj; syncPanel();
      pushViewUndo();
      cutDrag={type:'move', offX:mx-x, offY:my-y};
      cutCv.setPointerCapture(e.pointerId); return;
    }
  }
});
cutCv.addEventListener('pointermove',e=>{
  if(!cutDrag) return;
  const r=cutCv.getBoundingClientRect();
  const mx=(e.clientX-r.left)/r.width*CUTW, my=(e.clientY-r.top)/r.height*CUTH;
  const d=decals[activeDecal];
  if(cutDrag.type==='move'){
    d.cx=Math.min(Math.max(0,(mx-cutDrag.offX)/CUTW), 1-d.cw);
    d.cy=Math.min(Math.max(0,(my-cutDrag.offY)/CUTH), 1-d.ch);
  } else {
    d.cw=Math.min(Math.max(0.05, mx/CUTW-d.cx), 1-d.cx);
    d.ch=Math.min(Math.max(0.05, my/CUTH-d.cy), 1-d.cy);
  }
  const now=performance.now();
  if(now-projThrottle>90){ projThrottle=now; projectDecal(d); }
});
cutCv.addEventListener('pointerup',()=>{ if(cutDrag){ projectDecal(decals[activeDecal]);
  cutDrag=null; saveViewState(); } });

/* ══════════════ 视图设置 / Bloom(OutputPass 修黑屏)══════════════ */
const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight), 0.55, 0.4, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());
$('bloomCk').onchange=e=>{ bloom.enabled=e.target.checked; saveViewState(); };
$('spinCk').addEventListener('change',saveViewState);
$('expSl').addEventListener('input',e=>{ renderer.toneMappingExposure=+e.target.value;
  $('expV').textContent=(+e.target.value).toFixed(2); saveViewState(); });
addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight); composer.setSize(innerWidth,innerHeight);
});

/* ══════════════ 文件 / 持久化 ══════════════ */
function saveViewState(){
  try{ localStorage.setItem('morph3d-view', JSON.stringify({
    exp:+$('expSl').value, bloom:$('bloomCk').checked, spin:$('spinCk').checked,
    active:activeDecal, decals:decals.map(serializeDecal),
    carColors:carColors.map(c=>({...c})),
    mask:maskCanvas.toDataURL('image/png'),
  })); }catch(_){}
}
$('loadProj').onclick=()=>$('projFile').click();
$('projFile').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>loadProjectData(JSON.parse(rd.result))
    .then(()=>{ try{ localStorage.setItem('morph3d-project', rd.result); }catch(_){} })
    .catch(err=>hint('⚠ '+err.message));
  rd.readAsText(f); e.target.value='';
});
$('loadModel').onclick=()=>$('modelFile').click();
$('modelFile').addEventListener('change',e=>{
  const f=e.target.files[0]; if(f) loadModelBlob(f, true); e.target.value='';
});
$('expGlb').onclick=()=>{
  new GLTFExporter().parse(carGroup, gltf=>{
    downloadBlob(new Blob([gltf],{type:'model/gltf-binary'}), 'morph-car-decals.glb');
    hint('✓ 已导出 .glb — Blender:导入后选投影面网格,材质贴图换成 ⑤导出 的 PNG 序列(Image Sequence)接 Emission');
  }, err=>hint('⚠ 导出失败:'+err.message), {binary:true});
};

(async()=>{
  try{
    const stored=localStorage.getItem('morph3d-project');
    if(stored) await loadProjectData(JSON.parse(stored)).catch(err=>hint('⚠ '+err.message));
  }catch(_){}
  let vs=null;
  try{ vs=JSON.parse(localStorage.getItem('morph3d-view')||'null'); }catch(_){}
  if(vs){
    $('expSl').value=vs.exp; $('expV').textContent=(+vs.exp).toFixed(2);
    renderer.toneMappingExposure=vs.exp;
    $('bloomCk').checked=vs.bloom; bloom.enabled=vs.bloom;
    $('spinCk').checked=vs.spin;
  }
  const blob=await idbGet('model').catch(()=>null);
  if(blob) await loadModelBlob(blob, false);
  if(vs) await restoreView({decals:vs.decals||[], active:vs.active||0,
    mask:vs.mask||maskCanvas.toDataURL(), carColors:vs.carColors||[]});
  selected=false; syncPanel();
  if(vs?.decals?.some(d=>d.p)) hint('✓ 已恢复上次的模型与投影布局');
})();

/* ══════════════ 主循环 ══════════════ */
let frames=0;
function frame(now){
  const dt=(now-last)/1000; last=now; clock+=dt;
  if(SEQ){
    g+=dt; if(g>=SEQ.T) g-=SEQ.T;
    const fr=sampleFrame(SEQ, states, g, clock, P);
    renderTex(fr.balls, fr.col, P);
    screenTex.needsUpdate=true;
  }
  if($('spinCk').checked && !gizmoDrag && !painting) carGroup.rotation.y+=dt*0.12;
  updateGumball();
  drawCut();
  controls.update();
  composer.render();
  frames++;
}
function tick(now){ frame(now); requestAnimationFrame(tick); }
requestAnimationFrame(tick);

// 调试探针(隐藏标签页 rAF 不触发,自动化验证靠 step 驱动)。
window.__morph3d={
  status:()=>({ g:+g.toFixed(2), T:SEQ?+SEQ.T.toFixed(1):null,
    states:states?states.length:0, frames, decals:decals.filter(d=>d.obj).length,
    active:activeDecal, mode, selected, undoDepth:viewUndoStack.length }),
  step:(ms=33)=>{ frame(last+ms); },
  place:(nx,ny)=>{ camera.updateMatrixWorld(); carGroup.updateMatrixWorld(true);
    ray.setFromCamera(new THREE.Vector2(nx,ny),camera);
    const hit=ray.intersectObject(carGroup,true).find(h=>h.object.isMesh && !h.object.userData.isDecal && h.face);
    if(hit){ pushViewUndo(); placeDecalAt(hit); } return !!hit; },
  setMode:setMode3, undo:undoView,
  loadProject:data=>loadProjectData(data),
  texLit:()=>{ const d=texCtx.getImageData(0,0,TEXW,TEXH).data; let n=0;
    for(let i=0;i<d.length;i+=16) if(d[i]>30||d[i+1]>30||d[i+2]>30) n++; return n; },
};
