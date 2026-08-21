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

// 🔄 打开工程/恢复会话后,把导出相关 UI 从 P 重新同步一遍。
// 根治「界面显示未勾选,导出却按存档里隐藏的旧设置走」:各面板只在启动时读一次 P,
// 之后 applyParams 改了 P,界面不知道 —— 导出 1500×600 拉伸而预设显示 2048² 就是这么来的。
export function syncExportUIFromP(){
  const flags={ p2On:!!P.p2Export, uvCropOn:!!(P.uvCrop&&P.uvCrop.on),
                wideOn:!!P.wideExport, outTxOn:!!(P.outTx&&P.outTx.on) };
  for(const m of MODES){
    const on=flags[m.id];
    const cb=$(m.id); if(cb) cb.checked=on;
    const p=$(m.panel); if(p) p.style.display=on?'':'none';
  }
  const set=(id,v)=>{ const el=$(id); if(el!=null && v!=null) el.value=v; };
  const ck =(id,v)=>{ const el=$(id); if(el) el.checked=!!v; };
  // 输出变换字段
  const t=P.outTx||{};
  set('outTxW',t.w); set('outTxH',t.h); set('outTxFit',t.fit||'fit');
  set('outTxRot',String(t.rot||0)); set('outTxSymMir',t.symMirror||'off');
  ck('outTxMirX',t.mirX); ck('outTxMirY',t.mirY); ck('outTxWarp',t.warp);
  set('outTxSx',Math.round((t.sx??1)*100)); set('outTxSy',Math.round((t.sy??1)*100));
  const sr=$('outTxScaleRow'); if(sr) sr.style.display=(t.fit==='manual')?'':'none';
  if($('outTxGrid') && t.gx) $('outTxGrid').value=`${t.gx}x${t.gy}`;
  // 宽画幅 / 取景框 / P2 主要字段
  set('wideW',P.wideW); set('uvCropMirror',P.uvCrop?.mirror); set('uvCropRes',P.uvCrop?.res);
  set('p2Scale',P.p2Scale); set('p2Dir',P.p2Dir); set('p2Side',P.p2Side); ck('p2Mirror',P.p2Mirror);
  set('p2MirMode',P.p2MirrorMode||'left');
  set('p2SideSync',P.p2SideSync||'off'); set('p2SideSyncFlip',P.p2SideSyncFlip||'h');
  // 基础导出参数
  set('expFit',P.fit);
  const fps=$('pFps'); if(fps){ fps.value=P.fps; const v=$('vFps'); if(v) v.textContent=P.fps; }
  ck('pSs2x',P.ss2x); ck('transBg',P.transBg);
  ck('expDurOn',P.exportSec&&P.exportSec.on); set('expDurSec',P.exportSec?.sec??15);
  if(typeof window!=='undefined') window.refreshExportDurInfo?.();
}
