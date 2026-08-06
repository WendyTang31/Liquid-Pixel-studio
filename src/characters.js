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
    scale:1, speed:1, visible:true,
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

// 角色在墙钟 clock 时刻的循环时间 t 与位移进度 prog(0..1)。speed 缩放循环快慢。
export function charTime(ch, clock){
  const SEQ=ensureSEQ(ch), T=Math.max(1e-3, SEQ.T);
  const t=((clock*(ch.speed||1))%T+T)%T;
  return { SEQ, T, t, prog:t/T };
}
// 角色当前帧的位移形变后轮廓 polys(逻辑画布坐标)。绕画布中心缩放,再按位移进度平移。
export function charPolys(ch, clock){
  if(!ch.visible || !ch.states?.length) return [];
  const { SEQ, t, prog }=charTime(ch, clock);
  const dx=(ch.x0||0)+((ch.x1||0)-(ch.x0||0))*prog, dy=(ch.y0||0)+((ch.y1||0)-(ch.y0||0))*prog;
  const sc=ch.scale||1, cx=W/2, cy=H/2;
  const polys=computeVectorPolys(ch.states, SEQ, t, clock*(ch.speed||1), P);
  return polys.map(o=>({ ...o,
    poly:o.poly.map(p=>({ x:cx+(p.x-cx)*sc+dx, y:cy+(p.y-cy)*sc+dy })),
    strokeW:(o.strokeW||0)*sc }));
}
// 所有可见角色 → 合成实心(每个角色一块 SDF solid)。并入主渲染的 solids 数组即可同屏并行播放。
export function charactersSolids(clock){
  const out=[];
  for(const ch of store.characters){ const polys=charPolys(ch, clock);
    if(polys.length) out.push(...rasterizeVectorSolids(polys)); }
  return out;
}

// ── 序列化(随工程存/取)。SEQ 是派生的,不存;打开时重建。──
export function serializeCharacters(){
  return store.characters.map(ch=>({
    id:ch.id, name:ch.name, cycleSec:ch.cycleSec,
    x0:ch.x0, y0:ch.y0, x1:ch.x1, y1:ch.y1, scale:ch.scale, speed:ch.speed, visible:ch.visible,
    states:ch.states.map(s=>({ name:s.name, color:s.color, hold:s.hold, dur:s.dur,
      shapes:JSON.parse(JSON.stringify(s.shapes)) })),
  }));
}
export function loadCharacters(arr){
  store.characters=(arr||[]).map(d=>{
    const frames=(d.states||[]).map((s,i)=>({ id:i+1, name:s.name||`f${i+1}`, color:s.color||'#000',
      shapes:s.shapes||[], dots:[], manual:[], trans:{}, cam:null, loop:null, isPose:false,
      hold:s.hold||0, dur:s.dur||0.1 }));
    return { id:d.id, name:d.name, states:frames, SEQ:null, seqDirty:true, cycleSec:d.cycleSec||1,
      x0:d.x0||0, y0:d.y0||0, x1:d.x1||0, y1:d.y1||0, scale:d.scale??1, speed:d.speed??1,
      visible:d.visible!==false };
  });
  store.charSeq=Math.max(0, ...store.characters.map(c=>c.id||0));
  store.activeChar=store.characters.length?0:-1;
}
