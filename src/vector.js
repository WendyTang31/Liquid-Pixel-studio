// 矢量图层变形(AE 式关联图层,阶段一):带 layerId 的形状 = "贯穿多个关键帧的同一图层"。
// 它不进点阵系统 —— 停留时按矢量轮廓实心填充,过渡时【直接插值轮廓】(同 layerId 两端的
// 边界点逐点 lerp)再实心填充,不散成点。与现有点阵/metaball 系统并存,互不干扰。
// 数据层(shapes,含 layerId)→ 本模块取轮廓 → 光栅化成 SDF solid,复用既有实心渲染管线。
// 注意:模块顶层保持无 DOM(canvas 懒建、不 import pipeline)——
// 这样纯几何(outline/computeVectorPolys)可在 node 里单测。
import { W, H, SDFSC, SDFW, SDFH } from './config.js';
import { hex2rgb } from './utils.js';
import { distanceField } from './samplers.js';

const OUTN = 120; // 每个轮廓的重采样点数(两端必须一致才能逐点插值)

// 形状 → 稠密边界折线(逻辑坐标)。text 暂不支持矢量变形(返回 null → 退回原实心/溶解)。
function rawOutline(sh){
  if(sh.type==='ellipse'){ const cx=sh.x+sh.w/2, cy=sh.y+sh.h/2, rx=sh.w/2, ry=sh.h/2, pts=[];
    for(let i=0;i<200;i++){ const a=i/200*6.283185307; pts.push({x:cx+rx*Math.cos(a), y:cy+ry*Math.sin(a)}); }
    return pts; }
  if(sh.type==='rect'){ const {x,y,w,h}=sh, c=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]], pts=[];
    for(let e=0;e<4;e++){ const a=c[e], b=c[(e+1)%4]; for(let i=0;i<50;i++){ const t=i/50;
      pts.push({x:a[0]+(b[0]-a[0])*t, y:a[1]+(b[1]-a[1])*t}); } } return pts; }
  if(sh.type==='path' && sh.points?.length>=2) return flattenPath(sh);
  return null;
}
function flattenPath(sh){
  const pts=sh.points, n=pts.length, out=[];
  const push=(x,y)=>out.push({x,y});
  if(sh.bezier){
    for(let i=0;i<n;i++){ const a=pts[i], b=pts[(i+1)%n], c1=a.hOut||a, c2=b.hIn||b;
      for(let k=0;k<16;k++){ const t=k/16, u=1-t;
        push(u*u*u*a.x+3*u*u*t*c1.x+3*u*t*t*c2.x+t*t*t*b.x,
             u*u*u*a.y+3*u*u*t*c1.y+3*u*t*t*c2.y+t*t*t*b.y); } }
  } else { // 老平滑路径:与 fillSmoothClosedPath 一致(过中点的二次曲线)
    const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
    for(let i=0;i<n;i++){ const cur=pts[i], nx=pts[(i+1)%n], m0=mid(pts[(i-1+n)%n],cur), m1=mid(cur,nx);
      for(let k=0;k<12;k++){ const t=k/12, u=1-t;
        push(u*u*m0.x+2*u*t*cur.x+t*t*m1.x, u*u*m0.y+2*u*t*cur.y+t*t*m1.y); } }
  }
  return out;
}

// 闭合折线按弧长等距重采样为 N 点。
function resampleClosed(pts, N){
  const n=pts.length, seg=new Array(n); let total=0;
  for(let i=0;i<n;i++){ const a=pts[i], b=pts[(i+1)%n]; const d=Math.hypot(b.x-a.x,b.y-a.y); seg[i]=d; total+=d; }
  if(total<1e-6) return pts.slice(0,N);
  const out=[]; let i=0, acc=0;
  for(let k=0;k<N;k++){ const target=total*k/N;
    while(i<n-1 && acc+seg[i]<target){ acc+=seg[i]; i++; }
    const t=seg[i]>1e-9?(target-acc)/seg[i]:0, a=pts[i], b=pts[(i+1)%n];
    out.push({x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t});
  }
  return out;
}

// 形状 → 规范化轮廓(N 点、统一绕向、以"质心 +x 方向"最近点为起点)——
// 两个形状各自规范化后,同下标点大致对应(方向/相位一致),逐点插值不打结。
export function outline(sh, N=OUTN){
  const raw=rawOutline(sh); if(!raw||raw.length<3) return null;
  let area=0; for(let i=0;i<raw.length;i++){ const a=raw[i], b=raw[(i+1)%raw.length]; area+=a.x*b.y-b.x*a.y; }
  const ordered = area<0 ? raw.slice().reverse() : raw; // 统一绕向
  const rs=resampleClosed(ordered, N);
  let cx=0,cy=0; for(const p of rs){cx+=p.x;cy+=p.y;} cx/=N; cy/=N;
  let best=0,bd=1e9; for(let i=0;i<N;i++){ const d=Math.abs(Math.atan2(rs[i].y-cy,rs[i].x-cx)); if(d<bd){bd=d;best=i;} }
  return rs.slice(best).concat(rs.slice(0,best));
}

// 一个状态里的矢量图层形状(带 layerId、未隐藏、add)。
export const vectorShapes = state => (state.shapes||[]).filter(sh=>sh.layerId && !sh.hidden && sh.bool!=='sub');
export const hasVector = states => states.some(st=>vectorShapes(st).length>0);

function segAt(SEQ, g){ const {segs,T}=SEQ; g=Math.max(0,Math.min(T-1e-6,g));
  for(const s of segs) if(g>=s.t0 && g<s.t0+s.dur) return {seg:s, lt:(g-s.t0)/s.dur};
  return {seg:segs[0], lt:0}; }
const smooth=t=>t*t*t*(t*(t*6-15)+10);

// 某状态的静态矢量轮廓(编辑态/停留用)。
export function staticVectorPolys(state){
  const out=[]; for(const sh of vectorShapes(state)){ const o=outline(sh); if(o) out.push({poly:o, col:hex2rgb(state.color)}); }
  return out;
}

// 当前全局时间 g 的矢量轮廓:只在【过渡且两端同 layerId】时接管为轮廓变形(逐点 smootherstep)。
// 停留、以及只在一端出现的图层,都交回实心 SDF/点阵系统(前者显实心、后者溶解为点),
// 这样"矢量图层↔普通帧"有溶解过渡而非空白。端点 e=0/1 精确等于两端形状 → 零跳变。
export function computeVectorPolys(states, SEQ, g){
  const {seg, lt}=segAt(SEQ, g);
  if(seg.type==='hold') return []; // 停留由状态实心 SDF 显示,不重复画
  const A=states[seg.a], B=states[seg.b], e=smooth(lt);
  const ca=hex2rgb(A.color), cb=hex2rgb(B.color), out=[];
  const bmap=new Map(vectorShapes(B).map(sh=>[sh.layerId, sh]));
  for(const sa of vectorShapes(A)){ const sb=bmap.get(sa.layerId); if(!sb) continue;
    let poly;
    // 木偶/最短路径变形:同一形状被关键帧化(路径锚点数一致)→ 逐锚点(含贝塞尔控制柄)
    // 各走直线最短路插值。这样"手臂抬起"是每个控制点小幅连贯地移动,而非重采样导致的大变形。
    if(sa.type==='path' && sb.type==='path' && sa.points.length===sb.points.length && sa.points.length>=2){
      const lp=(a,b)=>({x:a.x+(b.x-a.x)*e, y:a.y+(b.y-a.y)*e});
      const pts=sa.points.map((pa,i)=>{ const pb=sb.points[i];
        const q=lp(pa,pb);
        q.hOut=lp(pa.hOut||pa, pb.hOut||pb); q.hIn=lp(pa.hIn||pa, pb.hIn||pb);
        return q; });
      poly=flattenPath({points:pts, bezier: sa.bezier||sb.bezier});
    } else { // 拓扑不同(矩形↔椭圆等)→ 退回弧长轮廓重采样
      const oa=outline(sa), ob=outline(sb); if(!oa||!ob) continue;
      poly=oa.map((p,i)=>({x:p.x+(ob[i].x-p.x)*e, y:p.y+(ob[i].y-p.y)*e}));
    }
    out.push({ poly, col:[ca[0]+(cb[0]-ca[0])*e, ca[1]+(cb[1]-ca[1])*e, ca[2]+(cb[2]-ca[2])*e] });
  }
  return out;
}

// 轮廓多边形(全部并成一个蒙版)→ SDF solid,喂给既有实心渲染(软边/gamma/辉光/镜头一致)。
// canvas 懒建,避免模块顶层依赖 DOM(纯几何部分可 node 单测)。
let _vc=null, _vctx=null;
export function rasterizeVectorSolids(polys){
  if(!polys.length) return [];
  if(!_vc){ _vc=document.createElement('canvas'); _vc.width=SDFW; _vc.height=SDFH;
    _vctx=_vc.getContext('2d',{willReadFrequently:true}); }
  _vctx.setTransform(SDFSC,0,0,SDFSC,0,0); // 逻辑坐标 → 2× 画布,轮廓更细
  _vctx.fillStyle='#000'; _vctx.fillRect(0,0,W,H); _vctx.fillStyle='#fff';
  for(const {poly} of polys){ if(!poly?.length) continue;
    _vctx.beginPath(); _vctx.moveTo(poly[0].x,poly[0].y);
    for(let i=1;i<poly.length;i++) _vctx.lineTo(poly[i].x,poly[i].y);
    _vctx.closePath(); _vctx.fill(); }
  _vctx.setTransform(1,0,0,1,0,0);
  const d=_vctx.getImageData(0,0,SDFW,SDFH).data;
  const on=(x,y)=> x>=0&&y>=0&&x<SDFW&&y<SDFH && d[(y*SDFW+x)*4]>127;
  return [{sdf: distanceField(on, SDFW, SDFH), w:1}];
}
