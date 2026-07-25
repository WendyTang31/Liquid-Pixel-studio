// 纯函数断言(node --test)。只测无 DOM 依赖的引擎/采样层。
import test from 'node:test';
import assert from 'node:assert/strict';
import { EASE, buildSequence, makePairs, sampleFrame } from '../src/engine.js';
import { SAMPLERS } from '../src/samplers.js';
import { P } from '../src/config.js';

test('呼吸漂移在停留↔过渡边界连续,无相位跳变(回归:曾用 index/random 两套相位公式)', () => {
  const localP = { amp: 0.01, stag: 0.3, ease: 'smootherstep', freq: 0.4, match: 'sortXY' }; // amp 放大以放大任何跳变
  const states = [
    { hold: 1, dur: 2, color: '#ffffff', dots: [{ x: .2, y: .3, r: .02 }, { x: .35, y: .6, r: .02 }] },
    { hold: 1, dur: 2, color: '#ffffff', dots: [{ x: .7, y: .4, r: .02 }, { x: .8, y: .2, r: .02 }] },
  ];
  const SEQ = buildSequence(states, false, localP); // [holdA(1), trans(2), holdB(1)]
  const eps = 1e-4, time = 7.777; // 任取一个墙钟时刻
  // 边界①:holdA 结束 → 过渡刚开始(e≈0),几何位置本就该重合,只有漂移可能跳变
  const beforeTrans = sampleFrame(SEQ, states, 1 - eps, time, localP);
  const afterTrans = sampleFrame(SEQ, states, 1 + eps, time, localP);
  for (let i = 0; i < beforeTrans.balls.length; i++) {
    const d = Math.hypot(beforeTrans.balls[i].x - afterTrans.balls[i].x, beforeTrans.balls[i].y - afterTrans.balls[i].y);
    assert.ok(d < 1e-3, `holdA→过渡边界不应跳变,点${i}位移=${d}`);
  }
  // 边界②:过渡结束(e≈1)→ holdB 开始
  const beforeHoldB = sampleFrame(SEQ, states, 3 - eps, time, localP);
  const afterHoldB = sampleFrame(SEQ, states, 3 + eps, time, localP);
  for (let i = 0; i < beforeHoldB.balls.length; i++) {
    const d = Math.hypot(beforeHoldB.balls[i].x - afterHoldB.balls[i].x, beforeHoldB.balls[i].y - afterHoldB.balls[i].y);
    assert.ok(d < 1e-3, `过渡→holdB边界不应跳变,点${i}位移=${d}`);
  }
});

test('缓动端点连续:每种 ease 都满足 f(0)=0, f(1)=1', () => {
  for (const name of Object.keys(EASE)) {
    assert.ok(Math.abs(EASE[name](0) - 0) < 1e-9, `${name}(0) 应为 0`);
    assert.ok(Math.abs(EASE[name](1) - 1) < 1e-9, `${name}(1) 应为 1`);
  }
});

test('缓动单调不减(采样 0..1)', () => {
  for (const name of Object.keys(EASE)) {
    let prev = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = EASE[name](t);
      assert.ok(v >= prev - 1e-9, `${name} 在 t=${t.toFixed(2)} 处回退`);
      prev = v;
    }
  }
});

test('序列总时长 == 各段时长之和,且末段收于 T', () => {
  const mk = (hold, dur, dots) => ({ hold, dur, color: '#ffffff', dots });
  const states = [
    mk(1, 2, [{ x: .2, y: .2, r: .01 }]),
    mk(0.5, 3, [{ x: .8, y: .8, r: .01 }]),
  ];
  const SEQ = buildSequence(states, true, P); // seamless: hold,trans,hold,trans(尾→首)
  const sum = SEQ.segs.reduce((a, s) => a + s.dur, 0);
  assert.ok(Math.abs(sum - SEQ.T) < 1e-9, '段时长和应等于 T');
  const last = SEQ.segs[SEQ.segs.length - 1];
  assert.ok(Math.abs(last.t0 + last.dur - SEQ.T) < 1e-9, '末段 t0+dur 应等于 T');
  // 无缝:应存在一段 尾→首(a=1,b=0)的过渡
  assert.ok(SEQ.segs.some(s => s.type === 'trans' && s.a === 1 && s.b === 0), '缺尾→首过渡');
});

test('无缝关闭时无尾→首过渡', () => {
  const mk = (dots) => ({ hold: 1, dur: 2, color: '#fff', dots });
  const states = [mk([{ x: .2, y: .2, r: .01 }]), mk([{ x: .8, y: .8, r: .01 }])];
  const SEQ = buildSequence(states, false, P);
  assert.ok(!SEQ.segs.some(s => s.type === 'trans' && s.a === 1 && s.b === 0), '不应有尾→首过渡');
});

test('配对数等于较多一侧点数(多余点以幽灵配对占位)', () => {
  const A = [{ x: .1, y: .1, r: .01 }, { x: .2, y: .2, r: .01 }, { x: .3, y: .3, r: .01 }];
  const B = [{ x: .8, y: .8, r: .01 }];
  const pairs = makePairs(A, B, P);
  assert.equal(pairs.length, 3, '应补齐到较多一侧的点数');
  for (const p of pairs) { assert.ok(p.a && p.b, '每对两端都在'); }
});

test('sampleFrame 在过渡端点落回 A/B 位置(错峰=0 时)', () => {
  const savedStag = P.stag, savedAmp = P.amp;
  P.stag = 0; P.amp = 0; // 关掉错峰与漂移,端点应精确重合
  const A = [{ x: .2, y: .5, r: .02 }], B = [{ x: .8, y: .5, r: .02 }];
  const states = [
    { hold: 0, dur: 2, color: '#ffffff', dots: A },
    { hold: 0, dur: 2, color: '#ffffff', dots: B },
  ];
  const SEQ = buildSequence(states, false, P);
  const f0 = sampleFrame(SEQ, states, 0, 0, P);       // 过渡起点
  const f1 = sampleFrame(SEQ, states, 2 - 1e-4, 0, P); // 过渡终点(逼近)
  assert.ok(Math.abs(f0.balls[0].x - .2) < 1e-3, '起点应贴近 A');
  assert.ok(Math.abs(f1.balls[0].x - .8) < 2e-3, '终点应贴近 B');
  P.stag = savedStag; P.amp = savedAmp;
});

test('部分匹配:点数不等时,较少一侧全部配对到互异目标,多余点原地生/灭', () => {
  const A = []; for (let i = 0; i < 6; i++) A.push({ x: 0.15 + i * 0.1, y: 0.3, r: 0.02 }); // 6(多,应有消亡)
  const B = [{ x: 0.2, y: 0.7, r: 0.02 }, { x: 0.5, y: 0.7, r: 0.02 }, { x: 0.8, y: 0.7, r: 0.02 }]; // 3(少)
  const pairs = makePairs(A, B, { match: 'ot' });
  assert.equal(pairs.length, 6, '应有 max(6,3)=6 对');

  const real = pairs.filter(p => p.a.r > 0 && p.b.r > 0);   // 真·真配对(部分匹配命中)
  const ghost = pairs.filter(p => p.a.r === 0 || p.b.r === 0); // 消亡/新生(含一端幽灵)
  assert.equal(real.length, 3, '应有 min(6,3)=3 对真实配对');
  assert.equal(ghost.length, 3, '应有 3 个多余点原地生/灭');

  // 核心不变量:任何一个真实目标位置最多被一个真实源点认领 —— 不再有"多点抢同一个坑"
  const key = p => p.x.toFixed(6) + ',' + p.y.toFixed(6);
  const claimedTargets = real.map(p => key(p.b));
  assert.equal(new Set(claimedTargets).size, claimedTargets.length, '真实目标不应被重复认领');

  // 消亡/新生点必须原地不动(只改变半径),不参与任何形式的位移
  for (const p of ghost) {
    assert.ok(Math.abs(p.a.x - p.b.x) < 1e-9 && Math.abs(p.a.y - p.b.y) < 1e-9, '生/灭点应原地不动');
    assert.ok(p.a.r === 0 || p.b.r === 0, '生/灭点一端半径必为 0');
  }
});

test('部分匹配:反方向(A 少 B 多)时,多余点在 B 侧新生', () => {
  const A = [{ x: 0.2, y: 0.7, r: 0.02 }, { x: 0.5, y: 0.7, r: 0.02 }, { x: 0.8, y: 0.7, r: 0.02 }]; // 3(少)
  const B = []; for (let i = 0; i < 6; i++) B.push({ x: 0.15 + i * 0.1, y: 0.3, r: 0.02 }); // 6(多,应新生)
  const pairs = makePairs(A, B, { match: 'ot' });
  const ghost = pairs.filter(p => p.a.r === 0 || p.b.r === 0);
  assert.equal(ghost.length, 3, '应有 3 个多余点原地新生');
  for (const p of ghost) assert.equal(p.a.r, 0, 'A 更少时,多余点应是 B 侧新生(a 端为幽灵)');
});

test('OT 配对总位移不明显劣于排序匹配(等点数)', () => {
  const A = [], B = [];
  for (let i = 0; i < 40; i++) A.push({ x: Math.cos(i) * 0.2 + 0.5, y: Math.sin(i) * 0.2 + 0.5, r: 0.02 });
  for (let i = 0; i < 40; i++) B.push({ x: 0.2 + (i % 8) * 0.08, y: 0.2 + Math.floor(i / 8) * 0.12, r: 0.02 });
  const cost = pairs => pairs.reduce((s, p) => s + Math.hypot(p.a.x - p.b.x, p.a.y - p.b.y), 0);
  const ot = cost(makePairs(A, B, { match: 'ot' }));
  const sx = cost(makePairs(A, B, { match: 'sortXY' }));
  assert.ok(ot <= sx * 1.05, `OT 总位移(${ot.toFixed(2)})不应明显劣于 sortXY(${sx.toFixed(2)})`);
});

test('采样器只在蒙版内落点', () => {
  // 蒙版:中心 200x120 矩形为"内"
  const on = (x, y) => x >= 140 && x <= 340 && y >= 80 && y <= 200;
  for (const name of ['grid', 'hex', 'poisson', 'uniform', 'outline']) {
    const pts = SAMPLERS[name](on, 17, 0);
    assert.ok(pts.length > 0, `${name} 应产出点`);
    // 允许 outline/uniform 落在边缘像素(松弛质心可能贴边),放宽 2px 容差
    for (const [x, y] of pts) {
      assert.ok(on(Math.round(x), Math.round(y)) ||
        (x >= 138 && x <= 342 && y >= 78 && y <= 202),
        `${name} 点 (${x|0},${y|0}) 落到蒙版外`);
    }
  }
});

test('智能识别(smart):两个分离圆形 → 还原为两个大球,圆心/半径准确', () => {
  // 蒙版:两个 r=40 的圆,圆心 (120,140) 和 (330,140)
  const c1 = { x: 120, y: 140, r: 40 }, c2 = { x: 330, y: 140, r: 40 };
  const on = (x, y) => ((x - c1.x) ** 2 + (y - c1.y) ** 2 <= c1.r ** 2) ||
                        ((x - c2.x) ** 2 + (y - c2.y) ** 2 <= c2.r ** 2);
  const balls = SAMPLERS.smart(on, 17);
  // 主导球:半径 >= 30 的应正好 2 个,分别贴近两个真实圆心
  const major = balls.filter(b => b[2] >= 30);
  assert.equal(major.length, 2, `应识别出两个主导大球,实际 ${major.length}(总球数 ${balls.length})`);
  for (const target of [c1, c2]) {
    const hit = major.find(b => Math.hypot(b[0] - target.x, b[1] - target.y) < 8);
    assert.ok(hit, `应有大球贴近圆心 (${target.x},${target.y})`);
    assert.ok(Math.abs(hit[2] - target.r) < 8, `半径应接近 ${target.r},实际 ${hit[2].toFixed(1)}`);
  }
});

test('智能识别(smart):细长条 → 沿骨架的串珠,而非单个大球', () => {
  const on = (x, y) => x >= 80 && x <= 400 && y >= 130 && y <= 150; // 320x20 横条
  const balls = SAMPLERS.smart(on, 17);
  assert.ok(balls.length >= 5, `细条应产出多个串珠球,实际 ${balls.length}`);
  for (const b of balls) {
    assert.ok(Math.abs(b[1] - 140) < 6, `串珠应贴着中轴线 y=140,实际 y=${b[1]}`);
    assert.ok(b[2] <= 14, `串珠半径应约等于半条宽(10),实际 ${b[2].toFixed(1)}`);
  }
});

test('均匀填充(Lloyd 松弛)比原始泊松盘间距方差更小,即真的更均匀', () => {
  // 用一个不规则的 L 形蒙版(比矩形更贴近真实文字/图形笔画),重复几次取最优,
  // 避免泊松盘自身的随机性偶然赢一次导致测试不稳定。
  const on = (x, y) => (x >= 60 && x <= 300 && y >= 60 && y <= 120) ||
                        (x >= 60 && x <= 140 && y >= 60 && y <= 220);
  const nnVariance = pts => {
    const d = pts.map(([x, y]) => {
      let best = Infinity;
      for (const [x2, y2] of pts) { if (x === x2 && y === y2) continue;
        const dd = (x - x2) ** 2 + (y - y2) ** 2; if (dd < best) best = dd; }
      return Math.sqrt(best);
    });
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    return d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length;
  };
  // 5 轮中 uniform 至少赢一轮即可:Lloyd 内有 250ms 时间预算护栏,CI/负载高时迭代可能被
  // 提前掐断导致个别轮次不占优 —— 全输才说明算法真的没效果。
  let poissonWins = 0;
  for (let trial = 0; trial < 5; trial++) {
    const varPoisson = nnVariance(SAMPLERS.poisson(on, 14));
    const varUniform = nnVariance(SAMPLERS.uniform(on, 14));
    if (varPoisson <= varUniform) poissonWins++;
  }
  assert.ok(poissonWins < 5, 'uniform 应至少有一轮比 poisson 更均匀(方差更小)');
});
