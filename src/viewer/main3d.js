// 3D 车模预览器:把 morph 序列实时渲到离屏画布,再以"贴花投影(Decal)"贴到车身表面。
// 为何不用模型自带 UV:量产车模的 UV 是为车漆/贴图图集展开的(常整车合并成一个网格),
// 直接把动画纹理交给它的 UV 会采到任意区域(之前"挡风玻璃整片白"就是这个原因)。
// DecalGeometry 沿点击处法线把矩形投影到曲面上、自动生成正确 UV —— 与模型 UV 完全无关,
// 天然就是"投到一个面",且支持大小/旋转/横纵移微调。引擎/数据层依旧零改动。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { W, H, P } from '../config.js';
import { buildSequence, sampleFrame } from '../engine.js';
import { createSizedRenderer } from '../render.js';
import { paintShapes, maskReaderFor, lumReaderFor, sampleDots } from '../pipeline.js';
import { decodeImageShape } from '../image.js';

const $=id=>document.getElementById(id);
const hint=msg=>{ $('hint').textContent=msg; };

/* ══════════════ 持久化:模型进 IndexedDB(glb 可达几十 MB,localStorage 放不下),
   贴花/滑块/工程走 localStorage —— 切页/刷新回来全都还在 ══════════════ */
function idbOpen(){ return new Promise((res,rej)=>{ const q=indexedDB.open('morph-studio',1);
  q.onupgradeneeded=()=>q.result.createObjectStore('files');
  q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error); }); }
async function idbPut(key,val){ const db=await idbOpen(); return new Promise((res,rej)=>{
  const tx=db.transaction('files','readwrite'); tx.objectStore('files').put(val,key);
  tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
async function idbGet(key){ const db=await idbOpen(); return new Promise((res,rej)=>{
  const rq=db.transaction('files').objectStore('files').get(key);
  rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); }); }

const meshList=()=>{ const l=[]; carGroup.traverse(o=>{ if(o.isMesh&&o!==decal.obj) l.push(o); }); return l; };
function saveViewState(){
  try{ localStorage.setItem('morph3d-view', JSON.stringify({
    sz:+$('szSl').value, rot:+$('rotSl').value, du:+$('uSl').value, dv:+$('vSl').value,
    exp:+$('expSl').value, bloom:$('bloomCk').checked, spin:$('spinCk').checked,
    decal: decal.localPoint ? { meshIdx:meshList().indexOf(decal.mesh),
      p:decal.localPoint.toArray(), n:decal.localNormal.toArray() } : null,
  })); }catch(_){}
}

/* ══════════════ 动画纹理 ══════════════ */
const TEXW=960, TEXH=560;
const texCanvas=document.createElement('canvas'); texCanvas.width=TEXW; texCanvas.height=TEXH;
const texCtx=texCanvas.getContext('2d');
const renderTex=createSizedRenderer(texCtx, TEXW, TEXH);
texCtx.fillStyle='#0a0a0a'; texCtx.fillRect(0,0,TEXW,TEXH);
texCtx.fillStyle='#98f5d0'; texCtx.font='30px system-ui'; texCtx.textAlign='center';
texCtx.fillText('等待工程 — 编辑器点「🚗 3D 预览」或此页 📂 载入', TEXW/2, TEXH/2);
const screenTex=new THREE.CanvasTexture(texCanvas);
screenTex.colorSpace=THREE.SRGBColorSpace;

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
  states=out;
  SEQ=buildSequence(states, true, P);
  g=0;
  hint(`✓ 工程已载入:${states.length} 个状态 · 循环 ${SEQ.T.toFixed(1)}s — 点击车身投上动画`);
}

/* ══════════════ 场景 / 灯光 / 环境 ══════════════ */
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

// 室内环境贴图:车漆/玻璃得到真实反射,整车清晰可辨(解决"模型看不清")。
const pmrem=new THREE.PMREMGenerator(renderer);
scene.environment=pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0x99aabb, 0x151515, 0.5));
const key=new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(4,7,3); scene.add(key);
const fill=new THREE.DirectionalLight(0x8899ff, 0.4); fill.position.set(-5,3,-4); scene.add(fill);

const ground=new THREE.Mesh(new THREE.CircleGeometry(26,48),
  new THREE.MeshStandardMaterial({color:0x101114, roughness:0.85, metalness:0.15}));
ground.rotation.x=-Math.PI/2; scene.add(ground);

// 屏幕材质:不受光照(自发光体观感),贴花专用防 z-fighting 设置。
const screenMat=new THREE.MeshBasicMaterial({map:screenTex, toneMapped:false,
  transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4});

/* ── 车:内置示例车 / 载入 glb ── */
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

async function loadModelBlob(blob, persist){
  hint('载入模型中…');
  const url=URL.createObjectURL(blob);
  try{
    const gltf=await new GLTFLoader().loadAsync(url);
    scene.remove(carGroup); clearDecal();
    carGroup=gltf.scene;
    const box=new THREE.Box3().setFromObject(carGroup);
    const size=box.getSize(new THREE.Vector3()), c=box.getCenter(new THREE.Vector3());
    const s=4.6/Math.max(size.x,size.y,size.z);
    carGroup.scale.setScalar(s);
    carGroup.position.set(-c.x*s, -box.min.y*s, -c.z*s);
    scene.add(carGroup);
    if(persist) idbPut('model', blob).catch(()=>{});
    hint('✓ 模型已载入 — 点击车身任意位置,把动画投影上去');
    return true;
  }catch(err){ hint('⚠ 模型载入失败:'+err.message+'(建议自包含 .glb)'); return false; }
  finally{ URL.revokeObjectURL(url); }
}

/* ══════════════ 贴花投影(核心)══════════════ */
// 记录以车组局部坐标,自动环绕/重投影都稳定;调滑块 = 重建贴花。
const decal={ mesh:null, localPoint:null, localNormal:null, obj:null };
function clearDecal(){
  if(decal.obj){ decal.obj.removeFromParent(); decal.obj.geometry.dispose(); decal.obj=null; }
  decal.mesh=null; decal.localPoint=null; decal.localNormal=null;
}
function projectDecal(){
  if(!decal.mesh||!decal.localPoint) return;
  if(decal.obj){ decal.obj.removeFromParent(); decal.obj.geometry.dispose(); decal.obj=null; }
  carGroup.updateMatrixWorld(true);
  const toWorld=carGroup.matrixWorld;
  const nrmMat=new THREE.Matrix3().getNormalMatrix(toWorld);
  const point=decal.localPoint.clone().applyMatrix4(toWorld);
  const n=decal.localNormal.clone().applyMatrix3(nrmMat).normalize();
  // 表面切向基:世界 up 与法线构造,横移/纵移沿切向进行
  const upRef=Math.abs(n.y)>0.94? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
  const tan=new THREE.Vector3().crossVectors(upRef,n).normalize();
  const bit=new THREE.Vector3().crossVectors(n,tan).normalize();
  const w=+$('szSl').value, h=w*(TEXH/TEXW);
  const du=+$('uSl').value, dv=+$('vSl').value;
  point.add(tan.clone().multiplyScalar(du)).add(bit.clone().multiplyScalar(dv));
  // 投影方向朝 -n(看向表面);再绕法线滚转
  const helper=new THREE.Object3D();
  helper.position.copy(point);
  helper.lookAt(point.clone().add(n));
  helper.rotateZ((+$('rotSl').value)*Math.PI/180);
  const geo=new DecalGeometry(decal.mesh, point, helper.rotation, new THREE.Vector3(w,h,w*0.7));
  const obj=new THREE.Mesh(geo, screenMat);
  obj.renderOrder=1;
  // 几何是世界坐标 → 逆变换挂回车组,跟随环绕旋转
  obj.applyMatrix4(toWorld.clone().invert());
  carGroup.add(obj);
  decal.obj=obj;
  saveViewState();
}
function placeDecalAt(hit){
  decal.mesh=hit.object;
  const toLocal=carGroup.matrixWorld.clone().invert();
  decal.localPoint=hit.point.clone().applyMatrix4(toLocal);
  const wn=hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
  decal.localNormal=wn.applyMatrix3(new THREE.Matrix3().getNormalMatrix(toLocal)).normalize();
  projectDecal();
  hint(`✓ 动画已投到「${hit.object.name||'表面'}」— 用 大小/旋转/横移/纵移 微调贴合`);
}

/* ── 交互 ── */
const ray=new THREE.Raycaster(), ptr=new THREE.Vector2();
let downAt=null;
renderer.domElement.addEventListener('pointerdown',e=>{ downAt=[e.clientX,e.clientY]; });
renderer.domElement.addEventListener('pointerup',e=>{
  if(!downAt || Math.hypot(e.clientX-downAt[0], e.clientY-downAt[1])>5) return;
  ptr.x=(e.clientX/innerWidth)*2-1; ptr.y=-(e.clientY/innerHeight)*2+1;
  camera.updateMatrixWorld(); carGroup.updateMatrixWorld(true); // 首帧渲染前点击也能正确拾取
  ray.setFromCamera(ptr,camera);
  const hit=ray.intersectObject(carGroup,true).find(h=>h.object.isMesh && h.object!==decal.obj && h.face);
  if(hit) placeDecalAt(hit);
});
const fmt={szSl:v=>(+v).toFixed(2), rotSl:v=>v+'°', uSl:v=>(+v).toFixed(2), vSl:v=>(+v).toFixed(2)};
for(const id of ['szSl','rotSl','uSl','vSl']){
  $(id).addEventListener('input',e=>{ $(id.replace('Sl','V')).textContent=fmt[id](e.target.value); projectDecal(); });
}
$('expSl').addEventListener('input',e=>{ renderer.toneMappingExposure=+e.target.value;
  $('expV').textContent=(+e.target.value).toFixed(2); saveViewState(); });
$('spinCk').addEventListener('change',saveViewState);

/* ── Bloom ── */
const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight), 0.65, 0.4, 0.72);
composer.addPass(bloom);
$('bloomCk').onchange=e=>{ bloom.enabled=e.target.checked; saveViewState(); };

addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight); composer.setSize(innerWidth,innerHeight);
});

/* ── 文件入口 ── */
$('loadProj').onclick=()=>$('projFile').click();
$('projFile').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>loadProjectData(JSON.parse(rd.result))
    .then(()=>{ try{ localStorage.setItem('morph3d-project', rd.result); }catch(_){} }) // 手动载入的工程同样留档
    .catch(err=>hint('⚠ '+err.message));
  rd.readAsText(f); e.target.value='';
});
$('loadModel').onclick=()=>$('modelFile').click();
$('modelFile').addEventListener('change',e=>{
  const f=e.target.files[0]; if(f) loadModelBlob(f, true); e.target.value='';
});

// 启动恢复:工程(localStorage)→ 模型(IndexedDB)→ 贴花与滑块(localStorage),按序等待。
(async()=>{
  try{
    const stored=localStorage.getItem('morph3d-project');
    if(stored) await loadProjectData(JSON.parse(stored)).catch(err=>hint('⚠ '+err.message));
  }catch(_){}
  let vs=null;
  try{ vs=JSON.parse(localStorage.getItem('morph3d-view')||'null'); }catch(_){}
  if(vs){
    $('szSl').value=vs.sz; $('szV').textContent=(+vs.sz).toFixed(2);
    $('rotSl').value=vs.rot; $('rotV').textContent=vs.rot+'°';
    $('uSl').value=vs.du; $('uV').textContent=(+vs.du).toFixed(2);
    $('vSl').value=vs.dv; $('vV').textContent=(+vs.dv).toFixed(2);
    $('expSl').value=vs.exp; $('expV').textContent=(+vs.exp).toFixed(2);
    renderer.toneMappingExposure=vs.exp;
    $('bloomCk').checked=vs.bloom; bloom.enabled=vs.bloom;
    $('spinCk').checked=vs.spin;
  }
  const blob=await idbGet('model').catch(()=>null);
  if(blob) await loadModelBlob(blob, false);
  if(vs?.decal){
    const m=meshList()[vs.decal.meshIdx];
    if(m){ decal.mesh=m;
      decal.localPoint=new THREE.Vector3().fromArray(vs.decal.p);
      decal.localNormal=new THREE.Vector3().fromArray(vs.decal.n);
      projectDecal();
      hint('✓ 已恢复上次的模型与投影位置');
    }
  }
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
  if($('spinCk').checked) carGroup.rotation.y+=dt*0.12;
  controls.update();
  composer.render();
  frames++;
}
function tick(now){ frame(now); requestAnimationFrame(tick); }
requestAnimationFrame(tick);

// 调试探针:状态查询 + 手动单步(隐藏标签页 rAF 不触发)+ NDC 投放 + 纹理活性检查。
window.__morph3d={
  status:()=>({ g:+g.toFixed(2), T:SEQ?+SEQ.T.toFixed(1):null,
    states:states?states.length:0, frames, decal:!!decal.obj }),
  step:(ms=33)=>{ frame(last+ms); },
  place:(nx,ny)=>{ camera.updateMatrixWorld(); carGroup.updateMatrixWorld(true);
    ray.setFromCamera(new THREE.Vector2(nx,ny),camera);
    const hit=ray.intersectObject(carGroup,true).find(h=>h.object.isMesh && h.object!==decal.obj && h.face);
    if(hit) placeDecalAt(hit); return !!hit; },
  loadProject:data=>loadProjectData(data),
  texLit:()=>{ const d=texCtx.getImageData(0,0,TEXW,TEXH).data; let n=0;
    for(let i=0;i<d.length;i+=16) if(d[i]>30||d[i+1]>30||d[i+2]>30) n++; return n; },
};
