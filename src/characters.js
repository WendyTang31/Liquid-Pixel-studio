// 🚶 角色系统:并行动画轨。每个角色 = 一段循环动画(如导入的走路小人)的关键帧序列 +
// 独立循环 + X/Y 位移(左到右走动)+ 缩放。所有角色【同时】合成到画面,互不占用主时间轴。
// 复用引擎:每个角色自建 SEQ,用 computeVectorPolys 求当前帧轮廓,平移/缩放后并入实心渲染。
// 纯合成层:不引入隐藏时间状态,任意时刻由 (角色循环时间, 位移进度) 凭空求值 → 可拖动、预览==导出。
import { store } from './store.js';
import { P, W, H } from './config.js';
import { buildSequence } from './engine.js';
import { computeVectorPolys, rasterizeVectorSolids } from './vector.js';

// 由导入的动画(帧=形状数组 + 逐帧时长/保持)造一个角色。frames 为 state 形态的对象数组。
export function makeCharacter(name, frames, cycleSec){
  return {
    id:++store.charSeq, name:name||`角色 ${store.charSeq}`,
    states:frames, SEQ:null, seqDirty:true, cycleSec:cycleSec||1,
    x0:0, y0:0, x1:0, y1:0,      // 位移:循环内从 (x0,y0) 线性走到 (x1,y1)(px,画布坐标偏移)
    scale:1, rot:0, speed:1, visible:true,   // rot=整体旋转(度)
    groundSpeed:DEFAULT_GROUND_SPEED,        // 地面速度(px/s):距离越远自动走越久,速度恒定(与步频/时长解耦)
    wrap:false,                              // wrap=环绕(出右回左,永远向前)
    mirX:false, mirY:false,                  // 整体镜像(水平/垂直):跑向左 ⇄ 跑向右
  };
}
// 把导入动画(anim.frames/durations/holds)转成角色的 state 帧(computeVectorPolys/buildSequence 所需字段)。
export function framesFromAnim(anim){
  return anim.frames.map((shapes,i)=>({
    id:i+1, name:`f${i+1}`, color:'#000',
    shapes, dots:[], manual:[], trans:{}, cam:null, loop:null, isPose:false,
    hold:anim.holds?.[i]||0, dur:anim.durations?.[i]||Math.max(0.06,(anim.cycleSec||1)/anim.frames.length),
  }));
}

function ensureSEQ(ch){ if(ch.seqDirty || !ch.SEQ){ ch.SEQ=buildSequence(ch.states, true, P); ch.seqDirty=false; } return ch.SEQ; }
// 角色一整圈的实际时长(秒)= 序列固有周期 / 速度。UI 用它显示/设置「整体 loop 时长」。
export function charLoopSec(ch){ return ensureSEQ(ch).T / (ch.speed||1); }
export function setCharLoopSec(ch, sec){ const T=ensureSEQ(ch).T; ch.speed = T / Math.max(0.05, sec||1); }

// 角色的循环时间 t、位移进度 prog(0..1)、是否已出场 started。
// sync='free'(默认):走墙钟 clock,延迟 delay 秒后出场,之后一直独立循环(适合一次性入场)。
// sync='timeline':跟随主时间轴 gMain —— 每个主循环内从 delay 处开始 → 与箭头等主动画【严格同步】,
//   两个角色都设 sync='timeline'、delay=0 即"一起开始";一个 delay=0、一个 delay=1 即"箭头后 1s 小人才跑"。
export const DEFAULT_GROUND_SPEED = 300;               // 地面速度默认值(px/s):距离与它一起决定"走多久"
export function charTime(ch, clock, gMain){
  const SEQ=ensureSEQ(ch), T=Math.max(1e-3, SEQ.T);
  const speed=ch.speed||1, delay=ch.delay||0;
  // 🔁 跑不停(wrap)= 永远向前的连续里程,天生与「跟随主时间轴」(每个主循环归零)矛盾 ——
  // 若两者并用,主循环一归零里程就回退 → 画面里小人瞬间退回去。故 wrap 时【强制走单调墙钟】,永不退回。
  const useTL = ch.sync==='timeline' && gMain!=null && !ch.wrap;
  const base = (useTL ? gMain : clock) - delay;      // 有效起算时间
  const started = base >= -1e-6;                      // delay 未到 → 尚未出场
  const total = base*speed;
  // 🚶【位移距离】与【步频/循环时长/速度】彻底解耦:走路循环每 T 秒一圈(步频),位移按【地面速度】推进。
  // 圈数不再手填,而是 = 距离 ÷ (地面速度 × 每圈秒数) 四舍五入成整数圈 —— 距离越远,自动多迈几圈、
  // 耗时更长,地面速度恒定,绝不"距离一大就加速"。整数圈 → 走路循环在一趟位移里跑整数次,无缝。
  const cycSec = T/speed;                              // 一个走路循环的实际秒数
  const gs = Math.max(1, ch.groundSpeed || DEFAULT_GROUND_SPEED);
  const travDist = ch.wrap ? (Math.abs((ch.x1||0)-(ch.x0||0)) || W)
                           : Math.hypot((ch.x1||0)-(ch.x0||0), (ch.y1||0)-(ch.y0||0));
  const laps = travDist>1 ? Math.max(1, Math.round(travDist/(gs*cycSec))) : 1;
  const t=((total%T)+T)%T;
  const progC=total/(T*laps);           // 连续里程(可 >1,永不回头)—— 环绕平移用
  const prog=((progC%1)+1)%1;           // 循环内进度 0..1 —— 线性往返用
  return { SEQ, T, t, prog, progC, started, laps };
}
// 取模到 [0,m):JS 的 % 对负数会返回负值,直接用会让向左跑的角色瞬移。
const mod=(v,m)=>((v%m)+m)%m;
const WRAP_PAD=200;                     // 环绕出画余量:够角色整个走出画面再折返,接缝落在画外
// 角色当前帧的位移形变后轮廓 polys(逻辑画布坐标)。绕画布中心缩放,再按位移进度平移。
export function charPolys(ch, clock, gMain){
  if(!ch.visible || !ch.states?.length) return [];
  const { SEQ, t, prog, progC, started }=charTime(ch, clock, gMain);
  if(!started) return [];                             // 还没到出场时间
  // 🔁 跑不停:画布只有 W 宽,想"一直往前跑"不能靠把行程拉到几千像素 —— 那样绝大部分时间人在画外,
  // 看起来就是"跑到边上被裁成一条线、又凭空出现在中间"。正解是【环绕平移】:走到右边画外就从左边画外
  // 接着进来。环绕周期 = 画布宽 + 余量,翻转点在画外发生 → 肉眼完全看不出接缝,视觉上就是永远向前跑。
  let dx, dy;
  if(ch.wrap){
    const span=W+WRAP_PAD;                              // 一个环绕周期(画布宽 + 出画余量)
    const perLap=((ch.x1||0)-(ch.x0||0)) || W;          // 跑满 laps 圈前进多少 px(正负 = 方向)
    const travelled=perLap*progC;                       // 连续里程,永不回头
    dx = -W/2 - WRAP_PAD/2 + mod(travelled, span);      // 取模 → 出右画外即从左画外接着进来
    dy = (ch.y0||0);                                    // 环绕模式纵向固定(要斜跑就关掉环绕)
  } else {
    dx=(ch.x0||0)+((ch.x1||0)-(ch.x0||0))*prog;
    dy=(ch.y0||0)+((ch.y1||0)-(ch.y0||0))*prog;
  }
  const sc=ch.scale||1, cx=W/2, cy=H/2;
  const ang=(ch.rot||0)*Math.PI/180, ca=Math.cos(ang), sa=Math.sin(ang); // 整体旋转(绕画面中心)
  const mx=ch.mirX?-1:1, my=ch.mirY?-1:1;                                 // 整体镜像(在旋转之前,故是"角色自身"翻面)
  const polys=computeVectorPolys(ch.states, SEQ, t, t, P, true); // includeHold:停留帧也画,不闪烁(相位用循环时间 t → 确定)
  return polys.map(o=>({ ...o,
    // 相对中心 → 镜像 → 缩放 → 旋转 → 位移(镜像在最内层 = 原地翻面,不影响走位)
    poly:o.poly.map(p=>{ const rx=(p.x-cx)*mx*sc, ry=(p.y-cy)*my*sc;
      return { x:cx + (rx*ca - ry*sa) + dx, y:cy + (rx*sa + ry*ca) + dy }; }),
    strokeW:(o.strokeW||0)*sc }));
}
// 给定角色数组 → 合成实心(每个角色一块 SDF solid)。store 无关 → 编辑器与 3D 预览器共用。
// gMain=主时间轴当前循环位置(秒),供 sync='timeline' 的角色与主动画同步;不传则所有角色按自由时钟。
export function charSolidsFrom(chars, clock, gMain){
  const out=[];
  for(const ch of chars||[]){ const polys=charPolys(ch, clock, gMain);
    if(polys.length) out.push(...rasterizeVectorSolids(polys)); }
  return out;
}
// 编辑器:合成 store 里的所有角色。并入主渲染的 solids 数组即可同屏并行播放。
// 正在「编辑帧」的角色跳过 —— 它此刻就是主时间轴,已由主渲染画出,避免重影。
export function charactersSolids(clock, gMain){
  return charSolidsFrom(store.characters.filter(c=>c!==store.editingChar), clock, gMain);
}

// ── 序列化(随工程存/取)。SEQ 是派生的,不存;打开时重建。──
export function serializeCharacters(){
  return store.characters.map(ch=>({
    id:ch.id, name:ch.name, cycleSec:ch.cycleSec,
    x0:ch.x0, y0:ch.y0, x1:ch.x1, y1:ch.y1, scale:ch.scale, rot:ch.rot||0, speed:ch.speed, visible:ch.visible,
    mirX:!!ch.mirX, mirY:!!ch.mirY, sync:ch.sync||'free', delay:ch.delay||0, groundSpeed:ch.groundSpeed||DEFAULT_GROUND_SPEED, wrap:!!ch.wrap,
    states:ch.states.map(s=>({ name:s.name, color:s.color, hold:s.hold, dur:s.dur,
      shapes:JSON.parse(JSON.stringify(s.shapes)) })),
  }));
}
// 纯构造:工程数据 → 角色数组(不写 store)。编辑器与 3D 预览器共用。
export function hydrateCharacters(arr){
  return (arr||[]).map(d=>{
    const frames=(d.states||[]).map((s,i)=>({ id:i+1, name:s.name||`f${i+1}`, color:s.color||'#000',
      shapes:s.shapes||[], dots:[], manual:[], trans:{}, cam:null, loop:null, isPose:false,
      hold:s.hold||0, dur:s.dur||0.1 }));
    return { id:d.id, name:d.name, states:frames, SEQ:null, seqDirty:true, cycleSec:d.cycleSec||1,
      x0:d.x0||0, y0:d.y0||0, x1:d.x1||0, y1:d.y1||0, scale:d.scale??1, rot:d.rot||0, speed:d.speed??1,
      visible:d.visible!==false, mirX:!!d.mirX, mirY:!!d.mirY, sync:d.sync||'free', delay:d.delay||0, groundSpeed:d.groundSpeed||DEFAULT_GROUND_SPEED, wrap:!!d.wrap };
  });
}
export function loadCharacters(arr){
  store.characters=hydrateCharacters(arr);
  store.charSeq=Math.max(0, ...store.characters.map(c=>c.id||0));
  store.activeChar=store.characters.length?0:-1;
}
