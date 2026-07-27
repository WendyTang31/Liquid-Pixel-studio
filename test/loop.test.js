// 状态内子循环(姿态分组 + 递归采样)纯函数断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupStates, buildSequence, sampleFrame } from '../src/engine.js';

const P0={ ease:'linear', stag:0, amp:0, freq:.4, match:'sortXY', flow:0, stretch:0 };
const D=(x,y)=>({x,y,r:.02});

test('groupStates:姿态归前面最近的主状态;开头孤儿姿态自立为主', () => {
  const sts=[{},{isPose:true},{isPose:true},{},{isPose:true}];
  const g=groupStates(sts);
  assert.equal(g.length,2);
  assert.deepEqual(g[0],{idx:0,poses:[1,2]});
  assert.deepEqual(g[1],{idx:3,poses:[4]});
  const orphan=groupStates([{isPose:true},{}]);
  assert.equal(orphan.length,2, '孤儿姿态应自立为主状态,不被吞掉');
});

test('buildSequence:姿态不进主序列;主状态停留段挂 loop 子序列,时长=基计时+姿态计时', () => {
  const A={hold:4, dur:2, color:'#fff', loop:{h0:1, d0:0.3}, dots:[D(.2,.5)]};
  const pose={hold:0.2, dur:0.5, color:'#fff', isPose:true, dots:[D(.2,.8)]};
  const B={hold:1, dur:2, color:'#fff', dots:[D(.8,.5)]};
  const SEQ=buildSequence([A,pose,B], false, P0);
  // 主序列:[holdA(4), trans A→B(2), holdB(1)] —— 姿态不占段
  assert.equal(SEQ.segs.length,3);
  assert.equal(SEQ.T,7);
  const holdA=SEQ.segs[0];
  assert.ok(holdA.loop, '有姿态的主状态停留段应挂 loop');
  // 子序列(无缝):holdA0(1) + d0(0.3) + holdPose(0.2) + 回程(0.5) = 2.0
  assert.ok(Math.abs(holdA.loop.SEQ.T-2.0)<1e-9, `子循环周期应为 2.0,实际 ${holdA.loop.SEQ.T}`);
  // 过渡照旧用主状态的基 dots 配对
  const tr=SEQ.segs[1];
  assert.equal(tr.type,'trans');
  assert.ok(Math.abs(tr.pairs[0].a.x-0.2)<1e-9 && Math.abs(tr.pairs[0].b.x-0.8)<1e-9);
});

test('子循环采样:停留头尾精确落在基姿态(与过渡零跳变);中段到达姿态位置', () => {
  const A={hold:4, dur:2, color:'#fff', loop:{h0:1, d0:0.5}, dots:[D(.2,.2)]};
  const pose={hold:1, dur:0.5, color:'#fff', isPose:true, dots:[D(.2,.8)]};
  const B={hold:1, dur:2, color:'#fff', dots:[D(.8,.2)]};
  const states=[A,pose,B];
  const SEQ=buildSequence(states, false, P0);
  // 子循环周期 = 1+0.5+1+0.5 = 3;主停留 4s → cycles=round(4/3)=1
  const f0=sampleFrame(SEQ,states,1e-6,0,P0);
  assert.ok(Math.abs(f0.balls[0].y-0.2)<1e-6, `停留开始应在基姿态,y=${f0.balls[0].y}`);
  const fEnd=sampleFrame(SEQ,states,4-1e-5,0,P0);
  assert.ok(Math.abs(fEnd.balls[0].y-0.2)<1e-3, `停留结束应回基姿态,y=${fEnd.balls[0].y}`);
  // τ 映射:lt=0.5 → τ=0.5*1*3=1.5 → 落在 d0 之后的姿态停留段(1.5..2.5)→ 应在姿态位置
  const fMid=sampleFrame(SEQ,states,2,0,P0);
  assert.ok(Math.abs(fMid.balls[0].y-0.8)<1e-6, `停留中段应到达姿态,y=${fMid.balls[0].y}`);
  // 与后续过渡的边界连续
  const before=sampleFrame(SEQ,states,4-1e-4,0,P0), after=sampleFrame(SEQ,states,4+1e-4,0,P0);
  const d=Math.hypot(before.balls[0].x-after.balls[0].x, before.balls[0].y-after.balls[0].y);
  assert.ok(d<2e-3, `停留(循环)→过渡边界跳变 ${d}`);
});

test('子循环整数圈:长停留自动多圈(cycles=round(hold/LT)),圈间连续', () => {
  const A={hold:6, dur:1, color:'#fff', loop:{h0:0.5, d0:0.5}, dots:[D(.3,.3)]};
  const pose={hold:0.5, dur:0.5, color:'#fff', isPose:true, dots:[D(.7,.7)]};
  const B={hold:1, dur:1, color:'#fff', dots:[D(.9,.1)]};
  const states=[A,pose,B];
  const SEQ=buildSequence(states, false, P0);
  // LT=2,hold=6 → 3 圈;每圈中点(姿态停留中心)应在姿态位置
  for(const k of [0,1,2]){
    const g=(k+0.625)*2; // 每圈 τ=1.25 → 姿态停留中心(0.5+0.5+0.25)
    const f=sampleFrame(SEQ,states,g,0,P0);
    assert.ok(Math.abs(f.balls[0].x-0.7)<1e-6, `第${k+1}圈应到达姿态,x=${f.balls[0].x}`);
  }
  // 圈与圈的交界(τ 回绕处)连续
  const b=sampleFrame(SEQ,states,2-1e-4,0,P0), a=sampleFrame(SEQ,states,2+1e-4,0,P0);
  const d=Math.hypot(b.balls[0].x-a.balls[0].x, b.balls[0].y-a.balls[0].y);
  assert.ok(d<2e-3, `圈间交界跳变 ${d}`);
});

test('子循环 + 镜头:主状态 cam 作用于子循环采样结果之上', () => {
  const A={hold:2, dur:1, color:'#fff', cam:{x:.5,y:.5,z:2,rot:0},
    loop:{h0:0.5, d0:0.25}, dots:[D(.25,.5)]};
  const pose={hold:0.5, dur:0.25, color:'#fff', isPose:true, dots:[D(.25,.5)]};
  const B={hold:1, dur:1, color:'#fff', dots:[D(.75,.5)]};
  const states=[A,pose,B];
  const SEQ=buildSequence(states, false, P0);
  const f=sampleFrame(SEQ,states,1e-6,0,P0);
  assert.ok(Math.abs(f.balls[0].x-0)<1e-6, `z=2 应把 (.25,.5) 推到 x=0,实际 ${f.balls[0].x}`);
  assert.ok(Math.abs(f.balls[0].r-.04)<1e-12, '半径应随镜头加倍');
});

test('无姿态的主状态行为与从前完全一致(回归)', () => {
  const A={hold:1, dur:2, color:'#fff', dots:[D(.2,.5)]};
  const B={hold:1, dur:2, color:'#fff', dots:[D(.8,.5)]};
  const SEQ=buildSequence([A,B], false, P0);
  assert.equal(SEQ.segs.length,3);
  assert.ok(!SEQ.segs[0].loop);
  const f=sampleFrame(SEQ,[A,B],0.5,0,P0);
  assert.ok(Math.abs(f.balls[0].x-0.2)<1e-9);
});
