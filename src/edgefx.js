// 边缘几何效果(停留期):把矢量实心形状的轮廓【沿法线程序化位移】—— 细密波浪 / 锯齿尖刺(p2 星形)/
// 飞溅触须,再配会自行消失的飞溅水珠。纯函数、确定性(只依赖 time 与坐标哈希)→ 拖动/导出完全一致。
// 分工:本模块改【几何】(重建位移后的轮廓 SDF,细节锐利,不受粗网格 warp 平滑限制);
// engine 的 behaviorDisp/warp 改【采样】(slosh/ripple 等流动类)。二者叠加互不冲突。
// 轮廓点为逻辑坐标(0..W≈480),位移单位 = px。
const TAU=6.283185307;
function hash(n){ const s=Math.sin(n*127.1+311.7)*43758.5453; return s-Math.floor(s); }

export const hasEdgeFx=fx=>!!(fx&&(fx.fineWave||fx.jagged||fx.splatter));
// 全局边缘几何:按 scope(仅停留 / 整段)与状态区间 [from,to] 判定【当前段】是否施加,返回参数或 null。
// hold 段:si 在区间内即施加(两种 scope 都作用于停留);trans 段:仅 scope==='span' 且两端都在区间内 → 连续贯穿。
export function segEdgeFx(P, seg, states){
  const e=P&&P.efx; if(!e || (!e.fineWave && !e.jagged && !e.splatter)) return null;
  const n=states.length, from=Math.max(0,e.from|0), to=(e.to==null||e.to<0)?n-1:Math.min(n-1,e.to);
  const vals={fineWave:e.fineWave||0, jagged:e.jagged||0, splatter:e.splatter||0, freq:e.freq||0.6, jagMotion:e.jagMotion||'pulse'};
  if(seg.type==='hold') return (seg.si>=from && seg.si<=to) ? vals : null;
  if(e.scope!=='span') return null;                                   // 仅停留模式:过渡不施加
  return (seg.a>=from && seg.a<=to && seg.b>=from && seg.b<=to) ? vals : null;
}
// 过渡期把两端状态的边缘 fx 参数按 e 插值 —— 令效果贯穿"停留→过渡→停留"连续,不在变形时闪断。
// 两端都设了同样的值 → 全程恒定;只有一端设 → 在过渡里平滑淡入/淡出。
export function blendEdgeFx(a, b, e){
  const g=(k)=>((a&&a[k])||0)*(1-e) + ((b&&b[k])||0)*e;
  const fw=g('fineWave'), jg=g('jagged'), sp=g('splatter');
  if(!fw && !jg && !sp) return null;
  return { fineWave:fw, jagged:jg, splatter:sp, freq:(a&&a.freq)||(b&&b.freq)||0.6, jagMotion:(a&&a.jagMotion)||(b&&b.jagMotion)||'pulse' };
}

// 少量"触须"槽:各有角度/周期/相位,时隐时现地向外冲出再收回(飞溅的丝状喷射)。
const TSLOTS=6;
function tendrilAt(s, time, f){
  let d=0;
  for(let k=0;k<TSLOTS;k++){
    const ang=hash(k*7.13+2), period=1.5+2.4*hash(k*7.13+3), phase=hash(k*7.13+5);
    const life=(((time*f/period)+phase)%1+1)%1;
    if(life>0.42) continue;                       // 仅活跃窗口 → 偶发、时隐时现
    const env=Math.sin(life/0.42*Math.PI);        // 0→1→0:冲出再收回
    let dd=Math.abs(s-ang); dd=Math.min(dd,1-dd); // 环形弧距
    const w=0.016, spike=Math.exp(-(dd*dd)/(2*w*w));
    d += env*spike;
  }
  return d; // ≥0,向外
}

// 轮廓平均半径(到质心):位移幅度按【图形自身大小】缩放 —— 小图形小变形、大图形大变形,比例恒定。
function meanRadius(poly, cx, cy){ let s=0; for(const p of poly) s+=Math.hypot(p.x-cx,p.y-cy); return s/poly.length||1; }

// 轮廓逐点沿【外法线】(垂直切线、背离质心)加位移 → 新轮廓。幅度 = 系数 × 图形半径(相对大小)。
export function displaceOutline(poly, cx, cy, time, fx){
  const N=poly.length; if(N<3) return poly;
  const f=Math.min(2.5, fx.freq||0.6), R=meanRadius(poly,cx,cy), out=new Array(N);
  for(let i=0;i<N;i++){
    const p=poly[i], a=poly[(i-1+N)%N], b=poly[(i+1)%N];
    let tx=b.x-a.x, ty=b.y-a.y; const tl=Math.hypot(tx,ty)||1; tx/=tl; ty/=tl;
    let nx=ty, ny=-tx;                                     // 切线的垂线
    if((p.x-cx)*nx+(p.y-cy)*ny < 0){ nx=-nx; ny=-ny; }     // 取指向外侧的
    const s=i/N; let d=0;                                  // 弧参数 [0,1)
    if(fx.fineWave)                                        // 细密行波:24 道涟漪【绕轮廓流动】(相位速度足够快 → 明显动),幅=半径 ~5%
      d += fx.fineWave*0.05*R * Math.sin(TAU*24*s - time*f*TAU*4);
    if(fx.jagged){                                         // 锯齿尖刺(p2):9 个变长尖峰,pow 收尖。
      // 动作模式:pulse=伸缩(逐齿脉动·默认原样);flow=电锯(齿沿轮廓匀速流动、幅度恒定);quiver=微颤(齿位置高频小抖)。
      const K=9, mode=fx.jagMotion||'pulse';
      let travel, amp;                                     // travel=齿沿轮廓移动的相位;amp=幅度调制(null=用逐齿脉动)
      if(mode==='flow'){        travel=time*f*2.4;  amp=1; }                        // 🪚 电锯:匀速流动、幅恒定
      else if(mode==='quiver'){ travel=time*f*0.22 + 0.10*Math.sin(time*f*TAU*2.4); // 🫨 微颤:位置高频小抖
                                amp=0.92+0.08*Math.sin(time*f*TAU*3.1); }
      else {                    travel=time*f*0.22;  amp=null; }                    // 伸缩(原样)
      const x=s*K + travel, cell=Math.floor(x), fr=x-cell;
      const len=0.4+0.6*hash(cell*2.31+1), tri=1-Math.abs(2*fr-1);
      const spike=Math.pow(tri, 2.4);
      const pulse = amp!=null ? amp : (0.72+0.28*Math.sin(time*f*TAU + cell));
      d += fx.jagged*0.28*R * len*spike*pulse;             // 恒向外 = 星尖(半径的 ~28%)
    }
    if(fx.splatter)                                        // 飞溅触须:窄、时隐时现的外冲长刺(半径的 ~30%)
      d += fx.splatter*0.30*R * tendrilAt(s, time, f);
    out[i]={x:p.x+nx*d, y:p.y+ny*d};
  }
  return out;
}

// 方向最接近 ang 的轮廓点半径(定位喷射起点)。
function polyRadiusAt(poly, cx, cy, ang){
  let best=0, bd=Infinity;
  for(const p of poly){ let da=Math.abs(Math.atan2(p.y-cy,p.x-cx)-ang);
    if(da>Math.PI) da=TAU-da; if(da<bd){ bd=da; best=Math.hypot(p.x-cx,p.y-cy); } }
  return best;
}
// 圆近似为小多边形(逻辑坐标),供并入实心 SDF。
function circlePoly(cx, cy, r, n=14){
  const p=new Array(n); for(let i=0;i<n;i++){ const a=i/n*TAU; p[i]={x:cx+r*Math.cos(a), y:cy+r*Math.sin(a)}; }
  return p;
}
// 飞溅水珠:独立小圆从边缘朝外飞、半径渐隐(→0 即自行消失),循环错峰再生。返回轮廓 poly 数组(并进 SDF)。
const DSLOTS=11;
export function splatterDropletPolys(poly, cx, cy, time, fx, col){
  if(!fx.splatter) return [];
  const f=Math.min(2.5, fx.freq||0.6), out=[];
  for(let k=0;k<DSLOTS;k++){
    const period=1.2+2.2*hash(k*13.71+1), phase=hash(k*13.71+2), ang=hash(k*13.71+3)*TAU;
    const life=(((time*f/period)+phase)%1+1)%1;
    if(life>0.72) continue;                                // 只在部分周期存在
    const edgeR=polyRadiusAt(poly, cx, cy, ang), fly=life*98;
    const x=cx+Math.cos(ang)*(edgeR+9+fly), y=cy+Math.sin(ang)*(edgeR+9+fly);
    const r=fx.splatter*13*(1-life);                       // 渐隐:半径→0 → 自行消失
    if(r>0.7) out.push({poly:circlePoly(x,y,r), col});
  }
  return out;
}
export function polysCentroid(vps){
  let x=0,y=0,n=0; for(const {poly} of vps) for(const p of poly){ x+=p.x; y+=p.y; n++; }
  return n?{x:x/n,y:y/n}:{x:240,y:240};
}
