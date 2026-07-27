// 纯函数断言(node --test)。图片导入的像素数学层,无 DOM 依赖(decodeImageShape 需要
// Image/DOM,不在此测,靠浏览器端到端验证)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { luminanceHistogram, alphaHistogram, hasMeaningfulAlpha, otsuThreshold, binarize, grayscaleize, quantizeColors } from '../src/image.js';

// 造一张合成的 RGBA 像素数组:一半深色像素、一半浅色像素(双峰分布,Otsu 的经典场景)。
function makeBimodalPixels(n, darkV, lightV){
  const data=new Uint8ClampedArray(n*4);
  for(let i=0;i<n;i++){
    const v = i<n/2 ? darkV : lightV;
    data[i*4]=v; data[i*4+1]=v; data[i*4+2]=v; data[i*4+3]=255;
  }
  return data;
}

test('亮度直方图:桶计数总和等于像素数,极值落在正确的桶', () => {
  const data=makeBimodalPixels(100, 30, 220);
  const hist=luminanceHistogram(data);
  const total=hist.reduce((a,b)=>a+b,0);
  assert.equal(total, 100);
  assert.equal(hist[30], 50); assert.equal(hist[220], 50);
});

test('Otsu 阈值:带噪声的双峰分布应落在两峰之间', () => {
  // 真实照片的每个"类"总有噪声扩散,不会是零方差的完美尖峰(那种退化情形下类间方差在
  // 整个中间区间恒为最大值,任意阈值都同样最优,不适合用来测"应落在中间")。
  const n=2000, data=new Uint8ClampedArray(n*4);
  for(let i=0;i<n;i++){
    const v=Math.max(0,Math.min(255, Math.round((i<n/2?40:210) + (Math.sin(i*12.9)*13))));
    data[i*4]=v; data[i*4+1]=v; data[i*4+2]=v; data[i*4+3]=255;
  }
  const t=otsuThreshold(luminanceHistogram(data));
  assert.ok(t>40 && t<210, `阈值应落在两峰之间,实际 ${t}`);
});

test('Otsu 阈值:全空直方图不应崩溃,给出合理默认值', () => {
  const hist=new Uint32Array(256);
  const t=otsuThreshold(hist);
  assert.ok(t>=0 && t<=255);
});

test('透明检测:全不透明返回 false,含透明像素返回 true', () => {
  const opaque=new Uint8ClampedArray([10,10,10,255, 200,200,200,255]);
  assert.equal(hasMeaningfulAlpha(opaque), false);
  const withAlpha=new Uint8ClampedArray([10,10,10,255, 200,200,200,0]);
  assert.equal(hasMeaningfulAlpha(withAlpha), true);
});

test('二值化:内部→可见(按 add/sub 取白/黑),外部→完全透明', () => {
  const data=makeBimodalPixels(4, 20, 230); // 前两个"暗"、后两个"亮"
  binarize(data, { threshold:128, invert:false, useAlpha:false, addColor255:true });
  // 亮(>128)的算"内部":add 模式应为白色可见
  assert.equal(data[2*4], 255); assert.equal(data[2*4+3], 255);
  // 暗的算"外部":应完全透明
  assert.equal(data[0*4+3], 0);
});

test('二值化:sub 模式内部应为黑色而非白色', () => {
  const data=makeBimodalPixels(2, 20, 230);
  binarize(data, { threshold:128, invert:false, useAlpha:false, addColor255:false });
  assert.equal(data[1*4], 0); assert.equal(data[1*4+3], 255); // 内部但 sub → 黑色可见
});

test('半调灰度化:R=放置(255) G=亮度,黑场之下全透明', () => {
  const data=makeBimodalPixels(4, 20, 200); // 前两个 v=20(低于黑场),后两个 v=200
  grayscaleize(data, { threshold:26, invert:false, useAlpha:false });
  assert.equal(data[0*4+3], 0, 'v=20 < 黑场26 应透明');
  assert.equal(data[2*4], 255, '内部 R 应为 255(放置通道)');
  assert.equal(data[2*4+1], 200, '内部 G 应保留亮度值');
  assert.equal(data[2*4+3], 255, '内部应不透明');
});

test('k-means 量化:主色收敛、白背景剔除为透明', () => {
  // 20x20 合成图:白底,左半近似红(带噪),右半近似蓝
  const w = 20, h = 20, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (y < 3 || y >= h - 3) { data.set([255, 255, 255, 255], i); continue; } // 上下白边=背景
    const noise = ((x * 7 + y * 13) % 5) - 2;
    if (x < w / 2) data.set([220 + noise, 30, 30, 255], i);
    else data.set([30, 30, 220 + noise, 255], i);
  }
  const cents = quantizeColors(data, w, h, 3);
  assert.ok(cents.length >= 2, '应识别出至少 2 个主色');
  const uniq = new Set();
  let bgCleared = true;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (y < 3 || y >= h - 3) { if (data[i + 3] !== 0) bgCleared = false; }
    else uniq.add(data[i] + ',' + data[i + 1] + ',' + data[i + 2]);
  }
  assert.ok(bgCleared, '白背景应被置为透明');
  assert.ok(uniq.size <= 3, `前景应只剩 ≤3 个主色,实际 ${uniq.size}`);
});

test('二值化:invert 翻转内外判定', () => {
  const a=makeBimodalPixels(2, 20, 230);
  binarize(a, { threshold:128, invert:false, useAlpha:false, addColor255:true });
  const b=makeBimodalPixels(2, 20, 230);
  binarize(b, { threshold:128, invert:true, useAlpha:false, addColor255:true });
  assert.notEqual(a[0*4+3], b[0*4+3], 'invert 前后同一像素的内外判定应相反');
});
