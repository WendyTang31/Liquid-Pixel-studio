// 画布固有像素尺寸。数据层一律用归一化坐标 (0..1),
// W/H 只在光栅化蒙版与像素渲染时用来换算,换分辨率导出时不动数据。
// 【正方形画布】:与 Blender UV 的 0–1 正方形空间一一对应 —— 圆画到画布上,贴到网格 UV 上仍是圆,
// 不再被 12:7 横向压扁。(旧工程内容按原像素坐标落在上半部,可自行下移居中。)
export const W = 480, H = 480;
// 实心/矢量的距离场分辨率(3× 逻辑):SDF 越高分辨率,实心/矢量边缘越细腻。
// 3D 车模 UV 直贴时,一块形状只占纹理的一小片,被放大到整片车身面 → 边缘台阶最明显,
// 故把 SDF 从 2× 提到 3×(1440×840)喂给同尺寸的贴图。SDF 逐像素查是 O(1) 双线性,
// 提分辨率只增加"载入时算一次距离场"的成本(~2.25×),不影响每帧渲染开销。
export const SDFSC = 3, SDFW = W*SDFSC, SDFH = H*SDFSC;

// 全局参数。刻意做成"引用永远稳定"的单对象:任何改动都用 Object.assign 就地写入,
// 从不整体重赋。这样各模块 `import { P }` 拿到的都是同一活引用,读写天然一致。
export const P = {
  sample:'hex', spacing:17, jitter:0, dotR:4.5,
  ease:'smootherstep', stag:0.3, amp:0.003, freq:0.4, flow:0, stretch:0,
  thr:1.1, soft:0.12, match:'ot', silhouette:false,
  // 边缘几何(全局):细波/锯齿/飞溅。scope='span' 贯穿整段(停留+过渡),'hold' 仅停留;
  // from/to = 生效的状态区间(0 基;to<0 = 到末尾)。逐帧现读,不需重建序列。
  efx:{ fineWave:0, jagged:0, splatter:0, freq:0.6, scope:'span', from:0, to:-1, jagMotion:'pulse' },
  // 墨水沉积(水墨):按 SDF 深度给实心上色 —— 边缘沉积深墨(angle 那一侧更重),内部向背景晕染变淡。
  // scope:'all'=对所有状态生效(默认);= 某状态 id → 只在那一个 frame 上墨(进/出该状态的过渡里平滑淡入淡出)。
  // intensity=0 或 on=false 则关闭。
  ink:{ on:false, intensity:0.6, angle:90, edge:1.1, bleed:0.5, dir:0.7, clear:0, dark:0.85, scope:'all' },
  transBg:false, // 背景透明:渲染 alpha=形状覆盖度 → 只出图案,背景全透(3D 投影/PNG 导出用)
  tool:'rect', bool:'add', font:120,
  fps:30, gamma:1.0, fit:'fit', colBg:'#0a0a0a',
  ss2x:true, glow:0,
  // 📐 宽画幅导出:把世界横向拉长成 wideW 个 480 基准方 → 小人从左跑到右【跑完不消失】,且不缩小分辨率
  //(不是拉伸方形,而是真正加宽世界、原始密度逐像素渲染)。基准方居中,角色跨世界。见 widexport.js。
  wideExport:false, wideW:5,
  // 🖥 输出变换(导出末端):把方形动画适配进任意画幅 + 整体镜像/旋转/网格 warp,带实时预览。见 outtx.js。
  // gx/gy=网格格数(1×1=四角透视);mesh=(gx+1)(gy+1) 个控制点(行主序,归一化 0..1),可逐点拖做分区精细 warp。
  outTx:{ on:false, w:1440, h:600, fit:'fit', mirX:false, mirY:false, rot:0, warp:false,
    gx:1, gy:1, mesh:[[0,0],[1,0],[0,1],[1,1]] },
  // 🔩 物理布局导出(P1 创作 → P2 实装,见 ledmap.js)。默认关 → 导出行为与既有构建逐字节一致。
  // 开启时导出强制为 128×320(控制器画布),逐模组裁切/旋转/平移,永不缩放。
  // p2Rot:逐模组旋转覆盖(现场校正),null=按映射表;p2Side:侧板方向 'cw'|'ccw'(实装镜像时整体翻转)。
  // p2Scale:导出倍数。1×=硬件原生 128×320(送控制器的那份);N× = 原生按 128N×320N 渲染、
  // 模组网格同步放大 → 真高清演示片,依旧零重采样(不是把低清拉大)。
  // p2Dir:'fwd'=在 P1 竖排里画→导出重排;'inv'=照着车上的样子画→导出翻回控制器顺序(想要线条在车上连续用这个)
  // p2Map:自定义模组映射表(null=用 ledmap.js 的默认表)。每项 {src:[x,y,w,h], dst:[x,y], rotate}
  // —— 实装尺寸/位置与默认不符时直接在界面上改,不必动代码。
  p2Export:false, p2Rot:[null,null,null,null,null], p2Side:'cw', p2Scale:8, p2Dir:'fwd', p2Map:null,
  // 🧩 按取景框导出(Blender):只输出 3D 取景框内的画面(+镜像补全),框外丢弃。见 uvcrop.js
  uvCrop:{ on:false, patch:'', mirror:'h', res:4096 }
};
