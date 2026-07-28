// 实心显示(solid)权重窗口断言:停留恒 1,过渡头尾平滑升降,中段纯点。
import test from 'node:test';
import assert from 'node:assert/strict';
import { solidWeights, camPtInv, camPt } from '../src/engine.js';

test('solidWeights:实心停留恒 1;非实心为空', () => {
  const sts=[{solid:true},{solid:false}];
  assert.deepEqual(solidWeights({type:'hold',si:0},sts,0), [{si:0,w:1}]);
  assert.deepEqual(solidWeights({type:'hold',si:1},sts,0), []);
});

test('solidWeights:过渡窗口 —— 起点满、35% 后归零;终点满、65% 前为零;中段无实心', () => {
  const sts=[{solid:true},{solid:true}];
  const seg={type:'trans',a:0,b:1};
  const at=lt=>solidWeights(seg,sts,lt);
  assert.ok(Math.abs(at(0)[0].w-1)<1e-9, '起点 A 满权重');
  assert.equal(at(0.5).length, 0, '中段纯点阵');
  const end=at(1);
  assert.ok(end.length===1&&end[0].si===1&&Math.abs(end[0].w-1)<1e-9, '终点 B 满权重');
  const w1=at(0.1)[0].w, w2=at(0.25)[0].w;
  assert.ok(w1>w2&&w2>0, 'A 侧应平滑衰减');
});

test('camPtInv 是 camPt 的逆(含旋转与变焦)', () => {
  const cam={x:.6,y:.4,z:1.7,rot:0.5};
  const [sx,sy]=camPt(0.31,0.72,cam);
  const [bx,by]=camPtInv(sx,sy,cam);
  assert.ok(Math.abs(bx-0.31)<1e-9&&Math.abs(by-0.72)<1e-9);
});
