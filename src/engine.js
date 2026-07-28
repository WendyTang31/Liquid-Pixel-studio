// 引擎层:全部纯函数,无隐藏状态。参数从 P 显式传入,任意全局时间 g 都能凭空求值 ——
// 这是时间轴可拖、导出确定性、"预览 == 导出"一致性的根基。预览与导出共用 sampleFrame。
import { hex2rgb } from './utils.js';
import { W, H } from './config.js';

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
};

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
export const hasFx=fx=>!!(fx&&(fx.slosh||fx.spring||fx.liquid||fx.ripple||fx.twinkle));
const FXB=0.04; // 位移基准幅度(归一化画布)
export function behaviorDisp(x,y,cx,cy,t,fx){
  let dx=0,dy=0,rf=1;
  const f=Math.min(2.5, fx.freq||0.6), w=6.283185307*f*t;
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
export function transBalls(pairs,t,time,P,fxc,morphLayers){
  const ease=EASE[P.ease], span=Math.max(1e-6,1-P.stag), stretch=P.stretch||0, flow=P.flow||0;
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
      const dA=hasFx(fxc.fxA)?behaviorDisp(p.a.x,p.a.y,fxc.cA.x,fxc.cA.y,time,fxc.fxA):FX0;
      const dB=hasFx(fxc.fxB)?behaviorDisp(p.b.x,p.b.y,fxc.cB.x,fxc.cB.y,time,fxc.fxB):FX0;
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
  const segs=[]; const M=masters.length;
  for(let m=0;m<M;m++){
    const {idx,poses}=masters[m], st=states[idx];
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
    const isLast=(m===M-1);
    const n=isLast ? (seamless && M>1 ? masters[0].idx : null) : masters[m+1].idx;
    if(n!==null){ const ov=st.trans||null;
      // 两端都有的 layerId = 该过渡走轮廓变形(vector.js),这些点由引擎按 lid 抑制;
      // 只在一端的 layerId 不算 morph,其点照常溶解(矢量图层↔普通帧的溶解过渡)。
      const la=lidSet(st.dots), lb=lidSet(states[n].dots);
      const morphLayers=new Set([...la].filter(x=>lb.has(x)));
      segs.push({type:'trans', a:idx, b:n, dur:st.dur, ov, morphLayers,
        pairs:makePairs(st.dots, states[n].dots, segParams(P,ov))}); }
  }
  if(!segs.length) segs.push({type:'hold', si:masters[0]?.idx??0, dur:1});
  let T=0; segs.forEach(s=>{s.t0=T; T+=s.dur;});
  return {segs,T};
}

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
const solidsOf=(seg,states,lt)=>solidWeights(seg,states,lt)
  .filter(s=>states[s.si]._sdf).map(s=>({sdf:states[s.si]._sdf, w:s.w}));

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
    const fx=st.fx, fxOn=hasFx(fx), fc=fxOn?centroidPt(st.dots):null;
    return {seg, col:hex2rgb(st.color), cam:camIdentity(cam)?null:cam,
      solids:solidsOf(seg,states,0),
      balls:applyCam(suppressSolidDots(st.dots.map(b=>{ const ph=dotPhase(b.x,b.y);
        let X=b.x+P.amp*drift(ph,time,P), Y=b.y+P.amp*drift(ph+3.1,time,P), R=b.r;
        if(fxOn){ const d=behaviorDisp(b.x,b.y,fc.x,fc.y,time,fx); X+=d.dx; Y+=d.dy; R*=d.rf; }
        return {x:X, y:Y, r:R, c:b.c, sfA:b.sf};
      }), seg, states, 0), cam)};
  } else {
    const lt=(g-seg.t0)/seg.dur, ca=hex2rgb(states[seg.a].color), cb=hex2rgb(states[seg.b].color);
    const e=EASE.smoothstep(lt), cam=camAt(seg,states,lt);
    const fxA=states[seg.a].fx, fxB=states[seg.b].fx;
    const fxc=(hasFx(fxA)||hasFx(fxB))
      ? {fxA,fxB,cA:centroidPt(states[seg.a].dots),cB:centroidPt(states[seg.b].dots)} : null;
    return {seg, balls:applyCam(suppressSolidDots(
        transBalls(seg.pairs,lt,time,segParams(P,seg.ov),fxc,seg.morphLayers), seg, states, lt), cam),
      cam:camIdentity(cam)?null:cam, solids:solidsOf(seg,states,lt),
      col:[ca[0]+(cb[0]-ca[0])*e, ca[1]+(cb[1]-ca[1])*e, ca[2]+(cb[2]-ca[2])*e]};
  }
}
