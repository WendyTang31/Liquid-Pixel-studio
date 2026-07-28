// 车面参考底图("画皮肤"工作流的 2D 侧):读取 3D 预览器 🗺同步 过来的投影面布局 +
// 车身表面快照,叠加在编辑画布上 —— 创作时直接看到"画布的哪块区域落在车的哪个面",
// 等价于 Substance 2D 视图里的 UV 岛 + Show 3D Mesh 参考。storage 事件保证跨窗口实时。
import { W, H } from '../config.js';

let layout=null;
const images=new Map(); // patch → HTMLImageElement

function load(){
  try{ layout=JSON.parse(localStorage.getItem('morph-uvlayout')||'null'); }catch(_){ layout=null; }
  images.clear();
  if(layout?.patches) for(const p of layout.patches){
    if(p.snap){ const img=new Image(); img.src=p.snap; images.set(p,img); }
  }
}

export function initSkinRef(){
  load();
  addEventListener('storage',e=>{ if(e.key==='morph-uvlayout') load(); });
}
export const hasSkinLayout=()=>!!layout?.patches?.length;

// ── 编辑器侧直接拖动取景框(用户在这画,就在这调)──
// 命中:边框带(6px)= 移动,右下角(10px)= 缩放。返回 null 或 {p, mode}。
export function skinHit(x,y){
  if(!layout?.patches) return null;
  const E=6;
  for(let i=layout.patches.length-1;i>=0;i--){
    const p=layout.patches[i];
    const px=p.cx*W, py=p.cy*H, pw=p.cw*W, ph=p.ch*H;
    if(Math.abs(x-(px+pw))<10 && Math.abs(y-(py+ph))<10) return {p, mode:'br'};
    const onV=(Math.abs(x-px)<E||Math.abs(x-(px+pw))<E) && y>py-E && y<py+ph+E;
    const onH=(Math.abs(y-py)<E||Math.abs(y-(py+ph))<E) && x>px-E && x<px+pw+E;
    if(onV||onH) return {p, mode:'move'};
  }
  return null;
}
// 写回:本页布局(立即重画)+ 3D 预览器存档(morph3d-view 里按 i 对位的 decal)——
// 同窗工作流下切回 3D 时 restoreView 会按新窗口重投影(UV 层经 applyUvLayer 重映射)。
export function saveSkinWindow(p){
  try{ layout.ts=Date.now(); localStorage.setItem('morph-uvlayout', JSON.stringify(layout)); }catch(_){}
  if(p.i==null) return;
  try{
    const v=JSON.parse(localStorage.getItem('morph3d-view')||'null');
    if(v?.decals?.[p.i]){ Object.assign(v.decals[p.i], {cx:p.cx, cy:p.cy, cw:p.cw, ch:p.ch});
      localStorage.setItem('morph3d-view', JSON.stringify(v)); }
  }catch(_){}
}

export function drawSkinRef(ctx){
  if(!layout?.patches) return;
  for(const p of layout.patches){
    const x=p.cx*W, y=p.cy*H, w=p.cw*W, h=p.ch*H;
    const img=images.get(p);
    if(img?.complete&&img.naturalWidth){ ctx.globalAlpha=0.3; ctx.drawImage(img,x,y,w,h); ctx.globalAlpha=1; }
    ctx.strokeStyle=p.color||'#98f5d0'; ctx.setLineDash([5,3]); ctx.lineWidth=1;
    ctx.strokeRect(x+0.5,y+0.5,Math.max(1,w-1),Math.max(1,h-1));
    ctx.setLineDash([]);
    ctx.font='10px system-ui'; ctx.fillStyle=p.color||'#98f5d0';
    ctx.fillText(`${p.name}${p.meshName?' · '+p.meshName:''}`, x+4, y+12);
  }
}
