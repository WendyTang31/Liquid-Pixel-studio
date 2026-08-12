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
import { uvPatches, activePatch, planSize, mirrorScale } from '../uvcrop.js';

let p1Cv=null, p2Cv=null, raf=0, lastSig='';
let calibMode=false, calibCv=null, warned=false;

// 当前时间轴位置的一帧。与【导出完全同一条路径】:先按正方形渲染(方画布零变形),
// 再纯裁切出中间 2:5 的 LED 取景窗 —— 所以预览所见即导出所得,不会一个变形一个不变形。
let sq=null;
function renderP1(){
  const ctx=p1Cv.getContext('2d',{willReadFrequently:true});
  ctx.imageSmoothingEnabled=false;
  if(calibMode){ ctx.drawImage(calibCv,0,0); return; }
  const g=store.mode==='play' ? store.g : (store.active>0 ? seekOfState() : 0);
  const fr=sampleFrame(store.SEQ, store.states, g, g, P);
  const solids=(fr.solids||[]).concat(rasterizeVectorSolids(computeVectorPolys(store.states, store.SEQ, g, g, P)));
  if(!sq) sq=makeCanvas(LED_H, LED_H);                       // 方形暂存(与创作画布同比例)
  const sctx=sq.getContext('2d',{willReadFrequently:true});
  renderToImageData(sctx, LED_H, LED_H, fr.balls, fr.col, P, solids, fr.cam);
  ctx.drawImage(sq, (LED_H-LED_W)>>1, 0, LED_W, LED_H, 0, 0, LED_W, LED_H);
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

// 模组映射表编辑:每块模组【从画面哪块区域取像素】(src x/y/宽/高)+【放到实装画布哪里】(dst x/y)。
// 实装尺寸与默认不符时在这里改成真实值即可 —— 这正是「用数据表而非写死逻辑」的意义。
function currentMap(){
  if(!P.p2Map) P.p2Map=MODULE_MAP.map(m=>({name:m.name, src:[...m.src], dst:[...m.dst], rotate:m.rotate}));
  return P.p2Map;
}
function renderMapRows(){
  const host=$('p2MapRows'); if(!host) return;
  const map=currentMap();
  host.innerHTML='';
  map.forEach((m,i)=>{
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:2px;font:10px system-ui;color:#9fb;margin:1px 0';
    const lab=document.createElement('span');
    lab.textContent=`${i+1}`; lab.title=m.name;
    lab.style.cssText='width:10px;opacity:.7;flex:0 0 auto';
    row.appendChild(lab);
    const num=(get,set,tip)=>{ const inp=document.createElement('input');
      inp.type='number'; inp.value=get(); inp.title=tip;
      inp.style.cssText='width:34px;background:#0d1210;border:1px solid #2a3330;border-radius:3px;color:#dfe;font:10px system-ui;padding:1px 2px';
      inp.onclick=e=>e.stopPropagation();
      inp.oninput=()=>{ const v=parseInt(inp.value,10); if(isFinite(v)){ set(v); refreshP2Preview(); } };
      return inp; };
    [0,1,2,3].forEach(k=>row.appendChild(num(()=>m.src[k], v=>m.src[k]=v,
      ['源 x','源 y','源 宽','源 高'][k])));
    const arrow=document.createElement('span'); arrow.textContent='→'; arrow.style.opacity='.5'; row.appendChild(arrow);
    [0,1].forEach(k=>row.appendChild(num(()=>m.dst[k], v=>m.dst[k]=v, ['目标 x','目标 y'][k])));
    host.appendChild(row);
  });
}

// 🧩 取景框导出面板:选哪块取景框 + 镜像补全 + 分辨率,并实时显示算出来的输出尺寸。
export function initUvCropPanel(){
  const on=$('uvCropOn'); if(!on) return;
  if(!P.uvCrop) P.uvCrop={ on:false, patch:'', mirror:'h', res:4096 };
  const sel=$('uvCropPatch'), mir=$('uvCropMirror'), res=$('uvCropRes'), info=$('uvCropInfo');
  const fillPatches=()=>{
    const list=uvPatches();
    sel.innerHTML='';
    if(!list.length){ const o=document.createElement('option');
      o.textContent='(无 —— 请先在 3D 预览器放置投影面/UV 层)'; o.value=''; sel.appendChild(o); return; }
    for(const p of list){ const o=document.createElement('option'); o.value=p.name; o.textContent=p.name; sel.appendChild(o); }
    if(P.uvCrop.patch && list.some(p=>p.name===P.uvCrop.patch)) sel.value=P.uvCrop.patch;
    else { sel.value=list[0].name; P.uvCrop.patch=list[0].name; }
  };
  const refresh=()=>{
    const p=activePatch();
    if(!p){ info.textContent='未找到取景框 —— 先到 3D 预览器放一块投影面或 UV 直贴层。'; return; }
    const pl=planSize(p, P.uvCrop.mirror, P.uvCrop.res);
    const [mw,mh]=mirrorScale(P.uvCrop.mirror);
    info.innerHTML=`取景框占画布 <b>${(p.cw*100).toFixed(0)}% × ${(p.ch*100).toFixed(0)}%</b>`
      + ` → 输出 <b>${pl.outW}×${pl.outH}</b>`
      + (mw*mh>1?`(${mw}×${mh} 镜像拼接)`:'(仅框内)')
      + `<br>内部按 ${pl.R}² 方形渲染后裁切,零变形。`
      + (pl.outW>3072||pl.outH>3072 ? ' <b style="color:#ffd479">超过 MP4 上限 → 请用 PNG 序列</b>' : '');
  };
  const sync=()=>{ $('uvCropPanel').style.display = on.checked ? '' : 'none';
    if(on.checked){ fillPatches(); refresh(); } };
  on.checked=!!P.uvCrop.on;
  on.addEventListener('change', e=>{ P.uvCrop.on=e.target.checked; sync();
    setHint(e.target.checked ? '🧩 已开启按取景框导出:只输出绿框内的画面(+镜像),框外一律丢弃'
                             : '已关闭 —— 导出恢复整张画布'); });
  sel.addEventListener('change', ()=>{ P.uvCrop.patch=sel.value; refresh(); });
  mir.value=P.uvCrop.mirror; mir.addEventListener('change', ()=>{ P.uvCrop.mirror=mir.value; refresh(); });
  res.value=String(P.uvCrop.res); res.addEventListener('change', ()=>{ P.uvCrop.res=parseInt(res.value,10)||4096; refresh(); });
  addEventListener('storage', e=>{ if(e.key==='morph-uvlayout' && on.checked){ fillPatches(); refresh(); } });
  sync();
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
    // 只提供与【槽位尺寸相容】的角度:横向槽(128×64)=0/180;旋转槽(64×128)=90/270。
    // 给横向槽设 90° 会让它变成 64×128 塞不进去 → 像素被裁掉,所以直接不给选。
    const rotatedSlot = (m.rotate===90 || m.rotate===270);
    const opts = rotatedSlot ? [['','按表 ('+m.rotate+'°)'],['90','90°'],['270','270°']]
                             : [['','按表 ('+m.rotate+'°)'],['0','0°'],['180','180°']];
    sel.title = rotatedSlot ? '这块是竖装槽位(64×128),只能 90°/270°' : '这块是横装槽位(128×64),只能 0°/180°';
    opts.forEach(([v,t])=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); });
    sel.value = P.p2Rot[i]==null ? '' : String(P.p2Rot[i]);
    sel.onchange=()=>{ P.p2Rot[i] = sel.value==='' ? null : parseInt(sel.value,10); refreshP2Preview(); };
    row.append(lab, sel); host.appendChild(row);
  });

  // 侧板方向(实装镜像时一处翻转全部侧板)
  const side=$('p2Side');
  side.value=P.p2Side||'cw';
  side.onchange=()=>{ P.p2Side=side.value; refreshP2Preview(); };

  // 变换方向:正向 / 反向(照车上的样子画)
  const dir=$('p2Dir');
  if(dir){ dir.value=P.p2Dir||'fwd';
    dir.onchange=()=>{ P.p2Dir=dir.value; refreshP2Preview();
      setHint(dir.value==='inv'
        ? '↩ 反向:左边画的就是【车上看到的样子】,右边是控制器实际收到的顺序 —— 想让线条在车上连续,用这个'
        : '➡ 正向:左边是 P1 竖排创作,右边是重排到实装位置后的样子'); }; }

  // 导出倍数(预览恒按 1× 画,省算力;倍数只影响导出尺寸 —— 布局本身与倍数无关)
  const sc=$('p2Scale');
  if(sc){ sc.value=String(P.p2Scale||8);
    sc.onchange=()=>{ P.p2Scale=parseInt(sc.value,10)||1;
      setHint(`🔩 导出将按 ${LED_W*P.p2Scale}×${LED_H*P.p2Scale} 原生渲染`
        +(P.p2Scale===1?'(硬件原生,送控制器用这份)':'(高清演示片;送硬件请切回 1×)')); }; }

  renderMapRows();
  const rst=$('p2MapReset');
  if(rst) rst.onclick=()=>{ P.p2Map=null; renderMapRows(); refreshP2Preview();
    setHint('↺ 模组映射已恢复默认(128×320,模组 2/3 旋转 90° 并排)'); };

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
