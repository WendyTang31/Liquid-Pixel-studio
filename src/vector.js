// 矢量图层变形(AE 式关联图层,阶段一):带 layerId 的形状 = "贯穿多个关键帧的同一图层"。
// 它不进点阵系统 —— 停留时按矢量轮廓实心填充,过渡时【直接插值轮廓】(同 layerId 两端的
// 边界点逐点 lerp)再实心填充,不散成点。与现有点阵/metaball 系统并存,互不干扰。
// 数据层(shapes,含 layerId)→ 本模块取轮廓 → 光栅化成 SDF solid,复用既有实心渲染管线。
// 注意:模块顶层保持无 DOM(canvas 懒建、不 import pipeline)——
// 这样纯几何(outline/computeVectorPolys)可在 node 里单测。
import { W, H, SDFSC, SDFW, SDFH, P } from './config.js';
import { hex2rgb } from './utils.js';
import { distanceField } from './samplers.js';
import { hasRig, interpPosedShapes } from './rig.js';
import { traceComponents } from './path.js';
import { segEdgeFx, displaceOutline, splatterDropletPolys, polysCentroid } from './edgefx.js';

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
// 任意闭合折线 → 规范化(N 点、统一绕向、以质心 +x 最近点为起点)。轮廓/剪影插值共用。
export function canonicalizePoly(poly, N=OUTN){
  if(!poly||poly.length<3) return null;
  let area=0; for(let i=0;i<poly.length;i++){ const a=poly[i], b=poly[(i+1)%poly.length]; area+=a.x*b.y-b.x*a.y; }
  const ordered = area<0 ? poly.slice().reverse() : poly; // 统一绕向
  const rs=resampleClosed(ordered, N);
  let cx=0,cy=0; for(const p of rs){cx+=p.x;cy+=p.y;} cx/=N; cy/=N;
  let best=0,bd=1e9; for(let i=0;i<N;i++){ const d=Math.abs(Math.atan2(rs[i].y-cy,rs[i].x-cx)); if(d<bd){bd=d;best=i;} }
  return rs.slice(best).concat(rs.slice(0,best));
}
export function outline(sh, N=OUTN){ const raw=rawOutline(sh); return raw ? canonicalizePoly(raw, N) : null; }

// ── 整体剪影变形 ──────────────────────────────────────────────────────────
// 把一个状态里【所有矢量图层形状】合成一张蒙版 → 取各连通块外轮廓 → 规范化。返回轮廓数组。
// 于是"多个图形"先并成一个整体剪影(头/身分离 = 多条轮廓),再整条连续变形,绝不散成点阵。
let _silC=null, _silCtx=null;
// 光栅化+轮廓追踪较重(~50ms),按状态缓存:同一状态在整段过渡的每帧复用,paused 预览与导出都不再逐帧重算。
// 缓存挂在 state._sil(签名 = 各矢量形状的 layerId+包围盒+锚点数);编辑改动经 rasterize 清除(见 pipeline)。
function silSig(shapes){ let s=''; for(const sh of vectorShapesFrom(shapes)){ if(!canMorph(sh)) continue;
  s+=sh.layerId+':'+(sh.x|0)+','+(sh.y|0)+','+(sh.w|0)+','+(sh.h|0)+':'+(sh.points?.length||0)+';'; } return s; }
function stateSilhouette(state, N=OUTN){
  const shapes=state.shapes||state; const sig=silSig(shapes);
  if(state._sil && state._sil.sig===sig) return state._sil.polys;
  if(!_silC){ _silC=document.createElement('canvas'); _silC.width=W; _silC.height=H;
    _silCtx=_silC.getContext('2d',{willReadFrequently:true}); }
  _silCtx.clearRect(0,0,W,H); _silCtx.fillStyle='#fff';
  let any=false;
  for(const sh of vectorShapesFrom(shapes)){ if(!canMorph(sh)) continue;
    const o=rawOutline(sh); if(!o||o.length<3) continue; any=true;
    _silCtx.beginPath(); _silCtx.moveTo(o[0].x,o[0].y);
    for(let i=1;i<o.length;i++) _silCtx.lineTo(o[i].x,o[i].y); _silCtx.closePath(); _silCtx.fill(); }
  let res=[];
  if(any){ const d=_silCtx.getImageData(0,0,W,H).data;
    res=traceComponents((x,y)=> d[(y*W+x)*4+3]>127, W, H)
      .map(c=>canonicalizePoly(c.map(([x,y])=>({x,y})), N)).filter(Boolean); }
  if(state.shapes) state._sil={sig, polys:res};
  return res;
}
const polyCentroid = poly => { let x=0,y=0; for(const p of poly){x+=p.x;y+=p.y;} return {x:x/poly.length, y:y/poly.length}; };
// 两状态整体剪影插值:各连通轮廓按质心就近配对,逐点最短路插值(点数已统一为 N);
// 只在一端存在的轮廓 → 朝自身质心收拢/展开(连续隐没/浮现),而非点阵溶解。
export function silhouetteMorphPolys(A, B, e){
  const ca=stateSilhouette(A), cb=stateSilhouette(B);
  if(!ca.length && !cb.length) return null;
  const usedB=new Set(), out=[], lp=(a,b)=>({x:a.x+(b.x-a.x)*e, y:a.y+(b.y-a.y)*e});
  for(const pa of ca){
    const ka=polyCentroid(pa); let best=-1, bd=Infinity;
    cb.forEach((pb,j)=>{ if(usedB.has(j)) return; const kb=polyCentroid(pb);
      const dd=(ka.x-kb.x)**2+(ka.y-kb.y)**2; if(dd<bd){bd=dd; best=j;} });
    if(best>=0){ usedB.add(best); const pb=alignCyclic(pa, cb[best]);
      out.push(pa.map((p,i)=>lp(p, pb[i]))); }
    else { out.push(pa.map(p=>lp(p, ka))); }        // B 没有对应 → 收拢到质心(连续消失)
  }
  cb.forEach((pb,j)=>{ if(usedB.has(j)) return; const kb=polyCentroid(pb);
    out.push(pb.map(p=>lp(kb, p))); });             // A 没有对应 → 从质心展开(连续出现)
  return out;
}

// 两条等长闭合轮廓的最佳循环对齐:找使逐点平方距离和最小的环移位 → 特征对特征(腿↔腿、手↔手),
// 轮廓插值不打结、不把肢体塌进躯干。O(N²/step),N=120 时每对几千次运算,逐帧可承受。
function alignCyclic(oa, ob){
  const N=ob.length; if(oa.length!==N) return ob;
  let best=0, bd=Infinity;
  for(let s=0;s<N;s++){ let d=0;
    for(let i=0;i<N;i+=3){ const a=oa[i], b=ob[(i+s)%N]; d+=(a.x-b.x)**2+(a.y-b.y)**2; if(d>=bd)break; }
    if(d<bd){ bd=d; best=s; } }
  return best ? ob.slice(best).concat(ob.slice(0,best)) : ob;
}

// 一个形状能否做矢量轮廓变形(text / 无效路径不行 → 交回点阵溶解)。
const canMorph = sh => !!sh && (sh.type==='ellipse' || sh.type==='rect' || (sh.type==='path' && sh.points?.length>=2));
// 一组 shapes / 一个状态里的矢量图层形状(带 layerId、未隐藏、add)。
export const vectorShapesFrom = shapes => (shapes||[]).filter(sh=>sh.layerId && !sh.hidden && sh.bool!=='sub');
export const vectorShapes = state => vectorShapesFrom(state.shapes);
export const hasVector = states => states.some(st=>vectorShapes(st).length>0);

// 形状包围盒中心/尺寸(相似度配对用;path 也维护 x/y/w/h)。
const shapeBox = sh => ({cx:(sh.x||0)+(sh.w||0)/2, cy:(sh.y||0)+(sh.h||0)/2, w:sh.w||0, h:sh.h||0});
// 相似度分数(越小越像):同类型优先、中心近、尺寸近、path 锚点数近(锚点数一致才能走木偶逐点)。
function simScore(a,b){
  const A=shapeBox(a), B=shapeBox(b);
  let s=Math.hypot(A.cx-B.cx, A.cy-B.cy) + 0.5*(Math.abs(A.w-B.w)+Math.abs(A.h-B.h));
  if(a.type!==b.type) s+=500;
  if(a.type==='path'&&b.type==='path') s+=Math.abs((a.points?.length||0)-(b.points?.length||0))*20;
  return s;
}

// 两状态间的矢量图层配对:先按 layerId 精确配,再把"改过 id / 删了重画"的落单图层按相似度就近配 ——
// 这样删掉一部分再重画(拿到新 layerId)也不会退化成点阵溶解/闪烁,而是连贯的轮廓变形。
// 返回 { pairs:[{sa,sb}], lids:Set }:lids = 所有被配上的 layerId(两侧都收进来),引擎据此抑制
// 这些点的溶解 → 由轮廓变形独占渲染,消除"既溶解又变形"的重影与"消失再出现"的闪烁。
// 本段过渡的【生效模式】:目标的入场 morphIn 优先,其次源的出场 morphOut,默认矢量。
// 于是:在 B 上设『入场』(morphIn)即可控制"来"的方式 —— 即使 A 已设出场、或 A 里没有对应形状(新出现)。
const transMode=(sa,sb)=> ((sa&&sa.morphLock==='frozen')||(sb&&sb.morphLock==='frozen')) ? 'frozen'
  : (sb&&sb.morphIn) || (sa&&sa.morphOut) || 'vector'; // 🔒 冻结:任一端锁定 → 不参与变形,静止
export function pairVectorShapes(shapesA, shapesB){
  const A=vectorShapesFrom(shapesA).filter(canMorph);
  const B=(shapesB||[]).filter(sh=>sh && !sh.hidden && sh.bool!=='sub' && canMorph(sh));
  const pairs=[], lids=new Set(), usedB=new Set();
  const bByLid=new Map(); for(const sb of B) if(sb.layerId!=null && !bByLid.has(sb.layerId)) bByLid.set(sb.layerId, sb);
  const add=(sa,sb,mode)=>{ pairs.push({sa,sb,mode}); if(sa?.layerId!=null)lids.add(sa.layerId); if(sb?.layerId!=null)lids.add(sb.layerId); };
  const leftoverA=[];
  for(const sa of A){ const sb=bByLid.get(sa.layerId);            // ① 精确 layerId
    if(sb && !usedB.has(sb)){ usedB.add(sb); const m=transMode(sa,sb);
      if(m!=='dots') add(sa,sb,m); }                              // dots → 两端溶解,不进矢量
    else leftoverA.push(sa); }
  for(const sa of leftoverA){                                     // ② 落单源(无同 layerId 目标)
    if(sa.morphOut==='dots') continue;
    // 约束范围:free=可配任意图形;链接=仅同组;否则=只和自己 → 收拢消失,不去抢别的图形。
    const scope = sa.morphLock==='free' ? 'all' : (sa.linkGroup!=null ? 'group' : 'self');
    if(scope==='self'){ add(sa, null, transMode(sa,null)); continue; }
    let best=null,bd=Infinity, bestFree=null,bf=Infinity;
    for(const sb of B){ if(scope==='group' && sb.linkGroup!==sa.linkGroup) continue; const s=simScore(sa,sb);
      if(s<bd){bd=s;best=sb;} if(!usedB.has(sb)&&s<bf){bf=s;bestFree=sb;} }
    const target=bestFree||best, m=transMode(sa,target);
    if(m!=='dots'){ add(sa, target||null, m); if(bestFree) usedB.add(bestFree); }
  }
  for(const sb of B){                                             // ③ 落单目标(新出现的形状)
    if(usedB.has(sb)||sb.layerId==null) continue;
    if(sb.morphLock==='frozen') add(null, sb, 'frozen');          // 🔒 冻结 → 静止显示,不溶解
    else if(sb.morphIn && sb.morphIn!=='dots') add(null, sb, sb.morphIn); // 有入场 → 浮现/硬切入,否则默认点阵溶入
  }
  return {pairs, lids};
}

function segAt(SEQ, g){ const {segs,T}=SEQ; g=Math.max(0,Math.min(T-1e-6,g));
  for(const s of segs) if(g>=s.t0 && g<s.t0+s.dur) return {seg:s, lt:(g-s.t0)/s.dur};
  return {seg:segs[0], lt:0}; }
const smooth=t=>t*t*t*(t*(t*6-15)+10);

// 某状态的静态矢量轮廓(编辑态/停留用)。
export function staticVectorPolys(state){
  const out=[]; for(const sh of vectorShapes(state)){ const o=outline(sh); if(o) out.push({poly:o, col:hex2rgb(state.color)}); }
  return out;
}
// 停留期【所有实心形状】(solidFill 或矢量图层,含无 layerId 的普通实心)的规范化轮廓 —— 边缘几何 fx 用,
// 让"细波/锯齿/飞溅"对任意实心圆/方/路径都生效,不限于被关键帧化的矢量图层。
export function solidOutlinePolys(state){
  const out=[], col=hex2rgb(state.color);
  for(const sh of (state.shapes||[])){
    if(sh.hidden || sh.bool==='sub' || !(sh.solidFill || sh.layerId!=null)) continue;
    const o=outline(sh); if(o) out.push({poly:o, col, strokeW:sh.strokeW||0}); // 保留描边宽度,边缘几何后仍描边不填实
  }
  return out;
}

// 当前全局时间 g 的矢量轮廓:只在【过渡且两端同 layerId】时接管为轮廓变形(逐点 smootherstep)。
// 停留、以及只在一端出现的图层,都交回实心 SDF/点阵系统(前者显实心、后者溶解为点),
// 这样"矢量图层↔普通帧"有溶解过渡而非空白。端点 e=0/1 精确等于两端形状 → 零跳变。
// 找某状态里指定 layerId 的可变形形状(样条取相邻帧同一肢体用)。
const shapeByLid=(state,lid)=> lid==null?null : (state?.shapes||[]).find(s=>s&&s.layerId===lid && s.type==='path') || null;
// 单调三次 Hermite(Fritsch–Carlson 限斜):p1→p2 端点,p0/p3 为前/后相邻关键帧;速度用中心差分,
// 但按【相邻两条弦的斜率】夹逼 —— 相邻帧大小差很大时(一大一小)不再过冲成"大色块",极值点(该坐标反向)
// 处速度归零(肢体摆到端点自然反向)。大小相近时 ≈ Catmull-Rom,依旧 C1 连续、无"减速再加速"卡顿。
// 相邻两段在共享关键帧算出的速度完全一致(同 p0/p1/p2/时长)→ 跨段 dP/dt 相等,连续性不破。
function clampSlope(v, a, b){
  if(a*b<=0) return 0;                                   // 两侧弦反向 → 极值点,速度 0(防过冲)
  const m=3*Math.min(Math.abs(a),Math.abs(b));           // |切线| ≤ 3× 较小邻边弦斜率
  return v>m ? m : (v<-m ? -m : v);
}
function hermite1(p0,p1,p2,p3, durPrev,dur,durNext, u){
  const d = (p2-p1)/dur;                                 // 本段弦斜率(单位/秒)
  const dPrev = (p0!=null) ? (p1-p0)/durPrev : d;        // p1 左邻弦斜率
  const dNext = (p3!=null) ? (p3-p2)/durNext : d;        // p2 右邻弦斜率
  let v1 = (p0!=null) ? (p2-p0)/(durPrev+dur) : d;       // p1 处速度(中心差分)
  let v2 = (p3!=null) ? (p3-p1)/(dur+durNext) : d;       // p2 处速度
  v1 = clampSlope(v1, dPrev, d);
  v2 = clampSlope(v2, d, dNext);
  const u2=u*u, u3=u2*u;
  const h00=2*u3-3*u2+1, h10=u3-2*u2+u, h01=-2*u3+3*u2, h11=u3-u2;
  return h00*p1 + h01*p2 + h10*(dur*v1) + h11*(dur*v2);
}
// 单个控制点(锚点 + 贝塞尔柄)的 Hermite 插值。缺柄时以锚点代替(柄收拢),与直线插值口径一致。
function hermitePt(pa,pb,pp,pn, seg, u){
  const H=(a,b,p,n,k)=>hermite1(p?p[k]:null, a[k], b[k], n?n[k]:null, seg.durPrev, seg.dur, seg.durNext, u);
  const q={ x:H(pa,pb,pp,pn,'x'), y:H(pa,pb,pp,pn,'y') };
  const ao=pa.hOut||pa, bo=pb.hOut||pb, po=pp?(pp.hOut||pp):null, no=pn?(pn.hOut||pn):null;
  const ai=pa.hIn||pa,  bi=pb.hIn||pb,  pi=pp?(pp.hIn||pp):null,  ni=pn?(pn.hIn||pn):null;
  q.hOut={ x:H(ao,bo,po,no,'x'), y:H(ao,bo,po,no,'y') };
  q.hIn ={ x:H(ai,bi,pi,ni,'x'), y:H(ai,bi,pi,ni,'y') };
  return q;
}

export function computeVectorPolys(states, SEQ, g, time, Pr, includeHold=false){
  const Pcfg = Pr || P; // 渲染参数:调用方传入(视口/3D 各自 P);未传时退回全局配置 P(node 单测)
  const {seg, lt}=segAt(SEQ, g);
  // 停留:主编辑器由状态实心 SDF 显示,故默认返回空(不重复画)。但【角色】只走本函数、无 SDF 兜底,
  // 必须 includeHold=true 才能在停留帧画出静态轮廓 —— 否则带 hold 的帧(如抬头停顿)会整段消失(闪烁)。
  if(seg.type==='hold') return includeHold ? solidOutlinePolys(states[seg.si]) : [];
  const A=states[seg.a], B=states[seg.b], e=(seg.ease||smooth)(lt); // 与点阵同一速度曲线(可调起步/落位)
  const ca=hex2rgb(A.color), cb=hex2rgb(B.color), out=[];
  // 🌊 整体剪影变形:把两状态各自【所有矢量图层】并成一个剪影(多连通=多轮廓),整条轮廓逐点最短路
  // 连续插值(点数已统一),只在一端存在的轮廓朝质心收拢/展开 —— 全程连续,绝不散成点阵。
  if(Pcfg.silhouette && !hasRig(A.shapes) && !hasRig(B.shapes)){
    const polys=silhouetteMorphPolys(A, B, e);
    if(polys){ const col=[ca[0]+(cb[0]-ca[0])*e, ca[1]+(cb[1]-ca[1])*e, ca[2]+(cb[2]-ca[2])*e];
      return polys.map(poly=>({poly, col})); }
  }
  // 🦴 骨骼层:过渡时插值【关节角度】→ FK 摆姿势 → 肢体成弧线摆动(不穿透/不缩短)。按 layerId 取用。
  const rigged=(hasRig(A.shapes)||hasRig(B.shapes)) ? interpPosedShapes(A.shapes, B.shapes, e) : null;
  const rigByLid=rigged ? new Map(rigged.filter(s=>s&&s.rig&&s.layerId!=null).map(s=>[s.layerId,s])) : null;
  const {pairs}=pairVectorShapes(A.shapes, B.shapes); // 精确 + 相似度就近配对(与引擎抑制口径一致)
  for(const {sa, sb, mode} of pairs){
    let poly;
    if(mode==='frozen'){ // 🔒 冻结:不受任何变形影响,保持自身轮廓静止
      const src=sa||sb; const o=outline(src); if(!o) continue;
      out.push({poly:o, strokeW:(src.strokeW||0), col: sa?[ca[0],ca[1],ca[2]]:[cb[0],cb[1],cb[2]]}); continue;
    }
    if(mode==='cut'){ // ✂️ 直切:不插值,中点前=源、之后=目标(硬切);源或目标缺一侧 → 该半段空(切入/切出)
      const atB=e>=0.5, src=atB?sb:sa, sc=atB?cb:ca;
      if(!src) continue; const o=outline(src); if(!o) continue;
      out.push({poly:o, strokeW:(src.strokeW||0), col:[sc[0],sc[1],sc[2]]}); continue;
    }
    if(!sa){ // 新出现的形状(仅目标端有):从质心【连续展开】浮现(入场=矢量)
      const ob=outline(sb); if(!ob) continue;
      let cx=0,cy=0; for(const p of ob){cx+=p.x;cy+=p.y;} cx/=ob.length; cy/=ob.length;
      out.push({poly:ob.map(p=>({x:cx+(p.x-cx)*e, y:cy+(p.y-cy)*e})), strokeW:(sb.strokeW||0), col:[cb[0],cb[1],cb[2]]}); continue;
    }
    if(!sb){ // 无目标图层(下一状态全空)→ 收拢到自身质心,连续缩小消失,绝不退化成点阵
      const oa=outline(sa); if(!oa) continue;
      let cx=0,cy=0; for(const p of oa){cx+=p.x;cy+=p.y;} cx/=oa.length; cy/=oa.length;
      poly=oa.map(p=>({x:p.x+(cx-p.x)*e, y:p.y+(cy-p.y)*e}));
    }
    else if(sa.rig && rigByLid?.has(sa.layerId)){ // 骨骼:用弧线插值后的世界轮廓
      const w=rigByLid.get(sa.layerId); poly=flattenPath({points:w.points, bezier:w.bezier});
    }
    // 木偶/最短路径变形:同一形状被关键帧化(路径锚点数一致)→ 逐锚点(含贝塞尔控制柄)
    // 各走直线最短路插值。这样"手臂抬起"是每个控制点小幅连贯地移动,而非重采样导致的大变形。
    else if(sa.type==='path' && sb.type==='path' && sa.points.length===sb.points.length && sa.points.length>=2){
      let pts;
      // 🌊 片段内连续运动:样条过关键帧(相邻帧同 layerId 肢体给切线)→ 速度 C1 连续,无衔接卡顿。
      const pp=seg.spline ? shapeByLid(states[seg.aPrev], sa.layerId) : null;
      const pn=seg.spline ? shapeByLid(states[seg.bNext], sa.layerId) : null;
      const okPrev=pp && pp.points.length===sa.points.length, okNext=pn && pn.points.length===sa.points.length;
      if(seg.spline && (okPrev || okNext)){
        pts=sa.points.map((pa,i)=> hermitePt(pa, sb.points[i], okPrev?pp.points[i]:null, okNext?pn.points[i]:null, seg, lt));
      } else {
        const lp=(a,b)=>({x:a.x+(b.x-a.x)*e, y:a.y+(b.y-a.y)*e}); // 无样条:仍走可调速的直线最短路
        pts=sa.points.map((pa,i)=>{ const pb=sb.points[i];
          const q=lp(pa,pb);
          q.hOut=lp(pa.hOut||pa, pb.hOut||pb); q.hIn=lp(pa.hIn||pa, pb.hIn||pb);
          return q; });
      }
      poly=flattenPath({points:pts, bezier: sa.bezier||sb.bezier});
    } else { // 拓扑不同(锚点数不等/矩形↔椭圆)→ 弧长轮廓重采样,但先做最佳循环对齐:
      // 找使逐点距离和最小的环移位,让"腿对腿、手对手"—— 否则相位错位会把腿插值进躯干、中间帧腿消失。
      const oa=outline(sa), ob0=outline(sb); if(!oa||!ob0) continue;
      const ob=alignCyclic(oa, ob0);
      poly=oa.map((p,i)=>({x:p.x+(ob[i].x-p.x)*e, y:p.y+(ob[i].y-p.y)*e}));
    }
    // 🖊 描边形状:过渡时也保持"只描轮廓"(线宽在两端间插值),而不是把轮廓填成实心。
    const sw=(sa.strokeW||0)*(1-e) + ((sb&&sb.strokeW)||0)*e;
    out.push({ poly, strokeW:sw>0.1?sw:0,
      col:[ca[0]+(cb[0]-ca[0])*e, ca[1]+(cb[1]-ca[1])*e, ca[2]+(cb[2]-ca[2])*e] });
  }
  // 🌟 边缘几何 fx 贯穿过渡:全局 efx 按 scope/区间判定(span 且两端都在范围内)→ 位移形变的轮廓 + 飞溅水珠。
  const efx = (time!=null) ? segEdgeFx(Pcfg, seg, states) : null;
  if(efx && out.length){
    const c=polysCentroid(out);
    const disp=out.map(o=>({...o, poly:displaceOutline(o.poly, c.x, c.y, time, efx)}));
    const drops=splatterDropletPolys(out[0].poly, c.x, c.y, time, efx, out[0].col);
    return [...disp, ...drops];
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
  _vctx.fillStyle='#000'; _vctx.fillRect(0,0,W,H); _vctx.fillStyle='#fff'; _vctx.strokeStyle='#fff';
  _vctx.lineJoin='round'; _vctx.lineCap='round';
  for(const {poly, strokeW} of polys){ if(!poly?.length) continue;
    _vctx.beginPath(); _vctx.moveTo(poly[0].x,poly[0].y);
    for(let i=1;i<poly.length;i++) _vctx.lineTo(poly[i].x,poly[i].y);
    _vctx.closePath();
    if(strokeW>0){ _vctx.lineWidth=strokeW; _vctx.stroke(); } // 🖊 描边形状:轮廓描成线,不填实心
    else _vctx.fill(); }
  _vctx.setTransform(1,0,0,1,0,0);
  const d=_vctx.getImageData(0,0,SDFW,SDFH).data;
  const on=(x,y)=> x>=0&&y>=0&&x<SDFW&&y<SDFH && d[(y*SDFW+x)*4]>127;
  return [{sdf: distanceField(on, SDFW, SDFH), w:1}];
}
