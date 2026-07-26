// 3D 车模预览器 · Rhino 式交互 + 动画组(节点):
//   同一动画组内的投影面天然"连接"—— 共享一张实时动画纹理与时间线,各自用取景框
//   截取画面分区(🔗横向均分 一键切成相邻区段,球即可跨面连续跑动)。
//   ➕新动画 载入第二个工程 .json 成为节点 2,与节点 1 并行播放(全局时钟同步起跑,
//   各按自身时长循环)。笔刷/橡皮蒙版、背景色、参数均按组隔离。
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
import { W, H, P as P_DEFAULT } from '../config.js';
import { buildSequence, sampleFrame } from '../engine.js';
import { createSizedRenderer } from '../render.js';
import { paintShapes, maskReaderFor, lumReaderFor, sampleDots } from '../pipeline.js';
import { decodeImageShape } from '../image.js';
import { downloadBlob } from '../utils.js';

const $=id=>document.getElementById(id);
const hint=msg=>{ $('hint').textContent=msg; };
const DEC_COLORS=['#98f5d0','#7ab4ff','#ffd479','#ff9a9a','#d59aff','#9affe2'];
const GRP_COLORS=['#98f5d0','#ffb347','#7ab4ff','#ff9a9a'];

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
async function idbDel(key){ const db=await idbOpen(); return new Promise((res,rej)=>{
  const tx=db.transaction('files','readwrite'); tx.objectStore('files').delete(key);
  tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }

/* ══════════════ 动画组 ══════════════ */
const TEXW=960, TEXH=560;
function makeGroup(name){
  const texCanvas=document.createElement('canvas'); texCanvas.width=TEXW; texCanvas.height=TEXH;
  const texCtx=texCanvas.getContext('2d');
  texCtx.fillStyle='#0a0a0a'; texCtx.fillRect(0,0,TEXW,TEXH);
  texCtx.fillStyle='#98f5d0'; texCtx.font='30px system-ui'; texCtx.textAlign='center';
  texCtx.fillText('等待工程…', TEXW/2, TEXH/2);
  const screenTex=new THREE.CanvasTexture(texCanvas);
  screenTex.colorSpace=THREE.SRGBColorSpace;
  const maskCanvas=document.createElement('canvas'); maskCanvas.width=TEXW; maskCanvas.height=TEXH;
  const maskCtx=maskCanvas.getContext('2d');
  maskCtx.fillStyle='#fff'; maskCtx.fillRect(0,0,TEXW,TEXH);
  const maskTex=new THREE.CanvasTexture(maskCanvas);
  const mat=new THREE.MeshBasicMaterial({map:screenTex, alphaMap:maskTex, toneMapped:false,
    transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4});
  return {name, states:null, SEQ:null, P:{...P_DEFAULT},
    texCanvas, texCtx, renderTex:createSizedRenderer(texCtx,TEXW,TEXH),
    screenTex, maskCanvas, maskCtx, maskTex, mat};
}
const groups=[makeGroup('动画 1')];
let activeGroup=0;

async function loadProjectData(data, gi=0){
  const gr=groups[gi];
  gr.P={...P_DEFAULT, ...(data.params||{})}; // 每组用自己工程的参数,互不串味
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
      dots:sampleDots(maskReaderFor(mctx), d.manual||[], gr.P, lumReaderFor(mctx))});
  }
  gr.states=out; gr.SEQ=buildSequence(out, true, gr.P);
  hint(`✓ 「${gr.name}」已载入:${out.length} 个状态 · 循环 ${gr.SEQ.T.toFixed(1)}s`);
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
// Fusion 式导航:按住鼠标中键拖动 = 平移视角(右键同效,左键旋转,滚轮缩放)
controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE, MIDDLE:THREE.MOUSE.PAN, RIGHT:THREE.MOUSE.PAN};

const pmrem=new THREE.PMREMGenerator(renderer);
scene.environment=pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0x99aabb, 0x151515, 0.5));
const key=new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(4,7,3); scene.add(key);
const fill=new THREE.DirectionalLight(0x8899ff, 0.4); fill.position.set(-5,3,-4); scene.add(fill);
const ground=new THREE.Mesh(new THREE.CircleGeometry(26,48),
  new THREE.MeshStandardMaterial({color:0x101114, roughness:0.85, metalness:0.15}));
ground.rotation.x=-Math.PI/2; scene.add(ground);

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

/* ══════════════ 投影面 ══════════════ */
const decals=[]; let activeDecal=0, selected=false;
function newDecal(gi=activeGroup){ return {group:gi, mesh:null, localPoint:null, localNormal:null,
  sz:1.2, rot:0, du:0, dv:0, cx:0, cy:0, cw:1, ch:1, obj:null}; }
decals.push(newDecal(0));
const serializeDecal=d=>({ group:d.group, meshIdx:d.mesh?meshList().indexOf(d.mesh):-1,
  p:d.localPoint?.toArray()||null, n:d.localNormal?.toArray()||null,
  sz:d.sz, rot:d.rot, du:d.du, dv:d.dv, cx:d.cx, cy:d.cy, cw:d.cw, ch:d.ch });
function removeObj(d){ if(d.obj){ d.obj.removeFromParent(); d.obj.geometry.dispose(); d.obj=null; } }
function clearAllDecals(){ for(const d of decals){ removeObj(d); d.mesh=null; d.localPoint=null; } }

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
  const {point,n,toWorld}=decalFrame(d);
  const w=d.sz, h=d.sz*(TEXH*d.ch)/(TEXW*d.cw);
  const helper=new THREE.Object3D();
  helper.position.copy(point);
  helper.lookAt(point.clone().add(n));
  helper.rotateZ(d.rot*Math.PI/180);
  const geo=new DecalGeometry(d.mesh, point, helper.rotation, new THREE.Vector3(w,h,w*0.7));
  const uv=geo.attributes.uv;
  for(let i=0;i<uv.count;i++){
    uv.setX(i, d.cx + uv.getX(i)*d.cw);
    uv.setY(i, (1-d.cy-d.ch) + uv.getY(i)*d.ch);
  }
  uv.needsUpdate=true;
  const obj=new THREE.Mesh(geo, groups[d.group].mat);
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
  selected=true; activeGroup=d.group; syncPanel(); saveViewState();
  hint(`✓ 投影面已放置(${groups[d.group].name})— 🖱选择工具拖操纵球微调`);
}

/* ══════════════ 视图撤销 ══════════════ */
const viewUndoStack=[];
function viewSnapshot(){ return { decals:decals.map(serializeDecal), active:activeDecal,
  masks:groups.map(gr=>gr.maskCanvas.toDataURL('image/png')),
  carColors:carColors.map(c=>({...c})) }; }
function pushViewUndo(){ viewUndoStack.push(viewSnapshot());
  if(viewUndoStack.length>30) viewUndoStack.shift(); }
async function restoreView(s){
  for(const d of decals) removeObj(d);
  decals.length=0;
  for(const sd of s.decals){
    const d=newDecal(Math.min(sd.group||0, groups.length-1));
    Object.assign(d,{sz:sd.sz,rot:sd.rot,du:sd.du,dv:sd.dv,cx:sd.cx,cy:sd.cy,cw:sd.cw,ch:sd.ch});
    const m=meshList()[sd.meshIdx];
    if(m&&sd.p&&sd.n){ d.mesh=m;
      d.localPoint=new THREE.Vector3().fromArray(sd.p);
      d.localNormal=new THREE.Vector3().fromArray(sd.n); }
    decals.push(d);
  }
  if(!decals.length) decals.push(newDecal(0));
  activeDecal=Math.min(s.active,decals.length-1);
  await Promise.all((s.masks||[]).map((murl,i)=>new Promise(res=>{
    if(!groups[i]||!murl) return res();
    const img=new Image();
    img.onload=()=>{ groups[i].maskCtx.clearRect(0,0,TEXW,TEXH);
      groups[i].maskCtx.drawImage(img,0,0); groups[i].maskTex.needsUpdate=true; res(); };
    img.onerror=res; img.src=murl; })));
  for(const [mesh,mat] of origMats) mesh.material=mat;
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

/* ══════════════ Gumball ══════════════ */
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
  const aU=mkArrow(0xff6666,'u'); aU.rotation.z=-Math.PI/2; gumball.add(aU);
  const aV=mkArrow(0x66ff88,'v'); gumball.add(aV);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(0.34,0.016,8,48), mat(0x66aaff));
  ring.userData.gizmo='rot'; ring.renderOrder=999; gumball.add(ring);
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
  hint({sel:'🖱 点投影面选中出现操纵球;箭头移动/圆环旋转/方块缩放;双击车身重新放置',
        place:'📍 点击车身,放置当前投影面(加入当前动画组)',
        brush:'🖌 拖动把被擦掉的区域涂回来',
        erase:'🧽 拖动擦除不想显示动画的区域',
        paint:'🎨 点击车身部件,涂成当前动画组的背景色'}[m]);
}
for(const [k,id] of Object.entries(MODE_BTN)) $(id).onclick=()=>setMode3(k);

/* ══════════════ 笔刷(按组隔离蒙版)══════════════ */
let lastStamp=null;
function stampBrush(gr,x,y,white){
  const R=+$('eraSl').value, feather=+$('featherSl').value;
  const inner=Math.max(0.5, R*(1-feather));
  const grad=gr.maskCtx.createRadialGradient(x,y,inner,x,y,R);
  const col=white?'255,255,255':'0,0,0';
  grad.addColorStop(0,`rgba(${col},1)`);
  grad.addColorStop(1,`rgba(${col},0)`);
  gr.maskCtx.fillStyle=grad;
  gr.maskCtx.beginPath(); gr.maskCtx.arc(x,y,R,0,7); gr.maskCtx.fill();
}
function strokeTo(gr,x,y,white){
  const R=+$('eraSl').value, step=Math.max(2,R*0.35);
  if(lastStamp&&lastStamp.gr===gr){
    const dx=x-lastStamp.x, dy=y-lastStamp.y, dist=Math.hypot(dx,dy);
    for(let t=step;t<dist;t+=step) stampBrush(gr, lastStamp.x+dx*t/dist, lastStamp.y+dy*t/dist, white);
  }
  stampBrush(gr,x,y,white);
  lastStamp={gr,x,y};
  gr.maskTex.needsUpdate=true;
}
$('eraSl').addEventListener('input',e=>{ $('eraV').textContent=e.target.value; });
$('featherSl').addEventListener('input',e=>{ $('featherV').textContent=(+e.target.value).toFixed(2); });
$('clearErase').onclick=()=>{ pushViewUndo();
  const gr=groups[activeGroup];
  gr.maskCtx.fillStyle='#fff'; gr.maskCtx.fillRect(0,0,TEXW,TEXH);
  gr.maskTex.needsUpdate=true; saveViewState(); hint(`↺ 「${gr.name}」被擦区域已恢复`); };

/* ══════════════ 指针交互 ══════════════ */
const ray=new THREE.Raycaster(), ptr=new THREE.Vector2();
function rayFromEvent(e){
  ptr.x=(e.clientX/innerWidth)*2-1; ptr.y=-(e.clientY/innerHeight)*2+1;
  camera.updateMatrixWorld(); carGroup.updateMatrixWorld(true);
  ray.setFromCamera(ptr,camera);
}
function brushHit(e){
  rayFromEvent(e);
  const objs=decals.filter(d=>d.obj).map(d=>d.obj);
  const hit=ray.intersectObjects(objs,false)[0];
  if(!hit?.uv) return null;
  const d=decals.find(dd=>dd.obj===hit.object);
  return {gr:groups[d.group], uv:hit.uv};
}
let downAt=null, painting=false, gizmoDrag=null, projThrottle=0;
renderer.domElement.addEventListener('pointerdown',e=>{
  downAt=[e.clientX,e.clientY];
  if(mode==='brush'||mode==='erase'){
    pushViewUndo(); painting=true; lastStamp=null;
    const h=brushHit(e); if(h) strokeTo(h.gr, h.uv.x*TEXW,(1-h.uv.y)*TEXH, mode==='brush');
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
  if(painting){ const h=brushHit(e); if(h) strokeTo(h.gr, h.uv.x*TEXW,(1-h.uv.y)*TEXH, mode==='brush'); return; }
  if(gizmoDrag){
    const d=decals[activeDecal], gd=gizmoDrag;
    const dx=e.clientX-gd.sx, dy=e.clientY-gd.sy;
    if(gd.type==='u'||gd.type==='v'){
      const dir=gd.type==='u'?gd.uDir:gd.vDir;
      const len2=dir.x*dir.x+dir.y*dir.y;
      const worldDelta=len2>1e-6 ? (dx*dir.x+dy*dir.y)/len2*0.5 : 0;
      if(gd.type==='u') d.du=gd.du0+worldDelta; else d.dv=gd.dv0+worldDelta;
    } else if(gd.type==='rot'){
      const a1=Math.atan2(e.clientY-gd.cy, e.clientX-gd.cx);
      d.rot=Math.round(gd.rot0 - (a1-gd.a0)*180/Math.PI);
      if(d.rot>180)d.rot-=360; if(d.rot<-180)d.rot+=360;
    } else if(gd.type==='scale'){
      d.sz=Math.min(3,Math.max(0.3, gd.sz0*(1-(dy)*0.005)));
    }
    const now=performance.now();
    if(now-projThrottle>90){ projThrottle=now; projectDecal(d); }
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
      const col=groups[activeGroup].P.colBg||'#0a0a0a';
      applyCarColor(meshList().indexOf(hit.object), col);
      saveViewState(); hint(`🎨 「${hit.object.name||'部件'}」已涂成 ${col}`); }
    return;
  }
  if(mode==='sel'){
    const dHit=ray.intersectObjects(decals.filter(d=>d.obj).map(d=>d.obj),false)[0];
    if(dHit){ activeDecal=decals.findIndex(d=>d.obj===dHit.object);
      activeGroup=decals[activeDecal].group; selected=true; syncPanel(); }
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

/* ══════════════ 面板:动画组节点 + 图层 + 属性 + 分区 ══════════════ */
function syncSliders(){
  const d=decals[activeDecal];
  $('szSl').value=d.sz; $('szV').textContent=d.sz.toFixed(2);
  $('rotSl').value=d.rot; $('rotV').textContent=d.rot+'°';
  $('uSl').value=d.du; $('uV').textContent=d.du.toFixed(2);
  $('vSl').value=d.dv; $('vV').textContent=d.dv.toFixed(2);
}
// 🔗 横向均分:把本组各投影面的取景框按顺序切成相邻等宽区段,并统一像素密度 —— 一键"跨面跑动"
function autoSlice(gi){
  const members=decals.filter(d=>d.group===gi&&d.obj);
  if(members.length<2){ hint('本组需要至少 2 块已放置的投影面才能均分'); return; }
  pushViewUndo();
  const ref=members.includes(decals[activeDecal])?decals[activeDecal]:members[0];
  const k=ref.sz/ref.cw; // 像素密度基准(世界宽/取景宽):切完各面 sz=k·cw,缝两侧内容等大
  members.sort((a,b)=>a.cx-b.cx);
  members.forEach((d,i)=>{ d.cx=i/members.length; d.cw=1/members.length; d.cy=0; d.ch=1;
    d.sz=Math.min(3,Math.max(0.3,k*d.cw)); projectDecal(d); });
  saveViewState(); syncPanel();
  hint(`🔗 「${groups[gi].name}」已均分成 ${members.length} 段并统一密度 — 把面挪到相邻位置即无缝`);
}

// 🧲 衔接:以当前面为基准,组内所有面按各自取景宽等密度换算尺寸,纵向窗口/旋转对齐 ——
// 解决手动衔接时"缝两侧内容大小不一、高度错位"的问题。
function matchSeams(gi){
  const members=decals.filter(d=>d.group===gi&&d.obj);
  if(members.length<2){ hint('本组需要至少 2 块已放置的投影面才能衔接'); return; }
  const ref=members.includes(decals[activeDecal])?decals[activeDecal]:members[0];
  pushViewUndo();
  const k=ref.sz/ref.cw;
  for(const d of members){
    if(d===ref) continue;
    d.sz=Math.min(3,Math.max(0.3,k*d.cw));
    d.cy=ref.cy; d.ch=ref.ch; d.rot=ref.rot;
    projectDecal(d);
  }
  saveViewState(); syncPanel();
  hint(`🧲 已按「投影面 ${decals.indexOf(ref)+1}」对齐组内密度/纵窗/旋转 — 微调位置即可无缝`);
}
function syncPanel(){
  syncSliders();
  const list=$('decList'); list.innerHTML='';
  groups.forEach((gr,gi)=>{
    const head=document.createElement('div');
    head.className='lay'+(gi===activeGroup?' on':'');
    head.style.background='#0d1412';
    head.innerHTML=`<span class="sw" style="background:${GRP_COLORS[gi%GRP_COLORS.length]};border-radius:50%"></span>
      <span class="nm" style="font-weight:600">${gr.name}</span>
      <span class="st">${gr.SEQ?gr.SEQ.T.toFixed(1)+'s':'空'}</span>
      <button data-slice="${gi}" title="把本组各面的取景框切成相邻等宽区段并统一密度,动画跨面连续跑动" style="padding:2px 6px;font-size:11px">🔗均分</button>
      <button data-seam="${gi}" title="以当前面为基准统一组内像素密度/纵向窗口/旋转,消除接缝处大小与高度差" style="padding:2px 6px;font-size:11px">🧲衔接</button>`;
    head.onclick=e=>{ if(e.target.dataset.slice!==undefined||e.target.dataset.seam!==undefined) return;
      activeGroup=gi; syncPanel(); };
    head.querySelector('[data-slice]').onclick=()=>autoSlice(gi);
    head.querySelector('[data-seam]').onclick=()=>matchSeams(gi);
    list.appendChild(head);
    decals.forEach((d,i)=>{
      if(d.group!==gi) return;
      const row=document.createElement('div');
      row.className='lay'+(i===activeDecal?' on':'');
      row.style.marginLeft='14px';
      row.innerHTML=`<span class="sw" style="background:${DEC_COLORS[i%DEC_COLORS.length]}"></span>
        <span class="nm">投影面 ${i+1}</span>
        <span class="st">${d.obj?`${Math.round(d.cx*100)}-${Math.round((d.cx+d.cw)*100)}%`:'未放置'}</span>`;
      row.onclick=()=>{ activeDecal=i; activeGroup=gi; selected=!!d.obj; syncPanel(); };
      list.appendChild(row);
    });
  });
}
$('addDec').onclick=()=>{ pushViewUndo(); decals.push(newDecal(activeGroup)); activeDecal=decals.length-1;
  selected=false; syncPanel(); setMode3('place'); saveViewState(); };
function delActiveDecal(){
  if(decals.length<=1){ hint('至少保留一块投影面'); return; }
  pushViewUndo();
  removeObj(decals[activeDecal]); decals.splice(activeDecal,1);
  activeDecal=Math.min(activeDecal,decals.length-1);
  syncPanel(); saveViewState();
}
$('delDec').onclick=delActiveDecal;
$('addGroup').onclick=()=>$('groupFile').click();
$('groupFile').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=async()=>{
    try{
      const gi=groups.length;
      groups.push(makeGroup(`动画 ${gi+1}`));
      await loadProjectData(JSON.parse(rd.result), gi);
      idbPut(`groupproj-${gi}`, rd.result).catch(()=>{});
      activeGroup=gi; syncPanel(); saveViewState();
      hint(`✓ 「动画 ${gi+1}」节点已建立 — ➕投影面 放它的画面,与动画 1 同时播放`);
    }catch(err){ hint('⚠ '+err.message); }
  };
  rd.readAsText(f); e.target.value='';
});

const sliderKeys={szSl:'sz',rotSl:'rot',uSl:'du',vSl:'dv'};
for(const [id,keyName] of Object.entries(sliderKeys)){
  $(id).addEventListener('pointerdown',pushViewUndo);
  $(id).addEventListener('input',e=>{ const d=decals[activeDecal];
    d[keyName]=+e.target.value; syncSliders(); projectDecal(d); });
  $(id).addEventListener('change',saveViewState);
}

/* ── 分区切割器(显示当前动画组)── */
const cutCv=$('cutCv'), cutCtx=cutCv.getContext('2d');
const CUTW=cutCv.width, CUTH=cutCv.height;
let cutDrag=null;
function drawCut(){
  cutCtx.drawImage(groups[activeGroup].texCanvas,0,0,CUTW,CUTH);
  decals.forEach((d,i)=>{
    if(d.group!==activeGroup) return;
    const x=d.cx*CUTW, y=d.cy*CUTH, w=d.cw*CUTW, h=d.ch*CUTH;
    cutCtx.strokeStyle=DEC_COLORS[i%DEC_COLORS.length];
    cutCtx.lineWidth=i===activeDecal?2:1;
    cutCtx.setLineDash(i===activeDecal?[]:[4,3]);
    cutCtx.strokeRect(x+0.5,y+0.5,w-1,h-1);
    cutCtx.setLineDash([]);
    if(i===activeDecal){ cutCtx.fillStyle=DEC_COLORS[i%DEC_COLORS.length];
      cutCtx.fillRect(x+w-7,y+h-7,7,7); }
    cutCtx.font='10px system-ui'; cutCtx.fillStyle=DEC_COLORS[i%DEC_COLORS.length];
    cutCtx.fillText(String(i+1), x+4, y+12);
  });
}
cutCv.addEventListener('pointerdown',e=>{
  const r=cutCv.getBoundingClientRect();
  const mx=(e.clientX-r.left)/r.width*CUTW, my=(e.clientY-r.top)/r.height*CUTH;
  const a=decals[activeDecal];
  if(a.group===activeGroup){
    const ax=a.cx*CUTW, ay=a.cy*CUTH, aw=a.cw*CUTW, ah=a.ch*CUTH;
    if(Math.abs(mx-(ax+aw))<9 && Math.abs(my-(ay+ah))<9){
      pushViewUndo(); cutDrag={type:'resize'}; cutCv.setPointerCapture(e.pointerId); return;
    }
  }
  for(let i=decals.length-1;i>=0;i--){
    const d=decals[i];
    if(d.group!==activeGroup) continue;
    const x=d.cx*CUTW, y=d.cy*CUTH, w=d.cw*CUTW, h=d.ch*CUTH;
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

/* ══════════════ Bloom / 视图 ══════════════ */
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
    active:activeDecal, activeGroup, groupCount:groups.length,
    decals:decals.map(serializeDecal),
    carColors:carColors.map(c=>({...c})),
    masks:groups.map(gr=>gr.maskCanvas.toDataURL('image/png')),
  })); }catch(_){}
}
$('loadProj').onclick=()=>$('projFile').click();
$('projFile').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>loadProjectData(JSON.parse(rd.result), 0)
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
    hint('✓ 已导出 .glb — Blender:选各投影面网格,贴图换成对应动画的 PNG 序列(Image Sequence)接 Emission');
  }, err=>hint('⚠ 导出失败:'+err.message), {binary:true});
};

/* ── 🗺 同步布局到编辑器(UV 皮肤式工作流):沿每块面的法线正交"烘焙"车身表面快照,
   连同取景框布局写入 localStorage —— 编辑器画布叠加显示,创作时即知哪块画面落在哪个面。── */
function bakePatchSnapshot(d){
  const {point,n,tan,bit}=decalFrame(d);
  const w=d.sz, h=d.sz*(TEXH*d.ch)/(TEXW*d.cw);
  const sw=256, sh=Math.max(32,Math.round(256*h/w));
  const cam=new THREE.OrthographicCamera(-w/2,w/2,h/2,-h/2,0.01,20);
  cam.position.copy(point.clone().add(n.clone().multiplyScalar(3)));
  cam.up.copy(bit.clone().applyAxisAngle(n, d.rot*Math.PI/180)); // 跟随贴片滚转
  cam.lookAt(point);
  cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  const rt=new THREE.WebGLRenderTarget(sw,sh);
  renderer.setRenderTarget(rt);
  renderer.render(scene,cam);
  const buf=new Uint8Array(sw*sh*4);
  renderer.readRenderTargetPixels(rt,0,0,sw,sh,buf);
  renderer.setRenderTarget(null); rt.dispose();
  const c=document.createElement('canvas'); c.width=sw; c.height=sh;
  const id=c.getContext('2d').createImageData(sw,sh);
  for(let y=0;y<sh;y++) id.data.set(buf.subarray((sh-1-y)*sw*4,(sh-y)*sw*4), y*sw*4); // GL 行序上下翻转
  c.getContext('2d').putImageData(id,0,0);
  return c.toDataURL('image/jpeg',0.7);
}
$('bakeBtn').onclick=()=>{
  const placed=decals.filter(d=>d.obj);
  if(!placed.length){ hint('先放置至少一块投影面再同步'); return; }
  const hidden=[gumball,...placed.map(d=>d.obj)];
  hidden.forEach(o=>o.visible=false); // 快照只拍车身表面,不含动画/操纵球
  const patches=placed.map(d=>({ i:decals.indexOf(d), group:d.group,
    groupName:groups[d.group].name,
    cx:d.cx, cy:d.cy, cw:d.cw, ch:d.ch,
    color:DEC_COLORS[decals.indexOf(d)%DEC_COLORS.length],
    name:`投影面 ${decals.indexOf(d)+1}`, meshName:d.mesh?.name||'',
    snap:bakePatchSnapshot(d) }));
  hidden.forEach(o=>o.visible=true);
  try{ localStorage.setItem('morph-uvlayout', JSON.stringify({ts:Date.now(), patches})); }catch(_){}
  hint(`🗺 已同步 ${patches.length} 块面的布局与表面快照 — 编辑器勾选「车面」即可对着画`);
};

/* ── 视图控件(前/后/左/右/顶/透视):相机平滑飞到标准视角,距离保持当前 ── */
let camTween=null;
const VIEW_DIRS={ front:[1,0.12,0], back:[-1,0.12,0], left:[0,0.12,1], right:[0,0.12,-1],
  top:[0.001,1,0], persp:[-0.66,0.31,0.68] };
document.querySelectorAll('#viewcube [data-view]').forEach(btn=>{
  btn.onclick=()=>{
    const dir=new THREE.Vector3(...VIEW_DIRS[btn.dataset.view]).normalize();
    const dist=camera.position.distanceTo(controls.target);
    camTween={ t:0, fromPos:camera.position.clone(),
      toPos:controls.target.clone().add(dir.multiplyScalar(dist)) };
  };
});
function stepCamTween(dt){
  if(!camTween) return;
  camTween.t=Math.min(1, camTween.t+dt*3.2);
  const e=camTween.t*camTween.t*(3-2*camTween.t); // smoothstep
  camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e);
  if(camTween.t>=1) camTween=null;
}

// 双向实时:编辑器每次改动即时存档(morph-autosave),此处监听即刻重载 ——
// 两个窗口并排开,2D 画、3D 秒见(Substance 式)。
addEventListener('storage',e=>{
  if(e.key==='morph-autosave'&&e.newValue){
    try{ loadProjectData(JSON.parse(e.newValue),0)
      .then(()=>hint('🔄 已同步编辑器最新动画')); }catch(_){}
  }
});

(async()=>{
  try{
    const stored=localStorage.getItem('morph3d-project');
    if(stored) await loadProjectData(JSON.parse(stored), 0).catch(err=>hint('⚠ '+err.message));
  }catch(_){}
  let vs=null;
  try{ vs=JSON.parse(localStorage.getItem('morph3d-view')||'null'); }catch(_){}
  if(vs){
    $('expSl').value=vs.exp; $('expV').textContent=(+vs.exp).toFixed(2);
    renderer.toneMappingExposure=vs.exp;
    $('bloomCk').checked=vs.bloom; bloom.enabled=vs.bloom;
    $('spinCk').checked=vs.spin;
    // 额外动画组:从 IDB 取回工程并重建节点
    for(let gi=1; gi<(vs.groupCount||1); gi++){
      const txt=await idbGet(`groupproj-${gi}`).catch(()=>null);
      groups.push(makeGroup(`动画 ${gi+1}`));
      if(txt){ try{ await loadProjectData(JSON.parse(txt), gi); }catch(_){} }
    }
  }
  const blob=await idbGet('model').catch(()=>null);
  if(blob) await loadModelBlob(blob, false);
  if(vs) await restoreView({decals:vs.decals||[], active:vs.active||0,
    masks:vs.masks||[], carColors:vs.carColors||[]});
  activeGroup=Math.min(vs?.activeGroup||0, groups.length-1);
  selected=false; syncPanel();
  if(vs?.decals?.some(d=>d.p)) hint('✓ 已恢复上次的模型与投影布局');
})();

/* ══════════════ 主循环(⏯ 暂停:冻结时间线与呼吸,便于跨面对齐)══════════════ */
let g=0, last=performance.now(), clock=0, frames=0, paused=false;
function setPaused(p){ paused=p;
  $('pauseBtn').textContent=paused?'▶ 播放':'⏸ 暂停';
  $('pauseBtn').classList.toggle('on',paused); }
$('pauseBtn').onclick=()=>setPaused(!paused);
addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT') return;
  if(e.key===' '){ setPaused(!paused); e.preventDefault(); }
});
function frame(now){
  const dt=(now-last)/1000; last=now;
  if(!paused){ clock+=dt; g+=dt; }
  for(const gr of groups){
    if(!gr.SEQ) continue;
    const fr=sampleFrame(gr.SEQ, gr.states, g%gr.SEQ.T, clock, gr.P);
    gr.renderTex(fr.balls, fr.col, gr.P);
    gr.screenTex.needsUpdate=true;
  }
  if($('spinCk').checked && !gizmoDrag && !painting) carGroup.rotation.y+=dt*0.12;
  stepCamTween(dt);
  updateGumball();
  drawCut();
  controls.update();
  composer.render();
  frames++;
}
function tick(now){ frame(now); requestAnimationFrame(tick); }
requestAnimationFrame(tick);

window.__morph3d={
  status:()=>({ g:+g.toFixed(2), groups:groups.map(gr=>({name:gr.name, T:gr.SEQ?+gr.SEQ.T.toFixed(1):null, states:gr.states?.length||0})),
    frames, decals:decals.filter(d=>d.obj).length, active:activeDecal, activeGroup, mode, selected,
    undoDepth:viewUndoStack.length }),
  step:(ms=33)=>{ frame(last+ms); },
  place:(nx,ny)=>{ camera.updateMatrixWorld(); carGroup.updateMatrixWorld(true);
    ray.setFromCamera(new THREE.Vector2(nx,ny),camera);
    const hit=ray.intersectObject(carGroup,true).find(h=>h.object.isMesh && !h.object.userData.isDecal && h.face);
    if(hit){ pushViewUndo(); placeDecalAt(hit); } return !!hit; },
  setMode:setMode3, undo:undoView, autoSlice,
  addGroupFromData:async data=>{ const gi=groups.length; groups.push(makeGroup(`动画 ${gi+1}`));
    await loadProjectData(data, gi); activeGroup=gi; syncPanel(); saveViewState(); return gi; },
  loadProject:data=>loadProjectData(data, 0),
  texLit:(gi=0)=>{ const d=groups[gi].texCtx.getImageData(0,0,TEXW,TEXH).data; let n=0;
    for(let i=0;i<d.length;i+=16) if(d[i]>30||d[i+1]>30||d[i+2]>30) n++; return n; },
};
