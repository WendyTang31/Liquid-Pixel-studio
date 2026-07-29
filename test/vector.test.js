// 矢量图层轮廓变形断言:轮廓规范化(定点数/对齐)、同 layerId 两端逐点插值、
// 停留/过渡分派与边界连续。rasterize 依赖 canvas,这里只测纯几何(outline/computeVectorPolys)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { outline, computeVectorPolys, vectorShapes } from '../src/vector.js';
import { buildSequence } from '../src/engine.js';

test('outline:任意形状规范化为固定点数,首点在质心 +x 方向附近', () => {
  const rect={type:'rect',x:100,y:100,w:200,h:80};
  const o=outline(rect, 120);
  assert.equal(o.length,120,'固定 120 点');
  let cx=0,cy=0; for(const p of o){cx+=p.x;cy+=p.y;} cx/=120; cy/=120;
  const a0=Math.atan2(o[0].y-cy,o[0].x-cx);
  assert.ok(Math.abs(a0)<0.2,`首点应接近 +x 方向,实际角=${a0.toFixed(2)}`);
});

test('outline:椭圆与矩形点数一致,可逐点插值(圆→方 morph 的前提)', () => {
  const oa=outline({type:'ellipse',x:0,y:0,w:100,h:100},120);
  const ob=outline({type:'rect',x:0,y:0,w:100,h:100},120);
  assert.equal(oa.length, ob.length);
  const mid=oa.map((p,i)=>({x:(p.x+ob[i].x)/2,y:(p.y+ob[i].y)/2}));
  assert.equal(mid.length,120,'逐点插值得到等长中间轮廓');
});

test('vectorShapes:只挑带 layerId、未隐藏、add 的形状', () => {
  const st={shapes:[
    {type:'rect',layerId:1,x:0,y:0,w:10,h:10},
    {type:'rect',x:0,y:0,w:10,h:10},               // 无 layerId → 排除
    {type:'rect',layerId:2,hidden:true,x:0,y:0,w:10,h:10}, // 隐藏 → 排除
  ]};
  assert.equal(vectorShapes(st).length,1);
});

test('computeVectorPolys:停留=静态;过渡同 layerId 两端插值;端点精确落回两端形状', () => {
  const A={color:'#fff', hold:1, dur:2, dots:[{x:.2,y:.2,r:.01}],
    shapes:[{type:'rect', layerId:7, x:100,y:100,w:80,h:80}]};
  const B={color:'#fff', hold:1, dur:2, dots:[{x:.8,y:.8,r:.01}],
    shapes:[{type:'ellipse', layerId:7, x:300,y:120,w:80,h:80}]};
  const states=[A,B];
  const SEQ=buildSequence(states, false, {match:'sortXY',ease:'linear',stag:0,amp:0,freq:.4});
  // 停留态由实心 SDF 显示 → computeVectorPolys 停留返回空(不重复画)
  assert.equal(computeVectorPolys(states, SEQ, 0.5).length, 0);
  // 过渡起点(g=1⁺,lt≈0):应≈A;过渡终点(g=3⁻,lt≈1):应≈B
  const near0=computeVectorPolys(states, SEQ, 1.0001);
  const cx0=near0[0].poly.reduce((s,p)=>s+p.x,0)/near0[0].poly.length;
  assert.ok(Math.abs(cx0-140)<5, `过渡起点应≈A,实际中心 ${cx0.toFixed(1)}`);
  const near1=computeVectorPolys(states, SEQ, 3-0.0001);
  const cx1=near1[0].poly.reduce((s,p)=>s+p.x,0)/near1[0].poly.length;
  assert.ok(Math.abs(cx1-340)<5, `过渡终点应≈B(中心~340),实际 ${cx1.toFixed(1)}`);
  // 中段:介于两者之间
  const mid=computeVectorPolys(states, SEQ, 2.0);
  const cxm=mid[0].poly.reduce((s,p)=>s+p.x,0)/mid[0].poly.length;
  assert.ok(cxm>150 && cxm<330, `中段中心应在两端之间,实际 ${cxm.toFixed(1)}`);
});

test('computeVectorPolys:layerId 只在一端 → 不产生 morph(需两端都有)', () => {
  const A={color:'#fff',hold:1,dur:2,dots:[{x:.2,y:.2,r:.01}],shapes:[{type:'rect',layerId:9,x:0,y:0,w:50,h:50}]};
  const B={color:'#fff',hold:1,dur:2,dots:[{x:.8,y:.8,r:.01}],shapes:[{type:'rect',x:0,y:0,w:50,h:50}]}; // 无 layerId
  const SEQ=buildSequence([A,B], false, {match:'sortXY',ease:'linear',stag:0,amp:0,freq:.4});
  assert.equal(computeVectorPolys([A,B], SEQ, 2.0).length, 0);
});

test('木偶/最短路径:同锚点数路径 → 逐锚点直线插值(而非弧长重采样打结)', () => {
  // kf1: 三角(手臂 anchor 在下);kf2: 同 3 锚点,其中一个"手臂"点抬高
  const A={color:'#fff',hold:1,dur:2,dots:[{x:.3,y:.3,r:.01}],shapes:[
    {type:'path',layerId:5,points:[{x:100,y:200},{x:200,y:200},{x:150,y:100}]}]};
  const B={color:'#fff',hold:1,dur:2,dots:[{x:.3,y:.3,r:.01}],shapes:[
    {type:'path',layerId:5,points:[{x:100,y:200},{x:260,y:120},{x:150,y:100}]}]}; // 第2点抬起+外移
  const SEQ=buildSequence([A,B], false, {match:'sortXY',ease:'linear',stag:0,amp:0,freq:.4});
  const start=computeVectorPolys([A,B], SEQ, 1.0001); // e≈0
  const mid=computeVectorPolys([A,B], SEQ, 2.0);       // e≈0.5
  const end=computeVectorPolys([A,B], SEQ, 3-0.0001);  // e≈1
  assert.equal(mid.length,1);
  const maxx=poly=>Math.max(...poly[0].poly.map(p=>p.x));
  // 逐锚点最短路:第2锚点 x 从 200→260 单调外移 → 三帧右缘应单调递增(手臂渐渐抬起,连贯)
  assert.ok(maxx(start)<maxx(mid) && maxx(mid)<maxx(end),
    `右缘应随过渡单调外移(手臂渐抬),实际 ${maxx(start).toFixed(0)}→${maxx(mid).toFixed(0)}→${maxx(end).toFixed(0)}`);
  assert.ok(maxx(end)-maxx(start)>20, '首尾差应明显(确实动了)');
  // 无打结:所有点都在两帧锚点凸包(+边距)内,不会飞出
  for(const p of mid[0].poly)
    assert.ok(p.x>=90&&p.x<=270&&p.y>=90&&p.y<=210, `点不应飞出(${p.x|0},${p.y|0})`);
});
