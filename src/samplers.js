// 采样层:纯函数家族 (on, spacing, jitter) => pts[]。
// on(x,y) 是蒙版读取器(白=形状内);返回像素坐标点数组 [[x,y],…]。
// 单状态点数上限由上层(pipeline.resample)统一抽稀,这里只管铺点。
import { W, H } from './config.js';

// 两遍 chamfer 3/4 距离场:每个内部像素到最近边界的距离(×3 存储)。smart/strokes 共用。
function distanceField(on){
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
  return D;
}

// 蒙版质心(vogel/rings 的螺旋/环中心)。稀疏步进扫描,够准且快。
function maskCentroid(on){
  let sx=0, sy=0, n=0;
  for(let y=0;y<H;y+=3) for(let x=0;x<W;x+=3)
    if(on(x,y)){ sx+=x; sy+=y; n++; }
  return n? {cx:sx/n, cy:sy/n} : {cx:W/2, cy:H/2};
}

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
    // 24 轮:实测 Lloyd 头几轮会先破坏泊松盘的最小间距保证(nn 方差先升后降),
    // ≈8 轮才回到种子水平、~20 轮后稳定优于种子 —— 5 轮恰好停在"更差"区间(曾是 bug)。
    // 时间预算护栏仍在,病态蒙版会提前止损。
    return lloydRelax(on,pts,24);
  },
  // Vogel 向日葵螺旋(CLAUDE.md §6):r=c·√n, θ=n·137.508°(黄金角)。
  // 确定性、无行列感、有中心韵律 —— 替代"太随机"的泊松盘的结构化实心填充。
  vogel(on,sp){
    const {cx,cy}=maskCentroid(on);
    const c=sp*0.55, maxR=Math.hypot(W,H), pts=[];
    for(let k2=0;k2<6000;k2++){
      const r=c*Math.sqrt(k2), th=k2*2.399963229;
      if(r>maxR) break;
      const x=cx+r*Math.cos(th), y=cy+r*Math.sin(th);
      if(on(Math.round(x),Math.round(y))) pts.push([x,y]);
    }
    return pts;
  },
  // 同心环:第 k 环半径 k·sp,放 round(2πk) 个点 —— 雷达/涟漪式韵律。
  rings(on,sp){
    const {cx,cy}=maskCentroid(on);
    const pts=[]; if(on(Math.round(cx),Math.round(cy))) pts.push([cx,cy]);
    const maxR=Math.hypot(W,H);
    for(let k2=1;k2*sp<maxR;k2++){
      const r=k2*sp, n=Math.max(4,Math.round(2*Math.PI*k2));
      for(let i=0;i<n;i++){
        const th=i/n*2*Math.PI;
        const x=cx+r*Math.cos(th), y=cy+r*Math.sin(th);
        if(on(Math.round(x),Math.round(y))) pts.push([x,y]);
      }
    }
    return pts;
  },
  // 笔画·文字:专为字形/线稿设计的骨架串珠 —— 沿笔画中轴密排小珠,
  // 珠半径 = 局部笔画半宽 × 0.8(刻意收 20%:保住字腔 a/o 的洞与字母间隙,不跨沟融合),
  // 沿笔画印章收紧到 0.75r(珠子首尾相接 → 线条连续可读)。自适应笔画粗细,不依赖全局间距。
  strokes(on,sp){
    const D=distanceField(on);
    const cand=[];
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const r=D[y*W+x]/3;
      if(r>=1.2) cand.push([x,y,r]);
    }
    cand.sort((a,b)=>b[2]-a[2]);
    const cov=new Uint8Array(W*H);
    const stamp=(bx,by,br)=>{ const R=Math.ceil(br), r2=br*br;
      for(let dy=-R;dy<=R;dy++){ const yy=by+dy; if(yy<0||yy>=H) continue;
        for(let dx=-R;dx<=R;dx++){ const xx=bx+dx; if(xx<0||xx>=W) continue;
          if(dx*dx+dy*dy<=r2) cov[yy*W+xx]=1; } } };
    const balls=[];
    for(const [x,y,r] of cand){
      if(cov[y*W+x]) continue;
      balls.push([x,y,Math.max(1.2,r*0.8)]);
      stamp(x,y,Math.max(1.5,r*0.75));
      if(balls.length>=900) break;
    }
    return balls;
  },
  // 智能识别·结构圆(中轴/最大内切圆):不"铺满"蒙版,而是还原"这团形状本来由哪几个圆组成"。
  // ① 两遍 chamfer 距离场:每个内部像素到最近边界的距离;② 距离峰值 = 天然圆心,峰值大小 = 半径;
  // ③ 从大到小贪心接受"未被已选球覆盖"的候选 —— 大团块得到一个精确大球(如导入的 metaball 设计稿),
  // 细笔画得到沿骨架的串珠。返回 [x,y,r] 三元组(逐点独立半径,引擎/渲染本就支持逐球 r)。
  smart(on,sp){
    const D=distanceField(on);
    // 两级覆盖(自适应中轴球树思路):主结构球(≥minR)先占大块,再用"残差细化"
    // 补小球到未覆盖处 —— 尖角/锐边/细节曲线的内切圆都小于 minR,老版直接丢弃导致
    // 边缘定义流失;细化允许小到 refMin 的球,专门刻画这些特征。覆盖判定用位图印章
    // (O(蒙版面积)),避免逐候选 × 逐球的平方级比较。
    const minR=Math.max(3, sp*0.35);                  // 主结构颗粒度(点间距滑块控制)
    const refMin=Math.max(1.3, sp*0.1);               // 细化下限:更小间距→更细的边缘珠
    const cand=[];
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const r=D[y*W+x]/3;                             // chamfer 3/4 度量还原到像素
      if(r>=refMin) cand.push([x,y,r]);
    }
    cand.sort((a,b)=>b[2]-a[2]);
    const cov=new Uint8Array(W*H);
    const stamp=(bx,by,br)=>{ const R=Math.ceil(br), r2=br*br;
      for(let dy=-R;dy<=R;dy++){ const yy=by+dy; if(yy<0||yy>=H) continue;
        for(let dx=-R;dx<=R;dx++){ const xx=bx+dx; if(xx<0||xx>=W) continue;
          if(dx*dx+dy*dy<=r2) cov[yy*W+xx]=1; } } };
    const balls=[];
    for(const [x,y,r] of cand){
      if(cov[y*W+x]) continue;
      if(r>=minR){ balls.push([x,y,r*0.95]); stamp(x,y,r*0.85); }
      else       { balls.push([x,y,Math.max(r*0.95,refMin)]); stamp(x,y,Math.max(r*0.9,1.5)); }
      if(balls.length>=700) break;
    }
    return balls;
  },
};

// 按目标点数拟合:间距二分逼近(∝1/√n),超出均匀抽稀 —— "每个图形单独控制点数"的底层。
export function samplePtsFit(sampler, on, spacing, jitter, target){
  let sp=spacing, pts=SAMPLERS[sampler](on,sp,jitter);
  if(target){
    for(let t=0;t<3 && pts.length && Math.abs(pts.length-target)/target>0.15;t++){
      sp=Math.max(3, Math.min(60, sp*Math.sqrt(pts.length/target)));
      pts=SAMPLERS[sampler](on,sp,jitter);
    }
    if(pts.length>target){ const k=pts.length/target;
      pts=pts.filter((_,i)=>Math.floor(i*k)!==Math.floor((i-1)*k) ? true : false)
        .slice(0,target); }
  }
  return pts;
}

// 采样核心:蒙版读取器 + 手动点 → 归一化点集(超 1500 抽稀)。纯函数,主应用/3D 预览器共用。
// 采样器可返回 [x,y] 或 [x,y,r](逐点独立半径,如 smart);无 r 的用全局 P.dotR,
// 半调亮度 lum → r=dotR·√B;彩色读取器 colR(x,y)=>[r,g,b]|null → 逐点颜色(dot.c),
// 引擎会在过渡中逐点插值颜色、渲染层按加权场混色 —— 彩色图标(如 emoji)的可识别性来自这里。
export function sampleDots(on, manual, P, lum, colR){
  let pts=SAMPLERS[P.sample](on,P.spacing,P.jitter);
  if(pts.length>1500){ const k=Math.ceil(pts.length/1500); pts=pts.filter((_,i)=>i%k===0); }
  const base=P.dotR/W;
  return pts.map(p=>{
    const d = p[2]!==undefined
      ? {x:p[0]/W, y:p[1]/H, r:p[2]/W}
      : {x:p[0]/W, y:p[1]/H,
         r:base*Math.sqrt(lum?Math.max(0.06,lum(Math.round(p[0]),Math.round(p[1]))):1)};
    if(colR){ const c=colR(Math.round(p[0]),Math.round(p[1])); if(c) d.c=c; }
    return d;
  }).concat(manual.map(m=>({x:m.x,y:m.y,r:base})));
}

// Lloyd 时间预算(ms)。UI 交互用默认 250ms 护栏;测试环境并行跑多个文件抢 CPU,
// 可临时调大以免迭代被掐、断言测到的是"被降级的算法"。
let LLOYD_BUDGET=250;
export function setLloydBudget(ms){ LLOYD_BUDGET=ms; }

function lloydRelax(on,pts,iters){
  const n=pts.length;
  const cell=Math.max(4,Math.sqrt((W*H)/n)); // 网格边长按点密度取,平均每格约一个点
  // 硬性时间预算:无论蒙版多病态(文字这类多连通块、细笔画、大片空白最容易触发退化到
  // O(n) 兜底查找的情形),都不可能拖垮交互 —— 超时就停在已完成的迭代上优雅退化。
  const deadline=performance.now()+LLOYD_BUDGET;
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
