// 车面参考底图("画皮肤"工作流的 2D 侧):读取 3D 预览器 🗺同步 过来的投影面布局 +
// 车身表面快照,叠加在编辑画布上 —— 创作时直接看到"画布的哪块区域落在车的哪个面",
// 等价于 Substance 2D 视图里的 UV 岛 + Show 3D Mesh 参考。storage 事件保证跨窗口实时。
// 取景框可在编辑器里直接点选/移动/缩放(见下),拥有独立的撤销栈与删除。
import { W, H } from '../config.js';

let layout=null;
let selSkin=null;              // 当前选中的取景框(patch 对象引用)
let focus=false;               // "正在操作取景框"焦点:删除后 selSkin 变 null 仍需让 Ctrl+Z 撤销删除
const images=new Map();        // patch → HTMLImageElement
const undoStack=[];            // 取景框专用撤销栈(JSON 快照,与形状撤销互不干扰)
export const skinFocus=()=>focus;                 // Ctrl+Z/Delete 路由用:此刻是否在取景框语境
export const setSkinFocus=v=>{ focus=v; };
export const skinHasUndo=()=>undoStack.length>0;

function reloadImages(){
  images.clear();
  if(layout?.patches) for(const p of layout.patches){
    if(p.snap){ const img=new Image(); img.src=p.snap; images.set(p,img); }
  }
}
function load(){
  try{ layout=JSON.parse(localStorage.getItem('morph-uvlayout')||'null'); }catch(_){ layout=null; }
  selSkin=null; reloadImages();
}

export function initSkinRef(){
  load();
  addEventListener('storage',e=>{ if(e.key==='morph-uvlayout') load(); });
}
export const hasSkinLayout=()=>!!layout?.patches?.length;
export const getSelSkin=()=>selSkin;
export const clearSkinSel=()=>{ selSkin=null; focus=false; };
export function selectSkin(p){ selSkin=p; focus=true; }

// 持久化:本页布局 + 3D 预览器存档(morph3d-view 里按 i 对位的 decal)——
// 同窗工作流下切回 3D 时 restoreView 会按新窗口重投影(UV 层经 applyUvLayer 重映射)。
export function persistSkin(){
  if(!layout) return;
  try{ layout.ts=Date.now(); localStorage.setItem('morph-uvlayout', JSON.stringify(layout)); }catch(_){}
  try{
    const v=JSON.parse(localStorage.getItem('morph3d-view')||'null');
    if(v?.decals) { let dirty=false;
      for(const p of layout.patches){ if(p.i!=null && v.decals[p.i]){
        Object.assign(v.decals[p.i], {cx:p.cx, cy:p.cy, cw:p.cw, ch:p.ch}); dirty=true; } }
      if(dirty) localStorage.setItem('morph3d-view', JSON.stringify(v));
    }
  }catch(_){}
}

// ── 取景框专用撤销/删除 ──
export function skinPushUndo(){ if(!layout) return; focus=true;
  undoStack.push(JSON.stringify(layout)); if(undoStack.length>30) undoStack.shift(); }
export function skinUndo(){
  if(!undoStack.length) return false;
  try{ layout=JSON.parse(undoStack.pop()); }catch(_){ return false; }
  selSkin=null; focus=true; reloadImages(); persistSkin(); return true; // 焦点保留:可连续 Ctrl+Z
}
// 删除只从 2D 叠加层移除(非破坏性:不动 3D 的 decal;要恢复回 3D 再 🗺同步 即可)。
export function deleteSelSkin(){
  if(!selSkin||!layout?.patches) return false;
  skinPushUndo();
  const i=layout.patches.indexOf(selSkin);
  if(i>=0) layout.patches.splice(i,1);
  images.delete(selSkin); selSkin=null;
  persistSkin(); return true;
}

// ── 命中测试 ──
const HR=7; // 手柄热区
// 选中框的操作命中:仅 8 个离散角/边手柄=缩放、边框线(≤6px)=移动;
// **内部一律返回 null** —— UV 参考是最底层背景,框内点击直接穿透到图案(形状)选择,
// 不再"框盖满画布就选不了图案"。返回 'nw|ne|sw|se|n|e|s|w|move' 或 null。
export function skinHandleAt(p,x,y){
  const px=p.cx*W, py=p.cy*H, pw=p.cw*W, ph=p.ch*H;
  const hs=[['nw',px,py],['n',px+pw/2,py],['ne',px+pw,py],['w',px,py+ph/2],
            ['e',px+pw,py+ph/2],['sw',px,py+ph],['s',px+pw/2,py+ph],['se',px+pw,py+ph]];
  for(const [m,hx,hy] of hs) if(Math.abs(x-hx)<HR&&Math.abs(y-hy)<HR) return m; // 手柄方块
  const E=6; // 边框线带 → 移动(仅贴着轮廓,不含内部)
  const onV=(Math.abs(x-px)<E||Math.abs(x-(px+pw))<E)&&y>py-E&&y<py+ph+E;
  const onH=(Math.abs(y-py)<E||Math.abs(y-(py+ph))<E)&&x>px-E&&x<px+pw+E;
  if(onV||onH) return 'move';
  return null; // 内部穿透:点击落到图案上
}
// 未选中时的选择命中:点边框带(6px)或名字标签 → 返回该 patch(用于点选)。
export function skinWindowAt(x,y){
  if(!layout?.patches) return null;
  for(let i=layout.patches.length-1;i>=0;i--){
    const p=layout.patches[i], px=p.cx*W, py=p.cy*H, pw=p.cw*W, ph=p.ch*H;
    if(x>px&&x<px+130&&y>py&&y<py+16) return p;   // 名字标签
    const E=6;
    const onV=(Math.abs(x-px)<E||Math.abs(x-(px+pw))<E)&&y>py-E&&y<py+ph+E;
    const onH=(Math.abs(y-py)<E||Math.abs(y-(py+ph))<E)&&x>px-E&&x<px+pw+E;
    if(onV||onH) return p;
  }
  return null;
}
const CURS={move:'move', n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize',
  nw:'nwse-resize', se:'nwse-resize', ne:'nesw-resize', sw:'nesw-resize'};
export function skinCursorAt(x,y){
  if(selSkin){ const m=skinHandleAt(selSkin,x,y); if(m) return CURS[m]; }
  return skinWindowAt(x,y)?'pointer':'';
}

export function drawSkinRef(ctx){
  if(!layout?.patches) return;
  for(const p of layout.patches){
    const x=p.cx*W, y=p.cy*H, w=p.cw*W, h=p.ch*H, on=(p===selSkin);
    const img=images.get(p);
    if(img?.complete&&img.naturalWidth){ ctx.globalAlpha=0.3; ctx.drawImage(img,x,y,w,h); ctx.globalAlpha=1; }
    ctx.strokeStyle=on?'#ffd678':(p.color||'#98f5d0');
    ctx.setLineDash(on?[]:[5,3]); ctx.lineWidth=on?1.6:1;
    ctx.strokeRect(x+0.5,y+0.5,Math.max(1,w-1),Math.max(1,h-1));
    ctx.setLineDash([]);
    ctx.font='10px system-ui'; ctx.fillStyle=on?'#ffd678':(p.color||'#98f5d0');
    ctx.fillText(`${p.name}${p.meshName?' · '+p.meshName:''}`, x+4, y+12);
    if(on){ // 8 手柄
      ctx.fillStyle='#ffd678';
      for(const [hx,hy] of [[x,y],[x+w/2,y],[x+w,y],[x,y+h/2],[x+w,y+h/2],[x,y+h],[x+w/2,y+h],[x+w,y+h]])
        ctx.fillRect(hx-3,hy-3,6,6);
    }
  }
}
