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
//  edgegap {myEdge, off, ref+refEdge | gref} CAD 式边距标注:本形状某条边与
//          "另一形状某条边 / 某条中线" 保持带号距离 off(创建时记方向,改值只改大小)
const edgeCoord=(s,e)=> e==='l'?s.x : e==='r'?s.x+s.w : e==='t'?s.y : s.y+s.h;
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
      else if(r.type==='edgegap'){
        let pos=null;
        if(ref) pos=edgeCoord(ref, r.refEdge);
        else if(r.gref!=null){ const g=(state.guides||[]).find(x=>x.id===r.gref);
          if(g) pos=g.p; else delete sh.rel; }   // 中线被删:约束失效
        if(pos!=null){
          const horiz=(r.myEdge==='l'||r.myEdge==='r');
          const target=pos+r.off-(r.myEdge==='r'?sh.w:0)-(r.myEdge==='b'?sh.h:0);
          if(horiz) moveTo(sh, target, sh.y); else moveTo(sh, sh.x, target);
        }
      }
      else if(r.type==='centerV'||r.type==='centerH'){
        // 优先引用中线 id(拖中线,对中形状实时跟);中线被删则退回创建时的静态位置
        let p=r.p;
        if(r.gref!=null){ const g=(state.guides||[]).find(x=>x.id===r.gref); if(g){ p=g.p; r.p=g.p; } }
        if(r.type==='centerV') moveTo(sh, p-sh.w/2, sh.y); else moveTo(sh, sh.x, p-sh.h/2);
      }
      else if(r.type==='mirrorV'||r.type==='mirrorH'){
        const v=r.type==='mirrorV';
        if(r.gref!=null){ const g=(state.guides||[]).find(x=>x.id===r.gref); if(g) r.p=g.p; }
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
