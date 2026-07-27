// 界面语言切换(中 ⇄ 英):字典式原地翻译 + MutationObserver 实时翻译动态内容。
// 不侵入任何业务模块 —— 文本节点/title/placeholder 命中字典即替换,动态生成的
// 图层行、提示条由观察器接手;未收录的长提示保持中文(渐进补全)。选择存 localStorage。
const EXACT = {
  // ── 编辑器顶栏/胶片条/时间轴 ──
  '▶ 预览序列':'▶ Preview', '✏ 回到编辑':'✏ Back to Edit',
  '清空当前状态':'Clear State', '🗑 全部':'🗑 All', '复制点集':'Copy Dots',
  '🖼 导入图片':'🖼 Import Image', '🚗 3D 预览':'🚗 3D Preview',
  '💾 保存工程':'💾 Save', '📂 打开工程':'📂 Open',
  '＋ 新状态':'+ New State', '▶ 播放':'▶ Play', '⏸ 暂停':'⏸ Pause',
  '循环':'Loop', '无缝(尾→首)':'Seamless (last→first)',
  // ── 当前状态 ──
  '当前状态':'CURRENT STATE', '名称':'Name', '颜色':'Color', '背景':'BG',
  '停留 (秒)':'Hold (s)', '过渡 (秒)':'Trans (s)',
  '本段过渡覆盖(→ 下一状态)':'Per-transition override (→ next)',
  '⧉ 复制':'⧉ Duplicate', '删除状态':'Delete State',
  '(跟随全局)':'(inherit global)',
  '📷 本状态镜头(推拉摇移)':'📷 STATE CAMERA (pan & zoom)',
  '变焦':'Zoom', '移X':'Pan X', '移Y':'Pan Y', '↺ 复位镜头':'↺ Reset Camera',
  // ── 图层面板 / 时间轴 ──
  '图层':'LAYERS', '矩形':'Rect', '椭圆':'Ellipse', '轮廓':'Path', '图片':'Image',
  '(空 — 用左侧工具画形状)':'(empty — draw with the left tools)',
  '双击改名':'dbl-click to rename',
  '显示/隐藏(隐藏 = 不进蒙版不出点)':'Show/hide (hidden = no dots)',
  '锁定:画布上不可选不可动(面板里仍可点)':'Lock: untouchable on canvas (panel still works)',
  '顶行=最上层(后画);点选 · 双击改名 · 拖动排序 · 👁显隐 · 🔒锁定':
    'Top = frontmost; click select · dbl-click rename · drag reorder · 👁 hide · 🔒 lock',
  '拖动=擦洗时间;拖段右缘=改时长;双击停留段=编辑该状态':
    'Drag = scrub · drag segment edge = duration · dbl-click hold = edit that state',
  '已调整图层顺序(上=前)':'Layer order changed (top = front)',
  '形状已锁定 — 图层面板点 🔒 解锁后再删':'Shape locked — unlock 🔒 in Layers first',
  // ── 选中对象 ──
  '选中对象':'SELECTION', '（未选中 — ➤ 工具点击形状）':'(none — click a shape with ➤)',
  '宽':'W', '高':'H', '阈值':'Threshold', '黑场':'Black floor',
  '反相':'Invert', '半调':'Halftone', '彩色':'Color',
  '采样':'Sampler', '点数':'Count', '半径×':'R×', '自动':'auto',
  '➕ 添加':'➕ Add', '➖ 挖除':'➖ Subtract', '删除 (Del)':'Delete (Del)',
  // ── 文字/采样/引擎/渲染/导出 ──
  '文字工具':'TEXT TOOL', '字号':'Size',
  '② 采样':'② SAMPLING', '方式':'Method',
  '方格网格':'Square grid', '六角网格':'Hex grid', '泊松盘·蓝噪声':'Poisson · blue noise',
  '均匀填充·Lloyd 松弛':'Uniform · Lloyd', '智能识别·结构圆':'Smart · structure circles',
  '笔画·文字':'Strokes · text', '灰阶点画·照片':'Stipple · photo',
  '向日葵螺旋·Vogel':'Sunflower · Vogel', '同心环':'Rings', '仅轮廓':'Outline only',
  '智能·结构圆':'Smart circles', '灰阶点画':'Stipple', '向日葵螺旋':'Sunflower', '泊松盘':'Poisson',
  '均匀·Lloyd':'Uniform·Lloyd',
  '点间距':'Spacing', '抖动':'Jitter', '点半径':'Dot R',
  '③ 引擎(全局)':'③ ENGINE (global)', '匹配':'Match',
  '最优传输(流动最匀)':'Optimal transport', '排序匹配':'Sort XY', '角度排序':'Angle sort',
  '贪心最近邻':'Greedy nearest', '随机(对照)':'Random (control)',
  '缓动':'Easing', '回弹 backOut':'backOut', '弹性 elasticOut':'elasticOut', '弹跳 bounceOut':'bounceOut',
  '错峰':'Stagger', '流场':'Flow', '拉伸':'Stretch', '噪声':'Drift',
  '④ 渲染':'④ RENDER', '融合阈值':'Fuse thr', '边缘柔度':'Softness',
  '轨迹':'Paths', '洋葱皮':'Onion', '画幅线':'Frame', '车面':'Car ref',
  '⑤ 导出':'⑤ EXPORT', '预设':'Preset',
  '当前画布 480×280':'Canvas 480×280', 'LED 6模组横排 768×64':'LED 6-mod row 768×64',
  'LED 6模组 3×2 384×128':'LED 6-mod 3×2 384×128', 'LED 20模组横排 2560×64':'LED 20-mod row 2560×64',
  '高清 1920×1080':'HD 1920×1080', '自定义…':'Custom…',
  '拉伸填满':'Stretch', '等比留黑':'Fit', '帧率':'FPS',
  '2×超采样':'2× supersample', '辉光':'Glow',
  '⏺ 录 WebM':'⏺ Rec WebM', '🎞 PNG 序列':'🎞 PNG Seq',
  // ── 3D 预览器 ──
  '3D 车模预览':'3D Car Preview', '📂 工程':'📂 Project', '🚗 车模':'🚗 Model',
  '🗺 同步到编辑器':'🗺 Sync to Editor', '亮度':'Exposure', '环绕':'Orbit',
  '← 编辑器':'← Editor',
  '动画组(节点)与投影面':'ANIM GROUPS (NODES) & PATCHES',
  '➕ 投影面':'➕ Patch', '🗑 删除':'🗑 Delete',
  '🌀 环绕面(连续皮肤)':'🌀 Wrap (continuous skin)',
  '🧩 UV 直贴(Blender 展开)':'🧩 UV map (Blender unwrap)',
  '直贴':'mapped', '失效':'invalid',
  '➕ 新动画(节点)':'➕ New Anim (node)',
  '属性 · 当前投影面':'PROPERTIES · ACTIVE PATCH',
  '大小':'Size', '旋转':'Rotate', '横移':'Slide U', '纵移':'Slide V',
  '画面分区(把动画切给各投影面)':'REGIONS (slice anim across patches)',
  '笔刷(画笔/橡皮共用)':'BRUSH (paint & eraser)', '粗细':'Size', '羽化':'Feather',
  '↺ 恢复全部被擦区域':'↺ Restore erased areas', '↺擦除':'↺ Restore',
  '环绕参数 · 当前环绕面':'WRAP PARAMS · ACTIVE WRAP',
  '轴向':'Axis', '纵轴 · 绕车一圈':'Vertical · around car', '横轴 · 跨盖过顶':'Length · over hood/roof',
  '起始角':'Start°', '跨度':'Span', '下沿':'Lower', '上沿':'Upper',
  '已放置':'placed', '未放置':'not placed', '待生成':'pending', '空':'empty',
  '🔗均分':'🔗Split', '🧲衔接':'🧲Match',
  '前':'F', '后':'B', '左':'L', '右':'R', '顶':'T',
  '🎨吸色':'🎨Pick', '🧽橡皮':'🧽Erase', '📤Blender':'📤Blender', '📤 Blender':'📤 Blender',
  '拖动 = 移动本面的取景框;拖右下角 = 缩放;点别的框 = 选中那个投影面。各面共享同一动画与时间线 —— 分区相邻,球就能跨面"跑过去"。':
    'Drag = move this patch\'s window; corner = resize; click another box = select it. All patches share one animation & timeline — adjacent regions let dots run across surfaces.',
  '快捷键:Q 选择 · W 放置 · B 画笔 · E 橡皮 · C 上色 · Ctrl+Z 撤销 · Delete 删投影面 · Esc 取消选中':
    'Keys: Q select · W place · B brush · E erase · C paint · Ctrl+Z undo · Delete remove patch · Esc deselect',
  '动画画面按"角度×高度"展开包在车身上;起始角决定接缝藏在哪(建议车尾/底部)。':
    'The animation wraps by angle × height; start angle decides where the seam hides (rear/bottom recommended).',
  // ── 常见提示 ──
  '点上方缩略图选状态编辑;▶ 预览整条序列':'Click a thumbnail above to edit; ▶ previews the sequence',
  '📍 放置工具点击车身,放上第一块投影面;或 📂 载入工程':'📍 Place tool: click the body to drop the first patch; or 📂 load a project',
  '✓ 已恢复上次编辑(自动保存)· 若要全新开始:🗑 全部':'✓ Restored last session (autosave) · start fresh with 🗑 All',
  '✓ 已恢复上次的模型与投影布局':'✓ Restored last model & patch layout',
  '✓ 工程已保存,下次 📂 打开继续':'✓ Project saved — reopen anytime with 📂',
  '✓ 工程已载入':'✓ Project loaded',
};

const PATTERNS_ZH_EN = [
  [/^🧩 UV · (.+)$/, '🧩 UV · $1'],
  [/^投影面 (\d+)(.*)$/, 'Patch $1$2'],
  [/^🌀 环绕 (\d+)$/, '🌀 Wrap $1'],
  [/^动画 (\d+)$/, 'Anim $1'],
  [/^编辑「(.+)」$/, 'Editing "$1"'],
  [/^预览序列 · 共 (\d+) 个状态 · 总时长 ([\d.]+)s$/, 'Preview · $1 states · $2s total'],
  [/^(\d+) · (.+)$/, '$1 · $2'],
];
const PATTERNS_EN_ZH = [
  [/^Patch (\d+)(.*)$/, '投影面 $1$2'],
  [/^🌀 Wrap (\d+)$/, '🌀 环绕 $1'],
  [/^Anim (\d+)$/, '动画 $1'],
  [/^Editing "(.+)"$/, '编辑「$1」'],
  [/^Preview · (\d+) states · ([\d.]+)s total$/, '预览序列 · 共 $1 个状态 · 总时长 $2s'],
];

const EXACT_EN_ZH = Object.fromEntries(Object.entries(EXACT).map(([z,e])=>[e,z]));

function tr(s, toEn){
  const exact = toEn ? EXACT[s] : EXACT_EN_ZH[s];
  if(exact) return exact;
  for(const [re,rep] of (toEn?PATTERNS_ZH_EN:PATTERNS_EN_ZH)){
    if(re.test(s)) return s.replace(re,rep);
  }
  return null;
}

let lang='zh', busy=false, observer=null;

function translateTextNode(tn, toEn){
  const raw=tn.nodeValue; if(!raw) return;
  const trimmed=raw.trim(); if(!trimmed) return;
  const out=tr(trimmed, toEn);
  if(out!==null && out!==trimmed) tn.nodeValue=raw.replace(trimmed,out);
}
function walk(root, toEn){
  if(root.nodeType===Node.TEXT_NODE){ translateTextNode(root,toEn); return; }
  if(root.nodeType!==Node.ELEMENT_NODE && root.nodeType!==Node.DOCUMENT_NODE) return;
  const twk=document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const list=[]; while(twk.nextNode()) list.push(twk.currentNode);
  for(const tn of list) translateTextNode(tn,toEn);
  const els=root.querySelectorAll ? root.querySelectorAll('*') : [];
  for(const el of els){
    for(const a of ['title','placeholder']){
      const v=el.getAttribute?.(a);
      if(v){ const out=tr(v.trim(), toEn); if(out) el.setAttribute(a,out); }
    }
  }
}

function setLang(l){
  lang=l;
  try{ localStorage.setItem('morph-lang', l); }catch(_){}
  busy=true; walk(document.body, l==='en'); busy=false;
  const btn=document.getElementById('langBtn');
  if(btn) btn.textContent = l==='en' ? '🌐 中文' : '🌐 EN';
}

export function initI18n(){
  try{ lang=localStorage.getItem('morph-lang')||'zh'; }catch(_){}
  const btn=document.getElementById('langBtn');
  if(btn) btn.onclick=()=>setLang(lang==='en'?'zh':'en');
  // 动态内容(图层行/提示条/按钮文案改写)实时翻译;自身写入靠 busy + "已翻译无匹配"双保险防环
  observer=new MutationObserver(muts=>{
    if(busy||lang!=='en') return;
    busy=true;
    for(const m of muts){
      if(m.type==='characterData') translateTextNode(m.target, true);
      else for(const n of m.addedNodes) walk(n, true);
    }
    busy=false;
  });
  observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  if(lang==='en') setLang('en');
}
