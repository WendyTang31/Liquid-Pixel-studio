// 3D 车模预览器:morph 序列实时渲到离屏画布 → 以"贴花投影(Decal)"贴到车身表面。
// 多投影面:每块贴花共享同一张动画纹理与时间线,各自截取画面的一段(uv 窗口)——
// 动画即可跨车头/车盖/侧身连续"跑动",且每块都是各自表面的正投影,互不拉伸
// (学界正解是测地线参数化/离散指数映射 Schmidt 2006;分片窗口是其实用近似)。
// 吸色把动画背景同步成车漆色;橡皮在动画空间擦 alpha 蒙版,所有投影面同步隐藏该区域。
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
import { downloadBlob } from '../utils.js';

const $=id=>document.getElementById(id);
const hint=msg=>{ $('hint').textContent=msg; };

/* ══════════════ 持久化 ══════════════ */
function idbOpen(){ return new Promise((res,rej)=>{ const q=indexedDB.open('morph-studio',1);
  q.onupgradeneeded=()=>q.result.createObjectStore('files');
  q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error); }); }
async function idbPut(key,val){ const db=await idbOpen(); return new Promise((res,rej)=>{
  const tx=db.transaction('files','readwrite'); tx.objectStore('files').put(val,key);
  tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
async function idbGet(key){ const db=await idbOpen(); return new Promise((res,rej)=>{
  const rq=db.transaction('files').objectStore('files').get(key);
  rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); }); }

function saveViewState(){
  try{ localStorage.setItem('morph3d-view', JSON.stringify({
    exp:+$('expSl').value, bloom:$('bloomCk').checked, spin:$('spinCk').checked,
    colBgPick: pickedBg,
    active: activeDecal,
    decals: decals.map(d=>({ meshIdx:d.mesh?meshList().indexOf(d.mesh):-1,
      p:d.localPoint?.toArray()||null, n:d.localNormal?.toArray()||null,
      sz:d.sz, rot:d.rot, du:d.du, dv:d.dv, cx:d.cx, cw:d.cw })),
    mask: maskDirty ? maskCanvas.toDataURL('image/png') : savedMaskURL,
  })); }catch(_){}
}

/* ══════════════ 动画纹理 + 橡皮蒙版 ══════════════ */
const TEXW=960, TEXH=560;
const texCanvas=document.createElement('canvas'); texCanvas.width=TEXW; texCanvas.height=TEXH;
const texCtx=texCanvas.getContext('2d');
const renderTex=createSizedRenderer(texCtx, TEXW, TEXH);
texCtx.fillStyle='#0a0a0a'; texCtx.fillRect(0,0,TEXW,TEXH);
texCtx.fillStyle='#98f5d0'; texCtx.font='30px system-ui'; texCtx.textAlign='center';
texCtx.fillText('等待工程 — 编辑器点「🚗 3D 预览」或此页 📂 载入', TEXW/2, TEXH/2);
const screenTex=new THREE.CanvasTexture(texCanvas);
screenTex.colorSpace=THREE.SRGBColorSpace;

// 橡皮蒙版:动画空间的 alpha(alphaMap 读绿通道;白=显示,黑=擦除)。
const maskCanvas=document.createElement('canvas'); maskCanvas.width=TEXW; maskCanvas.height=TEXH;
const maskCtx=maskCanvas.getContext('2d');
maskCtx.fillStyle='#fff'; maskCtx.fillRect(0,0,TEXW,TEXH);
const maskTex=new THREE.CanvasTexture(maskCanvas);
let maskDirty=false, savedMaskURL=null;

let states=null, SEQ=null, g=0, last=performance.now(), clock=0, pickedBg=null;

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
  if(pickedBg) P.colBg=pickedBg; // 吸色结果优先于工程里的背景色
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

/* ── 车 ── */
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
    scene.remove(carGroup); clearAllDecals();
    carGroup=gltf.scene;
    const box=new THREE.Box3().setFromObject(carGroup);
    const size=box.getSize(new THREE.Vector3()), c=box.getCenter(new THREE.Vector3());
    const s=4.6/Math.max(size.x,size.y,size.z);
    carGroup.scale.setScalar(s);
    carGroup.position.set(-c.x*s, -box.min.y*s, -c.z*s);
    scene.add(carGroup);
    if(persist) idbPut('model', blob).catch(()=>{});
    hint('✓ 模型已载入 — 点击车身放置当前投影面');
    return true;
  }catch(err){ hint('⚠ 模型载入失败:'+err.message+'(建议自包含 .glb)'); return false; }
  finally{ URL.revokeObjectURL(url); }
}

/* ══════════════ 多投影面(核心)══════════════ */
const decals=[]; let activeDecal=0;
function newDecal(){ return {mesh:null, localPoint:null, localNormal:null,
  sz:1.2, rot:0, du:0, dv:0, cx:0, cw:1, obj:null}; }
decals.push(newDecal());

function removeObj(d){ if(d.obj){ d.obj.removeFromParent(); d.obj.geometry.dispose(); d.obj=null; } }
function clearAllDecals(){ for(const d of decals) { removeObj(d); d.mesh=null; d.localPoint=null; } }

function projectDecal(d){
  if(!d.mesh||!d.localPoint) return;
  removeObj(d);
  carGroup.updateMatrixWorld(true);
  const toWorld=carGroup.matrixWorld;
  const nrmMat=new THREE.Matrix3().getNormalMatrix(toWorld);
  const point=d.localPoint.clone().applyMatrix4(toWorld);
  const n=d.localNormal.clone().applyMatrix3(nrmMat).normalize();
  const upRef=Math.abs(n.y)>0.94? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
  const tan=new THREE.Vector3().crossVectors(upRef,n).normalize();
  const bit=new THREE.Vector3().crossVectors(n,tan).normalize();
  // 贴片保持画面像素纵横比:高 = 宽 × (纹理高/纹理宽) × (本面画面宽占比) 的反比修正
  const w=d.sz, h=d.sz*(TEXH/TEXW)/Math.max(0.15,d.cw);
  point.add(tan.clone().multiplyScalar(d.du)).add(bit.clone().multiplyScalar(d.dv));
  const helper=new THREE.Object3D();
  helper.position.copy(point);
  helper.lookAt(point.clone().add(n));
  helper.rotateZ(d.rot*Math.PI/180);
  const geo=new DecalGeometry(d.mesh, point, helper.rotation, new THREE.Vector3(w,h,w*0.7));
  // uv 窗口:本面只显示动画画面的 [cx, cx+cw] 横段 —— 多面各取一段,动画即可跨面连续跑
  const uv=geo.attributes.uv;
  for(let i=0;i<uv.count;i++) uv.setX(i, d.cx + uv.getX(i)*d.cw);
  uv.needsUpdate=true;
  const obj=new THREE.Mesh(geo, screenMat);
  obj.renderOrder=1; obj.userData.isDecal=true;
  obj.applyMatrix4(toWorld.clone().invert());
  carGroup.add(obj);
  d.obj=obj;
  saveViewState();
}

function placeDecalAt(hit){
  const d=decals[activeDecal];
  d.mesh=hit.object;
  const toLocal=carGroup.matrixWorld.clone().invert();
  d.localPoint=hit.point.clone().applyMatrix4(toLocal);
  const wn=hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
  d.localNormal=wn.applyMatrix3(new THREE.Matrix3().getNormalMatrix(toLocal)).normalize();
  projectDecal(d);
  syncDecalSel();
  hint(`✓ 投影面 ${activeDecal+1} 已放到「${hit.object.name||'表面'}」— 滑块微调,➕面 可加下一块`);
}

/* ── 投影面 UI ── */
function syncDecalSel(){
  const sel=$('decSel'); sel.innerHTML='';
  decals.forEach((d,i)=>{ const o=document.createElement('option');
    o.value=i; o.textContent=`投影面 ${i+1}${d.obj?'':' (未放置)'}`; if(i===activeDecal) o.selected=true;
    sel.appendChild(o); });
}
function syncDecalUI(){
  const d=decals[activeDecal];
  $('szSl').value=d.sz; $('szV').textContent=d.sz.toFixed(2);
  $('rotSl').value=d.rot; $('rotV').textContent=d.rot+'°';
  $('uSl').value=d.du; $('uV').textContent=d.du.toFixed(2);
  $('vSl').value=d.dv; $('vV').textContent=d.dv.toFixed(2);
  $('cxSl').value=d.cx; $('cxV').textContent=Math.round(d.cx*100)+'%';
  $('cwSl').value=d.cw; $('cwV').textContent=Math.round(d.cw*100)+'%';
  syncDecalSel();
}
$('decSel').onchange=e=>{ activeDecal=+e.target.value; syncDecalUI(); };
$('addDec').onclick=()=>{ decals.push(newDecal()); activeDecal=decals.length-1;
  syncDecalUI(); hint(`投影面 ${activeDecal+1}:点击车身放置(与其它面同一动画、时间线同步)`); };
$('delDec').onclick=()=>{ if(decals.length<=1){ hint('至少保留一块投影面'); return; }
  removeObj(decals[activeDecal]); decals.splice(activeDecal,1);
  activeDecal=Math.min(activeDecal,decals.length-1); syncDecalUI(); saveViewState(); };
const decalSliders={szSl:['sz',v=>v.toFixed(2)], rotSl:['rot',v=>v+'°'], uSl:['du',v=>v.toFixed(2)],
  vSl:['dv',v=>v.toFixed(2)], cxSl:['cx',v=>Math.round(v*100)+'%'], cwSl:['cw',v=>Math.round(v*100)+'%']};
for(const [id,[key,fmt]] of Object.entries(decalSliders)){
  $(id).addEventListener('input',e=>{ const d=decals[activeDecal];
    d[key]=+e.target.value; $(id.replace('Sl','V')).textContent=fmt(+e.target.value);
    projectDecal(d); });
}

/* ══════════════ 交互模式:放置 / 吸色 / 橡皮 ══════════════ */
let mode='place';
function setViewMode(m){ mode=m;
  $('pickBtn').classList.toggle('on',m==='pick');
  $('eraseBtn').classList.toggle('on',m==='erase');
  controls.enabled=(m!=='erase'); // 擦除要拖动,得让出旋转
  hint(m==='pick'?'🎨 点击车漆取色 → 动画背景同步为该颜色':
       m==='erase'?'🧽 在投影面上拖动擦除;再点🧽退出':'点击车身放置当前投影面');
}
$('pickBtn').onclick=()=>setViewMode(mode==='pick'?'place':'pick');
$('eraseBtn').onclick=()=>setViewMode(mode==='erase'?'place':'erase');
$('eraSl').addEventListener('input',e=>{ $('eraV').textContent=e.target.value; });
$('clearErase').onclick=()=>{ maskCtx.fillStyle='#fff'; maskCtx.fillRect(0,0,TEXW,TEXH);
  maskTex.needsUpdate=true; maskDirty=true; saveViewState(); hint('↺ 擦除已全部恢复'); };

const ray=new THREE.Raycaster(), ptr=new THREE.Vector2();
function rayFromEvent(e){
  ptr.x=(e.clientX/innerWidth)*2-1; ptr.y=-(e.clientY/innerHeight)*2+1;
  camera.updateMatrixWorld(); carGroup.updateMatrixWorld(true);
  ray.setFromCamera(ptr,camera);
}
function eraseAt(e){
  rayFromEvent(e);
  const objs=decals.filter(d=>d.obj).map(d=>d.obj);
  const hit=ray.intersectObjects(objs,false)[0];
  if(!hit?.uv) return;
  const R=+$('eraSl').value;
  maskCtx.fillStyle='#000'; maskCtx.beginPath();
  maskCtx.arc(hit.uv.x*TEXW, (1-hit.uv.y)*TEXH, R, 0, 7); maskCtx.fill();
  maskTex.needsUpdate=true; maskDirty=true;
}
async function pickColorAt(e){
  frame(performance.now()); // 先渲一帧,同任务内读帧缓冲才有内容
  const gl=renderer.getContext();
  const px=new Uint8Array(4);
  const dpr=renderer.getPixelRatio();
  gl.readPixels(Math.round(e.clientX*dpr), Math.round(gl.drawingBufferHeight-e.clientY*dpr),
    1,1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const hex='#'+[px[0],px[1],px[2]].map(v=>v.toString(16).padStart(2,'0')).join('');
  pickedBg=hex; P.colBg=hex;
  saveViewState(); setViewMode('place');
  hint(`🎨 已取色 ${hex} — 动画背景已同步为车漆色`);
}

let downAt=null, erasing=false;
renderer.domElement.addEventListener('pointerdown',e=>{
  downAt=[e.clientX,e.clientY];
  if(mode==='erase'){ erasing=true; eraseAt(e); }
});
renderer.domElement.addEventListener('pointermove',e=>{ if(erasing) eraseAt(e); });
addEventListener('pointerup',e=>{
  if(erasing){ erasing=false; saveViewState(); return; }
  if(!downAt || Math.hypot(e.clientX-downAt[0], e.clientY-downAt[1])>5) return;
  if(e.target!==renderer.domElement) return;
  if(mode==='pick'){ pickColorAt(e); return; }
  rayFromEvent(e);
  const hit=ray.intersectObject(carGroup,true).find(h=>h.object.isMesh && !h.object.userData.isDecal && h.face);
  if(hit) placeDecalAt(hit);
});

/* ── Bloom(OutputPass 修复:少了它,合成链不做色调映射/sRGB 输出,画面近乎全黑)── */
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

/* ── Blender 导出:车 + 投影面(带 uv 与当前帧纹理)打包 .glb ── */
$('expGlb').onclick=()=>{
  new GLTFExporter().parse(carGroup, gltf=>{
    downloadBlob(new Blob([gltf],{type:'model/gltf-binary'}), 'morph-car-decals.glb');
    hint('✓ 已导出 .glb — Blender:导入后选投影面网格,把材质贴图换成 ⑤导出 的 PNG 序列(勾选 Image Sequence),接 Emission 即可正片渲染');
  }, err=>hint('⚠ 导出失败:'+err.message), {binary:true});
};

/* ── 文件入口 + 启动恢复 ── */
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
    if(vs.colBgPick){ pickedBg=vs.colBgPick; P.colBg=pickedBg; }
    if(vs.mask){ savedMaskURL=vs.mask;
      const img=new Image(); img.onload=()=>{ maskCtx.drawImage(img,0,0); maskTex.needsUpdate=true; };
      img.src=vs.mask; }
  }
  const blob=await idbGet('model').catch(()=>null);
  if(blob) await loadModelBlob(blob, false);
  if(vs?.decals?.length){
    decals.length=0;
    for(const sd of vs.decals){
      const d=newDecal();
      Object.assign(d,{sz:sd.sz,rot:sd.rot,du:sd.du,dv:sd.dv,cx:sd.cx??0,cw:sd.cw??1});
      const m=meshList()[sd.meshIdx];
      if(m && sd.p && sd.n){ d.mesh=m;
        d.localPoint=new THREE.Vector3().fromArray(sd.p);
        d.localNormal=new THREE.Vector3().fromArray(sd.n);
      }
      decals.push(d);
    }
    if(!decals.length) decals.push(newDecal());
    activeDecal=Math.min(vs.active??0, decals.length-1);
    for(const d of decals) projectDecal(d);
    hint('✓ 已恢复上次的模型与投影布局');
  }
  syncDecalUI();
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

// 调试探针(隐藏标签页 rAF 不触发,自动化验证靠 step 驱动)。
window.__morph3d={
  status:()=>({ g:+g.toFixed(2), T:SEQ?+SEQ.T.toFixed(1):null,
    states:states?states.length:0, frames, decals:decals.filter(d=>d.obj).length, active:activeDecal, mode }),
  step:(ms=33)=>{ frame(last+ms); },
  place:(nx,ny)=>{ camera.updateMatrixWorld(); carGroup.updateMatrixWorld(true);
    ray.setFromCamera(new THREE.Vector2(nx,ny),camera);
    const hit=ray.intersectObject(carGroup,true).find(h=>h.object.isMesh && !h.object.userData.isDecal && h.face);
    if(hit) placeDecalAt(hit); return !!hit; },
  loadProject:data=>loadProjectData(data),
  texLit:()=>{ const d=texCtx.getImageData(0,0,TEXW,TEXH).data; let n=0;
    for(let i=0;i<d.length;i+=16) if(d[i]>30||d[i+1]>30||d[i+2]>30) n++; return n; },
};
