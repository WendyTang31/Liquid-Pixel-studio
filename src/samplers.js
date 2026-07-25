// 采样层:纯函数家族 (on, spacing, jitter) => pts[]。
// on(x,y) 是蒙版读取器(白=形状内);返回像素坐标点数组 [[x,y],…]。
// 单状态点数上限由上层(pipeline.resample)统一抽稀,这里只管铺点。
import { W, H } from './config.js';

export const SAMPLERS = {
  // 方格网格:最规整,行列感最强。
  grid(on,sp,jit){ const pts=[];
    for(let y=sp/2;y<H;y+=sp) for(let x=sp/2;x<W;x+=sp){
      const jx=x+(Math.random()-.5)*jit*sp, jy=y+(Math.random()-.5)*jit*sp;
      if(on(Math.round(jx),Math.round(jy))) pts.push([jx,jy]); } return pts; },
  // 六角网格:错行 √3/2,视觉最均匀,默认。
  hex(on,sp,jit){ const pts=[], rh=sp*0.866; let row=0;
    for(let y=sp/2;y<H;y+=rh,row++){ const off=(row%2)*sp/2;
      for(let x=sp/2+off;x<W;x+=sp){
        const jx=x+(Math.random()-.5)*jit*sp, jy=y+(Math.random()-.5)*jit*sp;
        if(on(Math.round(jx),Math.round(jy))) pts.push([jx,jy]); } } return pts; },
  // 泊松盘(飞镖投掷 + cell=sp/√2 网格加速,邻域查 5×5):蓝噪声,无行列感。
  poisson(on,sp){
    const cell=sp/Math.SQRT2, gc=Math.ceil(W/cell), gr=Math.ceil(H/cell);
    const grid=new Int32Array(gc*gr).fill(-1), pts=[];
    const tries=Math.min(60000, Math.ceil(W*H/(sp*sp))*30);
    for(let k=0;k<tries;k++){
      const x=Math.random()*W, y=Math.random()*H;
      if(!on(x|0,y|0)) continue;
      const cx=(x/cell)|0, cy=(y/cell)|0; let ok=true;
      for(let dy=-2;dy<=2&&ok;dy++) for(let dx=-2;dx<=2&&ok;dx++){
        const nx=cx+dx, ny=cy+dy;
        if(nx<0||ny<0||nx>=gc||ny>=gr) continue;
        const pi=grid[ny*gc+nx];
        if(pi>=0){ const p=pts[pi]; if((p[0]-x)**2+(p[1]-y)**2<sp*sp) ok=false; } }
      if(ok){ grid[cy*gc+cx]=pts.length; pts.push([x,y]); } } return pts; },
  // 仅轮廓:先取 4 邻域边缘像素,再按 minD 做同样的网格去重。
  outline(on,sp){
    const edges=[];
    for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++)
      if(on(x,y)&&(!on(x-1,y)||!on(x+1,y)||!on(x,y-1)||!on(x,y+1))) edges.push([x,y]);
    const minD=sp*0.75, cell=minD/Math.SQRT2, gc=Math.ceil(W/cell), gr=Math.ceil(H/cell);
    const grid=new Int32Array(gc*gr).fill(-1), pts=[];
    for(const [x,y] of edges){
      const cx=(x/cell)|0, cy=(y/cell)|0; let ok=true;
      for(let dy=-2;dy<=2&&ok;dy++) for(let dx=-2;dx<=2&&ok;dx++){
        const nx=cx+dx, ny=cy+dy;
        if(nx<0||ny<0||nx>=gc||ny>=gr) continue;
        const pi=grid[ny*gc+nx];
        if(pi>=0){ const p=pts[pi]; if((p[0]-x)**2+(p[1]-y)**2<minD*minD) ok=false; } }
      if(ok){ grid[cy*gc+cx]=pts.length; pts.push([x,y]); } } return pts; },
  // 均匀填充(Lloyd 松弛):poisson 铺种子后,反复把每个点挪到"它负责的蒙版像素"的
  // 质心 —— 这是离散版 Voronoi/CVT,让点间距趋于一致,不再有局部扎堆或稀疏。
  // 网格加速最近点查找(思路同 render.js 的 tile 分块),避免逐点逐像素的 O(n·像素) 暴力法。
  uniform(on,sp,jit){
    const pts=SAMPLERS.poisson(on,sp).map(p=>[...p]);
    if(pts.length<2) return pts;
    return lloydRelax(on,pts,5);
  },
  // 智能识别·结构圆(中轴/最大内切圆):不"铺满"蒙版,而是还原"这团形状本来由哪几个圆组成"。
  // ① 两遍 chamfer 距离场:每个内部像素到最近边界的距离;② 距离峰值 = 天然圆心,峰值大小 = 半径;
  // ③ 从大到小贪心接受"未被已选球覆盖"的候选 —— 大团块得到一个精确大球(如导入的 metaball 设计稿),
  // 细笔画得到沿骨架的串珠。返回 [x,y,r] 三元组(逐点独立半径,引擎/渲染本就支持逐球 r)。
  smart(on,sp){
    const INF=1e9, D=new Float32Array(W*H);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++) D[y*W+x]=on(x,y)?INF:0;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){        // 前向遍历
      const i=y*W+x; if(D[i]===0) continue; let d=D[i];
      if(x>0)d=Math.min(d,D[i-1]+3);
      if(y>0){ d=Math.min(d,D[i-W]+3);
        if(x>0)d=Math.min(d,D[i-W-1]+4);
        if(x<W-1)d=Math.min(d,D[i-W+1]+4); }
      D[i]=d;
    }
    for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){  // 后向遍历
      const i=y*W+x; if(D[i]===0) continue; let d=D[i];
      if(x<W-1)d=Math.min(d,D[i+1]+3);
      if(y<H-1){ d=Math.min(d,D[i+W]+3);
        if(x<W-1)d=Math.min(d,D[i+W+1]+4);
        if(x>0)d=Math.min(d,D[i+W-1]+4); }
      D[i]=d;
    }
    const minR=Math.max(3, sp*0.35);                  // 点间距滑块控制颗粒度:更小间距→更细的结构球
    const cand=[];
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const r=D[y*W+x]/3;                             // chamfer 3/4 度量还原到像素
      if(r>=minR) cand.push([x,y,r]);
    }
    cand.sort((a,b)=>b[2]-a[2]);
    const balls=[];
    for(const [x,y,r] of cand){
      let covered=false;
      for(const b of balls){ const dx=x-b[0],dy=y-b[1];
        if(dx*dx+dy*dy < (b[2]*0.85)**2){ covered=true; break; } }
      if(!covered){ balls.push([x,y,r*0.95]);         // 0.95:补偿渲染阈值,避免涨出原形状
        if(balls.length>=400) break; }
    }
    return balls;
  },
};

// 采样核心:蒙版读取器 + 手动点 → 归一化点集(超 1500 抽稀)。纯函数,主应用/3D 预览器共用。
// 采样器可返回 [x,y] 或 [x,y,r](逐点独立半径,如 smart);无 r 的用全局 P.dotR,
// 且若给了亮度读取器 lum(半调),半径按 r=dotR·√B 随亮度缩放(感知墨量∝面积,见 CLAUDE.md §6)。
export function sampleDots(on, manual, P, lum){
  let pts=SAMPLERS[P.sample](on,P.spacing,P.jitter);
  if(pts.length>1500){ const k=Math.ceil(pts.length/1500); pts=pts.filter((_,i)=>i%k===0); }
  const base=P.dotR/W;
  return pts.map(p=>{
    if(p[2]!==undefined) return {x:p[0]/W, y:p[1]/H, r:p[2]/W};
    const B=lum ? Math.max(0.06, lum(Math.round(p[0]),Math.round(p[1]))) : 1;
    return {x:p[0]/W, y:p[1]/H, r:base*Math.sqrt(B)};
  }).concat(manual.map(m=>({x:m.x,y:m.y,r:base})));
}

function lloydRelax(on,pts,iters){
  const n=pts.length;
  const cell=Math.max(4,Math.sqrt((W*H)/n)); // 网格边长按点密度取,平均每格约一个点
  // 硬性时间预算:无论蒙版多病态(文字这类多连通块、细笔画、大片空白最容易触发退化到
  // O(n) 兜底查找的情形),都不可能拖垮交互 —— 超时就停在已完成的迭代上优雅退化。
  const deadline=performance.now()+250;
  for(let it=0;it<iters;it++){
    if(performance.now()>deadline) break;
    const gc=Math.max(1,Math.ceil(W/cell)), gr=Math.max(1,Math.ceil(H/cell));
    const bins=Array.from({length:gc*gr},()=>[]);
    for(let i=0;i<n;i++){
      const cx=Math.min(gc-1,(pts[i][0]/cell)|0), cy=Math.min(gr-1,(pts[i][1]/cell)|0);
      bins[cy*gc+cx].push(i);
    }
    const sx=new Float64Array(n), sy=new Float64Array(n), cnt=new Int32Array(n);
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      if(!on(x,y)) continue;
      const cx=Math.min(gc-1,(x/cell)|0), cy=Math.min(gr-1,(y/cell)|0);
      let best=-1,bd=Infinity;
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
        const nx=cx+dx, ny=cy+dy;
        if(nx<0||ny<0||nx>=gc||ny>=gr) continue;
        for(const i of bins[ny*gc+nx]){
          const ddx=pts[i][0]-x, ddy=pts[i][1]-y, d=ddx*ddx+ddy*ddy;
          if(d<bd){bd=d;best=i;}
        }
      }
      if(best<0) for(let i=0;i<n;i++){ // 3x3 邻域内恰好没点(极端稀疏)时的兜底
        const ddx=pts[i][0]-x, ddy=pts[i][1]-y, d=ddx*ddx+ddy*ddy; if(d<bd){bd=d;best=i;} }
      sx[best]+=x; sy[best]+=y; cnt[best]++;
    }
    for(let i=0;i<n;i++) if(cnt[i]>0) pts[i]=[sx[i]/cnt[i], sy[i]/cnt[i]];
  }
  return pts;
}
