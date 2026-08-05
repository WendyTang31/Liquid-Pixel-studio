// 实验物理层(labfx)纯函数断言:确定性、关闭即零、光敏安全(频率钳位)、
// 各效果的物理性质(无散度/体积守恒/地板钳位/两端渐生渐隐)、以及最关键的
// "停留↔过渡边界连续"—— 这是整个工具"预览==导出、时间轴可拖"的根基。
import test from 'node:test';
import assert from 'node:assert/strict';
import { LAB_FX, labDisp, labEmit, hasLabFx, dotsStat, DEF_STAT } from '../src/labfx.js';
import { EASE, hasFx, behaviorDisp, buildSequence, sampleFrame } from '../src/engine.js';

const P0 = { ease: 'linear', stag: 0, amp: 0, freq: .4, match: 'sortXY', flow: 0, stretch: 0 };
const D = (x, y) => ({ x, y, r: .02 });
const ST = dotsStat([D(.3, .3), D(.7, .7), D(.3, .7), D(.7, .3)]);

test('LAB_FX 表:键唯一、区间自洽、默认值落在区间内', () => {
  const seen = new Set();
  for (const s of LAB_FX) {
    assert.ok(!seen.has(s.key), `重复键 ${s.key}`); seen.add(s.key);
    assert.ok(s.min < s.max, `${s.key} 区间非法`);
    assert.ok(s.def >= s.min && s.def <= s.max, `${s.key} 默认值越界`);
    assert.ok(s.label && s.title && s.g, `${s.key} 缺文案`);
    // 幅度类默认必须为 0 —— 否则打开老工程会凭空多出效果(破坏向后兼容)
    if (!s.keep) assert.equal(s.def, 0, `${s.key} 幅度类默认值必须为 0`);
  }
});

test('关闭即零:无任何实验效果时零位移、单位半径(老工程行为不变)', () => {
  const z = labDisp(.3, .7, .5, .5, 1.234, {}, ST);
  assert.ok(Math.abs(z.dx) < 1e-12 && Math.abs(z.dy) < 1e-12 && Math.abs(z.rf - 1) < 1e-12);
  // 只设"参数"(风向/边数/粘滞/同步度)而不设幅度 → 仍视为未开启
  assert.equal(hasLabFx({ windDir: 90, crystalN: 5, viscosity: 1, coherence: 1 }), false);
  assert.equal(hasLabFx({ gravity: 0.3 }), true);
  assert.equal(hasLabFx({ bubble: 0.5 }), true);
});

test('确定性:同参两次求值完全一致(拖时间轴/导出可复现的前提)', () => {
  const fx = { gravity: .4, turbulence: .6, vortex: -.3, shatter: .5, tremor: .4, freq: .9 };
  assert.deepEqual(labDisp(.31, .62, .5, .5, 2.7, fx, ST), labDisp(.31, .62, .5, .5, 2.7, fx, ST));
  assert.deepEqual(labEmit({ bubble: .7, freq: .8 }, 1.9, ST, 1), labEmit({ bubble: .7, freq: .8 }, 1.9, ST, 1));
});

test('光敏安全:频率被硬性钳到 ≤2.5Hz(freq=99 与 freq=2.5 等价)', () => {
  const fx = f => ({ turbulence: 1, pulse: 1, tremor: 1, freq: f });
  const hi = labDisp(.3, .4, .5, .5, .37, fx(99), ST), cap = labDisp(.3, .4, .5, .5, .37, fx(2.5), ST);
  assert.ok(Math.abs(hi.dx - cap.dx) < 1e-12 && Math.abs(hi.dy - cap.dy) < 1e-12);
});

test('重力下垂:整体向下(dy>0);离中轴越远垂得越多', () => {
  const fx = { gravity: 1, freq: .6 };
  const near = labDisp(.5, .5, .5, .5, .4, fx, ST), far = labDisp(.95, .5, .5, .5, .4, fx, ST);
  assert.ok(near.dy > 0 && far.dy > 0, '应向下');
  assert.ok(far.dy > near.dy, '远端应垂得更多');
});

test('浮力/重力互为反向(同一轴的两端)', () => {
  const g = labDisp(.7, .5, .5, .5, .4, { gravity: 1, freq: .6 }, ST);
  const b = labDisp(.7, .5, .5, .5, .4, { buoyancy: 1, freq: .6 }, ST);
  assert.ok(g.dy > 0 && b.dy < 0);
});

test('湍流:势函数的 curl → 无散度(数值散度 ≈ 0,体积不被压缩)', () => {
  const fx = { turbulence: 1, freq: .6 }, h = 1e-4, t = .8;
  const at = (x, y) => labDisp(x, y, .5, .5, t, fx, ST);
  const div = (at(.5 + h, .5).dx - at(.5 - h, .5).dx) / (2 * h) + (at(.5, .5 + h).dy - at(.5, .5 - h).dy) / (2 * h);
  assert.ok(Math.abs(div) < 1e-6, `散度应≈0,实测 ${div}`);
});

test('漩涡:位移垂直于半径(纯切向,不把点吸进/推出涡心)', () => {
  const d = labDisp(.8, .5, .5, .5, .4, { vortex: 1, freq: .6 }, ST); // 正右方 → 应几乎纯 y
  assert.ok(Math.abs(d.dx) < 1e-9, '正右方点不应有径向(x)分量');
  assert.ok(Math.abs(d.dy) > 1e-6, '应有切向位移');
});

test('压力:沿径向、且符号随正负号翻转(充气 ⇄ 泄气)', () => {
  const inf = labDisp(.8, .5, .5, .5, .3, { pressure: 1, freq: .6 }, ST);
  const def = labDisp(.8, .5, .5, .5, .3, { pressure: -1, freq: .6 }, ST);
  assert.ok(Math.abs(inf.dy) < 1e-9, '正右方点位移应无 y 分量(纯径向)');
  assert.ok(Math.sign(inf.dx) === -Math.sign(def.dx) && Math.abs(inf.dx) > 1e-9);
});

test('结晶:边中点被压向内、顶点几乎不动 → 圆连续变成多边形', () => {
  const fx = { crystallize: 1, crystalN: 6, freq: .6 }, N = 6, seg = 2 * Math.PI / N;
  // 顶点方向 θ=0(半径最大,位移≈0);边中点方向 θ=seg/2(被压进去,位移向内)
  const corner = labDisp(.5 + .2, .5, .5, .5, .3, fx, ST);
  const mx = .5 + .2 * Math.cos(seg / 2), my = .5 + .2 * Math.sin(seg / 2);
  const mid = labDisp(mx, my, .5, .5, .3, fx, ST);
  const rIn = v => (v.dx * Math.cos(seg / 2) + v.dy * Math.sin(seg / 2)); // 沿该方向的径向分量
  assert.ok(Math.hypot(corner.dx, corner.dy) < 1e-6, '顶点方向应几乎不动');
  assert.ok(rIn(mid) < -1e-4, '边中点应被压向内');
});

test('同步度 coherence:0=逐点异相(有机),1=全体同相(机械)', () => {
  const a = { tremor: 1, freq: 2, coherence: 0 }, b = { tremor: 1, freq: 2, coherence: 1 };
  const p = [.21, .34], q = [.72, .61];
  const da = labDisp(...p, .5, .5, .5, a, ST), db = labDisp(...q, .5, .5, .5, a, ST);
  assert.ok(Math.abs(da.dx - db.dx) > 1e-6, 'coherence=0 时不同点应异相');
  const sa = labDisp(...p, .5, .5, .5, b, ST), sb = labDisp(...q, .5, .5, .5, b, ST);
  assert.ok(Math.abs(sa.dx - sb.dx) < 1e-12, 'coherence=1 时所有点应完全同相');
});

test('粘滞 viscosity:压低整体运动能量(动作变"稠")', () => {
  // 粘滞同时改幅度【和相位】,所以单点单时刻比大小没有意义(相位一挪,瞬时值可大可小)。
  // 要断言的是"能量变小",故对时间取 RMS。
  const rms = v => { let s = 0, n = 0;
    for (let t = 0; t < 12; t += 0.02) { const d = labDisp(.3, .4, .5, .5, t, { turbulence: 1, freq: .6, viscosity: v }, ST);
      s += d.dx * d.dx + d.dy * d.dy; n++; }
    return Math.sqrt(s / n); };
  assert.ok(rms(1) < rms(0) * 0.6, '满粘滞的运动能量应明显低于零粘滞');
});

test('流沙:落不穿地板(dy 不超过到地板的距离)', () => {
  const fx = { sand: 1, freq: 2.5 }, floor = ST.y1 + 0.02;
  for (let t = 0; t < 6; t += 0.037) {
    const d = labDisp(.4, .35, .5, .5, t, fx, ST);
    assert.ok(.35 + d.dy <= floor + 1e-9, `t=${t} 穿透地板`);
  }
});

test('蒸发/流沙:半径因子恒在 [0,1](不出现负半径)', () => {
  for (const fx of [{ evaporate: 1, freq: 2 }, { sand: 1, freq: 2 }]) {
    for (let t = 0; t < 4; t += 0.021) {
      const d = labDisp(.42, .38, .5, .5, t, fx, ST);
      assert.ok(d.rf >= -1e-12 && d.rf <= 1 + 1e-12, `rf=${d.rf} 越界`);
    }
  }
});

test('发射器:气泡半径两端为 0(自然生灭,不会凭空出现/消失)', () => {
  const fx = { bubble: 1, freq: 1.2 };
  let seen = 0, maxR = 0;
  for (let t = 0; t < 8; t += 0.01) {
    for (const b of labEmit(fx, t, ST, 1)) {
      assert.ok(b.r > 0, '不应产出零/负半径的球');
      maxR = Math.max(maxR, b.r); seen++;
      assert.ok(b.y >= ST.y0 - 1e-9 && b.y <= ST.y1 + 1e-9, '气泡应在形体内上浮');
    }
  }
  assert.ok(seen > 100, '应持续产出气泡');
  assert.ok(maxR > 0.01 && maxR < 0.05, `气泡半径量级应合理,实测 ${maxR}`);
});

test('发射器:fade=0 不产出任何球(过渡端点精确归零 → 与停留段严丝合缝)', () => {
  assert.equal(labEmit({ bubble: 1, boil: 1, drip: 1, freq: 1 }, 3.3, ST, 0).length, 0);
});

test('dotsStat:质心/包围盒正确;空点集回退到默认(不崩)', () => {
  const s = dotsStat([D(.2, .4), D(.6, .8)]);
  assert.ok(Math.abs(s.cx - .4) < 1e-9 && Math.abs(s.cy - .6) < 1e-9);
  assert.equal(s.x0, .2); assert.equal(s.x1, .6); assert.equal(s.y0, .4); assert.equal(s.y1, .8);
  assert.deepEqual(dotsStat([]), DEF_STAT);
});

test('新缓动:端点精确 0/1;hesitate 单调不减;spring 有过冲但有界', () => {
  for (const n of ['spring', 'anticipate', 'hesitate']) {
    assert.ok(Math.abs(EASE[n](0)) < 1e-9, `${n}(0)≠0`);
    assert.ok(Math.abs(EASE[n](1) - 1) < 1e-9, `${n}(1)≠1`);
  }
  let prev = -Infinity;
  for (let t = 0; t <= 1.0001; t += 0.01) { const v = EASE.hesitate(t);
    assert.ok(v >= prev - 1e-9, `hesitate 在 t=${t.toFixed(2)} 回退`); prev = v; }
  let mx = -Infinity, mn = Infinity;
  for (let t = 0; t <= 1; t += 0.005) { mx = Math.max(mx, EASE.spring(t)); mn = Math.min(mn, EASE.anticipate(t)); }
  assert.ok(mx > 1.05 && mx < 1.4, `spring 过冲应存在且有界,实测 ${mx}`);
  assert.ok(mn < -0.02 && mn > -0.3, `anticipate 应先反向蓄力且有界,实测 ${mn}`);
});

test('hasFx:实验效果也算"开启"(engine 才会去求值)', () => {
  assert.equal(hasFx({ gravity: .5 }), true);
  assert.equal(hasFx({ bubble: .5 }), true);
  assert.equal(hasFx({ crystalN: 8 }), false);
});

test('behaviorDisp:不传 st 时退化为默认统计量(老调用方签名不变)', () => {
  const fx = { gravity: .5, freq: .6 };
  assert.deepEqual(behaviorDisp(.3, .4, .5, .5, 1.1, fx), behaviorDisp(.3, .4, .5, .5, 1.1, fx, DEF_STAT));
  // 既有效果在加了实验层之后行为完全不变(回归)
  const legacy = { slosh: .8, freq: .6 };
  const d = behaviorDisp(.3, .4, .5, .5, 1.1, legacy);
  assert.ok(Math.abs(d.dx) > 1e-5 && Math.abs(d.rf - 1) < 1e-12);
});

test('sampleFrame:实验效果在停留期生效,且停留↔过渡边界连续(无跳变)', () => {
  const A = { hold: 2, dur: 2, color: '#fff', fx: { gravity: .7, turbulence: .5, bubble: .6, freq: .6 },
              dots: [D(.3, .3), D(.6, .7)] };
  const B = { hold: 1, dur: 2, color: '#fff', dots: [D(.7, .4), D(.2, .6)] };
  const states = [A, B], SEQ = buildSequence(states, false, P0);
  const held = sampleFrame(SEQ, states, 1.0, 0.5, P0);
  assert.ok(held.balls.length > A.dots.length, '气泡应追加额外的球');
  assert.ok(held.balls.slice(0, 2).some((b, i) => Math.abs(b.y - A.dots[i].y) > 1e-4), '应产生位移');
  // 边界:holdA 结束 → 过渡开始,同一墙钟,前 N 个(头部)球的位移应连续
  const eps = 1e-4, time = 3.3;
  const before = sampleFrame(SEQ, states, 2 - eps, time, P0), after = sampleFrame(SEQ, states, 2 + eps, time, P0);
  for (let i = 0; i < A.dots.length; i++) {
    const d = Math.hypot(before.balls[i].x - after.balls[i].x, before.balls[i].y - after.balls[i].y);
    assert.ok(d < 2e-3, `边界点${i}位移跳变=${d}`);
  }
});

test('sampleFrame:过渡两端的发射器按 e 交叉淡化(端点处只剩出发状态的球)', () => {
  const A = { hold: 0, dur: 2, color: '#fff', fx: { bubble: 1, freq: 1 }, dots: [D(.3, .3), D(.6, .7)] };
  const B = { hold: 0, dur: 2, color: '#fff', dots: [D(.7, .4), D(.2, .6)] };
  const states = [A, B], SEQ = buildSequence(states, false, P0);
  const start = sampleFrame(SEQ, states, 1e-6, 2.2, P0);   // lt≈0 → A 满、B 零
  const mid = sampleFrame(SEQ, states, 1.0, 2.2, P0);
  const extraStart = start.balls.length - A.dots.length, extraMid = mid.balls.length - A.dots.length;
  assert.ok(extraStart > 0, '起点应有 A 的气泡');
  assert.ok(extraMid <= extraStart, '中段 A 的气泡应已淡化(半径→0 被丢弃)');
});
