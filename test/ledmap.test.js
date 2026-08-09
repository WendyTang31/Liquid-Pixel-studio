// 物理布局映射(P1→P2)验收断言。纯函数,零 DOM。
import test from 'node:test';
import assert from 'node:assert/strict';
import { LED_W, LED_H, MODULE_MAP, transformP1toP2, makeCalibrationFrame,
         mapPixel, destSize, effectiveRot, scaleMap, transformP2toP1, invertMap } from '../src/ledmap.js';

const blank=(W=LED_W,H=LED_H,fill=[0,0,0,255])=>{
  const d=new Uint8ClampedArray(W*H*4);
  for(let i=0;i<d.length;i+=4){ d[i]=fill[0]; d[i+1]=fill[1]; d[i+2]=fill[2]; d[i+3]=fill[3]; }
  return {width:W,height:H,data:d};
};
const px=(img,x,y)=>{ const i=(y*img.width+x)*4; return [img.data[i],img.data[i+1],img.data[i+2],img.data[i+3]]; };
const setPx=(img,x,y,c)=>{ const i=(y*img.width+x)*4; img.data[i]=c[0]; img.data[i+1]=c[1]; img.data[i+2]=c[2]; img.data[i+3]=c[3]??255; };

test('①形状恒定:128×320 进 → 128×320 出', () => {
  const out=transformP1toP2(blank());
  assert.equal(out.width, LED_W); assert.equal(out.height, LED_H);
  assert.equal(out.data.length, LED_W*LED_H*4);
});

test('②全黑进 → 全黑出', () => {
  const out=transformP1toP2(blank());
  for(let i=0;i<out.data.length;i+=4){
    assert.equal(out.data[i],0); assert.equal(out.data[i+1],0); assert.equal(out.data[i+2],0);
  }
});

test('③像素守恒:每个非黑源像素在输出里恰好出现一次(不丢不重)', () => {
  // 每个像素编码自己的坐标 → 天然唯一,可做多重集比对
  const src=blank();
  for(let y=0;y<LED_H;y++) for(let x=0;x<LED_W;x++)
    setPx(src,x,y,[ (x+1)&255, (y+1)&255, (((x>>4)<<4)|(y>>4))&255, 255 ]);
  const out=transformP1toP2(src);
  const tally=m=>{ const h=new Map();
    for(let i=0;i<m.data.length;i+=4){
      if(!m.data[i]&&!m.data[i+1]&&!m.data[i+2]) continue;      // 跳过黑
      const k=m.data[i]+','+m.data[i+1]+','+m.data[i+2]+','+m.data[i+3];
      h.set(k,(h.get(k)||0)+1); }
    return h; };
  const a=tally(src), b=tally(out);
  assert.equal(b.size, a.size, '非黑像素种类数应一致');
  for(const [k,n] of a) assert.equal(b.get(k), n, `像素 ${k} 出现次数应一致`);
});

test('④校准帧:模组2 的左上白块 → 旋转块的【右上角】(90° 顺时针)', () => {
  const out=transformP1toP2(makeCalibrationFrame());
  const isWhite=p=>p[0]>240&&p[1]>240&&p[2]>240;
  // 模组2 目标块 = x 0..63, y 64..191
  let tl=0,tr=0,bl=0,br=0;
  for(let y=64;y<192;y++) for(let x=0;x<64;x++){
    if(!isWhite(px(out,x,y))) continue;
    const top=y<128, left=x<32;
    if(top&&left)tl++; else if(top&&!left)tr++; else if(!top&&left)bl++; else br++;
  }
  assert.ok(tr>0, '右上角应有白块');
  assert.equal(tl,0,'左上不应有'); assert.equal(bl,0,'左下不应有'); assert.equal(br,0,'右下不应有');
});

test('⑤纯函数:不修改入参', () => {
  const src=makeCalibrationFrame();
  const copy=Uint8ClampedArray.from(src.data);
  transformP1toP2(src);
  assert.deepEqual(Array.from(src.data), Array.from(copy));
});

test('旋转映射:90CW 的角点与 spec 一致(源上边 → 右半)', () => {
  const [w,h]=[128,64];
  assert.deepEqual(destSize(w,h,90), [64,128]);
  assert.deepEqual(mapPixel(0,0,w,h,90), [63,0]);      // 左上 → 右上
  assert.deepEqual(mapPixel(0,63,w,h,90), [0,0]);      // 左下 → 左上
  assert.deepEqual(mapPixel(127,0,w,h,90), [63,127]);  // 右上 → 右下
  for(let sy=0;sy<=31;sy++) assert.ok(mapPixel(0,sy,w,h,90)[0]>=32, '源上半 → dx 32..63(右半)');
});

test('SIDE_PANEL_ROTATION=ccw 只翻转侧板(90→270),不动 0° 模组;逐模组覆盖优先', () => {
  const side=MODULE_MAP[1], front=MODULE_MAP[0];
  assert.equal(effectiveRot(side,null,'cw'), 90);
  assert.equal(effectiveRot(side,null,'ccw'), 270);
  assert.equal(effectiveRot(front,null,'ccw'), 0);
  assert.equal(effectiveRot(side,180,'ccw'), 180);   // 覆盖优先
});

test('ccw 模式下像素同样守恒(不丢不重)', () => {
  const src=blank();
  for(let y=0;y<LED_H;y++) for(let x=0;x<LED_W;x++)
    setPx(src,x,y,[(x+1)&255,(y+1)&255,(((x>>4)<<4)|(y>>4))&255,255]);
  const out=transformP1toP2(src,{side:'ccw'});
  let n=0; for(let i=0;i<out.data.length;i+=4) if(out.data[i]||out.data[i+1]||out.data[i+2]) n++;
  let m=0; for(let i=0;i<src.data.length;i+=4) if(src.data[i]||src.data[i+1]||src.data[i+2]) m++;
  assert.equal(n,m);
});

test('高清倍数:N× 下形状/像素守恒/旋转见证全部成立(真高清,非拉伸)', () => {
  for(const n of [2,4,8]){
    const W=LED_W*n, H=LED_H*n;
    const src=blank(W,H);
    for(let y=0;y<H;y++) for(let x=0;x<W;x++)
      setPx(src,x,y,[(x+1)&255,(y+1)&255,(((x>>4)<<4)|(y>>4))&255,255]);
    const out=transformP1toP2(src,{scale:n});
    assert.equal(out.width,W); assert.equal(out.height,H);
    // 像素守恒(多重集一致)
    const tally=m=>{ const h=new Map();
      for(let i=0;i<m.data.length;i+=4){
        if(!m.data[i]&&!m.data[i+1]&&!m.data[i+2]) continue;
        const k=m.data[i]+','+m.data[i+1]+','+m.data[i+2];
        h.set(k,(h.get(k)||0)+1); } return h; };
    const a=tally(src), b=tally(out);
    assert.equal(b.size,a.size,`${n}× 非黑像素种类数应一致`);
    for(const [k,v] of a) assert.equal(b.get(k),v,`${n}× 像素 ${k} 次数应一致`);
  }
});

test('高清倍数:模组2 白块在 N× 下依旧落在旋转块右上角', () => {
  const n=4, W=LED_W*n, H=LED_H*n;
  const cal=makeCalibrationFrame(scaleMap(MODULE_MAP,n), W, H);
  const out=transformP1toP2(cal,{scale:n});
  const isWhite=p=>p[0]>240&&p[1]>240&&p[2]>240;
  let tl=0,tr=0,bl=0,br=0;
  for(let y=64*n;y<192*n;y++) for(let x=0;x<64*n;x++){
    if(!isWhite(px(out,x,y))) continue;
    const top=y<128*n, left=x<32*n;
    if(top&&left)tl++; else if(top&&!left)tr++; else if(!top&&left)bl++; else br++;
  }
  assert.ok(tr>0,'右上应有白块'); assert.equal(tl,0); assert.equal(bl,0); assert.equal(br,0);
});

test('反向变换:P1→P2→P1 往返 = 原图(逐像素完全一致)', () => {
  const src=blank();
  for(let y=0;y<LED_H;y++) for(let x=0;x<LED_W;x++)
    setPx(src,x,y,[(x*7+1)&255,(y*5+3)&255,((x^y)&255),255]);
  for(const side of ['cw','ccw']){
    const p2=transformP1toP2(src,{side});
    const back=transformP2toP1(p2,{side});
    assert.deepEqual(Array.from(back.data), Array.from(src.data), `${side}: 往返应完全还原`);
  }
});

// 逐像素比对但【快速失败】—— 对 16 万个元素做 deepEqual 失败时会生成巨大 diff,拖慢几十秒。
const sameData=(a,b)=>{ if(a.length!==b.length) return `长度 ${a.length}≠${b.length}`;
  for(let i=0;i<a.length;i++) if(a[i]!==b[i]) return `第 ${i} 个字节 ${a[i]}≠${b[i]}`;
  return null; };

test('反向变换:逐模组覆盖角度下往返依旧还原(角度须与槽位相容)', () => {
  const src=blank();
  for(let y=0;y<LED_H;y++) for(let x=0;x<LED_W;x++)
    setPx(src,x,y,[(x+2)&255,(y+9)&255,((x*3+y)&255),255]);
  // 横向槽位(128×64)只能 0/180;旋转槽位(64×128)只能 90/270 —— 否则尺寸不匹配会被裁掉
  const rotations=[180,270,270,180,0];
  const p2=transformP1toP2(src,{rotations});
  const back=transformP2toP1(p2,{rotations});
  assert.equal(sameData(back.data, src.data), null);
});

test('护栏:给横向模组设 90° 会超出其 128×64 槽位 → 像素被裁掉(UI 因此只提供相容角度)', () => {
  const src=blank();
  for(let y=0;y<LED_H;y++) for(let x=0;x<LED_W;x++) setPx(src,x,y,[200,200,200,255]);
  const bad=transformP1toP2(src,{rotations:[0,90,90,0,90]});   // 模组5(横向)被设成 90°
  let lit=0; for(let i=0;i<bad.data.length;i+=4) if(bad.data[i]>0) lit++;
  assert.ok(lit < LED_W*LED_H, '不相容角度确实会丢像素 —— 所以要在 UI 层挡住');
});

test('接缝验算:270°(CCW) 让模组2↔模组3 在 P2 里左右相接的两条边,在 P1 里正好相邻', () => {
  const w=128,h=64;
  // P2 中 模组2 块的右缘 dx=63 ← 来自 P1 的哪条边?
  const edgeOf=(rot,targetDx)=>{ const ys=[];
    for(let sy=0;sy<h;sy++) if(mapPixel(0,sy,w,h,rot)[0]===targetDx) ys.push(sy);
    return ys; };
  // 270°:dx=sy → dx=63 ⟺ sy=63(模组2 的【下】边)
  assert.deepEqual(edgeOf(270,63), [63], '270°: 模组2 右缘来自其 P1 下边');
  // 模组3 块的左缘 dx=0 ⟺ sy=0(模组3 的【上】边)→ P1 里 模组2下边 与 模组3上边 相邻 ✅
  assert.deepEqual(edgeOf(270,0), [0], '270°: 模组3 左缘来自其 P1 上边');
  // 90° CW:dx=63-sy → dx=63 ⟺ sy=0(模组2 的【上】边),与模组3 的下边相接 → P1 里不相邻 ❌
  assert.deepEqual(edgeOf(90,63), [0], '90°: 模组2 右缘来自其 P1 上边(接缝会断)');
});

test('scaleMap:整表等比放大,1× 原样返回', () => {
  assert.equal(scaleMap(MODULE_MAP,1), MODULE_MAP);
  const s=scaleMap(MODULE_MAP,8);
  assert.deepEqual(s[1].src, [0, 512, 1024, 512]);   // 模组2:[0,64,128,64]×8
  assert.deepEqual(s[2].dst, [512, 512]);            // 模组3:[64,64]×8
  // 放大后各模组仍恰好铺满 128N×320N,互不重叠
  let area=0; for(const m of s) area+=m.src[2]*m.src[3];
  assert.equal(area, (LED_W*8)*(LED_H*8));
});

test('校准帧:5 个模组各有 N 条竖条(N=序号),颜色互不相同', () => {
  const cal=makeCalibrationFrame();
  const seen=new Set();
  MODULE_MAP.forEach((mod,mi)=>{
    const [x0,y0,w,h]=mod.src;
    const midY=y0+(h>>1);
    let runs=0, prev=false;
    const bright=x=>{ const p=px(cal,x0+x,midY); return p[0]+p[1]+p[2] > 200; };
    for(let x=2;x<w-2;x++){ const b=bright(x); if(b&&!prev) runs++; prev=b; }
    assert.equal(runs, mi+1, `模组${mi+1} 应有 ${mi+1} 条竖条`);
    const c=px(cal, x0+Math.round(w/(mi+2)), midY).slice(0,3).join(',');
    assert.ok(!seen.has(c), '各模组颜色应互不相同'); seen.add(c);
  });
});
