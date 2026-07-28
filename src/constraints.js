// 约束层(Fusion 草图思想的点阵版):形状可携带 rel = 对另一形状/中线的持久关系,
// 每次编辑全状态重解(有向传播,拓扑序;成环即断开)。与 Fusion 内核的差别是刻意的:
// 本工具的形状是轴对齐包围盒,没有角度自由度,联立数值求解没有用武之地 ——
// 有向传播给出同样的"定义一次,永远成立",且行为可预测、可撤销。纯函数,node 可测。
import { pathBBox } from './path.js';

const cx=s=>s.x+s.w/2, cy=s=>s.y+s.h/2;
function moveTo(sh,nx,ny){
  const dx=nx-sh.x, dy=ny-sh.y;
  if(sh.type==='path'){ sh.points=sh.points.map(p=>({x:p.x+dx,y:p.y+dy}));
    Object.assign(sh, pathBBox(sh.points)); }
  else { sh.x=nx; sh.y=ny; }
}

// rel 类型:
//  offset  {ref,dx,dy,eqW,eqH} 中心相对 ref 定距(可选持续等宽/等高)
//  size    {ref}               宽高持续等于 ref
//  centerV {p} / centerH {p}   持续对中到中线(像素)
//  mirrorV {ref,p} / mirrorH   对称绑定:本形状 = ref 以中线 p 的镜像
export function solveConstraints(state){
  const byId=new Map(state.shapes.map(s=>[s.id,s]));
  const done=new Set(), stack=new Set();
  const apply=sh=>{
    if(done.has(sh.id)) return;
    if(!sh.rel){ done.add(sh.id); return; }
    if(stack.has(sh.id)){ delete sh.rel; done.add(sh.id); return; } // 成环:断开保安全
    stack.add(sh.id);
    const r=sh.rel, ref=r.ref!=null?byId.get(r.ref):null;
    if(r.ref!=null && !ref){ delete sh.rel; }        // 参照被删:约束失效
    else {
      if(ref) apply(ref);                             // 先解参照,再解自己(拓扑序)
      if(r.type==='offset'){
        if(r.eqW&&sh.type!=='path') sh.w=ref.w;
        if(r.eqH&&sh.type!=='path') sh.h=ref.h;
        moveTo(sh, cx(ref)+r.dx-sh.w/2, cy(ref)+r.dy-sh.h/2);
      } else if(r.type==='size'&&sh.type!=='path'){ sh.w=ref.w; sh.h=ref.h; }
      else if(r.type==='centerV'){ moveTo(sh, r.p-sh.w/2, sh.y); }
      else if(r.type==='centerH'){ moveTo(sh, sh.x, r.p-sh.h/2); }
      else if(r.type==='mirrorV'||r.type==='mirrorH'){
        const v=r.type==='mirrorV';
        if(ref.type==='path'&&sh.type==='path'){
          sh.points=ref.points.map(p=>v?{x:2*r.p-p.x,y:p.y}:{x:p.x,y:2*r.p-p.y});
          Object.assign(sh, pathBBox(sh.points));
        } else if(sh.type!=='path'){
          sh.w=ref.w; sh.h=ref.h;
          if(v){ sh.x=2*r.p-ref.x-ref.w; sh.y=ref.y; }
          else { sh.y=2*r.p-ref.y-ref.h; sh.x=ref.x; }
        }
      }
    }
    stack.delete(sh.id); done.add(sh.id);
  };
  for(const sh of state.shapes) apply(sh);
}
