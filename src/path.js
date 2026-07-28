// 路径几何工具:钢笔工具用。RDP 简化、包围盒都是纯函数,可独立单测;
// fillSmoothClosedPath 只用 canvas 2D 上下文构建路径(beginPath..closePath),
// 不读取任何画布状态,调用方决定 fill() 还是 stroke()(分别用于蒙版光栅化与编辑态描边预览)。

// Ramer-Douglas-Peucker:把手绘的密集原始轨迹点简化成少量锚点,只保留形状特征,
// 方便后续拖动编辑(密集原始点根本没法一个个拖)。只删点、不新增点、不挪动保留点的坐标。
export function rdpSimplify(points, epsilon){
  if(points.length<3) return points.slice();
  const perpDist=(p,a,b)=>{
    const dx=b.x-a.x, dy=b.y-a.y, len2=dx*dx+dy*dy;
    if(len2<1e-9) return Math.hypot(p.x-a.x,p.y-a.y);
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2));
    return Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
  };
  const run=pts=>{
    if(pts.length<3) return pts;
    let maxD=0, idx=0;
    for(let i=1;i<pts.length-1;i++){
      const d=perpDist(pts[i],pts[0],pts[pts.length-1]);
      if(d>maxD){maxD=d;idx=i;}
    }
    if(maxD>epsilon){
      const left=run(pts.slice(0,idx+1)), right=run(pts.slice(idx));
      return left.slice(0,-1).concat(right);
    }
    return [pts[0], pts[pts.length-1]];
  };
  return run(points);
}

// 包围盒:选中框、拖拽命中测试、缩放变换的基准。
export function pathBBox(points){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of points){ if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x;
    if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; }
  return {x:minX, y:minY, w:Math.max(1,maxX-minX), h:Math.max(1,maxY-minY)};
}

// 闭合平滑路径:经过每个锚点中点的二次曲线(标准"手绘轮廓平滑"技法)—— 视锚点序列
// 为环形,不需要用户手动"闭合",画完即是可填充区域。构建路径后由调用方 fill()/stroke()。
export function fillSmoothClosedPath(ctx, points){
  const n=points.length;
  if(n<3) return false;
  const mid=(a,b)=>({x:(a.x+b.x)/2, y:(a.y+b.y)/2});
  ctx.beginPath();
  const m0=mid(points[n-1], points[0]);
  ctx.moveTo(m0.x, m0.y);
  for(let i=0;i<n;i++){
    const next=points[(i+1)%n], m=mid(points[i], next);
    ctx.quadraticCurveTo(points[i].x, points[i].y, m.x, m.y);
  }
  ctx.closePath();
  return true;
}

// AE 式贝塞尔闭合路径:每个锚点可带 hIn/hOut(绝对坐标控制柄);无柄锚点=尖角(直线相接)。
// 段 a→b 的三次控制点取 a.hOut(缺省=a)与 b.hIn(缺省=b)—— 与 AE/Illustrator 钢笔一致:
// 不拖柄就是直线折点,拖柄就是光滑曲线。环形闭合。
export function fillBezierPath(ctx, pts){
  const n=pts.length; if(n<2) return false;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for(let i=0;i<n;i++){
    const a=pts[i], b=pts[(i+1)%n];
    const c1=a.hOut||a, c2=b.hIn||b;
    ctx.bezierCurveTo(c1.x,c1.y, c2.x,c2.y, b.x,b.y);
  }
  ctx.closePath();
  return true;
}

// 统一入口:贝塞尔路径走 fillBezierPath,老的手绘/平滑路径走 fillSmoothClosedPath(向后兼容)。
export function traceShapePath(ctx, sh){
  return sh.bezier ? fillBezierPath(ctx, sh.points) : fillSmoothClosedPath(ctx, sh.points);
}
