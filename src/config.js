// 画布固有像素尺寸。数据层一律用归一化坐标 (0..1),
// W/H 只在光栅化蒙版与像素渲染时用来换算,换分辨率导出时不动数据。
export const W = 480, H = 280;

// 全局参数。刻意做成"引用永远稳定"的单对象:任何改动都用 Object.assign 就地写入,
// 从不整体重赋。这样各模块 `import { P }` 拿到的都是同一活引用,读写天然一致。
export const P = {
  sample:'hex', spacing:17, jitter:0, dotR:4.5,
  ease:'smootherstep', stag:0.3, amp:0.003, freq:0.4, flow:0, stretch:0,
  thr:1.1, soft:0.12, match:'ot',
  tool:'rect', bool:'add', font:120,
  fps:30, gamma:1.0, fit:'stretch', colBg:'#0a0a0a',
  ss2x:false, glow:0
};
