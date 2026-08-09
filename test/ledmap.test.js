// 物理布局映射(P1→P2)验收断言。纯函数,零 DOM。
import test from 'node:test';
import assert from 'node:assert/strict';
import { LED_W, LED_H, MODULE_MAP, transformP1toP2, makeCalibrationFrame,
         mapPixel, destSize, effectiveRot } from '../src/ledmap.js';

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
