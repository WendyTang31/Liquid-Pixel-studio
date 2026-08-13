// 导出目标【互斥】:🔩P2 / 🧩取景框 / 📐宽画幅 / 🖥输出变换(warp)—— 一次只启用一个。
// 它们都在导出末端重排/裁切/变换画面,叠加会互相打架(尺寸错乱、内容被二次裁),故启用一个即自动关掉其余。
import { P } from '../config.js';
import { $ } from '../utils.js';

const MODES=[
  { id:'p2On',     panel:'p2Panel',     off:()=>{ P.p2Export=false; } },
  { id:'uvCropOn', panel:'uvCropPanel', off:()=>{ if(P.uvCrop) P.uvCrop.on=false; } },
  { id:'wideOn',   panel:'widePanel',   off:()=>{ P.wideExport=false; } },
  { id:'outTxOn',  panel:'outTxPanel',  off:()=>{ if(P.outTx) P.outTx.on=false; } },
];
// 启用 keepId 这个模式时,关掉其余所有(P 标志 + 勾选框 + 折叠面板)。
export function exclusiveExportMode(keepId){
  for(const m of MODES){
    if(m.id===keepId) continue;
    m.off();
    const cb=$(m.id); if(cb) cb.checked=false;
    const p=$(m.panel); if(p) p.style.display='none';
  }
}
