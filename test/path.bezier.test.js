// 贝塞尔路径构建断言:用一个记录调用的假 ctx 验证 fillBezierPath 的段控制点选取,
// 以及 traceShapePath 的分派(bezier → 贝塞尔;老路径 → 平滑)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fillBezierPath, traceShapePath } from '../src/path.js';

function fakeCtx(){
  const calls=[];
  return { calls,
    beginPath(){calls.push(['begin']);}, closePath(){calls.push(['close']);},
    moveTo(x,y){calls.push(['move',x,y]);},
    lineTo(x,y){calls.push(['line',x,y]);},
    bezierCurveTo(a,b,c,d,e,f){calls.push(['bez',a,b,c,d,e,f]);},
    quadraticCurveTo(a,b,c,d){calls.push(['quad',a,b,c,d]);} };
}

test('fillBezierPath:尖角锚点(无柄)段控制点落在端点上(=直线)', () => {
  const c=fakeCtx();
  const pts=[{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  assert.equal(fillBezierPath(c,pts), true);
  const bez=c.calls.filter(k=>k[0]==='bez');
  assert.equal(bez.length,3,'闭合环 3 段');
  // 段 0→1:c1=a(0,0), c2=b(10,0), 终点(10,0)
  assert.deepEqual(bez[0],['bez',0,0,10,0,10,0]);
});

test('fillBezierPath:带控制柄的锚点用其 hOut/hIn 作三次控制点', () => {
  const c=fakeCtx();
  const a={x:0,y:0,hOut:{x:3,y:-2}}, b={x:10,y:0,hIn:{x:7,y:-2}};
  fillBezierPath(c,[a,b]);
  const bez=c.calls.filter(k=>k[0]==='bez');
  // 段 a→b:c1=a.hOut(3,-2), c2=b.hIn(7,-2), 终点 b(10,0)
  assert.deepEqual(bez[0],['bez',3,-2,7,-2,10,0]);
});

test('fillBezierPath:少于 2 点返回 false', () => {
  assert.equal(fillBezierPath(fakeCtx(),[{x:0,y:0}]), false);
});

test('traceShapePath:分派 —— bezier 走三次曲线,老路径走平滑二次曲线', () => {
  const cb=fakeCtx(); traceShapePath(cb,{bezier:true,points:[{x:0,y:0},{x:5,y:5},{x:9,y:0}]});
  assert.ok(cb.calls.some(k=>k[0]==='bez') && !cb.calls.some(k=>k[0]==='quad'), 'bezier → bezierCurveTo');
  const cs=fakeCtx(); traceShapePath(cs,{points:[{x:0,y:0},{x:5,y:5},{x:9,y:0}]});
  assert.ok(cs.calls.some(k=>k[0]==='quad') && !cs.calls.some(k=>k[0]==='bez'), '老路径 → quadraticCurveTo');
});
