// 🔩 物理布局导出面板:总开关 + P1‖P2 实时对照预览 + 逐模组旋转覆盖 + 校准帧。
// 预览【每帧都跟着时间轴走】(不只导出时才算),用与导出同一条 sampleFrame → 所见即所得。
import { P } from '../config.js';
import { store } from '../store.js';
import { $, setHint, hex2rgb, downloadBlob, toBlobP } from '../utils.js';
import { sampleFrame } from '../engine.js';
import { computeVectorPolys, rasterizeVectorSolids } from '../vector.js';
import { renderToImageData } from '../render.js';
import { LED_W, LED_H, MODULE_MAP } from '../ledmap.js';
import { makeCanvas, transformCanvasP1toP2, calibrationCanvas } from '../ledcanvas.js';

let p1Cv=null, p2Cv=null, raf=0, lastSig='';
let calibMode=false, calibCv=null, warned=false;

// 当前时间轴位置的一帧,按控制器原生 128×320 渲染(与导出同尺寸 → 预览即导出)。
function renderP1(){
  const ctx=p1Cv.getContext('2d',{willReadFrequently:true});
  ctx.imageSmoothingEnabled=false;
  if(calibMode){ ctx.drawImage(calibCv,0,0); return; }
  const g=store.mode==='play' ? store.g : (store.active>0 ? seekOfState() : 0);
  const fr=sampleFrame(store.SEQ, store.states, g, g, P);
  const solids=(fr.solids||[]).concat(rasterizeVectorSolids(computeVectorPolys(store.states, store.SEQ, g, g, P)));
  renderToImageData(ctx, LED_W, LED_H, fr.balls, fr.col, P, solids, fr.cam);
}
// 编辑模式下把播放头对到当前状态的停留段起点,便于逐帧校对。
function seekOfState(){
  const seg=(store.SEQ?.segs||[]).find(s=>s.type==='hold' && s.si===store.active);
  return seg ? seg.t0 : 0;
}

// 立即重画一次。改开关/角度/校准都直接调它 —— 不把刷新完全押在 rAF 上
// (后台标签页/未显示时 rAF 会被节流甚至不触发,那时用户点了却看不到变化)。
export function refreshP2Preview(){
  if(!p1Cv) return;
  // 预览失败要看得见(静默 catch 会让人以为"没接上"):只警告一次,避免刷屏。
  try{ renderP1(); transformCanvasP1toP2(p1Cv, p2Cv); }
  catch(e){ if(!warned){ warned=true; console.warn('[P2 预览] 渲染失败:', e); } }
}
function tick(){
  raf=requestAnimationFrame(tick);
  if(!$('p2Panel') || $('p2Panel').style.display==='none') return;
  // 只在画面可能变化时重算(播放中/切帧/改了覆盖角度/校准模式)
  const sig=[store.mode, store.playing?store.g.toFixed(2):'', store.active, calibMode,
             (P.p2Rot||[]).join(','), P.p2Side, store.seqDirty].join('|');
  if(sig===lastSig && !store.playing) return;
  lastSig=sig;
  refreshP2Preview();
}

export function initLedPanel(){
  const host=$('p2Mods'); if(!host) return;
  p1Cv=makeCanvas(LED_W,LED_H); p2Cv=makeCanvas(LED_W,LED_H);
  const style='width:96px;height:240px;image-rendering:pixelated;background:#000;border:1px solid #2a3330;border-radius:4px';
  p1Cv.style.cssText=style; p2Cv.style.cssText=style;
  $('p2PrevA').appendChild(p1Cv); $('p2PrevB').appendChild(p2Cv);

  // 总开关:默认关 → 关闭时导出与既有构建逐字节一致
  const on=$('p2On');
  on.checked=!!P.p2Export;
  const sync=()=>{ $('p2Panel').style.display = on.checked ? '' : 'none';
    if(on.checked) refreshP2Preview(); };
  on.addEventListener('change', e=>{ P.p2Export=e.target.checked; sync();
    setHint(e.target.checked
      ? `🔩 已开启物理布局导出:导出强制 ${LED_W}×${LED_H},按模组裁切/旋转/平移(最近邻·零缩放)`
      : '已关闭物理布局导出 —— 导出恢复为原始 P1 画面与你设置的尺寸'); });
  sync();

  // 逐模组旋转覆盖(现场校正:实装方向意外时不用改代码)
  if(!P.p2Rot || P.p2Rot.length!==MODULE_MAP.length) P.p2Rot=MODULE_MAP.map(()=>null);
  host.innerHTML='';
  MODULE_MAP.forEach((m,i)=>{
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:6px;font:11px system-ui;color:#9fb;margin:2px 0';
    const lab=document.createElement('span');
    lab.textContent=`${i+1} ${m.name}`; lab.style.cssText='flex:1;opacity:.85';
    const sel=document.createElement('select');
    sel.style.cssText='background:#0d1210;border:1px solid #2a3330;border-radius:4px;color:#dfe;font:11px system-ui;padding:1px 3px';
    [['','按表 ('+m.rotate+'°)'],['0','0°'],['90','90°'],['180','180°'],['270','270°']].forEach(([v,t])=>{
      const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); });
    sel.value = P.p2Rot[i]==null ? '' : String(P.p2Rot[i]);
    sel.onchange=()=>{ P.p2Rot[i] = sel.value==='' ? null : parseInt(sel.value,10); refreshP2Preview(); };
    row.append(lab, sel); host.appendChild(row);
  });

  // 侧板方向(实装镜像时一处翻转全部侧板)
  const side=$('p2Side');
  side.value=P.p2Side||'cw';
  side.onchange=()=>{ P.p2Side=side.value; refreshP2Preview(); };

  // 校准帧:预览切成校准图案;可直接存 P1/P2 两张 PNG 拿去打屏比对
  $('p2Calib').onclick=()=>{
    calibMode=!calibMode;
    if(calibMode && !calibCv) calibCv=calibrationCanvas();
    $('p2Calib').textContent = calibMode ? '✓ 校准帧(点此退出)' : '🎯 生成校准帧';
    lastSig=''; refreshP2Preview();
    setHint(calibMode
      ? '🎯 校准帧:每块模组 = 不同底色 + N 条竖条(N=模组号)+ 左上白块。看右侧 P2:模组2 的白块应在其旋转块的【右上角】= 方向正确'
      : '已退出校准帧预览');
  };
  $('p2Save').onclick=async ()=>{
    if(!calibCv) calibCv=calibrationCanvas();
    const wasCalib=calibMode; calibMode=true; renderP1(); transformCanvasP1toP2(p1Cv,p2Cv);
    downloadBlob(await toBlobP(p1Cv), 'calibration_P1.png');
    downloadBlob(await toBlobP(p2Cv), 'calibration_P2.png');
    calibMode=wasCalib; lastSig='';
    setHint('✓ 已保存 calibration_P1.png / calibration_P2.png —— 把 P2 那张打到硬件上核对模组顺序与旋转');
  };

  if(!raf) raf=requestAnimationFrame(tick);
}
