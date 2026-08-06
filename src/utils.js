// 通用小工具。都是浏览器侧无状态帮手,唯一副作用集中在 DOM 读取,
// 但只在被调用时才碰 document,因此纯函数模块(engine/render/samplers)引它也安全。
import { W, H } from './config.js';

export const $ = id => document.getElementById(id);
export const hex2rgb = h => { h=h||'#000000';
  if(h.length===4) h='#'+h[1]+h[1]+h[2]+h[2]+h[3]+h[3]; // 3 位简写 #abc → #aabbcc(否则蓝通道会 slice 成空 = NaN)
  return [parseInt(h.slice(1,3),16)||0, parseInt(h.slice(3,5),16)||0, parseInt(h.slice(5,7),16)||0]; };
export const FONT = s => `900 ${s}px system-ui, "PingFang SC", sans-serif`;

// 底部提示行。集中一个入口,免得各模块到处缓存 hint 元素。
export const setHint = msg => { const el=$('hint'); if(el) el.textContent=msg; };

export const downloadBlob = (blob,name)=>{ const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),5000); };
export const toBlobP = c => new Promise(res=>c.toBlob(res,'image/png'));
// 让出一帧:rAF 优先(可见时与刷新同步),但隐藏标签页 rAF 不触发 —— 用 setTimeout 兜底,
// 保证导出/编码循环切到后台标签页也能跑完,不会卡死。
export const nextFrame = () => new Promise(res=>{
  let done=false; const go=()=>{ if(!done){ done=true; res(); } };
  requestAnimationFrame(go); setTimeout(go, 32);
});

// 导出目标尺寸:下限 16px,非法输入回退到画布尺寸。
export function getExpSize(){
  return [Math.max(16,parseInt($('expW').value)||W), Math.max(16,parseInt($('expH').value)||H)];
}
