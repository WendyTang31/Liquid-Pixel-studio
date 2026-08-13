// 实验物理效果层(Lab FX):在既有「动态几何」之外新增一批可独立开关的物理质感,
// 用于验证"动效物理质感 ↔ 情绪"的映射(AV 灯语语言研究:愤怒=锯齿/飞溅,喜悦=气泡/弹簧,
// 疲惫=下垂/融化,机器=同步/棱角,人=异相/圆润)。
//
// 铁律 —— 全部是【纯解析场】:只依赖(点的基础坐标, 形体统计量 stat, 全局时间 t),
// 不做时间积分、不保存任何状态。这样任意时刻可凭空求值 → 时间轴可拖、导出确定性、预览==导出。
// 真实的弹簧/群集/碰撞/布料都是【有状态积分器】,会毁掉这个根基,故这里一律取其解析近似:
//   · 弹簧 → 阻尼振荡的闭式解(见 engine.js 的 spring 缓动)
//   · 群集/流体 → 相干正弦场、势函数的 curl(无散度,体积不塌)
//   · 碰撞/沉降 → 带地板钳位的确定性生命周期
// 质感一致,而不引入隐藏状态。
//
// 光敏红线:所有振荡频率与既有 fx 一样硬钳 ≤2.5Hz;逐点效果默认异相(coherence=0),
// 聚合亮度平滑,不产生 3–30Hz 频闪。颤抖/碎裂等"激烈"效果一律做成【位置抖动】而非亮度抖动。
//
// 与 engine.behaviorDisp 的关系:labDisp 的结果【加】在既有效果之上(同为可加位移场),
// 所以情绪混合 = 位移场的加权和,无需任何特判 —— 这正是本工具能当"情绪调音台"的原因。
const TAU = 6.283185307;
const FXB = 0.04;            // 位移基准幅度(归一化画布),与 engine.behaviorDisp 同一基准

const hash1 = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
// 逐点相位:同一坐标永远得到同一相位(与 engine.dotPhase 同构 —— 保证停留↔过渡边界零跳变)。
// coherence=0 → 各点异相(有机、活的);=1 → 相位全归零、整体同步(机械、指令、警报)。
// 这一个标量就是"圆/人 ⇄ 方/车"在【时间维度】上的表达,与采样器在空间维度上的作用互补。
const dotPh = (x, y, fx) => {
  const s = Math.sin(x * 269.5 + y * 183.3) * 43758.5453, fr = s - Math.floor(s);
  return fr * (1 - Math.min(1, Math.max(0, fx.coherence || 0)));
};

// 形体统计量:质心 + 平均半径 + 包围盒。重力/融化/沉降/气泡都需要"形体自身的尺度与上下界",
// 否则效果幅度会随图形大小失真(小图形被扯烂、大图形纹丝不动)。
// 与 centroid 一样只是"当前点集的函数",不引入状态。
export function dotsStat(dots) {
  if (!dots || !dots.length) return { cx: .5, cy: .5, rad: .25, x0: .25, y0: .25, x1: .75, y1: .75 };
  let sx = 0, sy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of dots) {
    sx += d.x; sy += d.y;
    if (d.x < x0) x0 = d.x; if (d.x > x1) x1 = d.x;
    if (d.y < y0) y0 = d.y; if (d.y > y1) y1 = d.y;
  }
  const n = dots.length, cx = sx / n, cy = sy / n;
  let sr = 0; for (const d of dots) sr += Math.hypot(d.x - cx, d.y - cy);
  return { cx, cy, rad: Math.max(0.02, sr / n), x0, y0, x1, y1 };
}
export const DEF_STAT = { cx: .5, cy: .5, rad: .25, x0: .25, y0: .25, x1: .75, y1: .75 };

// ── 效果表:UI(滑块行)、回填、监听全部由这张表驱动 ——
// 单一事实来源,新增一个效果 = 表里加一行 + labDisp 里加一个 if。
// keep:true 的项即使为 0 也要写进 fx(它们是"参数"而非"幅度",如风向、结晶边数)。
// dp = 显示小数位。
export const LAB_FX = [
  // ⚙ 真实动力学 —— 情绪的"体重与体力"
  { g: '⚙ 真实动力学', key: 'gravity', label: '重力下垂', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '重力下垂:整体向下沉,离中轴越远垂得越多(悬链线感),伴极缓沉降呼吸。表达疲惫、认输、力竭。' },
  { g: '⚙ 真实动力学', key: 'buoyancy', label: '浮力上浮', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '浮力上浮:缓慢上升并轻微摆荡,像在水里/无重力。表达轻盈、放松、走神。与「重力下垂」是同一轴的两端。' },
  { g: '⚙ 真实动力学', key: 'pressure', label: '膨胀/收缩', min: -1, max: 1, step: .05, def: 0, dp: 2,
    title: '压力:沿法线整体外胀(正)或内缩(负),外层动得多 → 像充气而不是整体平移。外胀=得意/怒气积聚,内缩=泄气/退让。' },
  { g: '⚙ 真实动力学', key: 'pulse', label: '心跳', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '心跳:lub-dub 双击式径向脉冲(不是正弦)。表达活着、紧张、临近。频率即唤醒度。' },
  // 🌊 流体与材质 —— 情绪的"材料"
  { g: '🌊 流体与材质', key: 'turbulence', label: '湍流', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '湍流:势函数的 curl → 无散度流场(体积不被压缩,这正是 curl noise 的价值)。三组不可通约频率 → 长时间不重复。表达不安、心神不宁。' },
  { g: '🌊 流体与材质', key: 'vortex', label: '漩涡', min: -1, max: 1, step: .05, def: 0, dp: 2,
    title: '漩涡:绕质心的切向场,涡核处最强、外围衰减,且缓慢正反转(恒定旋转会把点越缠越死)。表达眩晕、被吸入、困惑。' },
  { g: '🌊 流体与材质', key: 'wind', label: '风', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '风:定向推力 + 阵风包络(两条不可通约慢正弦叠加 → 时强时弱但确定),迎风面先受力。可直接映射车速。' },
  { g: '🌊 流体与材质', key: 'windDir', label: '风向°', min: 0, max: 360, step: 5, def: 0, dp: 0, keep: true,
    title: '风向(度):0=向右,90=向下,180=向左,270=向上。' },
  { g: '🌊 流体与材质', key: 'viscosity', label: '粘滞', min: 0, max: 1, step: .05, def: 0, dp: 2, keep: true,
    title: '粘滞(修饰器,只作用于本实验区效果):同时压低幅度并放慢相位 → 同一个效果变"稠"。高粘滞=沉重/迟钝/抗拒,低粘滞=轻快/易激动。' },
  { g: '🌊 流体与材质', key: 'melt', label: '融化', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '融化:越靠下流得越多(上层还挂着),触底向两侧摊开。表达崩溃、耗尽、放弃。' },
  { g: '🌊 流体与材质', key: 'evaporate', label: '蒸发', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '蒸发:逐点各自错开地上升并缩小消失、再重新长出(两端都渐变,不会"啪"地出现)。表达注意力流失、脱离、心不在焉。' },
  // 👥 集体与指向 —— 情绪的"社交朝向"
  { g: '👥 集体与指向', key: 'attract', label: '吸引/排斥', min: -1, max: 1, step: .05, def: 0, dp: 2,
    title: '吸引(正)/排斥(负):朝向或背离下面的目标点,近处更强。把目标点设成"被搭话的那个人"的方位 = 指示(deixis),这是"我说的是你"最强的表达。' },
  { g: '👥 集体与指向', key: 'attX', label: '目标X', min: 0, max: 1, step: .01, def: .5, dp: 2, keep: true,
    title: '吸引/排斥的目标点水平位置(0=左,1=右)。' },
  { g: '👥 集体与指向', key: 'attY', label: '目标Y', min: 0, max: 1, step: .01, def: .5, dp: 2, keep: true,
    title: '吸引/排斥的目标点垂直位置(0=上,1=下)。' },
  { g: '👥 集体与指向', key: 'lean', label: '倾斜', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '倾斜:底部不动、越往上偏移越大的剪切(像身体前倾)。朝某人前倾=关注/压迫,后仰=退让。' },
  { g: '👥 集体与指向', key: 'leanDir', label: '倾斜°', min: 0, max: 360, step: 5, def: 0, dp: 0, keep: true,
    title: '倾斜方向(度):0=向右,90=向下,180=向左,270=向上。' },
  { g: '👥 集体与指向', key: 'coherence', label: '同步度', min: 0, max: 1, step: .05, def: 0, dp: 2, keep: true,
    title: '同步度(修饰器):0=各点异相(有机、活的、像人),1=全体同相(机械、指令、像警报)。本区所有逐点效果(蒸发/沉降/颤抖)共用。这是"圆=人 / 方=车"在时间维度上的表达。' },
  // 🧱 结构 —— 情绪的"完整性"
  { g: '🧱 结构', key: 'shatter', label: '碎裂', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '碎裂:按角度分成 7 块碎片,各自朝不同方向错开地崩开再合拢(块与块之间刻意不连续 = 断裂感)。表达愤怒、失控、警报。是「飞溅」的刚性对应物。' },
  { g: '🧱 结构', key: 'crystallize', label: '结晶', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '结晶:把圆润边界连续推成正多边形 —— 圆(人/友善)→ 棱角(机器/敌意)的连续硬化。做成随时间推进的通道 = "耐心正在耗尽"。' },
  { g: '🧱 结构', key: 'crystalN', label: '结晶边数', min: 3, max: 12, step: 1, def: 6, dp: 0, keep: true,
    title: '结晶目标多边形的边数(3=三角最尖锐,12=接近圆)。' },
  { g: '🧱 结构', key: 'anger', label: '愤怒尖刺', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '愤怒尖刺:把圆润轮廓炸成不规则的爆炸星芒(尖角外突、谷内凹、长短不一),并随相位急促颤动 —— 圆(平静)连续硬化成尖刺(暴怒)。想要更锋利的矢量尖角,可叠加「边缘几何·锯齿」。' },
  { g: '🧱 结构', key: 'angerN', label: '尖刺数', min: 5, max: 40, step: 1, def: 12, dp: 0, keep: true,
    title: '爆炸星芒的尖刺数量(少=大而利,多=密而碎的小三角)。' },
  { g: '🧱 结构', key: 'sand', label: '流沙沉降', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '流沙:各点错开地加速下落、堆到底面停住,并在两端渐隐渐生。表达凝聚力失效、耗散、垮塌。' },
  { g: '🧱 结构', key: 'whip', label: '鞭梢/绳', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '鞭梢:相位随离锚点距离滞后 → 波从锚点向梢部传播,幅度随距离平方增长(绳/尾巴/旗)。未设「波浪锚点」时以顶部中心为锚。' },
  // ⏱ 节奏
  { g: '⏱ 节奏', key: 'tremor', label: '颤抖', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '颤抖:逐点异相的小幅高频抖动 —— 只抖【位置】不抖【亮度】,故不构成频闪;频率同样钳在 ≤2.5Hz。表达恐惧、紧绷、寒冷、强忍。' },
  { g: '⏱ 节奏', key: 'bubble', label: '气泡', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '气泡:形体内部不断生出小球上浮、到顶胀大后破掉(半径正弦包络 → 两端自然为 0)。metaball 原生效果。表达喜悦、雀跃、笑意 —— 情绪表里的"兴奋"通道。' },
  { g: '⏱ 节奏', key: 'boil', label: '沸腾', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '沸腾:更密更快更小的气泡 + 表面躁动。介于「气泡=喜悦」与「飞溅=暴怒」之间 —— 表达"还没爆发的怒气"、压力积聚。' },
  { g: '⏱ 节奏', key: 'drip', label: '滴落', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '滴落:水珠从底边脱落、按自由落体(∝t²)下坠并渐隐。表达渗漏、消耗、哀伤。' },
  // 🖼 意象 —— 不是抽象物理量,而是【一眼认得出的自然现象】。
  // 抽象质感(碎裂/粘滞)靠观众自己联想才有情绪;意象自带文化含义(阳光=善意、落叶=萧瑟),
  // 在陌生人只看半秒的路口场景里,认得出比说得准更要紧。
  { g: '🖼 意象', key: 'sunshine', label: '阳光', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '阳光:12 道光芒沿径向张开、缓慢转动并随呼吸明灭,光芒方向上的点还会微微变大。表达善意、开放、被照拂。' },
  { g: '🖼 意象', key: 'leaf', label: '落叶飘动', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '落叶:逐点各自走 8 字翻转轨迹(左右摇摆 + 上下翻面),彼此异相。表达闲散、萧瑟、随风而动。' },
  { g: '🖼 意象', key: 'bird', label: '飞鸟振翅', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '飞鸟:快下压、慢回收的不对称振翅(对称正弦只会像呼吸,不像飞),越靠外侧翅幅越大,身体反向轻微起伏。表达自由、启程、轻盈。' },
  { g: '🖼 意象', key: 'floaty', label: '悬浮漂游', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '悬浮:整体缓慢上浮并左右游移,伴随极轻微的胀缩 —— 水里的气泡群。表达失重、梦境、放空。' },
  { g: '🖼 意象', key: 'firefly', label: '萤火虫盘旋', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '萤火虫:每颗球各自绕着一个小圈盘旋(半径/转速/相位逐点不同),盘旋中心还在极缓地游移,并伴随呼吸式明灭。逐点异相 → 是一群各飞各的萤火虫,而不是整体同步摆动。表达夏夜、静谧、生命感。' },
  { g: '🖼 意象', key: 'shimmer', label: '波光', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '波光:三组交叉行波形成焦散(水面反光的网格),既位移也调亮度。表达粼粼、灵动、水边。' },
  { g: '🖼 意象', key: 'rainbow', label: '彩虹', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '彩虹:按【绝对位置】铺色相并缓慢流动(不随形体质心走 → 过渡时颜色不跳变)。唯一改颜色而不改形状的效果,可与任何效果叠加。' },
  { g: '🖼 意象', key: 'snow', label: '落雪', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '落雪:细小雪片从形体上方飘落、横向摇摆着穿过。表达寒冷、静谧、时间流逝。' },
  { g: '🖼 意象', key: 'rain', label: '雨丝', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '雨丝:快速下落的短线(每滴由 3 个递减的球连成 —— metaball 融合后就是一根雨丝)。表达阴郁、匆忙、天气。' },
  { g: '🖼 意象', key: 'smoke', label: '烟', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '烟:从形体顶部升起,边升边膨胀边淡出,并随高度左右飘。表达消散、余韵、热。' },
  { g: '🖼 意象', key: 'ember', label: '火星', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '火星:细小亮点从底部加速上窜、边升边缩灭。表达灼热、危险、余怒未消。' },
  // 🌊 流体与材质(续)
  { g: '🌊 流体与材质·续', key: 'swell', label: '涌浪', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '涌浪:整个形体上只有半个波长的长周期横向大浪 —— 是"涌"不是"抖"。表达深沉、蓄势、海。' },
  { g: '🌊 流体与材质·续', key: 'churn', label: '翻腾', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '翻腾:相邻涡胞旋向相反的涡阵(Taylor-Green,精确无散度)—— 单个漩涡只会整体转,涡阵才会"翻"。表达煮沸、暗涌、内耗。' },
  { g: '🌊 流体与材质·续', key: 'stringy', label: '拉丝', min: 0, max: 1, step: .05, def: 0, dp: 2,
    title: '拉丝:沿径向拉长、且中段变细(两端粗中间细)—— 蜂蜜/胶的黏连。表达黏着、拖泥带水、难以脱身。' },
];

// 幅度类键(不含"参数"类):只要任一 > 0 就需要求值。参数类(风向/目标点/边数/粘滞/同步度)单独放着不触发。
const AMP_KEYS = LAB_FX.filter(s => !s.keep).map(s => s.key);
const EMIT_KEYS = ['bubble', 'boil', 'drip', 'snow', 'rain', 'smoke', 'ember'];
const TINT_KEYS = ['rainbow'];   // 只改颜色,既不位移也不发射球
const DISP_KEYS = AMP_KEYS.filter(k => !EMIT_KEYS.includes(k) && !TINT_KEYS.includes(k));

export const hasLabFx = fx => { if (!fx) return false; for (const k of AMP_KEYS) if (fx[k]) return true; return false; };
export const hasLabDisp = fx => { if (!fx) return false; for (const k of DISP_KEYS) if (fx[k]) return true; return false; };
export const hasLabEmit = fx => { if (!fx) return false; for (const k of EMIT_KEYS) if (fx[k]) return true; return false; };

// 湍流的势函数:三组不可通约的空间频率。curl(∂ψ/∂y, −∂ψ/∂x) 天然无散度 → 点不会被压缩成团。
const OCT_A = [1, 0.5, 0.25], OCT_X = [7.3, 13.7, 23.1], OCT_Y = [6.1, 17.3, 11.9], OCT_W = [1, 1.73, 2.61];
const TNORM = 1 / OCT_A.reduce((s, A, k) => s + A * Math.max(OCT_X[k], OCT_Y[k]), 0);

// ── 主位移场:返回【增量】{dx,dy,rf},由 engine 加到既有效果之上。──
// x,y = 点的基础坐标(归一化);cx,cy = 形体质心;st = dotsStat;t = 全局时间(秒)。
// wIn(可选):engine 传入的【连续相位】(=2π·Ψ(g),已把每帧的 fx.freq 变频积分进去)——
// 传入时物理振荡与主效果共用同一相位:过渡变频平滑(chirp)、不"打拍子"、确定且预览==导出。
// 不传则退回墙钟相位(2π·freq·t),旧行为完全不变。粘滞仍作为本层的相位/幅度缩放叠加其上。
export function labDisp(x, y, cx, cy, t, fx, st, wIn) {
  let dx = 0, dy = 0, rf = 1;
  if (!hasLabDisp(fx)) return { dx, dy, rf };
  st = st || DEF_STAT;
  const vis = Math.min(1, Math.max(0, fx.viscosity || 0));
  // 粘滞:放慢相位 + 压低幅度 = 同一个动作变"稠"。只作用于本层,不改既有 fx 的语义。
  const fbase = Math.min(2.5, fx.freq || 0.6);
  const cyc = (wIn != null ? wIn / TAU : fbase * t) * (1 - 0.7 * vis); // 已含粘滞的"圈数"(生命周期相位用)
  const w = TAU * cyc;
  const rad = Math.max(0.02, st.rad), hSpan = Math.max(1e-6, st.y1 - st.y0);

  if (fx.gravity) { // 悬链线式下垂:离中轴越远垂得越多,叠极缓沉降呼吸(静止的下垂读作"坏了",会动才读作"累了")
    const hx = Math.min(1, Math.abs(x - cx) / rad);
    dy += fx.gravity * FXB * 2.2 * (0.25 + 0.75 * hx * hx) * (0.85 + 0.15 * Math.sin(w));
  }
  if (fx.buoyancy) { // 上浮 + 侧向摆荡(纯上浮像整体平移,加摆荡才有"浮在液体里"的质感)
    const a = fx.buoyancy * FXB * 1.6;
    dy -= a * (0.6 + 0.4 * Math.sin(w));
    dx += a * 0.35 * Math.sin(0.7 * w + 3.1 * (y - cy) / rad);
  }
  if (fx.pressure) { // 沿径向充气/泄气:幅度 ∝ 离质心距离 → 外层动得多,才像"胀"而不是"整体挪"
    const rx = x - cx, ry = y - cy, d = Math.hypot(rx, ry) + 1e-6;
    const k = fx.pressure * FXB * 1.8 * (0.5 + 0.5 * Math.sin(w)) * (d / rad);
    dx += rx / d * k; dy += ry / d * k;
  }
  if (fx.pulse) { // lub-dub 双击:两个错开的高斯冲击,而非正弦 —— 正弦读作"呼吸",双击才读作"心跳"
    const rx = x - cx, ry = y - cy, d = Math.hypot(rx, ry) + 1e-6;
    const ph = ((cyc % 1) + 1) % 1;
    const thump = s => Math.exp(-Math.pow((ph - s) / 0.055, 2));
    const k = fx.pulse * FXB * 1.5 * (thump(0.06) + 0.62 * thump(0.20)) * (0.35 + 0.65 * d / rad);
    dx += rx / d * k; dy += ry / d * k;
  }
  if (fx.turbulence) { // 势函数的 curl:解析可导、精确无散度,比噪声网格便宜一个数量级
    let vx = 0, vy = 0;
    for (let k = 0; k < 3; k++) {
      const c = Math.cos(OCT_X[k] * x + OCT_Y[k] * y + OCT_W[k] * w);
      vx += OCT_A[k] * OCT_Y[k] * c; vy -= OCT_A[k] * OCT_X[k] * c;
    }
    const a = fx.turbulence * FXB * 1.4 * TNORM;
    dx += a * vx; dy += a * vy;
  }
  if (fx.vortex) { // 涡核:exp 衰减 × 线性增长 → 中间某个半径最强(真实涡的速度剖面)
    const rx = x - cx, ry = y - cy, d = Math.hypot(rx, ry) + 1e-6;
    const k = fx.vortex * FXB * 1.8 * Math.exp(-d / (rad * 0.9)) * (d / rad) * Math.sin(w * 0.5 + 1.2);
    dx += -ry / d * k; dy += rx / d * k;
  }
  if (fx.wind) { // 阵风 + 迎风面先受力(相位随沿风向的投影滞后)→ 有"吹过去"的时间差,而非整体平移
    const ang = (fx.windDir || 0) * Math.PI / 180;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const gust = 0.45 + 0.35 * Math.sin(w * 0.37) + 0.20 * Math.sin(w * 0.91 + 2.1);
    const lead = ((x - cx) * ca + (y - cy) * sa) / rad;
    const k = fx.wind * FXB * 2.0 * gust * (1 + 0.35 * Math.sin(w - 1.6 * lead));
    dx += ca * k; dy += sa * k;
  }
  if (fx.melt) { // 越靠下流得越多(上层还挂着),触底朝两侧摊开
    const depth = Math.min(1, Math.max(0, (y - st.y0) / hSpan)), flow = depth * depth;
    const a = fx.melt * FXB * 3.0;
    dy += a * flow * (0.7 + 0.3 * Math.sin(w * 0.5 + 4 * x));
    dx += a * 0.5 * flow * Math.sign(x - cx || 1) * Math.abs(Math.sin(w * 0.31 + 2.7 * x));
  }
  if (fx.evaporate) { // 逐点错开的生命周期:渐生 → 上升 → 渐隐。两端都渐变,故不会"啪"地出现/消失
    const ph = dotPh(x, y, fx), life = ((cyc * 0.5 + ph) % 1 + 1) % 1;
    const visible = Math.min(1, life / 0.12) * Math.min(1, (1 - life) / 0.35);
    dy -= fx.evaporate * FXB * 6 * life * life;
    rf *= 1 - fx.evaporate * (1 - visible);
  }
  if (fx.attract) { // 指示(deixis):把目标点放在"被搭话的人"的方位,整块朝他倾去 = "我说的是你"
    const ax = fx.attX == null ? .5 : fx.attX, ay = fx.attY == null ? .5 : fx.attY;
    const rx = ax - x, ry = ay - y, d = Math.hypot(rx, ry) + 1e-6;
    const k = fx.attract * FXB * 2.5 * (0.4 + 0.6 * Math.min(1, rad / d)) * (0.75 + 0.25 * Math.sin(w));
    dx += rx / d * k; dy += ry / d * k;
  }
  if (fx.lean) { // 底部固定的剪切 = 身体前倾/后仰,而不是整体平移(平移没有"姿态"的意思)
    const ang = (fx.leanDir || 0) * Math.PI / 180;
    const h = Math.min(1, Math.max(0, (st.y1 - y) / hSpan));
    const k = fx.lean * FXB * 3.0 * h * (0.8 + 0.2 * Math.sin(w * 0.5));
    dx += Math.cos(ang) * k; dy += Math.sin(ang) * k;
  }
  if (fx.shatter) { // 按角度切 7 块,各块整体错开地崩开再合拢。块与块之间【刻意不连续】—— 那就是断裂
    const rx = x - cx, ry = y - cy, d = Math.hypot(rx, ry) + 1e-6;
    const CELLS = 7, s = ((Math.atan2(ry, rx) / TAU) % 1 + 1) % 1, cell = Math.floor(s * CELLS);
    const hh = hash1(cell * 3.77 + 1);
    const ang = (cell + 0.5) / CELLS * TAU + (hh - 0.5) * 0.7;
    const env = Math.max(0, Math.sin(w * 0.5 + hh * TAU));
    const k = fx.shatter * FXB * 4.0 * (0.45 + 0.55 * hh) * env * (0.3 + 0.7 * d / rad);
    dx += Math.cos(ang) * k; dy += Math.sin(ang) * k;
  }
  if (fx.crystallize) { // 正 N 边形的极半径:边中点被压进去、顶点留在外 → 圆连续变成多边形
    const N = Math.max(3, Math.round(fx.crystalN || 6));
    const rx = x - cx, ry = y - cy, d = Math.hypot(rx, ry) + 1e-6;
    const seg = TAU / N, th = Math.atan2(ry, rx);
    const poly = Math.cos(seg / 2) / Math.cos(((th % seg) + seg) % seg - seg / 2);
    const k = fx.crystallize * (poly - 1) * d * (0.85 + 0.15 * Math.sin(w * 0.4));
    dx += rx / d * k; dy += ry / d * k;
  }
  if (fx.anger) { // 愤怒尖刺:极径按角度被推成【直边尖角】的不规则星芒 —— 尖处外突、谷处内凹、每根刺长短不一。
    // 纯静态定型:不含任何时间项 → 尖刺长度固定不抖(如动画暂停);跨关键帧变形时仍由过渡平滑增减。
    const rx = x - cx, ry = y - cy, d = Math.hypot(rx, ry) + 1e-6, th = Math.atan2(ry, rx);
    const N = Math.max(3, Math.round(fx.angerN || 10));
    const s = ((th / TAU) % 1 + 1) % 1, cell = Math.floor(s * N), frac = s * N - cell;
    const tent = 1 - Math.abs(2 * frac - 1);           // 三角波:0(两刺间的谷)→ 1(刺尖)
    const zig = tent * 2 - 1;                           // −1(谷)→ +1(尖)的纯三角波:直边尖角(而非圆润花瓣)
    const jit = 0.3 + 0.7 * hash1(cell * 3.37 + 1);     // 每根刺长短不一(由 cell 哈希 → 固定,不随时间变)
    const edge = d / rad;                               // 外层动得多、内核几乎不动 → 只把"轮廓"扎成星
    const k = fx.anger * FXB * 4.5 * zig * jit * edge;  // 无时间项 → 星形静止,尖处外突、谷处内凹
    dx += rx / d * k; dy += ry / d * k;
  }
  if (fx.sand) { // 加速下落 + 地板钳位 + 两端渐隐渐生(否则循环回卷时会"啪"地弹回原位)
    const ph = dotPh(x, y, fx), rate = 0.55 + 0.9 * hash1(ph * 91.7 + 5);
    const life = ((cyc * 0.4 * rate + ph) % 1 + 1) % 1;
    const floor = st.y1 + 0.02, room = Math.max(0, floor - y);
    const visible = Math.min(1, life / 0.10) * Math.min(1, (1 - life) / 0.25);
    dy += fx.sand * Math.min(room, life * life * room * 1.6);
    dx += fx.sand * FXB * 0.25 * Math.sin(ph * TAU + w * 0.3) * life * life;
    rf *= 1 - fx.sand * (1 - visible);
  }
  if (fx.whip) { // 相位随离锚点距离滞后 → 波从锚点向梢部【传播】;幅度 ∝ 距离² → 梢部甩得最狠
    const ax = fx.anchor ? fx.anchor.x : cx, ay = fx.anchor ? fx.anchor.y : st.y0;
    const rx = x - ax, ry = y - ay, d = Math.hypot(rx, ry) + 1e-6;
    const s = Math.min(1.5, d / rad);
    const k = fx.whip * FXB * 3.5 * s * s * Math.sin(w - 2.4 * s);
    dx += -ry / d * k; dy += rx / d * k;
  }
  if (fx.tremor) { // 只抖【位置】不抖【亮度】→ 不构成频闪;频率同样钳 ≤2.5Hz,逐点异相
    const ph = dotPh(x, y, fx), a = fx.tremor * FXB * 0.9;
    dx += a * Math.sin(w + ph * TAU);
    dy += a * Math.cos(w * 1.15 + ph * TAU * 1.7);
  }

  // ── 🖼 意象组 ──
  if (fx.sunshine) { // 12 道光芒瓣:cos 的高次幂把花瓣收尖(否则是软软的椭圆,不像"射线")
    const rx = x - cx, ry = y - cy, d = Math.hypot(rx, ry) + 1e-6, th = Math.atan2(ry, rx);
    const ray = Math.pow(0.5 + 0.5 * Math.cos(12 * (th - w * 0.06)), 3);
    const k = fx.sunshine * FXB * 2.4 * ray * (0.5 + 0.5 * Math.sin(w * 0.5)) * (0.3 + 0.7 * d / rad);
    dx += rx / d * k; dy += ry / d * k;
    rf *= 1 + fx.sunshine * 0.25 * ray;              // 光芒方向上的点也更亮更大
  }
  if (fx.leaf) { // 8 字翻转:左右摇摆的频率是上下翻面的一半 —— 这个 2:1 才是"叶子在翻",否则只是平移
    const ph = dotPh(x, y, fx), a = fx.leaf * FXB * 2.4, s = w * 0.6 + ph * TAU;
    dx += a * (Math.sin(s) + 0.4 * Math.sin(2.3 * s + 1.1));
    dy += a * 0.5 * Math.sin(2 * s);
  }
  if (fx.bird) { // 不对称振翅:快下压(35% 周期)、慢回收(65%)。对称正弦读作呼吸,不对称才读作飞
    const a = fx.bird * FXB * 3.0, wing = Math.min(1, Math.abs(x - cx) / rad);
    const ph = ((cyc % 1) + 1) % 1;
    const flap = ph < 0.35 ? Math.sin(Math.PI * ph / 0.35) : -0.7 * Math.sin(Math.PI * (ph - 0.35) / 0.65);
    dy -= a * flap * Math.pow(wing, 1.5);            // 翅尖幅度最大
    dy += a * 0.25 * flap * (1 - wing);              // 身体反向起伏(振翅的反作用)
  }
  if (fx.floaty) { // 缓慢上浮 + 侧向游移 + 极轻微胀缩,逐点异相 → 一群各自漂着的气泡
    const ph = dotPh(x, y, fx), a = fx.floaty * FXB * 2.0;
    dy -= a * (0.5 + 0.5 * Math.sin(w * 0.5 + ph * TAU));
    dx += a * 0.6 * Math.sin(w * 0.37 + ph * TAU * 1.4);
    rf *= 1 + fx.floaty * 0.12 * Math.sin(w * 0.7 + ph * TAU);
  }
  // 🪰 萤火虫【不在这里施加】—— 它是【刚性】效果,必须整单位同向移动,不能逐像素算,
  // 否则同一个图形的不同部位被推向不同方向,形状就被撕碎了。见 fireflyDisp,由调用方按"单位"施加:
  // 点阵里一个点=一个单位;实心/矢量里【整个图形】=一个单位。
  if (fx.shimmer) { // 三组交叉行波 = 焦散网格(水面反光);既推点也调亮度,亮度部分让它"闪"
    const a = fx.shimmer * FXB * 1.2;
    const p = Math.sin(9.1 * x + w * 0.8) + Math.sin(7.7 * y - w * 0.63) + Math.sin(6.3 * (x + y) + w * 0.45);
    dx += a * 0.5 * Math.cos(9.1 * x + w * 0.8);
    dy += a * 0.5 * Math.cos(7.7 * y - w * 0.63);
    rf *= 1 + fx.shimmer * 0.22 * (p / 3);
  }
  // ── 🌊 流体与材质(续)──
  if (fx.swell) { // 长波:整个形体只容得下半个波 → 是"涌"不是"抖"
    const a = fx.swell * FXB * 2.6, u = 2.4 * (x - cx) / rad - w * 0.5;
    dy += a * Math.sin(u); dx += a * 0.3 * Math.cos(u);
  }
  if (fx.churn) { // Taylor-Green 涡阵:相邻胞旋向相反,且精确无散度(∂dx/∂x + ∂dy/∂y = 0)
    const a = fx.churn * FXB * 2.0, k = 5.0;
    dx += a * Math.sin(k * x) * Math.cos(k * y + w * 0.5);
    dy -= a * Math.cos(k * x) * Math.sin(k * y + w * 0.5);
  }
  if (fx.stringy) { // 沿径向拉长 + 中段变细:两端粗中间细才是"丝",等粗只是被拉远
    const rx = x - cx, ry = y - cy, d = Math.hypot(rx, ry) + 1e-6, s = Math.min(1, d / rad);
    const k = fx.stringy * FXB * 3.0 * s * (0.6 + 0.4 * Math.sin(w * 0.4));
    dx += rx / d * k; dy += ry / d * k;
    rf *= 1 - fx.stringy * 0.45 * Math.sin(Math.PI * s);
  }

  if (vis) { const damp = 1 - 0.55 * vis; dx *= damp; dy *= damp; }
  return { dx, dy, rf };
}

// 🪰 萤火虫(刚性位移):对一个【单位】整体施加同一个位移 —— 单位内部处处相同,故形状完全不变形。
// kx,ky = 该单位的身份键:点阵里传点自身坐标(每点一只萤火虫);实心/矢量里传【图形质心】
//         (整个图形作为一只萤火虫盘旋)。键决定它自己的半径/转速/相位,故各飞各的且恒定不抖。
// 返回归一化画布单位的 {dx,dy,rf};关闭时精确返回零位移、单位半径。
export function fireflyDisp(kx, ky, t, fx, wIn){
  if(!fx || !fx.firefly) return { dx:0, dy:0, rf:1 };
  const vis = Math.min(1, Math.max(0, fx.viscosity || 0));
  const fbase = Math.min(2.5, fx.freq || 0.6);                 // 光敏红线:同样硬钳 ≤2.5Hz
  const cyc = (wIn != null ? wIn / TAU : fbase * t) * (1 - 0.7 * vis);
  const w = TAU * cyc;
  const ph = dotPh(kx, ky, fx);                                // 逐单位异相(coherence=1 才整体同步)
  const a = fx.firefly * FXB * 1.6;
  const rad  = 0.45 + 0.55 * hash1(ph * 61.7 + 5);             // 每只自己的盘旋半径
  const spin = w * (0.7 + 0.6 * hash1(ph * 37.1 + 2)) + ph * TAU; // 每只自己的转速与起始角
  let dx = a * rad * Math.cos(spin);                            // 同频 x/y 正交 = 真圆周盘旋
  let dy = a * rad * Math.sin(spin);
  dx += a * 0.6 * Math.sin(w * 0.21 + ph * 4.1);                // 盘旋中心极缓游移
  dy += a * 0.6 * Math.cos(w * 0.17 + ph * 5.3);
  return { dx, dy, rf: 1 + fx.firefly * 0.4 * Math.sin(w * 0.8 + ph * TAU) };
}
export const hasFirefly = fx => !!(fx && fx.firefly);

// ── 彩虹:唯一只改【颜色】的效果 ──
// 色相按【绝对坐标】铺开,而不是相对形体质心 —— 相对质心的话,过渡期质心一移动,
// 整片颜色会跟着滑,端点还会跳变。绝对坐标下颜色是空间里固定的一层,任何形变都不影响连续性。
export function labTint(x, y, t, fx) {
  const f = Math.min(2.5, fx.freq || 0.6);
  return hsv(((x * 0.85 + y * 0.28 + t * f * 0.06) % 1 + 1) % 1, 0.85, 1);
}
// strength = 过渡期的交叉淡化系数(与实心场/发射器用同一个 e),端点精确归零。
export function applyLabTint(balls, fx, t, strength, baseRGB) {
  if (!fx || !fx.rainbow || strength <= 1e-3) return;
  const s = Math.min(1, fx.rainbow * strength);
  for (const b of balls) {
    const c = labTint(b.x, b.y, t, fx), base = b.c || baseRGB;
    b.c = [base[0] + (c[0] - base[0]) * s, base[1] + (c[1] - base[1]) * s, base[2] + (c[2] - base[2]) * s];
  }
}
function hsv(h, s, v) {
  const i = Math.floor(h * 6), f2 = h * 6 - i, p = v * (1 - s), q = v * (1 - f2 * s), u = v * (1 - (1 - f2) * s);
  const [r, g, b] = [[v, u, p], [q, v, p], [p, v, u], [p, q, v], [u, p, v], [v, p, q]][i % 6];
  return [r * 255, g * 255, b * 255];
}

// ── 发射器:产生【额外的球】而非位移(气泡/沸腾/滴落本质是"多出来的物质")。──
// fade 用于过渡期按状态交叉淡化(离场 1→0、入场 0→1),半径乘 fade → 端点精确归零,与停留段严丝合缝。
// 所有槽位的周期/相位/水平位置都由 hash 定死 → 确定性,拖时间轴与导出完全一致。
// 亮度安全:各槽异相且半径包络两端为 0,聚合亮度平滑,不产生频闪。
function emitBubbles(out, g, slots, rate, rmax, f, t, st, fade) {
  for (let k = 0; k < slots; k++) {
    const per = 0.9 + 1.8 * hash1(k * 5.31 + 1), phase = hash1(k * 5.31 + 2), lane = hash1(k * 5.31 + 3);
    const life = ((t * f * rate / per + phase) % 1 + 1) % 1;
    const x = st.x0 + (st.x1 - st.x0) * (0.12 + 0.76 * lane) + 0.012 * Math.sin(life * TAU * 1.5 + phase * TAU);
    const y = st.y1 - (st.y1 - st.y0) * life;              // 底 → 顶
    const r = g * rmax * Math.sin(Math.PI * life) * fade;   // 先胀后破,两端为 0 = 自然生灭
    if (r > 1e-4) out.push({ x, y, r });
  }
}
function emitDrips(out, g, slots, f, t, st, fade) {
  for (let k = 0; k < slots; k++) {
    const per = 1.1 + 2.0 * hash1(k * 9.17 + 1), phase = hash1(k * 9.17 + 2), lane = hash1(k * 9.17 + 3);
    const life = ((t * f * 0.6 / per + phase) % 1 + 1) % 1;
    const x = st.x0 + (st.x1 - st.x0) * (0.15 + 0.7 * lane);
    const y = st.y1 + life * life * 0.42;                   // 自由落体 ∝ t²
    const r = g * 0.026 * Math.min(1, life * 8) * Math.min(1, (1 - life) * 2.2) * fade;
    if (r > 1e-4) out.push({ x, y, r });
  }
}
// 天气类发射器:粒子从形体【外面】穿过或升起,所以生成范围按包围盒外扩。
// 生命周期两端都做渐生渐隐(min(1,life*k) × min(1,(1-life)*k)),否则循环回卷时会"啪"地闪现。
function emitFalling(out, g, slots, seed, rate, rr, sway, f, t, st, fade, up) {
  const w0 = st.x1 - st.x0, span = (st.y1 - st.y0) + 0.55;
  for (let k = 0; k < slots; k++) {
    const per = 0.9 + 2.4 * hash1(k * seed + 1), phase = hash1(k * seed + 2), lane = hash1(k * seed + 3);
    const life = ((t * f * rate / per + phase) % 1 + 1) % 1;
    const x = st.x0 - 0.09 + (w0 + 0.18) * lane + sway * Math.sin(life * TAU * 2 + phase * TAU);
    const y = up ? st.y1 + 0.12 - span * life : st.y0 - 0.24 + span * life;
    const r = g * rr * Math.min(1, life * 9) * Math.min(1, (1 - life) * 6) * fade;
    if (r > 1e-4) out.push({ x, y, r });
  }
}
function emitRain(out, g, slots, f, t, st, fade) {
  const w0 = st.x1 - st.x0, span = (st.y1 - st.y0) + 0.6;
  for (let k = 0; k < slots; k++) {
    const per = 0.5 + 0.5 * hash1(k * 7.77 + 1), phase = hash1(k * 7.77 + 2), lane = hash1(k * 7.77 + 3);
    const life = ((t * f * 1.2 / per + phase) % 1 + 1) % 1;
    const x = st.x0 - 0.08 + (w0 + 0.16) * lane, y = st.y0 - 0.3 + span * life;
    const r = g * 0.010 * Math.min(1, life * 12) * Math.min(1, (1 - life) * 8) * fade;
    if (r <= 1e-4) continue;
    // 一滴雨 = 3 个递减的球连成一条 —— metaball 融合后就是一根雨丝,不用另加"线"这种图元
    for (let s = 0; s < 3; s++) out.push({ x, y: y - s * 0.022, r: r * (1 - s * 0.28) });
  }
}
function emitSmoke(out, g, slots, f, t, st, fade) {
  for (let k = 0; k < slots; k++) {
    const per = 1.6 + 2.2 * hash1(k * 11.3 + 1), phase = hash1(k * 11.3 + 2), lane = hash1(k * 11.3 + 3);
    const life = ((t * f * 0.4 / per + phase) % 1 + 1) % 1;
    const x = st.x0 + (st.x1 - st.x0) * (0.3 + 0.4 * lane) + 0.09 * Math.sin(life * 3.1 + phase * TAU) * life;
    const y = st.y0 - life * 0.42;
    const r = g * (0.012 + 0.05 * life) * (1 - life) * Math.min(1, life * 8) * fade; // 边升边胀边淡
    if (r > 1e-4) out.push({ x, y, r });
  }
}
function emitEmber(out, g, slots, f, t, st, fade) {
  for (let k = 0; k < slots; k++) {
    const per = 1.1 + 1.7 * hash1(k * 17.1 + 1), phase = hash1(k * 17.1 + 2), lane = hash1(k * 17.1 + 3);
    const life = ((t * f * 0.7 / per + phase) % 1 + 1) % 1;
    const x = st.x0 + (st.x1 - st.x0) * (0.15 + 0.7 * lane) + 0.05 * Math.sin(life * 7 + phase * TAU);
    const y = st.y1 - (st.y1 - st.y0 + 0.3) * life * (0.6 + 0.4 * life);   // 加速上窜
    const r = g * 0.011 * (1 - life) * Math.min(1, life * 12) * fade;
    if (r > 1e-4) out.push({ x, y, r });
  }
}
export function labEmit(fx, t, st, fade) {
  const out = [];
  if (!fx || fade <= 1e-3 || !hasLabEmit(fx)) return out;
  st = st || DEF_STAT;
  const vis = Math.min(1, Math.max(0, fx.viscosity || 0));
  const f = Math.min(2.5, fx.freq || 0.6) * (1 - 0.7 * vis);
  if (fx.bubble) emitBubbles(out, fx.bubble, 9, 1.0, 0.032, f, t, st, fade);
  if (fx.boil) emitBubbles(out, fx.boil, 18, 2.0, 0.015, f, t, st, fade);
  if (fx.drip) emitDrips(out, fx.drip, 7, f, t, st, fade);
  if (fx.snow) emitFalling(out, fx.snow, 22, 3.91, 0.35, 0.012, 0.03, f, t, st, fade, false);
  if (fx.rain) emitRain(out, fx.rain, 20, f, t, st, fade);
  if (fx.smoke) emitSmoke(out, fx.smoke, 12, f, t, st, fade);
  if (fx.ember) emitEmber(out, fx.ember, 16, f, t, st, fade);
  return out;
}
