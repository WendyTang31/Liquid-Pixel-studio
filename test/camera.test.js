// 虚拟摄像机(推拉摇移)纯函数断言:变换正确性、插值端点、与 sampleFrame 的集成。
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCam, camPt, camIdentity, lerpCam, camAt, buildSequence, sampleFrame, EASE } from '../src/engine.js';
import { W, H } from '../src/config.js';

test('镜头恒等:cam 为空/默认值时 applyCam 原样返回(零开销快路径)', () => {
  const balls = [{ x: .2, y: .3, r: .02, c: [255, 0, 0] }];
  assert.equal(applyCam(balls, null), balls, 'null 镜头应返回同一数组引用');
  assert.equal(applyCam(balls, { x: .5, y: .5, z: 1, rot: 0 }), balls, '默认镜头应返回同一数组引用');
  assert.ok(camIdentity(null) && camIdentity({ x: .5, y: .5, z: 1, rot: 0 }));
  assert.ok(!camIdentity({ x: .5, y: .5, z: 2, rot: 0 }));
});

test('变焦:z=2 时点到取景中心的距离与半径均加倍,颜色保留', () => {
  const balls = [{ x: .25, y: .5, r: .02, c: [0, 255, 0] }];
  const out = applyCam(balls, { x: .5, y: .5, z: 2, rot: 0 });
  assert.ok(Math.abs(out[0].x - 0.0) < 1e-9, `(.25,.5) 应映射到 x=0,实际 ${out[0].x}`);
  assert.ok(Math.abs(out[0].y - 0.5) < 1e-9);
  assert.ok(Math.abs(out[0].r - 0.04) < 1e-12, '半径应随变焦加倍');
  assert.deepEqual(out[0].c, [0, 255, 0], '逐点颜色应保留');
});

test('平移:取景中心右移 0.1,画面内容应左移 0.1(相机语义)', () => {
  const out = applyCam([{ x: .5, y: .5, r: .02 }], { x: .6, y: .5, z: 1, rot: 0 });
  assert.ok(Math.abs(out[0].x - 0.4) < 1e-9, `实际 ${out[0].x}`);
});

test('旋转在像素坐标系进行:90° 时像素位移守恒(W≠H 不产生剪切变形)', () => {
  // 中心右侧 48px 的点,旋转 90° 后应在中心下方 48px(像素距离不变)
  const px = 48;
  const [x, y] = camPt(0.5 + px / W, 0.5, { x: .5, y: .5, z: 1, rot: Math.PI / 2 });
  assert.ok(Math.abs(x - 0.5) < 1e-9, `旋转后应回到中线,实际 x=${x}`);
  assert.ok(Math.abs((y - 0.5) * H - px) < 1e-6, `像素距离应守恒 48px,实际 ${((y - 0.5) * H).toFixed(2)}`);
});

test('镜头插值:端点精确复原;变焦按对数插值(中点=几何平均)', () => {
  const a = { x: .3, y: .4, z: 1, rot: 0 }, b = { x: .7, y: .6, z: 4, rot: Math.PI / 4 };
  const at0 = lerpCam(a, b, 0), at1 = lerpCam(a, b, 1), mid = lerpCam(a, b, 0.5);
  assert.ok(Math.abs(at0.x - .3) < 1e-12 && Math.abs(at0.z - 1) < 1e-12);
  assert.ok(Math.abs(at1.x - .7) < 1e-12 && Math.abs(at1.z - 4) < 1e-12);
  assert.ok(Math.abs(mid.z - 2) < 1e-12, `对数插值中点应为 √(1·4)=2,实际 ${mid.z}`);
  assert.ok(Math.abs(mid.rot - Math.PI / 8) < 1e-12);
  // 一端缺省 = 默认镜头
  const fromNull = lerpCam(null, b, 0);
  assert.ok(Math.abs(fromNull.x - .5) < 1e-12 && Math.abs(fromNull.z - 1) < 1e-12);
});

test('sampleFrame 集成:停留段施加本状态镜头;过渡段镜头恒用 smootherstep 且边界连续', () => {
  const P0 = { ease: 'linear', stag: 0, amp: 0, freq: .4, match: 'sortXY', flow: 0, stretch: 0 };
  const states = [
    { hold: 1, dur: 2, color: '#fff', cam: null, dots: [{ x: .25, y: .5, r: .02 }] },
    { hold: 1, dur: 2, color: '#fff', cam: { x: .5, y: .5, z: 2, rot: 0 }, dots: [{ x: .25, y: .5, r: .02 }] },
  ];
  const SEQ = buildSequence(states, false, P0);
  // 停留 A(无镜头):点在原位
  const fA = sampleFrame(SEQ, states, 0.5, 0, P0);
  assert.ok(Math.abs(fA.balls[0].x - .25) < 1e-9 && fA.cam === null);
  // 停留 B(z=2):点被推近到 x=0,半径加倍
  const fB = sampleFrame(SEQ, states, 3.5, 0, P0);
  assert.ok(Math.abs(fB.balls[0].x - 0) < 1e-9, `实际 ${fB.balls[0].x}`);
  assert.ok(Math.abs(fB.balls[0].r - .04) < 1e-12);
  // 过渡中点:镜头 z = √2(对数插值 + smootherstep(0.5)=0.5),而非跟随点缓动
  const fMid = sampleFrame(SEQ, states, 2, 0, P0);
  assert.ok(Math.abs(fMid.cam.z - Math.SQRT2) < 1e-9, `实际 ${fMid.cam?.z}`);
  // 边界连续:过渡→停留 B 无跳变
  const eps = 1e-4;
  const before = sampleFrame(SEQ, states, 3 - eps, 0, P0), after = sampleFrame(SEQ, states, 3 + eps, 0, P0);
  const d = Math.hypot(before.balls[0].x - after.balls[0].x, before.balls[0].y - after.balls[0].y);
  assert.ok(d < 1e-3, `过渡→停留边界跳变 ${d}`);
});

test('camAt:停留段直接取状态镜头;过渡段 lt=0/1 时精确等于两端镜头', () => {
  const camB = { x: .6, y: .4, z: 1.5, rot: 0.3 };
  const states = [{ cam: null }, { cam: camB }];
  assert.equal(camAt({ type: 'hold', si: 1 }, states, 0), camB);
  const seg = { type: 'trans', a: 0, b: 1 };
  const c0 = camAt(seg, states, 0), c1 = camAt(seg, states, 1);
  assert.ok(Math.abs(c0.z - 1) < 1e-12 && Math.abs(c0.x - .5) < 1e-12, 'lt=0 应为默认镜头');
  assert.ok(Math.abs(c1.z - 1.5) < 1e-12 && Math.abs(c1.rot - 0.3) < 1e-12, 'lt=1 应为目标镜头');
  assert.ok(Math.abs(EASE.smootherstep(0.5) - 0.5) < 1e-12); // 中点对称性前提
});
