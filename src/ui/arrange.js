// 排列工具(计算式绘图 v1):对齐 / 等距分布 / 等尺寸 / 镜像复制 / 数值阵列。
// 调研结论:完整几何约束求解器(Fusion/SolveSpace 的 parallel/tangent 方程组)对本工具过重;
// 设计软件的行业范式(Figma/Illustrator)= 对齐+分布+阵列+镜像+数值输入+磁吸,
// 已能把"手画的三条线"变成数学上严格等距等宽的三条线 —— 这是 LED 点阵最需要的确定性。
// 全部操作走 applyShapeBBox 统一写入口(path 锚点缩放、text 字号定宽在那一处处理)。
import { W, H } from '../config.js';
import { store, cur } from '../store.js';
import { $, setHint } from '../utils.js';
import { pushUndo } from '../state.js';
import { shapesChanged } from '../pipeline.js';
import { applyShapeBBox } from '../shapes.js';
import { pathBBox } from '../path.js';
import { updateSelBox } from './inspector.js';

// 参与排列的形状:多选优先,否则单选;锁定/隐藏的不动。
const targets=()=>{
  const list=store.selMulti?.length?store.selMulti:(store.sel?[store.sel]:[]);
  return list.filter(sh=>!sh.locked&&!sh.hidden);
};
const done=n=>{ shapesChanged(cur()); updateSelBox(); setHint(`✓ 已排列 ${n} 个形状`); };

function align(kind){
  const ts=targets(); if(ts.length<2){ setHint('对齐需要多选 ≥2(Shift+点选或框选)'); return; }
  pushUndo();
  const L=Math.min(...ts.map(s=>s.x)), R=Math.max(...ts.map(s=>s.x+s.w));
  const T=Math.min(...ts.map(s=>s.y)), B=Math.max(...ts.map(s=>s.y+s.h));
  for(const s of ts){
    const nx = kind==='l'?L : kind==='r'?R-s.w : kind==='c'?(L+R)/2-s.w/2 : s.x;
    const ny = kind==='t'?T : kind==='b'?B-s.h : kind==='m'?(T+B)/2-s.h/2 : s.y;
    applyShapeBBox(s, nx, ny, s.w, s.h);
  }
  done(ts.length);
}

// 等距分布:按中心排序,首尾定住,中心严格等差 —— "三条线间距一样"的数学保证。
function distribute(axis){
  const ts=targets(); if(ts.length<3){ setHint('等距需要多选 ≥3'); return; }
  pushUndo();
  const c=s=>axis==='x'?s.x+s.w/2:s.y+s.h/2;
  const sorted=[...ts].sort((a,b)=>c(a)-c(b));
  const c0=c(sorted[0]), c1=c(sorted[sorted.length-1]);
  sorted.forEach((s,i)=>{
    const ci=c0+(c1-c0)*i/(sorted.length-1);
    applyShapeBBox(s, axis==='x'?ci-s.w/2:s.x, axis==='y'?ci-s.h/2:s.y, s.w, s.h);
  });
  done(ts.length);
}

// 等尺寸:全部改成主选中(最后点的那个)的宽/高 —— "同样笔画粗细"。
function equalize(dim){
  const ts=targets(); if(ts.length<2){ setHint('等尺寸需要多选 ≥2'); return; }
  const ref=store.sel&&ts.includes(store.sel)?store.sel:ts[ts.length-1];
  pushUndo();
  for(const s of ts){ if(s===ref) continue;
    applyShapeBBox(s, s.x, s.y, dim==='w'?ref.w:s.w, dim==='h'?ref.h:s.h);
  }
  done(ts.length);
}

// 镜像复制:按画布中线复制出对称件(path 逐锚点镜像;text 只镜像位置,字形不翻)。
function mirror(axis){
  const ts=targets(); if(!ts.length){ setHint('先选中要镜像的形状'); return; }
  pushUndo();
  const s0=cur(), made=[];
  for(const s of ts){
    const c=JSON.parse(JSON.stringify({...s, id:undefined})); c.id=store.shapeId++;
    delete c._img; // 图片运行时缓存不复制,revive 机制会补
    if(s.type==='path'){
      c.points=s.points.map(p=>axis==='h'?{x:W-p.x,y:p.y}:{x:p.x,y:H-p.y});
      Object.assign(c, pathBBox(c.points));
    } else if(axis==='h') c.x=W-s.x-s.w; else c.y=H-s.y-s.h;
    if(s.type==='image'&&s._img) Object.defineProperty(c,'_img',{value:s._img,enumerable:false,configurable:true});
    s0.shapes.push(c); made.push(c);
  }
  store.selMulti=made; store.sel=made[made.length-1];
  done(made.length);
}

// 阵列:每个选中形状按 (ΔX,ΔY) 重复到共 N 个 —— 等间距由数字保证,不靠手感。
function array(){
  const ts=targets(); if(!ts.length){ setHint('先选中要阵列的形状'); return; }
  const n=parseInt($('arrN').value), dx=parseFloat($('arrDX').value)||0, dy=parseFloat($('arrDY').value)||0;
  if(!isFinite(n)||n<2||n>60){ setHint('阵列数量需为 2~60'); return; }
  if(Math.abs(dx)<0.5&&Math.abs(dy)<0.5){ setHint('ΔX/ΔY 至少一项非 0(像素)'); return; }
  pushUndo();
  const s0=cur(), made=[];
  for(const s of ts) for(let k=1;k<n;k++){
    const c=JSON.parse(JSON.stringify({...s, id:undefined})); c.id=store.shapeId++;
    delete c._img;
    if(s.type==='path'){ c.points=s.points.map(p=>({x:p.x+dx*k, y:p.y+dy*k}));
      Object.assign(c, pathBBox(c.points)); }
    else { c.x=s.x+dx*k; c.y=s.y+dy*k; }
    if(s.type==='image'&&s._img) Object.defineProperty(c,'_img',{value:s._img,enumerable:false,configurable:true});
    s0.shapes.push(c); made.push(c);
  }
  store.selMulti=[...ts, ...made];
  done(ts.length+made.length);
}

export function initArrange(){
  $('alL').onclick=()=>align('l'); $('alC').onclick=()=>align('c'); $('alR').onclick=()=>align('r');
  $('alT').onclick=()=>align('t'); $('alM').onclick=()=>align('m'); $('alB').onclick=()=>align('b');
  $('dsH').onclick=()=>distribute('x'); $('dsV').onclick=()=>distribute('y');
  $('eqW').onclick=()=>equalize('w'); $('eqH').onclick=()=>equalize('h');
  $('mrH').onclick=()=>mirror('h'); $('mrV').onclick=()=>mirror('v');
  $('arrGo').onclick=array;
}
