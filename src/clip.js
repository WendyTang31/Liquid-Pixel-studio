// 动画片段(clip):把一组【连续状态】当成"一个大动画图层"整体操作 —— 导入的 SVG 走路循环
// (8 个关键帧)即一个 clip。可整体:①设总时长(均分到各帧)②缩放/移动(施加到所有帧的所有形状)
// ③调速(所有过渡统一缓动)④设循环次数(走 N 圈再衔接下一段)。
// 数据:每个状态挂 state.clip = { id, name, loops };同 id 的连续状态 = 同一片段。纯几何,可 node 单测。
import { pathBBox } from './path.js';

// 片段里各状态的下标(按出现顺序)。
export const clipIndicesOf = (states, id) =>
  (id==null) ? [] : states.reduce((a,s,i)=>{ if(s.clip?.id===id) a.push(i); return a; }, []);
export const clipFrameCount = (states, id) => clipIndicesOf(states, id).length;
// 片段总时长 = 各帧(停留+过渡)之和。
export const clipTotalSec = (states, id) =>
  clipIndicesOf(states,id).reduce((t,i)=>t+(states[i].dur||0)+(states[i].hold||0), 0);

// 均分总时长到各帧:纯过渡(hold 清零),还原"整段走路 = totalSec"的节奏。
export function retimeClip(states, id, totalSec){
  const idx=clipIndicesOf(states,id); if(!idx.length) return;
  const per=Math.max(0.02, totalSec/idx.length);
  for(const i of idx){ states[i].dur=per; states[i].hold=0; }
}

// 一组状态的整体包围盒中心(跨所有帧的所有锚点/bbox)——缩放绕此中心,视觉不漂移。
function boxCenter(states, idx){
  let mnX=1e9,mnY=1e9,mxX=-1e9,mxY=-1e9, any=false;
  const seen=(x,y)=>{ any=true; if(x<mnX)mnX=x; if(x>mxX)mxX=x; if(y<mnY)mnY=y; if(y>mxY)mxY=y; };
  for(const i of idx) for(const sh of (states[i]?.shapes||[])){
    if(sh.points) for(const p of sh.points) seen(p.x,p.y);
    else if('x' in sh && 'w' in sh){ seen(sh.x,sh.y); seen(sh.x+sh.w, sh.y+sh.h); }
  }
  return any ? {cx:(mnX+mxX)/2, cy:(mnY+mxY)/2} : {cx:240, cy:240};
}

// 整体变换:围绕【一组状态】的公共中心统一缩放 + 平移,施加到这些状态所有形状(锚点 + 贝塞尔柄 + rig 关节点 + bbox)。
// 相对变换(每次调用施加一次),多次点击累积 —— 无需基线快照,幂等安全。关键帧多选缩放/移动、片段整体变换共用。
export function transformStates(states, indices, {scale=1, dx=0, dy=0}={}){
  if(!indices?.length) return;
  const {cx,cy}=boxCenter(states, indices);
  const tf=p=>{ const nx=cx+(p.x-cx)*scale+dx, ny=cy+(p.y-cy)*scale+dy; p.x=nx; p.y=ny; };
  for(const i of indices) for(const sh of (states[i]?.shapes||[])){
    if(sh.points){ for(const p of sh.points){ tf(p); if(p.hIn)tf(p.hIn); if(p.hOut)tf(p.hOut); }
      Object.assign(sh, pathBBox(sh.points)); }
    else if('x' in sh && 'w' in sh){ const a={x:sh.x,y:sh.y}, b={x:sh.x+sh.w,y:sh.y+sh.h}; tf(a); tf(b);
      sh.x=Math.min(a.x,b.x); sh.y=Math.min(a.y,b.y); sh.w=Math.abs(b.x-a.x); sh.h=Math.abs(b.y-a.y); }
    if(sh.rig?.pivot) tf(sh.rig.pivot);
  }
}
// 片段整体变换 = 对片段所有帧做整体变换。
export function transformClip(states, id, opts){ transformStates(states, clipIndicesOf(states,id), opts); }

// 统一缓动(所有片段过渡)——整体调"起步/落位"的速度感。ease 传空串则清除覆盖(回全局)。
export function setClipEase(states, id, ease){
  for(const i of clipIndicesOf(states,id)){ const s=states[i]; s.trans=s.trans||{};
    if(ease) s.trans.ease=ease; else delete s.trans.ease; }
}
// 循环次数(片段整体重复 N 圈再衔接下一段):写进片段每个状态的 clip.loops(保持一致)。
export function setClipLoops(states, id, loops){
  const n=Math.max(1, Math.round(loops)||1);
  for(const i of clipIndicesOf(states,id)) if(states[i].clip) states[i].clip.loops=n;
}
