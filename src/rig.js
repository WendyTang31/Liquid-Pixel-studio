// FK 骨骼绑定(After Effects 父子链式):给 path 形状加
//   rig = { parent: 父级 layerId | null, pivot: {x,y}(关节点/锚点,画布坐标), rot: 度(本状态的关节角) }
// 旋转某关节 → 它与其【所有子级】绕该关节点刚性转动(手臂/腿成弧线摆动,长度不变、不穿透)。
// rot 逐状态存 → 过渡时插值【关节角度】(走最短路)而非点位 → 天然弧线运动 = 真正的走路循环。
// 纯几何(不碰 DOM),可 node 单测。渲染前用 poseShapes 把 rig 形状"摆好姿势"(点变到世界坐标)。
const D2R=Math.PI/180;

// 2×3 仿射 [a,b,c,d,e,f]:x'=a·x+c·y+e, y'=b·x+d·y+f
export const rigIdent=()=>[1,0,0,1,0,0];
function rotAbout(px,py,deg){ const r=deg*D2R, c=Math.cos(r), s=Math.sin(r);
  return [c,s,-s,c, px-c*px+s*py, py-s*px-c*py]; }         // 绕 (px,py) 旋转 deg
function mul(A,B){ return [                                 // A∘B(先 B 后 A)
  A[0]*B[0]+A[2]*B[1], A[1]*B[0]+A[3]*B[1],
  A[0]*B[2]+A[2]*B[3], A[1]*B[2]+A[3]*B[3],
  A[0]*B[4]+A[2]*B[5]+A[4], A[1]*B[4]+A[3]*B[5]+A[5] ]; }
export function rigApply(M,x,y){ return {x:M[0]*x+M[2]*y+M[4], y:M[1]*x+M[3]*y+M[5]}; }

// 是否有可绑定的 rig 形状(带 rig 且带 layerId)。
export const hasRig = shapes => (shapes||[]).some(sh=>sh && sh.rig && sh.layerId!=null);

// 每个 rig 层的世界矩阵(按 layerId 组父子链)。Map(layerId → 2×3 矩阵)。guard 防环(自引用/成环退回单位阵)。
export function rigMatrices(shapes){
  const byLid=new Map(); for(const sh of shapes||[]) if(sh && sh.layerId!=null && sh.rig) byLid.set(sh.layerId, sh);
  const cache=new Map(), guard=new Set();
  const solve=sh=>{ const lid=sh.layerId;
    if(cache.has(lid)) return cache.get(lid);
    if(guard.has(lid)) return rigIdent();                  // 成环 → 退回单位阵,不死循环
    guard.add(lid);
    const rig=sh.rig, local=rotAbout(rig.pivot?.x||0, rig.pivot?.y||0, rig.rot||0);
    const par=(rig.parent!=null && byLid.has(rig.parent) && rig.parent!==lid) ? byLid.get(rig.parent) : null;
    const W=par ? mul(solve(par), local) : local;
    cache.set(lid, W); guard.delete(lid); return W; };
  for(const sh of byLid.values()) solve(sh);
  return cache;
}

function xfPt(M, pt){ const o=rigApply(M, pt.x, pt.y);
  if(pt.hIn) o.hIn=rigApply(M, pt.hIn.x, pt.hIn.y);
  if(pt.hOut) o.hOut=rigApply(M, pt.hOut.x, pt.hOut.y);
  return o; }

// 摆好姿势:把每个 rig 形状的 points 变换到世界坐标(其余形状原样返回)。渲染/采样前调用。
export function poseShapes(shapes){
  const mats=rigMatrices(shapes);
  if(!mats.size) return shapes;
  return shapes.map(sh=>{ if(!sh || !sh.rig || sh.layerId==null || !sh.points) return sh;
    const M=mats.get(sh.layerId); if(!M) return sh;
    return {...sh, points: sh.points.map(pt=>xfPt(M,pt))}; });
}

// 角度插值走最短路(避免 350°→10° 绕一大圈)。
export function lerpAngle(a,b,e){ let d=((b-a)%360+540)%360-180; return a+d*e; }

// 过渡:两状态间按 e 插值(关节角走最短路 + pivot + 静息点位),再摆姿势 → 世界形状。
// 用于矢量 morph:rig 层走"角度插值→FK",肢体成弧线摆动(而非点位直线插值的穿透/缩短)。
export function interpPosedShapes(shapesA, shapesB, e){
  const bByLid=new Map(); for(const sh of shapesB||[]) if(sh && sh.layerId!=null) bByLid.set(sh.layerId, sh);
  const lp=(a,b)=>a+(b-a)*e;
  const interp=(shapesA||[]).map(sa=>{
    if(!sa || !sa.rig || sa.layerId==null) return sa;
    const sb=bByLid.get(sa.layerId);
    const ra=sa.rig, rb=(sb&&sb.rig)||ra;
    const rot=lerpAngle(ra.rot||0, rb.rot||0, e);
    const pivot={ x:lp(ra.pivot?.x||0, rb.pivot?.x ?? (ra.pivot?.x||0)),
                  y:lp(ra.pivot?.y||0, rb.pivot?.y ?? (ra.pivot?.y||0)) };
    // 静息点位:两端锚点数一致则逐点插值(肢体也可微变形),否则用 A 端
    const points=(sa.points && sb?.points && sa.points.length===sb.points.length)
      ? sa.points.map((pa,i)=>{ const pb=sb.points[i], o={x:lp(pa.x,pb.x), y:lp(pa.y,pb.y)};
          if(pa.hIn&&pb.hIn) o.hIn={x:lp(pa.hIn.x,pb.hIn.x),y:lp(pa.hIn.y,pb.hIn.y)};
          if(pa.hOut&&pb.hOut) o.hOut={x:lp(pa.hOut.x,pb.hOut.x),y:lp(pa.hOut.y,pb.hOut.y)};
          return o; })
      : sa.points;
    return {...sa, points, rig:{...ra, rot, pivot}};
  });
  return poseShapes(interp);
}
