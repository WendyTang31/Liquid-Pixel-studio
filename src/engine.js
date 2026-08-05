// 引擎层:全部纯函数,无隐藏状态。参数从 P 显式传入,任意全局时间 g 都能凭空求值 ——
// 这是时间轴可拖、导出确定性、"预览 == 导出"一致性的根基。预览与导出共用 sampleFrame。
import { hex2rgb } from './utils.js';
import { W, H } from './config.js';
import { pairVectorShapes, solidOutlinePolys, rasterizeVectorSolids } from './vector.js';
import { segEdgeFx, displaceOutline, splatterDropletPolys, polysCentroid } from './edgefx.js';
import { labDisp, labEmit, applyLabTint, hasLabFx, dotsStat } from './labfx.js';

// 缓动:端点连续、速度/加速度在端点收敛(smootherstep 最柔)。
// 物理组(backOut/elasticOut/bounceOut)刻意在中途越过 1 再回落 —— 过冲/弹跳/回弹的"手感"
// 正来自这个越界;引擎的 lerp 对 e>1 天然外推,无需特判。
export const EASE={ linear:t=>t, smoothstep:t=>t*t*(3-2*t),
  smootherstep:t=>t*t*t*(t*(t*6-15)+10),
  cubic:t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2,
  backOut:t=>{const c1=1.70158,c3=c1+1; return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);},
  elasticOut:t=>t<=0?0:t>=1?1:Math.pow(2,-10*t)*Math.sin((t*10-0.75)*(2*Math.PI/3))+1,
  bounceOut:t=>{const n1=7.5625,d1=2.75;
    if(t<1/d1)return n1*t*t;
    if(t<2/d1)return n1*(t-=1.5/d1)*t+.75;
    if(t<2.5/d1)return n1*(t-=2.25/d1)*t+.9375;
    return n1*(t-=2.625/d1)*t+.984375;},
  // ── 实验组(Lab):情绪化的速度曲线。──
  // 真·阻尼弹簧:二阶系统的阶跃响应闭式解 1−e^(−ζωt)(cos ω_d t + ζω/ω_d · sin ω_d t)。
  // 比 elasticOut 更"有质量"—— 刚度 ω 与阻尼比 ζ 就是物理常数,不是凑出来的手感曲线:
  // 欠阻尼(此处 ζ=0.42)= 急躁/激动;临界阻尼 = 沉稳;过阻尼 = 疲惫。这里取一组居中的欠阻尼值。
  spring:t=>{ if(t<=0)return 0; if(t>=1)return 1;
    const zw=6.72, wd=14.52; return 1-Math.exp(-zw*t)*(Math.cos(wd*t)+zw/wd*Math.sin(wd*t)); },
  // 预备动作(anticipation):先反向蓄力再出发 —— 动画十二原则里让运动读作"有意图"而非"被推动"的那一条。
  // 蓄力项两端均为 0 且端点速度为 0,故与相邻停留段仍然严丝合缝。
  anticipate:t=>{ if(t<=0)return 0; if(t>=1)return 1;
    return -0.16*Math.sin(Math.PI*Math.min(1,t/0.35)) + EASE.smootherstep(Math.max(0,(t-0.2)/0.8)); },
  // 迟疑:在 smootherstep 上叠 3 次减速(系数 0.045 保证导数恒正 → 只会"顿",不会倒退)。
  // 端点值与端点速度都不受影响。表达犹豫、斟酌、"我拿不准"。
  hesitate:t=>{ const s=t*t*t*(t*(t*6-15)+10); return s-0.045*Math.sin(6*Math.PI*s); },
};

// 三次贝塞尔缓动(CSS cubic-bezier 同构):控制速度曲线的"最好方式"。端点 (0,0)(1,1),
// 控制点 (x1,y1)(x2,y2)。端点斜率 = 速度:e'(0)=y1/x1、e'(1)=(1-y2)/(1-x2)。
// 取 x1=1/3,x2=2/3,则给定 起步速度 vIn、落位速度 vOut → y1=vIn/3、y2=1−vOut/3,
// 端点斜率就精确 = vIn、vOut(相对匀速的倍数:0=停下、1=匀速、>1=冲)。
// 这样"下一状态开头的速度 match 上一状态结尾的速度"即令二者相等,过渡在关键帧处速度连续 = 无缝。
export function bezierEase(vIn, vOut){
  const x1=1/3, y1=Math.max(0,vIn)/3, x2=2/3, y2=1-Math.max(0,vOut)/3;
  const cx=3*x1, bx=3*(x2-x1)-cx, ax=1-cx-bx;
  const cy=3*y1, by=3*(y2-y1)-cy, ay=1-cy-by;
  const X=u=>((ax*u+bx)*u+cx)*u, Xd=u=>(3*ax*u+2*bx)*u+cx, Y=u=>((ay*u+by)*u+cy)*u;
  return t=>{ if(t<=0)return 0; if(t>=1)return 1;
    let u=t; for(let i=0;i<8;i++){ const dx=X(u)-t, d=Xd(u); if(Math.abs(dx)<1e-6||Math.abs(d)<1e-7)break; u-=dx/d; }
    return Y(Math.max(0,Math.min(1,u))); };
}
// 段的速度曲线:trans 覆盖里设了 起步/落位速度(sIn/sOut)则用贝塞尔,否则回退命名缓动(不改旧行为)。
export const segEase=(ov,P)=> (ov && (ov.sIn!=null || ov.sOut!=null))
  ? bezierEase(ov.sIn??0, ov.sOut??0) : EASE[segParams(P,ov).ease];

const centroid=a=>{let x=0,y=0;a.forEach(b=>{x+=b.x;y+=b.y;});return{x:x/a.length,y:y/a.length};};

// 位置确定的呼吸漂移相位(而非随机数或数组下标):同一坐标永远得到同一相位。
// 这是消除"每个状态出入两次小错位"的关键 —— 停留态和过渡态的端点用的是同一个点的
// 同一个坐标,只要相位公式只依赖坐标,两边算出来的相位就天然一致、边界处零跳变。
function dotPhase(x,y){ const s=Math.sin(x*127.1+y*311.7)*43758.5453; return (s-Math.floor(s))*6.283185307; }

// Sliced Optimal Transport 配对:沿多个方向反复做 1D 排序对齐(1D 排序即该方向的最优传输),
// 迭代逼近 2D 最优传输,得到总位移最小、保邻域的 A↔B 映射 —— 点如流体般各走最短路、
// 不交叉、不在中途挤成团。这是 procedural morph 平滑的关键,取代易聚集的最近邻类匹配。
// 方向用黄金角序列均匀铺开(确定性,不引入随机,保证预览=导出一致)。
function matchOT(A, B, iters){
  const n=A.length;
  const perm=new Array(n); for(let i=0;i<n;i++) perm[i]=i;      // A[i] ↔ B[perm[i]]
  const idxA=new Array(n), idxB=new Array(n);
  for(let it=0; it<iters; it++){
    const ang=it*2.399963229;                                   // 黄金角(弧度)
    const ux=Math.cos(ang), uy=Math.sin(ang);
    for(let i=0;i<n;i++){ idxA[i]=i; idxB[i]=i; }
    idxA.sort((p,q)=>(A[p].x*ux+A[p].y*uy)-(A[q].x*ux+A[q].y*uy));           // A 沿方向排序
    idxB.sort((p,q)=>(B[perm[p]].x*ux+B[perm[p]].y*uy)-(B[perm[q]].x*ux+B[perm[q]].y*uy)); // 当前配对 B 排序
    const np=new Array(n);
    for(let r=0;r<n;r++) np[idxA[r]]=perm[idxB[r]];             // 该方向按序重新对齐
    for(let i=0;i<n;i++) perm[i]=np[i];
  }
  const sb=new Array(n); for(let i=0;i<n;i++) sb[i]=B[perm[i]];
  return [A.slice(), sb];
}

// 点配对策略:决定 A→B 谁变成谁,直接塑造形变的"手感"。
export const MATCH={
  sortXY:(A,B)=>{const k=b=>b.x+0.3*b.y;
    return[[...A].sort((p,q)=>k(p)-k(q)),[...B].sort((p,q)=>k(p)-k(q))];},
  angle:(A,B)=>{const ca=centroid(A),cb=centroid(B);
    const ka=b=>Math.atan2(b.y-ca.y,b.x-ca.x),kb=b=>Math.atan2(b.y-cb.y,b.x-cb.x);
    return[[...A].sort((p,q)=>ka(p)-ka(q)),[...B].sort((p,q)=>kb(p)-kb(q))];},
  greedy:(A,B)=>{const sa=[...A].sort((p,q)=>p.x-q.x),used=new Array(B.length).fill(false),sb=[];
    sa.forEach(a=>{let bi=-1,bd=1e9;
      B.forEach((b,i)=>{if(used[i])return;const d=(a.x-b.x)**2+(a.y-b.y)**2;if(d<bd){bd=d;bi=i;}});
      used[bi]=true;sb.push(B[bi]);});
    return[sa,sb];},
  random:(A,B)=>{const sb=[...B];
    for(let i=sb.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[sb[i],sb[j]]=[sb[j],sb[i]];}
    return[[...A],sb];},
  ot:(A,B)=>matchOT(A,B,60),
};

// 部分匹配(贪心最近邻、无放回):点数不等时,给较少一侧的每个点各配一个
// "不重复占用"的较多一侧最近邻;配不上的那些多余点各自落单,交给调用方处理"生/灭"。
// 这是应对点数不等的关键 —— 任何目标位置最多只被一个源点认领,
// 从根源杜绝"多点抢同一个坑"式的坍缩黑块(mass-splitting 打散重合点治标不治本:
// 散开后仍挤在融合半径内,反而制造更大的一坨)。
function partialNearestMatch(small, big){
  const nS=small.length, nB=big.length, used=new Array(nB).fill(false);
  const matched=new Array(nS); // matched[i] = small[i] 认领的 big 索引
  for(let i=0;i<nS;i++){
    let best=-1,bd=Infinity;
    for(let j=0;j<nB;j++){ if(used[j]) continue;
      const d=(small[i].x-big[j].x)**2+(small[i].y-big[j].y)**2;
      if(d<bd){bd=d;best=j;} }
    used[best]=true; matched[i]=best;
  }
  const excess=[]; for(let j=0;j<nB;j++) if(!used[j]) excess.push(j);
  return {matched, excess};
}

// 配对:点数相等时按策略整体排序对齐;点数不等时,重合部分走"部分最近邻匹配",
// 多余的点原地"消亡"(r: 实际值→0)或原地"新生"(r: 0→实际值)—— 位置完全不挪动,
// 只是渐显/渐隐,呼应"光生长"的美学纲领,同时彻底避免多点争抢同一目标造成的黑块。
// p.d 是按 a.x 归一化的相位,供错峰(stagger)用。
export function makePairs(dotsA,dotsB,P){
  const A=dotsA.map(b=>({...b})), B=dotsB.map(b=>({...b}));
  if(!A.length||!B.length) return [];
  let pairs;
  if(A.length===B.length){
    const [sa,sb]=MATCH[P.match](A,B);
    pairs=sa.map((a,i)=>({a,b:sb[i],d:0}));
  } else {
    const aIsSmall=A.length<B.length;
    const small=aIsSmall?A:B, big=aIsSmall?B:A;
    const {matched,excess}=partialNearestMatch(small,big);
    pairs=matched.map((bi,i)=>{
      const s=small[i], g=big[bi];
      return {a:aIsSmall?s:g, b:aIsSmall?g:s, d:0};
    });
    for(const bi of excess){
      const p=big[bi], phantom={x:p.x,y:p.y,r:0,c:p.c};
      // aIsSmall: big=B 多出 → B 侧原地新生;否则 big=A 多出 → A 侧原地消亡。
      // 幽灵端继承真实端的颜色 —— 生灭过程中颜色恒定,只有半径在变。
      pairs.push(aIsSmall
        ? {a:phantom, b:p, d:0}
        : {a:p, b:phantom, d:0});
    }
  }
  // 每对预存两端的位置相位(见 dotPhase):过渡时按 e 在两者间插值,
  // 端点(e=0/1)与相邻停留态严丝合缝 —— 消亡/新生对 a、b 同位置,phaseA===phaseB,自动稳定。
  pairs.forEach(p=>{ p.phaseA=dotPhase(p.a.x,p.a.y); p.phaseB=dotPhase(p.b.x,p.b.y); });
  const xs=pairs.map(p=>p.a.x),mn=Math.min(...xs),mx=Math.max(...xs);
  pairs.forEach(p=>p.d=(mx-mn)<1e-6?0:(p.a.x-mn)/(mx-mn));
  return pairs;
}

// 双正弦低频漂移:停留态的"呼吸",幅度极小(乘 P.amp)。
export function drift(ph,time,P){return Math.sin(time*P.freq*6.283+ph)*.7+Math.sin(time*P.freq*3.33+ph*1.7)*.3;}

// ── 动态几何(行为修饰器):停留期给单个状态叠加的程序化位移场,纯函数、确定性。
// 全部按"点的基础坐标 + 全局时间"求值 —— 与漂移同构,故过渡时按端点 e 插值即天然连续。
// 光敏红线:所有振荡频率硬性 ≤2.5Hz;twinkle 逐点异相异频,聚合亮度平滑,绝非全局频闪。
// 实验层(labfx)的效果同样是可加位移场,故一并纳入"是否需要求值"的判定。
export const hasFx=fx=>!!(fx&&(fx.slosh||fx.spring||fx.liquid||fx.ripple||fx.twinkle||fx.wobble))||hasLabFx(fx);
const FXB=0.04; // 位移基准幅度(归一化画布)
// st = dotsStat(形体统计量),仅实验层需要(重力/融化/沉降要知道形体的尺度与上下界);
// 老调用方不传即退化为 DEF_STAT,既有效果的行为完全不变。
// wIn(可选):由 buildSequence 沿时间轴把 fx.freq 积分成的【连续相位】(弧度)——
// 传入时用它取代 2π·f·t,于是过渡里 freqA→freqB 是平滑变频(chirp)而非两频"打拍子";
// 不传(旧调用方/直接单测)则退回墙钟相位,行为完全不变。twinkle/实验层仍用逐点/墙钟相位,不受影响。
export function behaviorDisp(x,y,cx,cy,t,fx,st,wIn){
  let dx=0,dy=0,rf=1;
  const f=Math.min(2.5, fx.freq||0.6), w=(wIn!=null)?wIn:6.283185307*f*t;
  if(fx.slosh){ // 水平面波浪:整体左右晃 + 液面行波,越靠上晃幅越大(容器晃动)
    const a=fx.slosh*FXB, depth=1-Math.min(1,Math.max(0,y));
    dx += a*(Math.sin(w)*(0.5+0.9*depth) + 0.35*Math.sin(1.7*w+7*x));
    dy += a*0.25*Math.sin(1.3*w+5*x)*depth;
  }
  if(fx.spring){ // 弹簧挤压/拉伸:绕质心体积守恒缩放,波形带过冲更弹
    const s=fx.spring*0.3, wv=Math.sin(w)+0.3*Math.sin(2*w), sy=1+s*wv, sx=1/sy;
    dx += (x-cx)*(sx-1); dy += (y-cy)*(sy-1);
  }
  if(fx.liquid){ // 液态线:横向行波沿形体流动的起伏
    const a=fx.liquid*FXB;
    dy += a*Math.sin(6.2*(x-cx)-w);
    dx += a*0.4*Math.sin(5.0*(y-cy)-1.1*w);
  }
  if(fx.ripple){ // 从中心向外辐射的同心波纹
    const a=fx.ripple*FXB, rx=x-cx, ry=y-cy, d=Math.hypot(rx,ry)+1e-5;
    const disp=a*Math.sin(w-14*d);
    dx += rx/d*disp; dy += ry/d*disp;
  }
  if(fx.twinkle){ // 逐点低频微光闪(相位/频率由坐标哈希;各点异相 → 闪烁而非频闪)
    const h=Math.sin(x*127.1+y*311.7)*43758.5453, fr=h-Math.floor(h);
    const fdot=Math.min(2.5, 0.3+2.2*fr);
    rf *= 1 + fx.twinkle*0.6*Math.sin(6.283185307*fdot*t + fr*6.283);
  }
  if(fx.wobble){ // 🌊 边缘波:整块边界像水波(〰️)沿行波起伏 —— 水平边上下荡、竖直边左右荡
    const a=fx.wobble*FXB*1.4, k=6.283185307*3; // ~3 个波
    dy += a*Math.sin(k*x + w);            // 水平边上下起伏(主)
    dx += a*0.55*Math.sin(k*y*1.15 - w);  // 竖直边左右起伏
  }
  // 🎯 波浪锚点:位移幅度随【离锚点的距离】增长 —— 锚点处不动(env=0),越远晃得越大(甩绳/旗杆挥旗)。
  // 锚点/reach 均为归一化坐标(0–1)。只缩放位移,不动 rf(微光)。
  if(fx.anchor){
    const reach=Math.max(0.03, fx.anchorReach||0.5);
    const env=Math.min(1, Math.hypot(x-fx.anchor.x, y-fx.anchor.y)/reach);
    dx*=env; dy*=env;
  }
  // 🧪 实验层:加在锚点包络【之后】—— 实验效果各自带空间包络(重力按离中轴、鞭梢按离锚点…),
  // 再乘一次锚点包络会双重衰减、行为难预测。故二者独立叠加,互不干扰。
  if(hasLabFx(fx)){ const L=labDisp(x,y,cx,cy,t,fx,st,w); dx+=L.dx; dy+=L.dy; rf*=L.rf; }
  return {dx,dy,rf};
}
const FX0={dx:0,dy:0,rf:1};
const centroidPt=dots=>{ let x=0,y=0,n=dots.length||1; for(const b of dots){x+=b.x;y+=b.y;} return {x:x/n,y:y/n}; };

// 过渡帧:每个点独立按错峰相位 p.d 延迟进入缓动,叠加双轴漂移。
// 漂移相位在 phaseA(=离开时的停留相位)与 phaseB(=到达时的停留相位)间按同一个 e 插值,
// e=0/1 时分别精确退化为源/目标停留态的相位 —— 与相邻停留段严丝合缝,无跳变。
// P.stretch>0 时,运动中的球沿速度反方向甩出两颗递减拖尾球 —— metaball 场把三球融成
// 胶囊状,即 squash & stretch 的"拉伸"近似;速度由缓动的数值微分给出,错峰使各球
// 拉伸时刻互不相同。头部球始终在结果数组前 N 位,与 pairs 下标对齐(轨迹叠加层依赖此约定)。
export function transBalls(pairs,t,time,P,fxc,morphLayers,easeFn,w){
  const ease=easeFn||EASE[P.ease], span=Math.max(1e-6,1-P.stag), stretch=P.stretch||0, flow=P.flow||0;
  const fxOn=fxc&&(hasFx(fxc.fxA)||hasFx(fxc.fxB)); // 动态几何:两端各自求值后按 e 插值(端点连续)
  const ml=(morphLayers&&morphLayers.size)?morphLayers:null; // 两端同层的点抑制(轮廓变形接管)
  const out=new Array(pairs.length); const trails=[];
  for(let i=0;i<pairs.length;i++){
    const p=pairs[i];
    const lt=Math.max(0,Math.min(1,(t-p.d*P.stag)/span)), e=ease(lt);
    const dxA=drift(p.phaseA,time,P), dxB=drift(p.phaseB,time,P);
    const dyA=drift(p.phaseA+3.1,time,P), dyB=drift(p.phaseB+3.1,time,P);
    const lid=p.a.lid??p.b.lid;
    const rr = (ml&&lid!=null&&ml.has(lid)) ? 0 : p.a.r+(p.b.r-p.a.r)*e; // 两端同层→点抑制,轮廓变形接管
    const ball={x:p.a.x+(p.b.x-p.a.x)*e+P.amp*(dxA+(dxB-dxA)*e),
                y:p.a.y+(p.b.y-p.a.y)*e+P.amp*(dyA+(dyB-dyA)*e),
                r:rr};
    if(p.a.sf) ball.sfA=1; if(p.b.sf) ball.sfB=1; // 实心标记随配对传递(供停留/过渡抑制)
    if(p.a.c||p.b.c){ // 逐点颜色插值(缺一端时用另一端,颜色恒定)
      const ca=p.a.c||p.b.c, cb=p.b.c||p.a.c;
      ball.c=[ca[0]+(cb[0]-ca[0])*e, ca[1]+(cb[1]-ca[1])*e, ca[2]+(cb[2]-ca[2])*e];
    }
    if(flow>0){
      // 相干流场:方向角取决于行程中点位置(邻近的点弯向一致 → 群体如流体),
      // 叠加少量每球个性(phaseA);sin(π·lt) 包络保证两端精确归零,不破坏与停留态的衔接。
      const mx=(p.a.x+p.b.x)/2, my=(p.a.y+p.b.y)/2;
      const th=2.4*Math.sin(5.1*mx+3.3*my)+1.9*Math.cos(3.7*mx-4.1*my)+0.6*Math.sin(p.phaseA);
      const env=Math.sin(Math.PI*lt)*flow*0.08;
      ball.x+=Math.cos(th)*env; ball.y+=Math.sin(th)*env;
    }
    if(fxOn){ // 动态几何:两端各按自己质心/参数求位移,按同一 e 插值 → e=0/1 精确匹配相邻停留态
      // 两端共用同一个连续相位 w(变频已积分进 w)→ 只交叉淡化【空间形状/幅度】,不再两频打拍。
      const dA=hasFx(fxc.fxA)?behaviorDisp(p.a.x,p.a.y,fxc.cA.x,fxc.cA.y,time,fxc.fxA,fxc.sA,w):FX0;
      const dB=hasFx(fxc.fxB)?behaviorDisp(p.b.x,p.b.y,fxc.cB.x,fxc.cB.y,time,fxc.fxB,fxc.sB,w):FX0;
      ball.x+=dA.dx+(dB.dx-dA.dx)*e; ball.y+=dA.dy+(dB.dy-dA.dy)*e;
      ball.r*=dA.rf+(dB.rf-dA.rf)*e;
    }
    out[i]=ball;
    if(stretch>0 && lt>0 && lt<1 && ball.r>0){
      const eps=0.02;
      const v=(ease(Math.min(1,lt+eps))-ease(Math.max(0,lt-eps)))/(2*eps); // de/dlt
      const vx=(p.b.x-p.a.x)*v, vy=(p.b.y-p.a.y)*v, sp=Math.hypot(vx,vy);
      if(sp>0.05){
        const k=Math.min(0.06, sp*0.04)*stretch, ux=vx/sp, uy=vy/sp;
        trails.push({x:ball.x-ux*k*0.5, y:ball.y-uy*k*0.5, r:ball.r*0.85});
        trails.push({x:ball.x-ux*k,     y:ball.y-uy*k,     r:ball.r*0.65});
      }
    }
  }
  return trails.length?out.concat(trails):out;
}

// 段级有效参数:状态可携带 trans 覆盖对象(ease/stag/flow/stretch/match),缺省继承全局。
export const segParams=(P,ov)=> (ov && Object.keys(ov).length) ? {...P, ...ov} : P;
// 一组点里出现的矢量图层号集合(用于判"两端同层→轮廓变形")。
export const lidSet=dots=>{ const s=new Set(); for(const d of dots) if(d.lid!=null) s.add(d.lid); return s; };

// ── 状态内子循环(姿态分组)──
// isPose=true 的状态不是主序列成员,而是"归属其前面最近主状态"的循环姿态(眨眼/走路帧)。
// 分组规则唯一定义在这里:时间轴/胶片条等 UI 必须复用本函数,否则排布会与播放对不上。
// 开头的孤儿姿态(前面没有主状态)按主状态对待 —— 删除主状态后姿态不会凭空消失。
export function groupStates(states){
  const masters=[];
  states.forEach((st,idx)=>{
    if(st.isPose && masters.length) masters[masters.length-1].poses.push(idx);
    else masters.push({idx, poses:[]});
  });
  return masters;
}

// 序列构建:[停留, 过渡, 停留, …(seamless 时补一段 尾→首 过渡)],主状态参与,姿态归组。
// 纯函数:states + seamless 开关 + P 进,{segs,T} 出;不碰任何全局。
// 每段过渡记住出发状态的 trans 覆盖(seg.ov),配对用段级 match,采样时再合并其余参数。
// 有姿态的主状态,其停留段挂 seg.loop = 子序列(基→各姿态→无缝回基),采样时整数圈回放:
// 停留的头尾都精确落在基姿态上,与相邻过渡(按基姿态 dots 配对)零跳变 —— 这是
// "循环速度微调以对齐圈数"的设计取舍,符合"光生长"的连续性纲领。
export function buildSequence(states, seamless, P, _noLoop){
  const masters=groupStates(states);
  const M=masters.length;
  // 🎬 片段循环展开:把带 clip.loops>1 的【连续同片段主状态】在播放列表里重复 loops 次 ——
  // 走路片段循环 N 圈后再过渡到下一段("走够 N 圈再衔接")。无 clip/loops 时 playlist===masters,行为不变。
  // (姿态子循环 _noLoop 不做片段展开,避免与"停留内圈"叠加。)
  const playlist=[];
  if(_noLoop){ for(const mm of masters) playlist.push(mm); }
  else{
    let m=0;
    while(m<M){
      const cid=states[masters[m].idx].clip?.id;
      if(cid!=null){
        let e=m; while(e+1<M && states[masters[e+1].idx].clip?.id===cid) e++;
        const loops=Math.max(1, Math.round(states[masters[m].idx].clip?.loops||1));
        for(let r=0;r<loops;r++) for(let k=m;k<=e;k++) playlist.push(masters[k]);
        m=e+1;
      } else { playlist.push(masters[m]); m++; }
    }
  }
  const segs=[]; const L=playlist.length;
  for(let m=0;m<L;m++){
    const {idx,poses}=playlist[m], st=states[idx];
    if(st.hold>0.01){
      const seg={type:'hold', si:idx, dur:st.hold};
      if(!_noLoop && poses.length){
        // 子循环里基姿态用 loop.h0/d0 计时(st.hold 是主时间轴上的总停留,别混用);
        // 姿态用各自的 hold/dur。isPose 置 false + _noLoop 双保险防递归分组。
        const lp=st.loop||{};
        // cam 置空:镜头只在主层施加一次(不然递归里外各套一遍变成双重变焦);姿态镜头无意义。
        const loopStates=[{...st, hold:lp.h0??1, dur:lp.d0??0.3, isPose:false, cam:null},
                          ...poses.map(pi=>({...states[pi], isPose:false, cam:null}))];
        seg.loop={states:loopStates, SEQ:buildSequence(loopStates, true, P, true)};
      }
      segs.push(seg);
    }
    const isLast=(m===L-1);
    const bPos=isLast ? 0 : m+1;
    const n=isLast ? (seamless && L>1 ? playlist[0].idx : null) : playlist[bPos].idx;
    if(n!==null){ const ov=st.trans||null;
      // 矢量图层配对(精确 layerId + 相似度就近兜底,见 vector.pairVectorShapes):被配上的
      // layerId 两侧都进 morphLayers → 这些点被抑制,由轮廓变形独占(免"既溶解又变形"的重影/闪烁)。
      // 删一部分再重画(拿到新 layerId)也照样连贯变形,不退化成点阵溶解。
      // 整体剪影模式:抑制两状态【所有矢量图层】的点(全交给连续轮廓变形,零溶解);否则按配对结果抑制。
      const morphLayers = P.silhouette
        ? new Set([...st.shapes, ...states[n].shapes]
            .filter(s=>s && s.layerId!=null && !s.hidden && s.bool!=='sub').map(s=>s.layerId))
        : pairVectorShapes(st.shapes, states[n].shapes).lids;
      // 🌊 前后相邻关键帧(按播放列表,seamless 时环绕)—— 供矢量样条插值算时间连续的速度切线。
      const cyc=i=>playlist[((i%L)+L)%L].idx;
      const aPrev = (seamless&&L>1) ? cyc(m-1) : (m>0 ? playlist[m-1].idx : null);
      const bNext = (seamless&&L>1) ? cyc(bPos+1) : (bPos+1<=L-1 ? playlist[bPos+1].idx : null);
      const durPrev = aPrev!=null ? states[aPrev].dur : st.dur;   // aPrev→a 段时长
      const durNext = bNext!=null ? states[n].dur : st.dur;       // b→bNext 段时长
      // 片段内(两端同 clip 且都无停留)= 连续运动 → 样条平滑过关键帧,速度天然连续(消除"减速再加速"卡顿)。
      const spline = states[idx].clip?.id!=null && states[idx].clip.id===states[n].clip?.id
                     && (states[idx].hold||0)<0.01 && (states[n].hold||0)<0.01;
      segs.push({type:'trans', a:idx, b:n, dur:st.dur, ov, morphLayers, ease:segEase(ov,P),
        aPrev, bNext, durPrev, durNext, spline,
        pairs:makePairs(st.dots, states[n].dots, segParams(P,ov))}); }
  }
  if(!segs.length) segs.push({type:'hold', si:masters[0]?.idx??0, dur:1});
  let T=0; segs.forEach(s=>{s.t0=T; T+=s.dur;});
  // 🎵 动态几何相位:把每个状态的 fx.freq 沿时间轴积分成连续圈数 Ψ —— 停留段常频、过渡段
  // freqA→freqB 线性变频(chirp)。全轨凑成【整数圈】(scale≈1 的微调),使无缝循环在回绕点相位精确对齐。
  const freqOf=si=>Math.min(2.5, Math.max(0, states[si]?.fx?.freq ?? 0.6));
  let psi=0;
  for(const s of segs){ s._psi0=psi;
    if(s.type==='hold'){ s._f0=s._f1=freqOf(s.si); psi+=s._f0*s.dur; }
    else { s._f0=freqOf(s.a); s._f1=freqOf(s.b); psi+=(s._f0+s._f1)*0.5*s.dur; } }
  const cyc=Math.round(psi), scale=(psi>1e-6 && cyc>=1)?cyc/psi:1;
  if(scale!==1) for(const s of segs){ s._psi0*=scale; s._f0*=scale; s._f1*=scale; }
  return {segs,T};
}
// Ψ(g)→ 角相位(弧度):停留段线性、过渡段二次(线性变频的积分)。喂给 behaviorDisp 取代墙钟相位。
const segPhase=(seg,g)=>{ if(seg._f0==null) return undefined;
  const tau=g-seg.t0;
  const cyc = seg._f0===seg._f1 ? seg._psi0 + seg._f0*tau
            : seg._psi0 + seg._f0*tau + 0.5*((seg._f1-seg._f0)/seg.dur)*tau*tau;
  return 6.283185307*cyc;
};
// 动态几何连续相位(弧度),供采样与单测校验变频/无缝。
export function fxPhaseAt(SEQ, g){ const {segs,T}=SEQ; g=Math.max(0,Math.min(T-1e-6,g));
  let seg=segs[0]; for(const s of segs){ if(g>=s.t0 && g<s.t0+s.dur){seg=s;break;} }
  return segPhase(seg,g)||0; }

// ── 虚拟摄像机(推拉摇移)──
// 每个状态可携带 cam {x,y,z,rot}:x/y=取景中心(归一化),z=变焦(>1 推近),rot=旋转(弧度)。
// 摄像机是"观看变换",施加在 sampleFrame 的最终球列表上 —— CPU/GPU 预览、导出、3D 贴图
// 全部经由 sampleFrame,零特判统一生效;编辑态数据(shapes/dots)完全不动。
export const DEF_CAM={x:0.5,y:0.5,z:1,rot:0};
export const camIdentity=c=>!c||(Math.abs(c.x-0.5)<1e-9&&Math.abs(c.y-0.5)<1e-9&&
  Math.abs((c.z??1)-1)<1e-9&&Math.abs(c.rot||0)<1e-12);
export function lerpCam(a,b,e){
  a={...DEF_CAM,...(a||{})}; b={...DEF_CAM,...(b||{})};
  // 变焦按对数插值(乘法均匀):推近的"感知速度"才恒定,线性插值会显得前快后慢。
  return {x:a.x+(b.x-a.x)*e, y:a.y+(b.y-a.y)*e,
          z:a.z*Math.pow(b.z/a.z,e), rot:a.rot+(b.rot-a.rot)*e};
}
// 单点镜头变换。旋转在"像素坐标系"里做:归一化系下 W≠H,直接旋转会剪切变形。
export function camPt(x,y,cam){
  if(camIdentity(cam)) return [x,y];
  const cm={...DEF_CAM,...cam}, cos=Math.cos(cm.rot), sin=Math.sin(cm.rot);
  const dx=(x-cm.x)*W, dy=(y-cm.y)*H;
  return [0.5+(dx*cos-dy*sin)*cm.z/W, 0.5+(dx*sin+dy*cos)*cm.z/H];
}
// 逆镜头变换:渲染像素(归一化)→ 画布源坐标。实心场(SDF)在源空间采样,
// 经此逆变换后与已被镜头变换的球画面严格对齐(含旋转)。
export function camPtInv(x,y,cam){
  if(camIdentity(cam)) return [x,y];
  const cm={...DEF_CAM,...cam}, cos=Math.cos(-cm.rot), sin=Math.sin(-cm.rot);
  const dx=(x-0.5)*W/cm.z, dy=(y-0.5)*H/cm.z;
  return [cm.x+(dx*cos-dy*sin)/W, cm.y+(dx*sin+dy*cos)/H];
}
export function applyCam(balls, cam){
  if(camIdentity(cam)) return balls;
  const cm={...DEF_CAM,...cam}, cos=Math.cos(cm.rot), sin=Math.sin(cm.rot);
  return balls.map(b=>{
    const dx=(b.x-cm.x)*W, dy=(b.y-cm.y)*H;
    const o={...b, x:0.5+(dx*cos-dy*sin)*cm.z/W, y:0.5+(dx*sin+dy*cos)*cm.z/H, r:b.r*cm.z};
    return o;
  });
}
// 当前段的有效镜头:停留=本状态镜头;过渡=相邻两状态镜头插值。
// 刻意恒用 smootherstep 而不跟随该段的点缓动 —— 弹性/弹跳适合"物",不适合"镜头"
// (镜头过冲会整幅画面晃动,违背"光生长"的稳定感;真实摄影机运动也是柔进柔出)。
export function camAt(seg, states, lt){
  if(seg.type==='hold') return states[seg.si].cam||null;
  return lerpCam(states[seg.a].cam, states[seg.b].cam, EASE.smootherstep(lt));
}

// ── 实心显示(solid)──
// 实心状态停留时按蒙版距离场(SDF)渲染:边缘是矢量形状本来的直线/曲线,不是点凑的。
// 过渡时实心场在头/尾各 35% 窗口内平滑升降(smoothstep),中段纯点阵 —— "整块溶解成
// 点飞走、再凝回整块"。窗口两端与停留段严丝合缝(w=1 时内部早已饱和,点在蒙版内,
// 边缘由实心场主导,亮度无跳变)。纯函数,返回 [{si,w}]。
export function solidWeights(seg, states, lt){
  const out=[];
  if(seg.type==='hold'){ if(states[seg.si].solid) out.push({si:seg.si, w:1}); }
  else {
    const WIN=0.35, ss=EASE.smoothstep;
    if(states[seg.a].solid){ const w=ss(Math.max(0,Math.min(1,1-lt/WIN))); if(w>0) out.push({si:seg.a, w}); }
    if(states[seg.b].solid){ const w=ss(Math.max(0,Math.min(1,(lt-(1-WIN))/WIN))); if(w>0) out.push({si:seg.b, w}); }
  }
  return out;
}
// 停留用全量 _sdf(含矢量图层);过渡用 _sdfBase(不含矢量图层)—— 矢量图层由 vector.js
// 轮廓变形独占,过渡时不再让状态 SDF 在旧关键帧位置留残影(消卡顿/噪音)。
const solidsOf=(seg,states,lt)=>solidWeights(seg,states,lt)
  .map(s=>{ const st=states[s.si], sdf = seg.type==='hold' ? st._sdf : (st._sdfBase||null);
    return sdf ? {sdf, w:s.w, si:s.si} : null; })
  .filter(Boolean);
// 动态几何(停留期)也作用于实心/矢量:给每个实心 SDF 附本状态 fx 的位移场 warp(u,v)→{dx,dy,rf},
// 渲染器逆向采样 → 整块随之晃动(此前 fx 只作用于点,实心用静态 SDF → 实心/矢量图形停留期无动作)。
// warp 用全局时间 time(连续),且 trans 各实心用自身状态的 fx/质心 → 与相邻停留段严丝合缝,无跳变。
// fadeOf(si)→[0..1]:过渡时把 fx 强度按状态交叉淡化(离场状态 1→0,入场 0→1)—— 让停留期的
// 动态几何(微光/波浪等)慢慢消失而非"满强度直到实心突然消失"。停留 fadeOf 缺省=满强度 1。
const attachFxWarp=(solids, states, time, fadeOf, w)=>solids.map(s=>{
  const st=states[s.si], fx=st?.fx;
  if(!hasFx(fx)) return s;
  const fade = fadeOf ? fadeOf(s.si) : 1;
  if(fade<=1e-3) return s;                                   // fx 已淡出:退回静态实心
  const fs = dotsStat(st.dots);
  return {...s, warp:(u,v)=>{ const d=behaviorDisp(u,v,fs.cx,fs.cy,time,fx,fs,w);
    return {dx:d.dx*fade, dy:d.dy*fade, rf:1+(d.rf-1)*fade}; }}; // 幅度按 fade 缩放,rf 向 1(无微光)靠拢
});

// 实心形状的点抑制:实心场权重为 w 时,其蒙版内的点半径乘 √(1−w)(场值 ∝ r² → 场强恰乘 1−w)。
// 停留(w=1)点完全消失 → 边缘 = 纯矢量 SDF,不会被靠边的大点"鼓包";过渡窗口内
// 实心场降、点平滑长出,停留↔过渡边界零跳变(根治"点突然出现"的卡顿)。
function suppressSolidDots(balls, seg, states, lt){
  const sw=solidWeights(seg,states,lt);
  if(!sw.length) return balls;
  const wA=seg.type==='hold' ? (sw[0]?.w||0) : (sw.find(s=>s.si===seg.a)?.w||0);
  const wB=seg.type==='trans' ? (sw.find(s=>s.si===seg.b)?.w||0) : 0;
  if(!wA&&!wB) return balls;
  for(const b of balls){
    const w=Math.max(0, 1-(b.sfA?wA:0)-(b.sfB?wB:0));
    if(w<1) b.r*=Math.sqrt(w);
  }
  return balls;
}

// 采样一帧:全局时间 g → {seg, balls, col, cam, solids}。预览与导出共用同一函数。
export function sampleFrame(SEQ, states, g, time, P){
  const {segs,T}=SEQ;
  g=Math.max(0,Math.min(T-1e-6,g));
  let seg=segs[0];
  for(const s of segs){ if(g>=s.t0 && g<s.t0+s.dur){seg=s;break;} }
  const w=segPhase(seg,g);   // 动态几何连续相位(变频已积分)—— 与 g 绑定 → 确定且预览==导出
  if(seg.type==='hold'){
    const st=states[seg.si], cam=camAt(seg,states,0);
    if(seg.loop){
      // 子循环:把停留段的本地进度映射到"整数圈"的子序列时间上再递归采样。
      // round(dur/LT) 圈 → 循环速度被轻微缩放以使停留头尾都精确落在基姿态(τ=0),
      // 相邻过渡按基姿态 dots 配对,边界天然无跳变。time 直传,呼吸漂移跨层连续。
      const LT=seg.loop.SEQ.T, lt=(g-seg.t0)/seg.dur;
      const cycles=Math.max(1, Math.round(seg.dur/LT));
      const tau=Math.min(LT-1e-6, (lt*cycles*LT)%LT);
      const sub=sampleFrame(seg.loop.SEQ, seg.loop.states, tau, time, P);
      return {seg, col:sub.col, cam:camIdentity(cam)?null:cam, balls:applyCam(sub.balls, cam),
        solids:sub.solids};
    }
    const fx=st.fx, fxOn=hasFx(fx), fs=fxOn?dotsStat(st.dots):null;
    // 🌟 边缘几何 fx(细波/锯齿/飞溅):停留期重建【位移后的矢量轮廓 SDF】+ 飞溅水珠 —— 几何级锐利细节,
    // 不受 warp 粗网格平滑限制。与流动类 fx(slosh/ripple…)叠加:后者仍由 attachFxWarp 加采样位移。
    let solids;
    const efx=segEdgeFx(P, seg, states); // 全局边缘几何(可选范围/是否含过渡)—— 停留段也按区间判定
    if(efx){
      const vps=solidOutlinePolys(st);
      if(vps.length){
        const c=polysCentroid(vps);
        const dpolys=vps.map(({poly,col,strokeW})=>({poly:displaceOutline(poly,c.x,c.y,time,efx), col, strokeW}));
        const drops=splatterDropletPolys(vps[0].poly, c.x, c.y, time, efx, hex2rgb(st.color));
        const vsolid=rasterizeVectorSolids([...dpolys, ...drops]).map(s=>({...s, si:seg.si}));
        const base=st._sdfBase ? [{sdf:st._sdfBase, w:1, si:seg.si}] : []; // 非矢量实心(如图片)保留
        solids=attachFxWarp([...vsolid, ...base], states, time, null, w);
      } else solids=attachFxWarp(solidsOf(seg,states,0), states, time, null, w);
    } else solids=attachFxWarp(solidsOf(seg,states,0), states, time, null, w); // 停留期动态几何也晃动实心/矢量
    const col=hex2rgb(st.color);
    // 🧪 发射器(气泡/雪/雨/烟/火星…)产生的是【额外的球】,追加在数组末尾 ——
    // 轨迹叠加层依赖"头部球在前 N 位"的约定,故新球一律往后加,不打乱下标。
    const balls=suppressSolidDots(st.dots.map(b=>{ const ph=dotPhase(b.x,b.y);
        let X=b.x+P.amp*drift(ph,time,P), Y=b.y+P.amp*drift(ph+3.1,time,P), R=b.r;
        if(fxOn){ const d=behaviorDisp(b.x,b.y,fs.cx,fs.cy,time,fx,fs,w); X+=d.dx; Y+=d.dy; R*=d.rf; }
        return {x:X, y:Y, r:R, c:b.c, sfA:b.sf};
      }).concat(fxOn?labEmit(fx,time,fs,1):[]), seg, states, 0);
    applyLabTint(balls, fx, time, 1, col);        // 🌈 彩虹:逐球上色(含发射出来的球)
    return {seg, col, cam:camIdentity(cam)?null:cam, solids, balls:applyCam(balls, cam)};
  } else {
    const lt=(g-seg.t0)/seg.dur, ca=hex2rgb(states[seg.a].color), cb=hex2rgb(states[seg.b].color);
    const e=EASE.smoothstep(lt), cam=camAt(seg,states,lt);
    const fxA=states[seg.a].fx, fxB=states[seg.b].fx;
    const fxc=(hasFx(fxA)||hasFx(fxB))
      ? {fxA,fxB,cA:centroidPt(states[seg.a].dots),cB:centroidPt(states[seg.b].dots),
         sA:dotsStat(states[seg.a].dots), sB:dotsStat(states[seg.b].dots)} : null;
    // 🧪 发射器按过渡进度交叉淡化(离场 1−e、入场 e):e=0/1 时另一端半径精确为 0,
    // 与相邻停留段严丝合缝 —— 与实心场的淡化用的是同一个 e,气泡不会在变形瞬间闪断。
    const emit=fxc ? labEmit(fxc.fxA,time,fxc.sA,1-e).concat(labEmit(fxc.fxB,time,fxc.sB,e)) : [];
    const col=[ca[0]+(cb[0]-ca[0])*e, ca[1]+(cb[1]-ca[1])*e, ca[2]+(cb[2]-ca[2])*e];
    const balls=suppressSolidDots(
        transBalls(seg.pairs,lt,time,segParams(P,seg.ov),fxc,seg.morphLayers,seg.ease,w).concat(emit), seg, states, lt);
    // 🌈 彩虹按同一个 e 交叉淡化:只有一端开彩虹时,颜色在过渡里平滑淡入/淡出,端点精确归零。
    if(fxc){ applyLabTint(balls, fxA, time, 1-e, col); applyLabTint(balls, fxB, time, e, col); }
    return {seg, balls:applyCam(balls, cam),
      cam:camIdentity(cam)?null:cam,
      // 动态几何 fx 按过渡进度交叉淡化:离场状态 1→e、入场状态 e(用位置同款缓动 e)—— 微光/波浪慢慢消失。
      solids:attachFxWarp(solidsOf(seg,states,lt), states, time, si=> si===seg.a ? 1-e : (si===seg.b ? e : 1), w),
      col};
  }
}
