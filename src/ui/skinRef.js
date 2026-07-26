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
