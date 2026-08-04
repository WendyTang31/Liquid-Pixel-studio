// 动画片段(clip):整体时长/变换/循环圈 纯函数 + 引擎片段展开断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import { clipIndicesOf, clipFrameCount, clipTotalSec, retimeClip,
         transformClip, setClipEase, setClipLoops } from '../src/clip.js';
import { buildSequence } from '../src/engine.js';

const P0={ ease:'linear', stag:0, amp:0, freq:.4, match:'sortXY', flow:0, stretch:0 };
// 一帧:一个 4 锚点方形 path,带 clip 标签
const frame=(cid,x=100,y=100,s=20)=>({ hold:0, dur:0.1, color:'#fff', dots:[], trans:{},
  clip:{id:cid, name:'walk', loops:1},
  shapes:[{ type:'path', bezier:false, layerId:1, bool:'add',
    points:[{x,y},{x:x+s,y},{x:x+s,y:y+s},{x,y:y+s}], x, y, w:s, h:s }] });

test('clipIndicesOf / frameCount:按 clip.id 收集连续帧', () => {
  const sts=[frame(1),frame(1),frame(2),{hold:1,dur:1,shapes:[]}];
  assert.deepEqual(clipIndicesOf(sts,1),[0,1]);
  assert.equal(clipFrameCount(sts,2),1);
  assert.deepEqual(clipIndicesOf(sts,null),[], 'id 为 null 不匹配任何');
});

test('retimeClip:总时长均分到各帧(hold 清零)', () => {
  const sts=[frame(1),frame(1),frame(1),frame(1)];
  retimeClip(sts,1,10);
  for(const s of sts){ assert.ok(Math.abs(s.dur-2.5)<1e-9); assert.equal(s.hold,0); }
  assert.ok(Math.abs(clipTotalSec(sts,1)-10)<1e-9);
});

test('transformClip:绕片段中心整体缩放,所有帧一致放大', () => {
  const sts=[frame(1,100,100,20),frame(1,100,100,20)];
  transformClip(sts,1,{scale:2});
  for(const s of sts){ const sh=s.shapes[0];
    assert.ok(Math.abs(sh.w-40)<1e-6, `宽应×2 → 40,实际 ${sh.w}`);
    assert.ok(Math.abs(sh.h-40)<1e-6); }
});

test('transformClip:平移施加到所有帧', () => {
  const sts=[frame(1,100,100,20)];
  transformClip(sts,1,{dx:15,dy:-5});
  const sh=sts[0].shapes[0];
  assert.ok(Math.abs(sh.x-115)<1e-6 && Math.abs(sh.y-95)<1e-6, `应平移 (+15,-5),实际 (${sh.x},${sh.y})`);
});

test('setClipEase / setClipLoops:写进片段每帧', () => {
  const sts=[frame(1),frame(1)];
  setClipEase(sts,1,'cubic'); assert.equal(sts[0].trans.ease,'cubic'); assert.equal(sts[1].trans.ease,'cubic');
  setClipEase(sts,1,''); assert.equal(sts[0].trans.ease,undefined, '空串清除覆盖');
  setClipLoops(sts,1,3); assert.equal(sts[0].clip.loops,3); assert.equal(sts[1].clip.loops,3);
});

test('buildSequence:片段 loops=N 在播放列表里重复 N 次(走 N 圈再衔接下一段)', () => {
  const walk=[frame(1),frame(1)]; walk.forEach(s=>s.clip.loops=3);
  const next={hold:0,dur:0.1,color:'#fff',dots:[],trans:{},shapes:[]}; // 片段后的下一段
  const SEQ=buildSequence([...walk,next], true, P0);
  // 片段首帧(idx 0)作为过渡起点应出现 3 次(循环 3 圈)
  const firstFrameStarts=SEQ.segs.filter(s=>s.type==='trans' && s.a===0).length;
  assert.equal(firstFrameStarts,3, `片段循环 3 圈,首帧应作 3 次过渡起点,实际 ${firstFrameStarts}`);
});

test('buildSequence:无 clip 时行为不变(playlist===masters)', () => {
  const A={hold:1,dur:2,color:'#fff',dots:[]}, B={hold:1,dur:2,color:'#fff',dots:[]};
  const SEQ=buildSequence([A,B], false, P0);
  assert.equal(SEQ.segs.length,3, '[holdA, transA→B, holdB]');
  assert.equal(SEQ.T,4, 'holdA 1 + trans 2 + holdB 1');
});
