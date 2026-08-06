// 集中式可变状态。legacy 里散落的全局(states/active/sel/mode/g/…)在这里聚成一个对象,
// 各模块共享同一引用,读写即时可见。纯函数模块(samplers/engine/render)不引它 —— 它们
// 只接受显式入参,保证"任意 g 可凭空求值"的引擎铁律不被隐藏状态破坏。
export const store = {
  states:[], active:0, sel:null,   // 状态序列 / 当前编辑索引 / 当前选中形状(主选中)
  selMulti:[],                     // 多选集合(Shift+点选 / 框选;排列工具的作用对象)
  selStates:[],                    // 关键帧多选(胶片条 Shift+点选;复制/粘贴/整体缩放移动的作用对象)
  stateId:1, shapeId:1,            // 自增 id 分配器
  mode:'edit', playing:false,      // edit | play;play 下是否在走时间
  g:0, clock:0, last:0,            // 序列时间 / 单调墙钟(驱动漂移)/ 上帧时刻
  SEQ:{segs:[],T:0}, seqDirty:true,// 构建好的序列 + 脏标记
  undoStack:[], redoStack:[],
  hideOverlays:false,              // 录制/导出时隐藏洋葱皮等叠加层
  dragAct:null, dragStart:null, dragNow:null,
  penPts:null, penCursor:null,       // 贝塞尔钢笔:正在放置的锚点数组 + 当前光标(橡皮筋预览)
  view:{z:1, ox:0, oy:0},            // 画布视口(归一化):缩放 z + 左上角 ox/oy;可见区=[ox,ox+1/z]²
  panning:false, spaceHeld:false,    // 平移中 / 空格按住(空格+拖=平移)
  recorder:null, chunks:[], exporting:false,
  // 🚶 角色(并行动画轨):每个 = 一段导入的循环动画(如走路小人),独立循环 + X/Y 位移,
  // 全部同时合成到画面。不挤占主时间轴 → 用轻量结构管理多个小人。见 characters.js。
  characters:[], charSeq:0, activeChar:-1,
};

// 当前编辑状态。到处都要用,单独导出一个取值器。
export const cur = () => store.states[store.active];
