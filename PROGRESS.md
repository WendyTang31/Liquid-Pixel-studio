# PROGRESS — 项目进展快照(供新对话/协作者快速接手)

> 最后更新:2026-07-27。配合 `Claude.md`(项目纲领)与 git log(每个功能一个详细 commit)阅读。
> 新 Claude 会话:先读 `Claude.md`,再读本文件,即可继续工作。

## 当前状态:功能完整、全部已推送 GitHub

仓库:https://github.com/WendyTang31/metaball-morph-studio (main)
产物:`dist/index.html`(2D 编辑器)+ `dist/viewer.html`(3D 车模预览器),均为自包含单文件,可双击运行。
构建:`npm run dev`(5173,占用时可用 PORT 环境变量改口)· `npm run build`(两次构建出双单文件)· `npm test`(48 项纯函数断言)。

## 已实现(按层)

**采样器家族**(`src/samplers.js`,含逐形状覆盖 sh.sampler/count/rscale):
grid / hex / poisson / uniform(Lloyd 24 轮,曾有"5 轮停在劣化区"的 bug 已修)/
smart(中轴结构圆+边缘细化)/ strokes(文字骨架串珠,新文字默认)/
stipple(Secord 加权点画,照片→单色可读点阵,亮度+边缘增益加权)/ vogel / rings / outline。

**引擎**(`src/engine.js`,纯函数):OT 配对(sliced optimal transport)+ 点数不等时生灭(birth/death)、
位置哈希呼吸相位(消接缝跳变)、物理缓动(backOut/elasticOut/bounceOut)、拉伸拖尾、相干流场、
逐段过渡覆盖(state.trans)、逐点颜色插值。

**渲染**:CPU tile 场渲染(彩色=场权重混色)+ WebGL2 GPU 预览(render-gl.js,3× 分辨率,导出仍 CPU 保确定性)。

**彩色管线**:图片"彩色"开关 → k-means 主色量化+背景剔除 → 逐点颜色全链路(采样→引擎→双端渲染)。

**2D 编辑器**:钢笔(RDP+锚点编辑)、图片导入(Otsu/半调/彩色)、图像序列批量导入(每张一状态)、
对齐(数值 XYWH/方向键微移/4px 磁吸参考线)、车面参考底图(3D 同步来的布局+快照+UV 线框)、
PS 式会话(每次改动即时 autosave,启动恢复)、导出 2×超采样+辉光、中英切换(🌐,src/i18n.js)、
📷 虚拟镜头(逐状态 cam{x,y,z,rot},过渡间恒用 smootherstep 插值 + 变焦对数插值;
纯变换在 sampleFrame 内施加 → CPU/GPU 预览、导出、3D 贴图零特判统一生效;
编辑模式画布显示取景框;旋转在像素坐标系做,W≠H 不剪切变形)、
AE 式版面(左侧图层面板 src/ui/layers.js:点选/双击改名/👁显隐/🔒锁定/拖动排序,
顶行=最上层,数据只是 sh.name/hidden/locked 三个普通字段随 shapes 深拷贝入档;
底部真时间轴 src/ui/timeline.js:状态铺成停留+过渡胶囊条宽∝时长、拖=擦洗、
拖段右缘=改时长(与右栏滑杆双向同步)、双击停留段=编辑该状态,段划分规则与
buildSequence 严格一致;隐藏形状不进蒙版不出点,锁定形状画布上不可选)。

**3D 预览器**(`src/viewer/main3d.js`):三种投影层——
① 贴花 Decal(点击放置,gumball 操纵球:箭头移/环转/方块缩放,双击重放);
② 🌀 环绕面(圆柱投影连续皮肤,跨部件无缝);
③ 🧩 UV 直贴(Blender 展开工作流:按网格自带 UV 贴,越界警告+平铺,UV 线框自动同步 2D 底图)。
动画组节点(多动画并行,组内共享纹理/时间线/蒙版)、画面分区切割器(取景框+磁吸)、
🔗均分/🧲衔接(等密度接缝)、软边笔刷/橡皮(按组蒙版)、🎨车身上色、⏸暂停(空格)、
视图控件(前后左右顶)、中键平移、Blender GLB 导出、IndexedDB 模型持久化、Ctrl+Z 视图撤销。

## 关键架构约定(违反=错误,详见 Claude.md)

- 引擎纯函数,任意 g 可凭空求值;预览与导出共用 sampleFrame。
- 蒙版双通道:R=放置(>127),G=亮度(半调);彩色走独立 colorCanvas。
- dots 逐点携带 r(半径)与可选 c(颜色);采样器可返回 [x,y] 或 [x,y,r]。
- Lloyd 有 250ms 时间预算护栏(测试用 setLloydBudget 放宽)。
- 工程文件向后兼容 v3 A/B 与 v4 states;serializeStates 含 trans/sampler/count/rscale/colorful 等。
- 已知验证技巧:隐藏标签页 rAF 不触发,用 window.__morph(编辑器)/window.__morph3d(3D,含 step/place/uvLayer 等)探针驱动;
  Vite 对已编辑模块加 ?t= 时间戳,外部 import 拿到的是不同实例,读状态必须走探针。

**2026-07-28 批次**:① UV 直贴取景窗口 —— UV 层的 cx/cy/cw/ch 经 applyUvLayer 重映射网格 UV
(原始 UV 备份幂等重算,删除/换模还原),分区切割器拖框即"把该部件的读画区挪到画布任意处",
morph-uvlayout 条目防抖跟写(线框底图即时跟移),🗺同步不再抹掉 UV 条目;② 排列工具
(src/ui/arrange.js,计算式绘图 v1):多选(Shift+点选/空处框选,整体拖动/微移/删除),
对齐 6 向/等距分布(首尾定住中心等差)/等宽等高(以主选中为准)/镜像复制(画布中线)/
数值阵列(N+ΔXΔY)—— 结论:约束求解器(Fusion 式)过重,Figma 范式(对齐+阵列+数值)已覆盖
LED 点阵需求;③ 右栏分区标题可折叠(localStorage 记忆,DOM 动态包裹不改控件 id);④ 切割器手势重做:
四边+四角均可拖拽缩放(7px 热区,hover 光标反馈 move/ew/ns/nwse/nesw),共享边联动
(拖一条贴合边=两侧窗口此消彼长,MIN=0.05 保可操作)——"满幅 UV 窗口拖不动"根治
(满幅时移动被夹死是数学必然,现在随手抓边缩小即可挪);⑤ Shift=全局选择手势:
任意工具下 Shift+点=切换选中、Shift+拖=框选加选(<4px 判点选),画布被大形状铺满
时照样可框选。

## 待办(2026-07-27 与用户敲定的 AE/程序化路线,按序执行)

已评估结论:AE 借"版面"(图层+时间轴),动画模型学 Rive(状态内子循环)而非 AE 全局关键帧;
AE 不能导出代码接入,可行外链 = 渲帧导入(已有图像序列导入);AI 路线 = 让 Claude 写生成器代码。

1. ~~动画内虚拟摄像机(推拉摇移)~~ ✅(📷 本状态镜头)。
2. ~~AE 式版面:图层面板 + 真时间轴~~ ✅ 2026-07-27。
3. ~~状态内子循环(核心)~~ ✅ 2026-07-27:姿态=挂 isPose 标记的真实状态(紧跟主状态,
   胶片条虚线小格 🔁,工具/撤销/图层面板全复用);engine.groupStates 唯一定义分组,
   buildSequence 给带姿态的主状态停留段挂 seg.loop(基[loop.h0/d0 计时]→各姿态[各自
   hold/dur]→无缝回基),sampleFrame 递归采样 + **整数圈对齐**(cycles=round(hold/LT),
   停留头尾精确落在基姿态 → 与相邻过渡零跳变);镜头只在主层套一次(子序列剥 cam);
   UI:右栏「🔁 状态内循环」＋姿态按钮/基姿态计时,时间轴主段 🔁N 徽标,姿态不占主段;
   groupTail 保证新建/复制状态不插进组内。眨眼=基+闭眼姿态(hold 0.05/dur 0.1);
   走路=4~8 姿态。3D 预览器透传 isPose/loop 自动生效。
4. 行为修饰器:呼吸缩放/摆动/波浪,逐形状参数化,频率上限 2.5Hz(光敏红线)。
5. 导入为子循环 + 姿态抽稀(打通 AE/Cavalry/Sora 渲帧 → 点阵)。
6. (可选)生成器状态 API(纯函数 gen(t)→dots,AI 写代码,禁随机/墙钟)。
7. 多选与群组对齐按钮;贝塞尔缓动编辑器(P2)。
8. Sidecar JSON / 观看距离模拟 / 闪烁护栏(研究仪器化,论文相关)。
9. 演出模式(全屏+键盘跳状态,8/22 展览)。
10. i18n 词典补全(长 tooltip 尚有中文残留)。

## 用户工作流备忘

- 照片→点阵:导入图片 → 勾半调 → 阈值≈10 → 采样"灰阶点画·照片";单色=不勾彩色。
- 文字:新文字默认"笔画"采样;点数留空=全覆盖;"半径×"0.7 更细。
- Blender UV 工作流:Unwrap → **Pack Islands(必须,0-1 方格)** → 导出 .glb → 3D 里 🧩 点部件 → 2D 勾"车面"对着线框画。
- 跨面跑动:同组多面 + 🔗均分;或 🌀 环绕面;或 UV 直贴(最优)。
