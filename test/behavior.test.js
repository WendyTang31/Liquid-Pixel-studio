// 动态几何(行为修饰器)纯函数断言:各效果生效、确定性、光敏安全(频率上限)、
// 停留↔过渡边界连续。
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFx, behaviorDisp, buildSequence, sampleFrame, fxPhaseAt } from '../src/engine.js';

const P0={ ease:'linear', stag:0, amp:0, freq:.4, match:'sortXY', flow:0, stretch:0 };
const D=(x,y)=>({x,y,r:.02});

test('hasFx:任一幅度>0 才算开启;仅 freq 不算', () => {
  assert.equal(hasFx(null), false);
  assert.equal(hasFx({freq:2}), false);
  assert.equal(hasFx({slosh:0.5}), true);
  assert.equal(hasFx({twinkle:0.1}), true);
});

test('behaviorDisp:确定性(同参两次一致);无效果时零位移单位半径', () => {
  const a=behaviorDisp(0.3,0.7,0.5,0.5,1.234,{slosh:0.6,freq:0.8});
  const b=behaviorDisp(0.3,0.7,0.5,0.5,1.234,{slosh:0.6,freq:0.8});
  assert.deepEqual(a,b);
  const z=behaviorDisp(0.3,0.7,0.5,0.5,1.234,{});
  assert.ok(Math.abs(z.dx)<1e-12&&Math.abs(z.dy)<1e-12&&Math.abs(z.rf-1)<1e-12);
});

test('波浪 slosh:随时间产生水平位移;越靠上晃幅越大', () => {
  const top=behaviorDisp(0.5,0.05,0.5,0.5,0.5,{slosh:1,freq:0.6});
  const bot=behaviorDisp(0.5,0.95,0.5,0.5,0.5,{slosh:1,freq:0.6});
  assert.ok(Math.abs(top.dx)>1e-4, '应有水平位移');
  assert.ok(Math.abs(top.dx)>Math.abs(bot.dx), '顶部晃幅应大于底部');
});

test('弹簧 spring:体积守恒(质心处零位移;上下反向缩放)', () => {
  const t=0.3, fx={spring:1,freq:0.6};
  const c=behaviorDisp(0.5,0.5,0.5,0.5,t,fx);
  assert.ok(Math.abs(c.dx)<1e-9&&Math.abs(c.dy)<1e-9,'质心不动');
  const up=behaviorDisp(0.5,0.2,0.5,0.5,t,fx), dn=behaviorDisp(0.5,0.8,0.5,0.5,t,fx);
  assert.ok(Math.sign(up.dy)!==Math.sign(dn.dy)||up.dy===0,'质心两侧 y 位移反向');
});

test('波纹 ripple:位移沿径向(与半径方向平行)', () => {
  const fx={ripple:1,freq:0.6};
  const d=behaviorDisp(0.8,0.5,0.5,0.5,0.4,fx); // 正右方 → 位移应几乎纯 x
  assert.ok(Math.abs(d.dy)<1e-9, '正右方点位移应无 y 分量');
  assert.ok(Math.abs(d.dx)>1e-5, '应有径向位移');
});

test('微光 twinkle:只改半径不改位置;逐点异相(不同点相位不同)', () => {
  const a=behaviorDisp(0.2,0.3,0.5,0.5,0.5,{twinkle:1,freq:0.6});
  const b=behaviorDisp(0.7,0.6,0.5,0.5,0.5,{twinkle:1,freq:0.6});
  assert.ok(Math.abs(a.dx)<1e-12&&Math.abs(a.dy)<1e-12,'twinkle 不改位置');
  assert.ok(a.rf!==1, '半径因子应变化');
  assert.ok(Math.abs(a.rf-b.rf)>1e-6, '不同点应异相 → rf 不同(非全局同步频闪)');
});

test('光敏安全:频率被硬性钳到 ≤2.5Hz(freq=10 与 freq=2.5 等价)', () => {
  const hi=behaviorDisp(0.3,0.4,0.5,0.5,0.37,{slosh:1,freq:10});
  const cap=behaviorDisp(0.3,0.4,0.5,0.5,0.37,{slosh:1,freq:2.5});
  assert.ok(Math.abs(hi.dx-cap.dx)<1e-12&&Math.abs(hi.dy-cap.dy)<1e-12,'超 2.5Hz 应被钳住');
});

test('sampleFrame:停留段施加动态几何;停留↔过渡边界连续(无跳变)', () => {
  const A={hold:2, dur:2, color:'#fff', fx:{slosh:0.8,ripple:0.5,freq:0.6}, dots:[D(.3,.3),D(.6,.7)]};
  const B={hold:1, dur:2, color:'#fff', dots:[D(.7,.4),D(.2,.6)]};
  const states=[A,B];
  const SEQ=buildSequence(states, false, P0);
  // 停留中点:动态几何应让点偏离基础位置
  const held=sampleFrame(SEQ,states,1.0,0.5,P0);
  const moved=held.balls.some((b,i)=>Math.abs(b.x-A.dots[i].x)>1e-4||Math.abs(b.y-A.dots[i].y)>1e-4);
  assert.ok(moved,'停留期动态几何应产生位移');
  // 边界:holdA 结束(g=2⁻)→ 过渡开始(g=2⁺),同一墙钟,位移应连续
  const eps=1e-4, time=3.3;
  const before=sampleFrame(SEQ,states,2-eps,time,P0), after=sampleFrame(SEQ,states,2+eps,time,P0);
  for(let i=0;i<before.balls.length;i++){
    const d=Math.hypot(before.balls[i].x-after.balls[i].x, before.balls[i].y-after.balls[i].y);
    assert.ok(d<2e-3, `边界点${i}位移跳变=${d}`);
  }
});

test('逐帧变频:过渡期相位连续、瞬时频率从 freqA 单调升到 freqB(chirp)', () => {
  // kf1 慢(0.3Hz)→ kf2 快(2.0Hz),停留+过渡+停留,seamless 环。
  const A={hold:2, dur:2, color:'#fff', fx:{slosh:0.8,freq:0.3}, dots:[D(.3,.3)]};
  const B={hold:2, dur:2, color:'#fff', fx:{slosh:0.8,freq:2.0}, dots:[D(.6,.7)]};
  const states=[A,B];
  const SEQ=buildSequence(states, true, P0);   // seamless=true → 含回绕过渡
  const T=SEQ.T;
  // 1) 相位单调非减且无【突跳】:任一步进都远小于一整圈(真断裂会是 O(2π))。
  const N=2000, step=2*Math.PI*2.5*(T/N)*1.6; // 允许上限=最高频(2.5Hz)下的单步推进×余量
  let prev=fxPhaseAt(SEQ,0), maxJump=0, mono2=true;
  for(let i=1;i<=N;i++){ const p=fxPhaseAt(SEQ, i/N*T*0.9999);
    if(p<prev-1e-9) mono2=false; maxJump=Math.max(maxJump, p-prev); prev=p; }
  assert.ok(mono2, '相位应单调非减');
  assert.ok(maxJump < step, `相位有突跳=${maxJump} (上限${step})`);
  // 2) 过渡段(g∈[2,4])瞬时频率(相位数值导数/2π)从 ~freqA 单调升到 ~freqB
  const dg=1e-3, instF=g=>(fxPhaseAt(SEQ,g+dg)-fxPhaseAt(SEQ,g-dg))/(2*dg)/(2*Math.PI);
  const fStart=instF(2.02), fEnd=instF(3.98);
  assert.ok(fStart>0.25 && fStart<0.6, `过渡起点频率≈freqA, 实=${fStart}`);
  assert.ok(fEnd>1.6 && fEnd<2.3, `过渡终点频率≈freqB, 实=${fEnd}`);
  let mono=true; for(let g=2.1; g<3.9; g+=0.1) if(instF(g+0.1) < instF(g)-1e-6) mono=false;
  assert.ok(mono, '过渡期瞬时频率应单调递增(chirp)');
  // 3) 无缝:整轨相位≈2π 的整数倍(回绕点精确对齐,循环无缝)
  const cycles=fxPhaseAt(SEQ, T-1e-6)/(2*Math.PI);
  assert.ok(Math.abs(cycles-Math.round(cycles))<0.02, `整轨应为整数圈, 实=${cycles}`);
});

test('sampleFrame:无 fx 的状态行为不变(回归)', () => {
  const A={hold:1, dur:2, color:'#fff', dots:[D(.2,.5)]};
  const B={hold:1, dur:2, color:'#fff', dots:[D(.8,.5)]};
  const SEQ=buildSequence([A,B], false, P0);
  const f=sampleFrame(SEQ,[A,B],0.5,0,P0);
  assert.ok(Math.abs(f.balls[0].x-0.2)<1e-9 && Math.abs(f.balls[0].r-0.02)<1e-9);
});
