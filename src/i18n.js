// 界面语言:英文(默认)/ 中文 / 한국어。源文案为中文(zh 作规范键),EN/KO 为字典。
// 切换时:先把当前显示文案还原成 zh(反查),再翻到目标语言。未收录条目回退到英文/保持原样。
// 不侵入业务模块;文本节点/title/placeholder 命中即换,动态内容由 MutationObserver 接手。
const EN = {
  '▶ 预览序列':'▶ Preview', '✏ 回到编辑':'✏ Back to Edit',
  '清空当前状态':'Clear State', '🗑 全部':'🗑 All', '复制点集':'Copy Dots',
  '🖼 导入图片':'🖼 Import Image', '🚗 3D 预览':'🚗 3D Preview', '✒ 导入 SVG':'✒ Import SVG',
  '💾 保存工程':'💾 Save', '📂 打开工程':'📂 Open',
  '＋ 新状态':'+ New State', '+ 新状态':'+ New State', '▶ 播放':'▶ Play', '⏸ 暂停':'⏸ Pause',
  '循环':'Loop', '无缝(尾→首)':'Seamless (last→first)',
  '当前状态':'CURRENT STATE', '名称':'Name', '颜色':'Color', '背景':'BG',
  '停留 (秒)':'Hold (s)', '过渡 (秒)':'Trans (s)', '🧱实心':'🧱Solid', '🖊描边':'🖊Stroke',
  '本段过渡覆盖(→ 下一状态)':'Per-transition override (→ next)',
  '⧉ 复制':'⧉ Duplicate', '删除状态':'Delete State', '(跟随全局)':'(inherit global)',
  '速度曲线(起步/落位)':'Speed curve (in/out)', '🔗 承接上一段(无缝)':'🔗 Continue prev (seamless)',
  '📷 本状态镜头(推拉摇移)':'📷 STATE CAMERA (pan & zoom)',
  '变焦':'Zoom', '移X':'Pan X', '移Y':'Pan Y', '旋转':'Rotate', '↺ 复位镜头':'↺ Reset Camera',
  '🔁 状态内循环(眨眼/走路)':'🔁 IN-STATE LOOP (blink / walk)',
  '＋ 循环姿态(复制当前画面)':'+ Loop pose (copy current)', '+ 循环姿态(复制当前画面)':'+ Loop pose (copy current)',
  '基姿态停留':'Base hold', '总时长':'Total (s)', '整体':'Whole', '调速':'Speed', '循环圈':'Loops', '(逐帧默认)':'(per-frame default)',
  '🌊 动态几何(停留期)':'🌊 DYNAMIC GEOMETRY (hold)',
  '频率 Hz':'Freq Hz', '波浪':'Slosh', '弹簧':'Spring', '液态线':'Liquid line', '波纹':'Ripple', '微光':'Twinkle', '边缘波':'Edge wave',
  // 🧪 实验物理(labfx):标签与 LAB_FX 表里的 label 一一对应
  '🧪 实验物理(情绪测试台)':'🧪 LAB PHYSICS (emotion test bench)',
  '每项可独立开关、可叠加(位移场相加)。滑到 0 = 关闭。悬停标签看该效果表达什么情绪。':
    'Each is independent and additive (displacement fields sum). 0 = off. Hover a label to see the emotion it carries.',
  '↺ 清空本状态实验效果':'↺ Clear lab FX (this state)',
  '⚙ 真实动力学':'⚙ REAL DYNAMICS', '🌊 流体与材质':'🌊 FLUID & MATERIAL',
  '👥 集体与指向':'👥 COLLECTIVE & DEIXIS', '🧱 结构':'🧱 STRUCTURE', '⏱ 节奏':'⏱ RHYTHM',
  '重力下垂':'Gravity sag', '浮力上浮':'Buoyancy', '膨胀/收缩':'Pressure', '心跳':'Heartbeat',
  '湍流':'Turbulence', '漩涡':'Vortex', '风':'Wind', '风向°':'Wind dir°', '粘滞':'Viscosity',
  '融化':'Melt', '蒸发':'Evaporate',
  '吸引/排斥':'Attract/Repel', '目标X':'Target X', '目标Y':'Target Y',
  '倾斜':'Lean', '倾斜°':'Lean dir°', '同步度':'Coherence',
  '碎裂':'Shatter', '结晶':'Crystallize', '结晶边数':'Crystal sides', '愤怒尖刺':'Anger spikes', '尖刺数':'Spike count', '流沙沉降':'Sand settle', '鞭梢/绳':'Whip / rope',
  '颤抖':'Tremor', '气泡':'Bubble', '沸腾':'Boil', '滴落':'Drip',
  '🖼 意象':'🖼 IMAGERY', '🌊 流体与材质·续':'🌊 FLUID & MATERIAL (cont.)',
  '阳光':'Sunshine', '落叶飘动':'Falling leaf', '飞鸟振翅':'Bird wingbeat', '悬浮漂游':'Floating',
  '波光':'Caustics', '彩虹':'Rainbow', '落雪':'Snow', '雨丝':'Rain', '烟':'Smoke', '火星':'Embers',
  '涌浪':'Swell', '翻腾':'Churn', '拉丝':'Stringy',
  '🧪 弹簧 spring(真·阻尼振荡)':'🧪 spring (true damped oscillation)',
  '🧪 预备 anticipate(先蓄力再出发)':'🧪 anticipate (wind up, then go)',
  '🧪 迟疑 hesitate(途中三次减速)':'🧪 hesitate (three slow-downs)',
  '🎯 波浪锚点(定点向外延伸)':'🎯 Wave anchor (grows outward)', '锚点X':'Anchor X', '锚点Y':'Anchor Y', '波及':'Reach',
  '细波':'Fine wave', '锯齿':'Jagged', '飞溅':'Splatter', '范围':'Range',
  '锯齿动作':'Jagged motion', '伸缩':'Pulse', '流动(电锯)':'Flow (chainsaw)', '微颤':'Quiver',
  '整段(含过渡)':'Whole (incl. transitions)', '仅停留':'Hold only', '状态':'States',
  '✦ 边缘几何(全局·重建轮廓·仅对实心/矢量形状)':'✦ EDGE GEOMETRY (global · rebuilds outline · solids/vectors)',
  '图层':'LAYERS', '矩形':'Rect', '椭圆':'Ellipse', '轮廓':'Path', '图片':'Image',
  '排列(计算式)':'ARRANGE (computed)',
  '⋯等距':'⋯space', '⋮等距':'⋮space', '=宽':'=W', '=高':'=H',
  '⧉ 左右镜像':'⧉ Mirror H', '⧉ 上下镜像':'⧉ Mirror V', '阵列':'Array', '生成':'Make',
  '┃中线':'┃CL', '━中线':'━CL', '🔗定距':'🔗Gap', '🔗等尺寸':'🔗Equal',
  '🪞对称':'🪞Mirror', '⌖对中':'⌖Center', '⟂正交':'⟂Ortho', '解除':'Unbind',
  '选中对象':'SELECTION', '（未选中 — ➤ 工具点击形状）':'(none — click a shape with ➤)',
  '(未选中 — ➤ 工具点击形状)':'(none — click a shape with ➤)',
  '宽':'W', '高':'H', '阈值':'Threshold', '黑场':'Black floor',
  '反相':'Invert', '半调':'Halftone', '彩色':'Color',
  '采样':'Sampler', '点数':'Count', '半径×':'R×', '自动':'auto',
  '➕ 添加':'➕ Add', '➖ 挖除':'➖ Subtract', '删除 (Del)':'Delete (Del)',
  '入场←':'In ←', '出场→':'Out →', '约束':'Constraint',
  '只和自己(独立)':'Self only (isolated)', '🌐 自由(可变到任意图形)':'🌐 Free (morph to any)',
  '🔒 冻结(绝不变形)':'🔒 Freeze (never morphs)', '🔗 已链接组':'🔗 Linked group',
  '② 矢量变形(木偶)':'② Vector morph (puppet)', '① 点阵溶解(墨水)':'① Dot dissolve (ink)', '③ 直切(无动画)':'③ Cut (no anim)',
  '② 矢量变形(木偶·最短路径)':'② Vector morph (puppet)',
  '🔗 链接矢量变形':'🔗 Link morph', '✂️ 解除链接':'✂️ Unlink', '🔗 融合为一个图形':'🔗 Merge into one shape',
  '🌊 整体剪影变形(合并矢量图层·不散点)':'🌊 Silhouette morph (merge vectors)',
  '文字工具':'TEXT TOOL', '字号':'Size',
  '② 采样':'② SAMPLING', '方式':'Method',
  '方格网格':'Square grid', '六角网格':'Hex grid', '泊松盘·蓝噪声':'Poisson · blue noise',
  '均匀填充·Lloyd 松弛':'Uniform · Lloyd', '智能识别·结构圆':'Smart · structure circles',
  '笔画·文字':'Strokes · text', '灰阶点画·照片':'Stipple · photo',
  '向日葵螺旋·Vogel':'Sunflower · Vogel', '同心环':'Rings', '仅轮廓':'Outline only',
  '点间距':'Spacing', '抖动':'Jitter', '点半径':'Dot R',
  '③ 引擎(全局)':'③ ENGINE (global)', '匹配':'Match',
  '最优传输(流动最匀)':'Optimal transport', '排序匹配':'Sort XY', '角度排序':'Angle sort',
  '贪心最近邻':'Greedy nearest', '随机(对照)':'Random (control)',
  '缓动':'Easing', '错峰':'Stagger', '流场':'Flow', '拉伸':'Stretch', '噪声':'Drift',
  '④ 渲染':'④ RENDER', '融合阈值':'Fuse thr', '边缘柔度':'Softness',
  '轨迹':'Paths', '洋葱皮':'Onion', '画幅线':'Frame', '车面':'Car ref', '背景透明':'Transparent BG',
  '🖋 墨水沉积(水墨)':'🖋 INK DEPOSIT (wash)', '启用墨水沉积':'Enable ink',
  '浓度':'Density', '方向°':'Angle°', '墨边':'Ink edge', '晕染':'Bleed', '偏重':'Bias', '透明':'Transparent', '墨深':'Ink dark',
  '⑤ 导出':'⑤ EXPORT', '预设':'Preset',
  '当前画布 480×480(方)':'Canvas 480×480 (square)',
  '方形 1080²(高清)':'Square 1080²', '方形 2K 2048²(推荐)':'Square 2K 2048² (rec.)',
  '方形 3000²(超清)':'Square 3000²', '方形 4K 4096²(极致·走 PNG 序列)':'Square 4K 4096² (PNG seq)',
  'LED 6模组横排 768×64':'LED 6-mod row 768×64', 'LED 6模组 3×2 384×128':'LED 6-mod 3×2 384×128',
  'LED 20模组横排 2560×64':'LED 20-mod row 2560×64', '高清 1920×1080':'HD 1920×1080', '自定义…':'Custom…',
  '等比不变形':'Fit (no distort)', '拉伸填满(LED屏)':'Stretch (LED)', '2×超采样(抗锯齿)':'2× supersample (AA)', '辉光':'Glow', '帧率':'FPS',
  '⏺ 录 WebM':'⏺ Rec WebM', '🎞 PNG 序列':'🎞 PNG Seq', '🎬 MP4':'🎬 MP4',
  // ── 长提示 / 图层面板 / 排列反馈 / 采样简称 / 缓动 ──
  '本形状已回到点阵':'Shape back to dots', '去程过渡':'To-pose trans',
  '给本状态加"循环姿态"可做眨眼/走路等微动作(在停留期间循环)':'Add loop poses for micro-motions (blink, walk) that cycle during the hold',
  '(空 — 用左侧工具画形状)':'(empty — draw with the left tools)', '双击改名':'dbl-click to rename',
  '显示/隐藏(隐藏 = 不进蒙版不出点)':'Show/hide (hidden = no dots)',
  '锁定:画布上不可选不可动(面板里仍可点)':'Lock: untouchable on canvas',
  '顶行=最上层(后画);点选 · 双击改名 · 拖动排序 · 👁显隐 · 🔒锁定':'Top = frontmost; click · dbl-click rename · drag reorder · 👁 hide · 🔒 lock',
  '拖动=擦洗时间;拖段右缘=改时长;双击停留段=编辑该状态':'Drag = scrub · edge = duration · dbl-click hold = edit state',
  '已调整图层顺序(上=前)':'Layer order changed (top = front)', '形状已锁定 — 图层面板点 🔒 解锁后再删':'Shape locked — unlock 🔒 in Layers first',
  '智能·结构圆':'Smart circles', '灰阶点画':'Stipple', '向日葵螺旋':'Sunflower', '泊松盘':'Poisson', '均匀·Lloyd':'Uniform·Lloyd',
  '回弹 backOut':'backOut', '弹性 elasticOut':'elasticOut', '弹跳 bounceOut':'bounceOut',
  '定距跟随':'gap-follow', '等尺寸':'equal-size',
  // ── 3D 预览器 ──
  '3D 车模预览':'3D Preview', '📂 工程':'📂 Project', '🚗 车模':'🚗 Model',
  '🗺 同步到编辑器':'🗺 Sync to Editor', '亮度':'Exposure', '环绕':'Orbit', '← 编辑器':'← Editor',
  '动画组(节点)与投影面':'ANIM GROUPS (NODES) & PATCHES', '➕ 投影面':'➕ Patch', '🗑 删除':'🗑 Delete',
  '🌀 环绕面(连续皮肤)':'🌀 Wrap (continuous skin)', '🧩 UV 直贴(Blender 展开)':'🧩 UV map (Blender unwrap)',
  '➕ 新动画(节点)':'➕ New Anim (node)', '属性 · 当前投影面':'PROPERTIES · ACTIVE PATCH',
  '大小':'Size', '横移':'Slide U', '纵移':'Slide V', '镜像':'Mirror', '水平':'Horizontal', '垂直':'Vertical',
  '画面分区(把动画切给各投影面)':'REGIONS (slice anim across patches)',
  '笔刷(画笔/橡皮共用)':'BRUSH (paint & eraser)', '粗细':'Size', '羽化':'Feather', '↺ 恢复全部被擦区域':'↺ Restore erased areas',
  '环绕参数 · 当前环绕面':'WRAP PARAMS · ACTIVE WRAP', '轴向':'Axis', '起始角':'Start°', '跨度':'Span', '下沿':'Lower', '上沿':'Upper',
  '🔗均分':'🔗Split', '🧲衔接':'🧲Match', '前':'F', '后':'B', '左':'L', '右':'R', '顶':'T', '背景透明':'Transparent BG',
  '模型贴图':'Model tex',
};

const KO = {
  '3D 车模预览':'3D 미리보기', '📂 工程':'📂 프로젝트', '🚗 车模':'🚗 모델', '🗺 同步到编辑器':'🗺 편집기로 동기화',
  '亮度':'노출', '环绕':'회전', '← 编辑器':'← 편집기', '动画组(节点)与投影面':'애니 그룹 & 패치',
  '➕ 投影面':'➕ 패치', '🗑 删除':'🗑 삭제', '🌀 环绕面(连续皮肤)':'🌀 랩 (연속 스킨)', '🧩 UV 直贴(Blender 展开)':'🧩 UV 매핑 (Blender)',
  '➕ 新动画(节点)':'➕ 새 애니 (노드)', '属性 · 当前投影面':'속성 · 현재 패치',
  '大小':'크기', '横移':'가로 U', '纵移':'세로 V', '镜像':'반전', '水平':'가로', '垂直':'세로',
  '画面分区(把动画切给各投影面)':'영역 (패치별 분할)', '笔刷(画笔/橡皮共用)':'브러시', '粗细':'굵기', '羽化':'페더',
  '前':'앞', '后':'뒤', '左':'좌', '右':'우', '顶':'위', '轴向':'축', '起始角':'시작각', '跨度':'범위', '模型贴图':'모델 텍스처',
  '▶ 预览序列':'▶ 미리보기', '✏ 回到编辑':'✏ 편집으로',
  '清空当前状态':'상태 지우기', '🗑 全部':'🗑 전체', '复制点集':'점 복사',
  '🖼 导入图片':'🖼 이미지 가져오기', '🚗 3D 预览':'🚗 3D 미리보기', '✒ 导入 SVG':'✒ SVG 가져오기',
  '💾 保存工程':'💾 저장', '📂 打开工程':'📂 열기',
  '＋ 新状态':'+ 새 상태', '+ 新状态':'+ 새 상태', '▶ 播放':'▶ 재생', '⏸ 暂停':'⏸ 일시정지',
  '循环':'반복', '无缝(尾→首)':'이음새 없음(끝→처음)',
  '当前状态':'현재 상태', '名称':'이름', '颜色':'색상', '背景':'배경',
  '停留 (秒)':'유지(초)', '过渡 (秒)':'전환(초)', '🧱实心':'🧱솔리드', '🖊描边':'🖊외곽선',
  '本段过渡覆盖(→ 下一状态)':'이 전환 재정의 (→ 다음)',
  '⧉ 复制':'⧉ 복제', '删除状态':'상태 삭제', '(跟随全局)':'(전역 따름)',
  '速度曲线(起步/落位)':'속도 곡선(시작/도착)', '🔗 承接上一段(无缝)':'🔗 이전 이어받기(이음새 없음)',
  '📷 本状态镜头(推拉摇移)':'📷 상태 카메라 (팬 & 줌)',
  '变焦':'줌', '移X':'이동 X', '移Y':'이동 Y', '旋转':'회전', '↺ 复位镜头':'↺ 카메라 초기화',
  '🔁 状态内循环(眨眼/走路)':'🔁 상태 내 루프 (깜빡임/걷기)',
  '＋ 循环姿态(复制当前画面)':'+ 루프 포즈(현재 복제)', '+ 循环姿态(复制当前画面)':'+ 루프 포즈(현재 복제)',
  '基姿态停留':'기본 유지', '总时长':'총 길이(초)', '整体':'전체', '调速':'속도', '循环圈':'반복 수', '(逐帧默认)':'(프레임 기본)',
  '🌊 动态几何(停留期)':'🌊 다이내믹 지오메트리 (유지)',
  '频率 Hz':'주파수 Hz', '波浪':'출렁임', '弹簧':'스프링', '液态线':'액체선', '波纹':'물결', '微光':'반짝임', '边缘波':'가장자리 파동',
  // 🧪 실험 물리(labfx)
  '🧪 实验物理(情绪测试台)':'🧪 실험 물리 (감정 테스트베드)',
  '每项可独立开关、可叠加(位移场相加)。滑到 0 = 关闭。悬停标签看该效果表达什么情绪。':
    '각 항목은 독립적이며 겹쳐집니다(변위장의 합). 0 = 끔. 라벨에 마우스를 올리면 어떤 감정인지 나옵니다.',
  '↺ 清空本状态实验效果':'↺ 이 상태의 실험 효과 초기화',
  '⚙ 真实动力学':'⚙ 실제 역학', '🌊 流体与材质':'🌊 유체와 재질',
  '👥 集体与指向':'👥 집단과 지시', '🧱 结构':'🧱 구조', '⏱ 节奏':'⏱ 리듬',
  '重力下垂':'중력 처짐', '浮力上浮':'부력', '膨胀/收缩':'압력', '心跳':'심장박동',
  '湍流':'난류', '漩涡':'소용돌이', '风':'바람', '风向°':'풍향°', '粘滞':'점성',
  '融化':'녹음', '蒸发':'증발',
  '吸引/排斥':'인력/척력', '目标X':'목표 X', '目标Y':'목표 Y',
  '倾斜':'기울기', '倾斜°':'기울기 방향°', '同步度':'동기화도',
  '碎裂':'파쇄', '结晶':'결정화', '结晶边数':'결정 변 수', '愤怒尖刺':'분노 가시', '尖刺数':'가시 수', '流沙沉降':'모래 침강', '鞭梢/绳':'채찍/밧줄',
  '颤抖':'떨림', '气泡':'거품', '沸腾':'끓음', '滴落':'물방울',
  '🖼 意象':'🖼 이미지', '🌊 流体与材质·续':'🌊 유체와 재질 (계속)',
  '阳光':'햇살', '落叶飘动':'낙엽', '飞鸟振翅':'새 날갯짓', '悬浮漂游':'부유',
  '波光':'물빛', '彩虹':'무지개', '落雪':'눈', '雨丝':'비', '烟':'연기', '火星':'불티',
  '涌浪':'너울', '翻腾':'뒤섞임', '拉丝':'실 늘어짐',
  '🧪 弹簧 spring(真·阻尼振荡)':'🧪 스프링 (실제 감쇠 진동)',
  '🧪 预备 anticipate(先蓄力再出发)':'🧪 예비 동작 (준비 후 출발)',
  '🧪 迟疑 hesitate(途中三次减速)':'🧪 망설임 (도중 3회 감속)',
  '🎯 波浪锚点(定点向外延伸)':'🎯 파동 앵커 (밖으로 확장)', '锚点X':'앵커 X', '锚点Y':'앵커 Y', '波及':'도달 범위',
  '细波':'미세 파동', '锯齿':'톱니', '飞溅':'튀김', '范围':'범위',
  '锯齿动作':'톱니 동작', '伸缩':'신축', '流动(电锯)':'흐름(전기톱)', '微颤':'미세 떨림',
  '整段(含过渡)':'전체(전환 포함)', '仅停留':'유지만', '状态':'상태',
  '✦ 边缘几何(全局·重建轮廓·仅对实心/矢量形状)':'✦ 가장자리 지오메트리 (전역 · 솔리드/벡터)',
  '图层':'레이어', '矩形':'사각형', '椭圆':'타원', '轮廓':'패스', '图片':'이미지',
  '排列(计算式)':'정렬 (계산식)',
  '⧉ 左右镜像':'⧉ 좌우 반전', '⧉ 上下镜像':'⧉ 상하 반전', '阵列':'배열', '生成':'생성', '解除':'해제',
  '选中对象':'선택', '（未选中 — ➤ 工具点击形状）':'(선택 없음 — ➤ 로 클릭)', '(未选中 — ➤ 工具点击形状)':'(선택 없음 — ➤ 로 클릭)',
  '宽':'너비', '高':'높이', '阈值':'임계값', '反相':'반전', '半调':'하프톤', '彩色':'컬러',
  '采样':'샘플링', '点数':'개수', '半径×':'반경×', '自动':'자동',
  '➕ 添加':'➕ 추가', '➖ 挖除':'➖ 빼기', '删除 (Del)':'삭제 (Del)',
  '入场←':'입장←', '出场→':'퇴장→', '约束':'제약',
  '只和自己(独立)':'자기만 (독립)', '🌐 自由(可变到任意图形)':'🌐 자유 (아무 도형으로)',
  '🔒 冻结(绝不变形)':'🔒 고정 (변형 안 함)', '🔗 已链接组':'🔗 연결된 그룹',
  '② 矢量变形(木偶)':'② 벡터 변형 (퍼펫)', '① 点阵溶解(墨水)':'① 점 분해 (잉크)', '③ 直切(无动画)':'③ 컷 (애니메이션 없음)',
  '② 矢量变形(木偶·最短路径)':'② 벡터 변형 (퍼펫)',
  '🔗 链接矢量变形':'🔗 변형 연결', '✂️ 解除链接':'✂️ 연결 해제', '🔗 融合为一个图形':'🔗 하나로 병합',
  '🌊 整体剪影变形(合并矢量图层·不散点)':'🌊 실루엣 변형 (벡터 병합)',
  '文字工具':'텍스트 도구', '字号':'크기',
  '② 采样':'② 샘플링', '方式':'방식', '仅轮廓':'외곽선만', '同心环':'동심원',
  '点间距':'간격', '抖动':'지터', '点半径':'점 반경',
  '③ 引擎(全局)':'③ 엔진 (전역)', '匹配':'매칭', '缓动':'이징',
  '错峰':'스태거', '流场':'플로우', '拉伸':'늘이기', '噪声':'노이즈',
  '④ 渲染':'④ 렌더', '融合阈值':'융합 임계', '边缘柔度':'가장자리', '辉光':'글로우', '帧率':'프레임률',
  '轨迹':'궤적', '洋葱皮':'어니언', '画幅线':'프레임', '车面':'차체 참조', '背景透明':'배경 투명',
  '🖋 墨水沉积(水墨)':'🖋 잉크 침착 (수묵)', '启用墨水沉积':'잉크 켜기',
  '浓度':'농도', '方向°':'방향°', '墨边':'잉크 가장자리', '晕染':'번짐', '偏重':'편중', '透明':'투명', '墨深':'잉크 진하기',
  '⑤ 导出':'⑤ 내보내기', '预设':'프리셋',
  '等比不变形':'비율 유지', '拉伸填满(LED屏)':'채우기(LED)', '2×超采样(抗锯齿)':'2× 슈퍼샘플(AA)',
  '⏺ 录 WebM':'⏺ WebM 녹화', '🎞 PNG 序列':'🎞 PNG 시퀀스', '🎬 MP4':'🎬 MP4', '自定义…':'사용자…',
};

// zh → lang 的正则(动态编号等);反向由 REV 提供。
const PAT = {
  en:[[/^🎬 动画片段「(.+)」· (\d+) 帧$/,'🎬 Clip "$1" · $2 frames'],[/^🧩 UV · (.+)$/,'🧩 UV · $1'],
      [/^投影面 (\d+)(.*)$/,'Patch $1$2'],[/^动画 (\d+)$/,'Anim $1'],[/^编辑「(.+)」$/,'Editing "$1"'],
      [/^预览序列 · 共 (\d+) 个状态 · 总时长 ([\d.]+)s$/,'Preview · $1 states · $2s total'],[/^(\d+) · (.+)$/,'$1 · $2']],
  ko:[[/^🎬 动画片段「(.+)」· (\d+) 帧$/,'🎬 클립 "$1" · $2 프레임'],[/^🧩 UV · (.+)$/,'🧩 UV · $1'],
      [/^投影面 (\d+)(.*)$/,'패치 $1$2'],[/^动画 (\d+)$/,'애니 $1'],[/^编辑「(.+)」$/,'편집 "$1"'],
      [/^预览序列 · 共 (\d+) 个状态 · 总时长 ([\d.]+)s$/,'미리보기 · 상태 $1개 · $2s'],[/^(\d+) · (.+)$/,'$1 · $2']],
};
const REV = {
  en:Object.fromEntries(Object.entries(EN).map(([z,e])=>[e,z])),
  ko:Object.fromEntries(Object.entries(KO).map(([z,k])=>[k,z])),
};
const REV_PAT = { // lang → zh(还原动态文案)
  en:[[/^🎬 Clip "(.+)" · (\d+) frames$/,'🎬 动画片段「$1」· $2 帧'],[/^Patch (\d+)(.*)$/,'投影面 $1$2'],[/^Anim (\d+)$/,'动画 $1'],[/^Editing "(.+)"$/,'编辑「$1」'],[/^Preview · (\d+) states · ([\d.]+)s total$/,'预览序列 · 共 $1 个状态 · 总时长 $2s']],
  ko:[[/^🎬 클립 "(.+)" · (\d+) 프레임$/,'🎬 动画片段「$1」· $2 帧'],[/^패치 (\d+)(.*)$/,'投影面 $1$2'],[/^애니 (\d+)$/,'动画 $1'],[/^편집 "(.+)"$/,'编辑「$1」'],[/^미리보기 · 상태 (\d+)개 · ([\d.]+)s$/,'预览序列 · 共 $1 个状态 · 总时长 $2s']],
};

// 任意语言文案 → 规范 zh。
function toZh(s, from){
  if(from==='zh') return s;
  if(REV[from][s]) return REV[from][s];
  for(const [re,rep] of REV_PAT[from]) if(re.test(s)) return s.replace(re,rep);
  return null; // 未知 → 无法还原
}
// 规范 zh → 目标语言。
function fromZh(zh, to){
  if(to==='zh') return zh;
  const map = to==='en'?EN:KO;
  if(map[zh]) return map[zh];
  for(const [re,rep] of PAT[to]) if(re.test(zh)) return zh.replace(re,rep);
  // KO 未收录 → 回退英文;英文未收录 → null(保持原样)
  if(to==='ko' && EN[zh]) return EN[zh];
  return null;
}
function tr(s, from, to){
  if(from===to) return null;
  const zh = toZh(s, from); if(zh===null) return null;
  const out = fromZh(zh, to);
  return (out===null || out===s) ? null : out;
}

let lang='en', busy=false, observer=null;

function translateTextNode(tn, from, to){
  const raw=tn.nodeValue; if(!raw) return;
  const t=raw.trim(); if(!t) return;
  const out=tr(t, from, to);
  if(out!==null && out!==t) tn.nodeValue=raw.replace(t,out);
}
function walk(root, from, to){
  if(root.nodeType===Node.TEXT_NODE){ translateTextNode(root,from,to); return; }
  if(root.nodeType!==Node.ELEMENT_NODE && root.nodeType!==Node.DOCUMENT_NODE) return;
  const twk=document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const list=[]; while(twk.nextNode()) list.push(twk.currentNode);
  for(const tn of list) translateTextNode(tn,from,to);
  for(const el of (root.querySelectorAll?root.querySelectorAll('*'):[]))
    for(const a of ['title','placeholder']){ const v=el.getAttribute?.(a);
      if(v){ const out=tr(v.trim(),from,to); if(out) el.setAttribute(a,out); } }
}

function setLang(l){
  if(l===lang) { markTabs(); return; }
  const from=lang; lang=l;
  try{ localStorage.setItem('morph-lang', l); }catch(_){}
  busy=true; walk(document.body, from, l); busy=false;
  markTabs();
}
const ORDER=['en','zh','ko'], LABEL={en:'🌐 EN',zh:'🌐 中',ko:'🌐 한'};
function markTabs(){
  document.querySelectorAll('#langTabs [data-lang]').forEach(b=>
    b.classList.toggle('active', b.dataset.lang===lang));
  const btn=document.getElementById('langBtn'); // 3D 预览器用单按钮循环
  if(btn) btn.textContent=LABEL[ORDER[(ORDER.indexOf(lang)+1)%3]];
}

export function initI18n(){
  let saved=null; try{ saved=localStorage.getItem('morph-lang'); }catch(_){}
  const target = saved || 'en';           // 默认英文
  const tabs=document.getElementById('langTabs');
  if(tabs) tabs.querySelectorAll('[data-lang]').forEach(b=>
    b.onclick=()=>setLang(b.dataset.lang));
  const btn=document.getElementById('langBtn'); // 无选项卡时(3D 预览器)单按钮循环 en→zh→ko
  if(btn) btn.onclick=()=>setLang(ORDER[(ORDER.indexOf(lang)+1)%3]);
  // 源文案是 zh;若目标非 zh 则从 zh 翻过去。lang 先置为 zh 以便首次翻译按 zh→target。
  lang='zh';
  observer=new MutationObserver(muts=>{
    if(busy||lang==='zh') return;         // 中文=源语言,动态内容无需翻译
    busy=true;
    for(const m of muts){
      if(m.type==='characterData') translateTextNode(m.target,'zh',lang);
      else for(const n of m.addedNodes) walk(n,'zh',lang);
    }
    busy=false;
  });
  observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  setLang(target);
}
