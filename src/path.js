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

// 摩尔邻域轮廓描摹(Moore-Neighbor Tracing):on(x,y)=实心像素,返回最外层边界像素环
// (y 向下坐标系,顺时针)。用于"融合"多个图形:并集光栅化 → 描出单一外轮廓 → RDP 精简成 path。
// 纯函数(吃 on 谓词),可 node 单测。孤立/空 → null。
export function traceContour(on, w, h){
  let sx=-1, sy=-1;
  for(let y=0;y<h&&sy<0;y++){ for(let x=0;x<w;x++){ if(on(x,y)){ sx=x; sy=y; break; } } }
  if(sx<0) return null;
  // 8 邻域顺时针(y 向下):N, NE, E, SE, S, SW, W, NW
  const N=[[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
  const contour=[[sx,sy]];
  let px=sx, py=sy, backDir=6; // 进入起点方向来自西侧外部(W 的下标 6)
  const maxIter=w*h*4+16;
  for(let it=0; it<maxIter; it++){
    let found=-1;
    for(let k=1;k<=8;k++){ const idx=(backDir+k)%8;
      const nx=px+N[idx][0], ny=py+N[idx][1];
      if(nx>=0&&ny>=0&&nx<w&&ny<h&&on(nx,ny)){ found=idx; break; } }
    if(found<0) break;              // 孤立像素
    backDir=(found+4)%8;            // 新回溯方向 = 从新像素指回旧像素
    px+=N[found][0]; py+=N[found][1];
    if(px===sx&&py===sy) break;     // 回到起点 → 环闭合
    contour.push([px,py]);
  }
  return contour.length>=3 ? contour : null;
}

// 多连通域轮廓:泛洪标记各连通块,逐块取外轮廓。返回 [[ [x,y],… ], …](按块)。
// 整体剪影变形用 —— 头、身分离的人形会得到多条轮廓,各自连续变形,不退化成点阵。
export function traceComponents(on, w, h, minArea=24){
  const seen=new Uint8Array(w*h), out=[], stack=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const idx=y*w+x; if(seen[idx]||!on(x,y)) continue;
    const pix=new Set(); stack.length=0; stack.push(idx); seen[idx]=1;
    while(stack.length){ const p=stack.pop(); pix.add(p); const cx=p%w, cy=(p/w)|0;
      const nb=[[1,0],[-1,0],[0,1],[0,-1]];
      for(const [dx,dy] of nb){ const nx=cx+dx, ny=cy+dy;
        if(nx<0||ny<0||nx>=w||ny>=h) continue; const ni=ny*w+nx;
        if(!seen[ni]&&on(nx,ny)){ seen[ni]=1; stack.push(ni); } } }
    if(pix.size<minArea) continue;                 // 跳过碎屑
    const c=traceContour((x,y)=>pix.has(y*w+x), w, h);
    if(c && c.length>=6) out.push(c);
  }
  return out;
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
