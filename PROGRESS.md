# PROGRESS — 项目进展快照(供新对话/协作者快速接手)

> 最后更新:2026-07-28。**新 Claude 会话:先读 `Claude.md`(项目纲领)+ 本文件,再看 git log(每功能一详细 commit)。**
> 仓库 https://github.com/WendyTang31/metaball-morph-studio (main) · 功能完整、全部已推送。

## 一句话:这是什么
自动驾驶车尾 LED 点阵灯语(eHMI)的专属动画编辑器。设计师画形状/文字/矢量图形 → 多状态间
平滑形变(点阵 metaball morph **或** 矢量轮廓变形)→ 导出 PNG 序列/MP4/WebM,或贴到 3D 车模预览。
美学红线:**"光不闪烁,光生长"** —— 禁硬切/频闪,任何 3–30Hz 亮度振荡是光敏红线。

## 构建/运行
- `npm run dev`(端口 5173,被占用时 `PORT=xxxx npm run dev`)
- `npm run build`(出 `dist/index.html` 编辑器 + `dist/viewer.html` 3D 预览器,均自包含单文件,可双击)
- `npm test`(**76 项**纯函数断言,node --test)
- 依赖:jszip(PNG zip)、three(3D)、mp4-muxer(MP4)。运行时仅此三个。

## 分层实现现状

**采样器**(`src/samplers.js`,支持逐形状 sh.sampler/count/rscale):grid/hex/poisson/uniform(Lloyd 24 轮)/
smart(中轴结构圆)/strokes(文字骨架串珠)/stipple(照片加权点画)/vogel/rings/outline。

**引擎**(`src/engine.js`,纯函数,预览=导出的根基):OT 配对(sliced optimal transport)+ 点数不等生灭、
位置哈希呼吸相位、物理缓动、拉伸拖尾、流场、逐段过渡覆盖(state.trans)、逐点颜色插值;
`sampleFrame(SEQ,states,g,time,P)` 返回 {seg,balls,col,cam,solids}。虚拟镜头 cam{x,y,z,rot}(过渡 smootherstep+变焦对数插值)、
子循环 loop(眨眼/走路,整数圈对齐)、动态几何 fx(波浪/弹簧/液态线/波纹/微光,≤2.5Hz)、矢量图层 morphLayers。

**渲染**(`src/render.js`):CPU tile 场渲染 + **视口渲染**(createSizedRenderer 接 view={z,ox,oy},只渲可见区
→ 编辑器缩放清晰、开销恒定)+ WebGL2 预览(render-gl.js,z=1 满幅走 GPU,缩放/含实心回退 CPU)。
实心/矢量距离场 = 2×(SDFW/SDFH=960×560,消边缘像素感)。

**2D 编辑器 UI**:
- 版面(AE 式):左**图层面板**(src/ui/layers.js,改名/显隐/锁定/拖排序)+ 底**真时间轴**(src/ui/timeline.js,
  停留+过渡胶囊条,拖=擦洗、拖段缘=改时长、双击=编辑;段划分与 buildSequence 严格一致)+ 右属性栏(可折叠分区)。
- **贝塞尔钢笔**(src/ui/stage.js):点=尖角/点后拖=对称柄/点回起点·Enter·双击=闭合;➤ 拖锚点(柄随动)、
  拖黄柄调曲率(Alt 断对称)、双击锚点尖角⇄光滑;path.js fillBezierPath+traceShapePath。
- **排列/约束**(src/ui/arrange.js + src/constraints.js):多选(Shift 点选/框选)、对齐/等距/等尺寸/镜像/阵列;
  持久约束 sh.rel(定距/等尺寸/对中/对称,有向传播重解)、中线 guides[]、CAD 尺寸标注(点边→Shift+点边→输数值)。
- **🧱 实心显示**(逐形状 sh.solidFill):蒙版 chamfer SDF 与点场同阈值相加 → 停留=矢量锐边整块、过渡=溶解为点。
- **动画方式选择器**(选中对象):① 点阵溶解(墨水)/ ② 矢量变形(木偶,见下)。文字默认实心字形填充。
- **画布缩放/平移**:滚轮以光标为中心、中键/空格拖平移、缩放条复位。矢量数据放大只是看更细。
- 其它:图片导入(Otsu/半调/彩色 k-means)、图像序列批量导入、Ctrl+C/V 跨状态复制、PS 式 autosave、中英切换(🌐)。

**导出**(src/export.js):PNG 序列(JSZip)、🎬 MP4(WebCodecs H.264+mp4-muxer,与 PNG 同一确定性离线管线,
不支持回退 PNG)、WebM 实时录制。全部经同一 sampleFrame,所见即所得。

**3D 预览器**(`src/viewer/main3d.js`):三种投影 —— ①贴花 Decal(gumball 操纵)②🌀环绕面(圆柱投影)
③🧩 UV 直贴(Blender 展开);动画组节点、分区切割器、🔗均分/🧲衔接、软边笔刷/橡皮、🎨上色、
视图控件、Blender GLB 导出、IndexedDB 持久化。**贴图边缘:颜色贴图 mipmap+各向异性(alpha 蒙版不 mipmap,
否则粗糙 mip 层把透明区平均致整片网格消失="前盖消失"真凶)。**

## AE 关联图层 / 矢量变形(用户核心方向)—— 当前进度

**用户 2026-07-28 选定做 Full AE 关联图层模型**:一个形状作为贯穿多关键帧的"图层",轮廓直接矢量插值。

**已完成(src/vector.js)**:
- `layerId` 形状 = 关联图层。停留/未配对过渡进 `_sdf`(实心显示);出 lid 标记的点(供跨系统溶解)。
- **木偶/最短路径变形**(909de36):同 layerId 两端路径【锚点数一致】→ 逐锚点(含贝塞尔柄)直线插值再 flatten,
  每控制点走最短路,小幅连贯(手臂抬起自然)。拓扑不同(矩形↔椭圆/加删锚点)→ 退回弧长轮廓重采样。
- **矢量图层↔普通帧** = 点阵溶解(engine.morphLayers = 两端 dot lid 交集,按 lid 抑制"两端同层"的点;
  只在一端的层不抑制 → 照常溶解)。
- 无残影(48455a5):过渡的实心淡出窗口只用 `_sdfBase`(不含矢量图层),矢量图层由轮廓变形独占。
- 3D 生效(48455a5):viewer 帧循环并入 computeVectorPolys→rasterizeVectorSolids,states 存 shapes。
- UI:选中对象「动画」下拉切 ①/②;②模式下「🔑 打关键帧到下一状态」→ 去那里**移动控制点**(别增删锚点)。

**待办(关联图层剩余)**:② 专门的**逐图层关键帧时间轴**(轨道/加删关键帧/逐帧编辑,当前借用 states 当关键帧);
text 矢量变形;拓扑差异大时的鲁棒轮廓对应;矢量图层的 3D 若掉帧可改"贴图上直接 ctx.fill"(免每帧距离场)。

## 关键架构约定(违反=错误)
- 引擎纯函数,任意 g 可凭空求值;预览与导出共用 sampleFrame。
- 蒙版 R=放置(>127)/G=亮度(半调);彩色走独立 colorCanvas;dots 逐点带 r 与可选 c。
- 工程文件向后兼容 v3 A/B 与 v4 states;serializeStates 含 trans/cam/loop/fx/solid/guides/layerId 等(缺省不写)。
- **性能**:实心/矢量是 CPU 逐像素场,分辨率再高会拖垮帧率(实测 4× 缓冲 ~196ms/帧);"放大也清晰"用
  视口渲染,不是加大缓冲。
- **验证技巧**:隐藏标签页 rAF 不触发(用 setTimeout 或探针);window.__morph(编辑器)/window.__morph3d
  (3D,含 step/place/uvLayer)探针驱动;Vite 给已编辑模块加 ?t= 时间戳,外部 import 拿到的是不同实例、
  模块级状态(如 selSkin)读不到 → 靠 localStorage 变化或探针验证。

## 待办候选(优先级)
1. **逐图层关键帧时间轴**(AE 关联图层第②步,最高)。
2. text 矢量变形;矢量轮廓对应鲁棒性;矢量 3D 掉帧优化。
3. 导入为子循环 + 姿态抽稀(打通 AE/Cavalry/Sora 渲帧 → 点阵)。
4. 生成器状态 API(纯函数 gen(t)→dots,让 AI 写代码,禁随机/墙钟)。
5. 贝塞尔缓动编辑器;演出模式(全屏+键盘跳状态,8/22 展览);i18n 长 tooltip 补全。
6. 研究仪器化:Sidecar JSON / 观看距离模拟 / 闪烁护栏(论文相关)。

## 用户工作流备忘
- **木偶动画(如小人摇手)**:画形状 → 选中对象「动画=②矢量变形」→「🔑 打关键帧到下一状态」→
  在下一状态**移动控制点**(别增删锚点)→ 轮廓沿最短路平滑变形。
- 照片→点阵:导入图片 → 勾半调 → 阈值≈10 → 采样"灰阶点画·照片"。
- 文字:默认实心字形填充(清晰);想要点阵取消 🧱实心 + 采样改"笔画"。
- Blender UV:Unwrap → **Pack Islands(必须,0-1 方格)** → 导出 .glb → 3D 里 🧩 点部件 → 2D 勾"车面"对着线框画。
- 跨面跑动:同组多面 + 🔗均分;或 🌀 环绕面;或 UV 直贴(最优)。
