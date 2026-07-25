// 3D 车模预览器:把 morph 序列实时渲到离屏画布,作为自发光纹理贴到车尾"屏幕"网格。
// 引擎/采样/数据层零改动 —— 这里只是又一个渲染出口(与 CLAUDE.md"WebGL 只动渲染层"一致)。
// 工程来源:主应用"🚗 3D 预览"按钮写入 localStorage,或本页手动载入 .json。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { W, H, P } from '../config.js';
import { buildSequence, sampleFrame } from '../engine.js';
import { createSizedRenderer } from '../render.js';
import { paintShapes, maskReaderFor, sampleDots } from '../pipeline.js';
import { decodeImageShape } from '../image.js';

const $=id=>document.getElementById(id);
const hint=msg=>{ $('hint').textContent=msg; };

/* ══════════════ 动画纹理:离屏画布 + 复用渲染器 ══════════════ */
const TEXW=960, TEXH=560; // 2× 画布分辨率,曲面拉伸后仍然清晰
const texCanvas=document.createElement('canvas'); texCanvas.width=TEXW; texCanvas.height=TEXH;
const texCtx=texCanvas.getContext('2d');
const renderTex=createSizedRenderer(texCtx, TEXW, TEXH);
texCtx.fillStyle='#0a0a0a'; texCtx.fillRect(0,0,TEXW,TEXH);
texCtx.fillStyle='#98f5d0'; texCtx.font='28px system-ui'; texCtx.textAlign='center';
texCtx.fillText('等待工程 — 在编辑器点「🚗 3D 预览」或此页 📂 载入', TEXW/2, TEXH/2);
const screenTex=new THREE.CanvasTexture(texCanvas);
screenTex.colorSpace=THREE.SRGBColorSpace;

let states=null, SEQ=null, g=0, last=performance.now(), clock=0;

// 工程 JSON → 可播放的 states(shapes → 蒙版 → dots),兼容 v3 A/B。
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
    out.push({name:d.name, color:d.color, hold:d.hold, dur:d.dur,
      dots:sampleDots(maskReaderFor(mctx), d.manual||[], P)});
  }
  states=out;
  SEQ=buildSequence(states, true, P); // 3D 演示固定无缝循环
  g=0;
  hint(`✓ 工程已载入:${states.length} 个状态 · 循环 ${SEQ.T.toFixed(1)}s · ${states.map(s=>s.dots.length).join('/')} 点`);
}

/* ══════════════ three.js 场景 ══════════════ */
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x0a0a0a);
scene.fog=new THREE.Fog(0x0a0a0a, 14, 30);
const camera=new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 100);
camera.position.set(-5.2, 2.6, 5.4);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
$('scene').appendChild(renderer.domElement);
const controls=new OrbitControls(camera, renderer.domElement);
controls.target.set(0,0.8,0); controls.enableDamping=true; controls.maxPolarAngle=Math.PI/2-0.03;

scene.add(new THREE.HemisphereLight(0x8899aa, 0x111111, 0.55));
const key=new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(4,7,3); scene.add(key);

const ground=new THREE.Mesh(new THREE.CircleGeometry(24,48),
  new THREE.MeshStandardMaterial({color:0x101114, roughness:0.9, metalness:0.1}));
ground.rotation.x=-Math.PI/2; scene.add(ground);

// 屏幕材质:MeshBasicMaterial 不受光照 = 自发光体,配合 Bloom 呈现 LED 辉光。
const screenMat=new THREE.MeshBasicMaterial({map:screenTex, toneMapped:false});

/* ── 内置示例车(无模型也能直接看效果)── */
let carGroup=new THREE.Group(), screenMesh=null;
const savedMats=new Map(); // mesh → 原材质,换目标时还原
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
  // 车尾 LED 屏(带正规 UV 的平面,朝 -x 即车尾方向)
  const sc=new THREE.Mesh(new THREE.PlaneGeometry(1.55,0.9), screenMat);
  sc.position.set(-2.12,0.95,0); sc.rotation.y=-Math.PI/2;
  sc.name='LED_screen'; g0.add(sc);
  return {group:g0, screen:sc};
}
function useDemoCar(){
  scene.remove(carGroup); savedMats.clear();
  const {group,screen}=buildDemoCar();
  carGroup=group; screenMesh=screen; scene.add(carGroup);
  refreshMeshList();
}
useDemoCar();

/* ── glTF 载入:归一化尺寸/落地,列出网格供选屏 ── */
function refreshMeshList(){
  const sel=$('meshSel'); sel.innerHTML='<option value="">— 选择屏幕网格 —</option>';
  carGroup.traverse(o=>{ if(o.isMesh){
    const opt=document.createElement('option');
    opt.value=o.uuid; opt.textContent=o.name||('mesh-'+o.uuid.slice(0,6));
    if(o===screenMesh) opt.selected=true;
    sel.appendChild(opt);
  }});
}
function setScreenMesh(mesh){
  if(!mesh||mesh===screenMesh) return;
  if(screenMesh && savedMats.has(screenMesh)) screenMesh.material=savedMats.get(screenMesh); // 还原旧目标
  if(!savedMats.has(mesh)) savedMats.set(mesh, mesh.material);
  mesh.material=screenMat; screenMesh=mesh;
  refreshMeshList();
  hint(`✓ 动画已贴到「${mesh.name||'未命名网格'}」`);
}
async function loadModelFile(file){
  hint('载入模型中…');
  const url=URL.createObjectURL(file);
  try{
    const gltf=await new GLTFLoader().loadAsync(url);
    scene.remove(carGroup); savedMats.clear(); screenMesh=null;
    carGroup=gltf.scene;
    // 归一化:最长边 4.6,落地,居中
    const box=new THREE.Box3().setFromObject(carGroup);
    const size=box.getSize(new THREE.Vector3()), c=box.getCenter(new THREE.Vector3());
    const s=4.6/Math.max(size.x,size.y,size.z);
    carGroup.scale.setScalar(s);
    carGroup.position.set(-c.x*s, -box.min.y*s, -c.z*s);
    scene.add(carGroup); refreshMeshList();
    hint('✓ 模型已载入 — 下拉选择或直接点击"屏幕"表面,把动画贴上去');
  }catch(err){ hint('⚠ 模型载入失败:'+err.message+'(建议用自包含的 .glb)'); }
  finally{ URL.revokeObjectURL(url); }
}

/* ── 点击拾取投屏表面 ── */
const ray=new THREE.Raycaster(), ptr=new THREE.Vector2();
let downAt=null;
renderer.domElement.addEventListener('pointerdown',e=>{ downAt=[e.clientX,e.clientY]; });
renderer.domElement.addEventListener('pointerup',e=>{
  if(!downAt || Math.hypot(e.clientX-downAt[0], e.clientY-downAt[1])>5) return; // 拖动=旋转,不拾取
  ptr.x=(e.clientX/innerWidth)*2-1; ptr.y=-(e.clientY/innerHeight)*2+1;
  ray.setFromCamera(ptr,camera);
  const hit=ray.intersectObject(carGroup,true)[0];
  if(hit&&hit.object.isMesh) setScreenMesh(hit.object);
});
$('meshSel').onchange=e=>{
  carGroup.traverse(o=>{ if(o.isMesh&&o.uuid===e.target.value) setScreenMesh(o); });
};

/* ── Bloom 合成 ── */
const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight), 0.75, 0.4, 0.55);
composer.addPass(bloom);
$('bloomCk').onchange=e=>{ bloom.enabled=e.target.checked; };

addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight); composer.setSize(innerWidth,innerHeight);
});

/* ── 文件入口 ── */
$('loadProj').onclick=()=>$('projFile').click();
$('projFile').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>loadProjectData(JSON.parse(rd.result)).catch(err=>hint('⚠ '+err.message));
  rd.readAsText(f); e.target.value='';
});
$('loadModel').onclick=()=>$('modelFile').click();
$('modelFile').addEventListener('change',e=>{
  const f=e.target.files[0]; if(f) loadModelFile(f); e.target.value='';
});

// 主应用经 localStorage 递交的工程
try{
  const stored=localStorage.getItem('morph3d-project');
  if(stored) loadProjectData(JSON.parse(stored)).catch(err=>hint('⚠ '+err.message));
}catch(_){ /* 隐私模式等拿不到 localStorage 时静默,走手动载入 */ }

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

// 调试探针:查询运行状态 + 手动单步(隐藏标签页 rAF 不触发,自动化验证靠 step 驱动;
// WebGL 缓冲合成后即清空,只有在 step 同一个任务里同步读像素才能截到画面)。
window.__morph3d={
  status:()=>({ g:+g.toFixed(2), T:SEQ?+SEQ.T.toFixed(1):null,
    states:states?states.length:0, frames, screen:screenMesh?.name||null }),
  step:(ms=33)=>{ frame(last+ms); },
};
