// 导出层:PNG 序列(JSZip)+ MP4 直出(WebCodecs VideoEncoder→mp4-muxer,离线逐帧确定性)
// + WebM 实时录制(MediaRecorder)。PNG/MP4 都走预览同一条 sampleFrame,离线任意分辨率
// 逐帧渲染 —— 所见即所得、帧级确定;WebM 是实时捕获(手感预览用)。
import JSZip from 'jszip';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { P } from './config.js';
import { store } from './store.js';
import { $, getExpSize, setHint, downloadBlob, toBlobP, nextFrame } from './utils.js';
import { sampleFrame, vectorSolids } from './engine.js';
import { computeVectorPolys, rasterizeVectorSolids } from './vector.js';
import { renderToImageData } from './render.js';
import { rebuildSequence } from './sequence.js';
import { resampleAll } from './pipeline.js';
import { setMode } from './ui/stage.js';
import { LED_W, LED_H } from './ledmap.js';
import { p2On, p2Size, p2Scale, makeCanvas, transformCanvasP1toP2, mirrorSymmetricH } from './ledcanvas.js';
import { uvCropOn, uvCropCfg, activePatch, planSize, composeCrop } from './uvcrop.js';
import { charactersSolids, charPolys, charLoopFrames } from './characters.js';
import { renderWideFrame, wideEW } from './widexport.js';
import { applyOutputTransform } from './outtx.js';

export const outTxOn = () => !!(P.outTx && P.outTx.on);

// 导出时的角色时间:用导出帧时间 g 同时作墙钟 + 主时间轴位置 → 确定、可复现。
const charSolidsForExport = g => charactersSolids(g, g % Math.max(1e-3, store.SEQ.T));
function charPolysForExport(g){
  const out=[], gm=g % Math.max(1e-3, store.SEQ.T);
  for(const c of store.characters||[]){ if(c===store.editingChar) continue; out.push(...charPolys(c, g, gm)); }
  return out;
}
// ⏱ 主时间轴时间:导出总时长可以【超过主序列周期 T】(角色跑整圈 / 指定导出时长)——
// 但 sampleFrame 会把 g 钳在 T 内(过了 T 主动画就冻在最后一瞬,停留帧显示成空白/变形)。
// 故主序列一律用【取模包裹】的 gm(和预览播放到点循环一样),角色则继续用未包裹的墙钟 g。
const wrapMain = g => g % Math.max(1e-3, store.SEQ.T);
export const wideOn = () => !!P.wideExport;

// 🔩 物理布局导出:开启时尺寸锁成 128×320 的整数倍(1×=硬件原生;N×=原生高清渲染,模组网格同步放大)。
// 关闭时原样返回用户设置 → 与既有构建逐字节一致。
// 基础渲染尺寸(方形/宽画幅/P2/取景框/自定义)。
function baseExpSize(){
  const uv=uvCropOn()&&activePatch();
  if(uv){ const {mirror,res}=uvCropCfg(); const pl=planSize(uv, mirror, res); return [pl.outW, pl.outH]; }
  if(P.wideExport){ const [,EH]=getExpSize(); return [wideEW(EH, Math.max(1,P.wideW||5)), EH]; } // 📐 宽画幅:EW=worldW·EH
  return p2On() ? p2Size() : getExpSize();
}
// 最终编码尺寸:开了 🖥 输出变换 → 目标画幅(如 36:15);否则 = 基础尺寸。
function expSize(){
  if(outTxOn()) return [Math.max(2,P.outTx.w|0), Math.max(2,P.outTx.h|0)];
  return baseExpSize();
}

// 离线渲染器:建好复用画布,drawFrame(f) 把第 f 帧(含 2×超采样 + 辉光)画进 ec。
// PNG 与 MP4 共用 —— 两条导出路径的画面逐像素一致。
// 返回的 out 才是【应当被编码/存盘的画布】:P2 模式下 = 变换后的画布,否则就是 ec 本身。
// 🧩 取景框导出:输出尺寸/渲染尺寸由取景框与镜像模式推出(与用户设的导出尺寸无关)。
function uvPlan(){
  if(!uvCropOn()) return null;
  const p=activePatch(); if(!p) return null;
  const { mirror, res }=uvCropCfg();
  return { patch:p, mirror, plan:planSize(p, mirror, res) };
}

function makeOfflineRenderer(EW, EH){
  if(P.wideExport){
    // 📐 宽画幅:世界拉长成 worldW 个基准方,主内容居中,角色跨世界奔跑,不消失、不缩小。
    const worldW=Math.max(1, P.wideW||5);
    const out=makeCanvas(EW, EH), octx=out.getContext('2d');
    function drawFrame(f){
      const g=f/P.fps, gm=wrapMain(g);           // 主序列取模循环;角色走墙钟(见 wrapMain 注释)
      const fr=sampleFrame(store.SEQ, store.states, gm, g, P);
      const polys=computeVectorPolys(store.states, store.SEQ, gm, g, P).concat(charPolysForExport(g));
      renderWideFrame(octx, EW, EH, worldW, fr.balls, fr.col, polys, fr.inkW);
    }
    return { ec:out, out, drawFrame };
  }
  const uv=uvPlan();
  if(uv){
    // 取景框模式:按【方形】渲染(与创作画布同比例 → 零变形),再裁到框内 + 镜像补全。
    // 框外的画面从不进入输出 —— 那部分本来就投不到模型上。
    const R=uv.plan.R;
    const ec=makeCanvas(R,R), ectx=ec.getContext('2d');
    const ss=(P.ss2x && R*2<=6000)?2:1;
    const big=makeCanvas(R*ss,R*ss), bctx=big.getContext('2d');
    const out=makeCanvas(uv.plan.outW, uv.plan.outH);
    function drawFrame(f){
      const g=f/P.fps, gm=wrapMain(g);           // 主序列取模循环;角色走墙钟
      const fr=sampleFrame(store.SEQ, store.states, gm, g, P);
      const solids=(fr.solids||[]).concat(
        vectorSolids(computeVectorPolys(store.states, store.SEQ, gm, g, P), fr.seg, store.states, gm, g))
        .concat(charSolidsForExport(g));   // 🚶 并行角色也进导出(此前只有预览有,导出漏了)
      if(ss===2){ renderToImageData(bctx,R*2,R*2,fr.balls,fr.col,P,solids,fr.cam,fr.inkW); ectx.drawImage(big,0,0,R,R); }
      else renderToImageData(ectx,R,R,fr.balls,fr.col,P,solids,fr.cam,fr.inkW);
      composeCrop(ec, uv.patch, uv.mirror, uv.plan, out);
    }
    return { ec, out, drawFrame, uv };
  }
  const p2on=p2On();
  // 🔩 P2:创作画布是【正方形】,而 LED 是 2:5 长条。直接把方画布塞进 128×320 必然变形
  // (拉伸=压扁,等比=上下大黑边、内容全挤进旋转板)。故先按【正方形】渲染 —— 与画布同比例、
  // 零变形 —— 再纯裁切出中间那条 2:5 的「LED 取景窗」(1:1 拷贝,零重采样),最后才做模组变换。
  const RW = p2on ? EH : EW, RH = EH;
  const ec=document.createElement('canvas'); ec.width=RW; ec.height=RH;
  const ectx=ec.getContext('2d');
  // 抗锯齿超采样:2× 内部渲染再缩回。但输出已很大时(≥3000px)关掉 —— 6000px+ 的内部画布内存/耗时太大,
  // 且此分辨率下 SDF 软边本身已提供干净抗锯齿。既保证"无噪边",又不至于超大导出时爆内存。
  const ss=(P.ss2x && Math.max(RW,RH)*2<=6000)?2:1;
  const big=document.createElement('canvas'); big.width=RW*ss; big.height=RH*ss;
  const bctx=big.getContext('2d');
  const glowCv=document.createElement('canvas'); glowCv.width=RW; glowCv.height=RH;
  const glowCtx=glowCv.getContext('2d');
  function drawFrame(f){
    const g=f/P.fps, gm=wrapMain(g);             // 主序列取模循环;角色走墙钟;g 作漂移相位(连续)
    const fr=sampleFrame(store.SEQ, store.states, gm, g, P); // 确定性:同 f 永远同帧
    // vectorSolids:过渡期的矢量轮廓也带上形变修饰器(尖刺/锯齿等),与预览一致
    const solids=(fr.solids||[]).concat(
      vectorSolids(computeVectorPolys(store.states, store.SEQ, gm, g, P), fr.seg, store.states, gm, g))
      .concat(charSolidsForExport(g));   // 🚶 并行角色也进导出(此前只有预览有,导出漏了)
    if(ss===2){ renderToImageData(bctx,RW*2,RH*2,fr.balls,fr.col,P,solids,fr.cam,fr.inkW); ectx.drawImage(big,0,0,RW,RH); }
    else renderToImageData(ectx,RW,RH,fr.balls,fr.col,P,solids,fr.cam,fr.inkW);
    if(P.glow>0){
      glowCtx.clearRect(0,0,RW,RH); glowCtx.drawImage(ec,0,0);
      ectx.save();
      ectx.filter=`blur(${Math.max(2,Math.round(RW/160))}px)`;
      ectx.globalCompositeOperation='lighter'; ectx.globalAlpha=P.glow;
      ectx.drawImage(glowCv,0,0);
      ectx.restore();
    }
  }
  // P2:方形渲染 →【纯裁切】出中间 2:5 的 LED 取景窗(1:1 拷贝,零重采样)→ 模组布局变换。
  const crop = p2on ? makeCanvas(EW, EH) : null;
  const p2   = p2on ? makeCanvas(EW, EH) : null;
  const cropX = p2on ? ((RW - EW) >> 1) : 0;
  function drawOut(f){
    drawFrame(f);
    if(!p2on) return;
    const cx=crop.getContext('2d',{willReadFrequently:true}); cx.imageSmoothingEnabled=false;
    cx.drawImage(ec, cropX, 0, EW, EH, 0, 0, EW, EH);   // 同尺寸裁切 = 逐像素原样搬运
    if(P.p2Mirror) mirrorSymmetricH(crop);              // 🪞 双边镜像:【在分屏切割之前】,故分屏也得到准确镜像
    transformCanvasP1toP2(crop, p2);
  }
  return { ec, out: p2 || ec, drawFrame: drawOut };
}

// 导出渲染器:基础渲染 → (可选)🖥 输出变换(适配画幅 + 镜像/旋转/warp)。PNG/MP4 共用。
// (导出 export 供测试/诊断:与真实导出走同一条码路)
export function makeExportRenderer(){
  let [BW,BH]=baseExpSize();
  // ⚡ 输出变换开着时,基础方形只需渲染到【输出真正用得到】的分辨率:
  // 等比留边(fit)时内容方块 = min(目标宽,高)(如 2880×1200 → 1200²),按 2048² 渲再缩小纯属浪费
  //(加上 2× 超采样就是 4096² = 每帧一千六百万像素,导出慢的主因)。裁满/拉伸/warp 需要铺满 → 用 max。
  // 只降不升:绝不超过用户选的基础分辨率(质量上限不变),P2/取景框/宽画幅各有专属尺寸逻辑,不动。
  if(outTxOn() && !p2On() && !uvCropOn() && !P.wideExport){
    const t=P.outTx, FW=Math.max(2,t.w|0), FH=Math.max(2,t.h|0);
    let needed;
    if(t.warp || t.fit==='fill' || t.fit==='stretch') needed=Math.max(FW,FH);
    else if(t.fit==='manual') needed=Math.min(Math.max(FW,FH), Math.min(FW,FH)*Math.max(1, t.sx||1, t.sy||1));
    else needed=Math.min(FW,FH);                        // fit 等比留边:内容方块 = 短边
    const k=Math.min(1, needed/Math.max(BW,BH));
    BW=Math.max(2,Math.round(BW*k)); BH=Math.max(2,Math.round(BH*k));
  }
  const base=makeOfflineRenderer(BW,BH);
  if(!outTxOn()) return base;
  const [FW,FH]=expSize();
  const final=makeCanvas(FW,FH);
  const opts=()=>({ w:FW, h:FH, fit:P.outTx.fit, mirX:!!P.outTx.mirX, mirY:!!P.outTx.mirY,
    rot:P.outTx.rot||0, warp:!!P.outTx.warp, gx:P.outTx.gx||1, gy:P.outTx.gy||1, mesh:P.outTx.mesh,
    symMirror:P.outTx.symMirror||'off', transBg:!!P.transBg, bg:P.colBg,   // 🎨 留边用画布背景色填充(如白)
    sx:P.outTx.sx??1, sy:P.outTx.sy??1 });                                 // 手动拉伸倍率
  return { out:final, drawFrame(f){ base.drawFrame(f); applyOutputTransform(base.out, opts(), final); } };
}

const gcd=(a,b)=>{ a=Math.abs(a); b=Math.abs(b); while(b){ [a,b]=[b,a%b]; } return a||1; };
const lcm=(a,b)=>a/gcd(a,b)*b;
// 帧数护栏:PNG/MP4 共用。
// 🚶 关键:并行角色里【跑不停 / 自由横穿】的用墙钟推进,其一整圈远比主序列长 ——
// 若只按 store.SEQ.T 出帧,骑车人只会导出旅途的一小段、跑不完全程(骑车 loop 全变空白/太短的根因)。
// 故导出时长【以最长角色圈为准】,角色在此长度天然首尾相接。主序列若还有真实多段动画,再尽量
// 让它在导出里整数次循环 —— 但代价可控时才做(避免与角色圈互质时时长暴涨到几十秒)。
// 自动时长(帧):主序列 + 墙钟角色圈的合理公共长度(无副作用,供 UI 预读)。
function autoFrames(){
  const fps=P.fps;
  const mainF=Math.max(1, Math.round((store.SEQ?.T||0)*fps));
  const wall=(store.characters||[]).filter(c=>
    c && c.visible!==false && c!==store.editingChar && (c.wrap || (c.sync||'free')==='free'));
  let frames=mainF;
  if(wall.length){
    // 各角色圈的公共长度(彼此取整数倍);超上限则退取最长的那个圈。
    let cf=1;
    for(const c of wall){ cf=lcm(cf, charLoopFrames(c, fps)); }
    if(cf>1200) cf=Math.min(1200, Math.max(...wall.map(c=>charLoopFrames(c, fps))));
    frames=cf;
    // 主序列有真实多段动画时,让它也整数次循环 —— 仅在结果不超上限、且不把时长撑大到 3 倍以上时。
    if((store.states?.length||0)>1 && mainF>1){ const F=lcm(mainF, cf); if(F<=1200 && F<=cf*3) frames=F; }
  }
  return Math.min(1200, frames);
}
// 实际将导出的帧数(无副作用,UI 读数用):优先手动指定的时长,否则走自动。
export function plannedFrames(){
  const fps=P.fps;
  if(P.exportSec && P.exportSec.on)
    return Math.min(1200, Math.max(2, Math.round(Math.max(0.1, P.exportSec.sec||1)*fps)));
  return autoFrames();
}
function frameCount(){
  const frames=plannedFrames();
  if(frames<2){ setHint('⚠ 序列太短'); return 0; }
  if(frames>=1200){ setHint('⚠ 已达 1200 帧上限 —— 缩短导出时长/提高角色「地面速度」或降帧率'); }
  return frames;
}

export async function exportPNG(){
  if(store.exporting) return;
  resampleAll(); rebuildSequence();
  const [EW,EH]=expSize();
  const frames=frameCount(); if(!frames) return;
  store.exporting=true; $('pngBtn').textContent='… 渲染中';
  const { out, drawFrame }=makeExportRenderer();
  const zip=new JSZip();
  for(let f=0;f<frames;f++){
    drawFrame(f);
    // 文件名与帧序不变,只有像素内容随 P2 变换而变
    zip.file(`frame_${String(f).padStart(4,'0')}.png`, await toBlobP(out));
    if(f%5===0){ setHint(`导出中 ${f+1}/${frames}…`); await nextFrame(); }
  }
  setHint('打包 zip…');
  downloadBlob(await zip.generateAsync({type:'blob'}),
    `morph_seq_${EW}x${EH}${p2On()?'_P2':''}_${P.fps}fps_${frames}f.zip`);
  setHint(`✓ 已导出整条序列 ${frames} 帧 (${EW}×${EH}${p2On()?' · 🔩P2 实装布局':''}, ${(frames/P.fps).toFixed(1)}s)`);
  $('pngBtn').textContent='🎞 PNG 序列'; store.exporting=false;
}

// H.264 profile/level 逐个试:高→低,直到 isConfigSupported 通过(分辨率越大需越高 level)。
async function pickAvcCodec(EW,EH,fps,bitrate){
  const cands=['avc1.640034','avc1.640028','avc1.4d0034','avc1.4d0028','avc1.42E034','avc1.42E01F'];
  for(const codec of cands){
    try{ const s=await VideoEncoder.isConfigSupported({codec,width:EW,height:EH,bitrate,framerate:fps});
      if(s?.supported) return codec; }catch(_){}
  }
  return null;
}

export async function exportMP4(){
  if(store.exporting) return;
  if(typeof VideoEncoder==='undefined' || typeof VideoFrame==='undefined'){
    setHint('⚠ 此浏览器不支持 WebCodecs(MP4 直出)—— 已改用 🎞 PNG 序列,ffmpeg 合成 MP4');
    return exportPNG();
  }
  resampleAll(); rebuildSequence();
  let [EW,EH]=expSize();
  EW-=EW%2; EH-=EH%2;                       // H.264(yuv420)要求偶数边长(128×320 本就是偶数,P2 不受影响)
  const frames=frameCount(); if(!frames) return;
  const fps=P.fps;
  const bitrate=Math.round(Math.min(40e6, Math.max(2e6, EW*EH*fps*0.15)));
  const codec=await pickAvcCodec(EW,EH,fps,bitrate);
  if(!codec){ setHint('⚠ 此浏览器无可用 H.264 编码档 —— 已改用 🎞 PNG 序列'); return exportPNG(); }

  store.exporting=true; $('mp4Btn').textContent='… 编码中';
  try{
    const muxer=new Muxer({ target:new ArrayBufferTarget(),
      video:{ codec:'avc', width:EW, height:EH, frameRate:fps }, fastStart:'in-memory' });
    let encErr=null;
    const encoder=new VideoEncoder({
      output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),
      error:e=>{ encErr=e; } });
    encoder.configure({ codec, width:EW, height:EH, bitrate, framerate:fps });
    const { out, drawFrame }=makeExportRenderer();
    const usPerFrame=1e6/fps;
    for(let f=0;f<frames;f++){
      if(encErr) throw encErr;
      drawFrame(f);
      const vf=new VideoFrame(out, { timestamp:Math.round(f*usPerFrame), duration:Math.round(usPerFrame) });
      encoder.encode(vf, { keyFrame: f%Math.max(1,Math.round(fps))===0 }); // 每秒一个关键帧
      vf.close();
      // 背压:编码队列过长时让出,避免一次性堆满内存
      while(encoder.encodeQueueSize>8){ await new Promise(r=>setTimeout(r,4)); if(encErr) throw encErr; }
      if(f%5===0){ setHint(`MP4 编码中 ${f+1}/${frames}…`); await nextFrame(); }
    }
    await encoder.flush();
    if(encErr) throw encErr;
    muxer.finalize();
    downloadBlob(new Blob([muxer.target.buffer],{type:'video/mp4'}),
      `morph_${EW}x${EH}${p2On()?'_P2':''}_${fps}fps_${frames}f.mp4`);
    setHint(`✓ 已导出 MP4 ${frames} 帧 (${EW}×${EH}${p2On()?' · 🔩P2 实装布局':''}, ${(frames/fps).toFixed(1)}s, H.264)`);
  }catch(err){
    setHint('⚠ MP4 编码失败:'+(err?.message||err)+' —— 可改用 🎞 PNG 序列');
  }
  $('mp4Btn').textContent='🎬 MP4'; store.exporting=false;
}

export function toggleRecord(){
  if(store.recorder){ store.recorder.stop(); return; }
  // 🔩 P2 模式:实时录制也必须是【原生 128×320】—— 若去缩放预览画布就等于重采样(规格明令禁止)。
  // 故这里用与 PNG/MP4 同一条离线渲染管线,按墙钟推进帧号画进 P2 画布,再抓这张画布的流。
  if(p2On()) return recordP2();
  const cv=$('cv');
  setMode('play'); store.g=0; store.playing=true; $('playBtn').textContent='⏸ 暂停';
  store.hideOverlays=true; store.forceCpu=true; store.chunks=[]; // captureStream 抓 2D 画布,录制期强制 CPU 渲染
  store.recorder=new MediaRecorder(cv.captureStream(30),{mimeType:'video/webm'});
  store.recorder.ondataavailable=e=>{ if(e.data.size) store.chunks.push(e.data); };
  store.recorder.onstop=()=>{
    downloadBlob(new Blob(store.chunks,{type:'video/webm'}),'morph_seq.webm');
    store.recorder=null; store.hideOverlays=false; store.forceCpu=false;
    $('recBtn').textContent='⏺ 录 WebM'; setHint('✓ WebM 已保存'); };
  store.recorder.start();
  $('recBtn').textContent='⏹ 停止保存'; setHint('● 录制中…');
}

// P2 实时录制:离线渲染 → 布局变换 → 抓 128×320 画布流。帧序与 PNG/MP4 一致,只是按真实时间循环播放。
function recordP2(){
  resampleAll(); rebuildSequence();
  const frames=frameCount(); if(!frames) return;
  const [RW,RH]=p2Size();
  const { out, drawFrame }=makeOfflineRenderer(RW, RH);
  drawFrame(0);
  let raf=0, f=-1;
  const t0=performance.now();
  const tick=()=>{
    const nf=Math.floor((performance.now()-t0)/1000*P.fps)%frames;
    if(nf!==f){ f=nf; drawFrame(f); }
    raf=requestAnimationFrame(tick);
  };
  store.chunks=[];
  store.recorder=new MediaRecorder(out.captureStream(P.fps),{mimeType:'video/webm'});
  store.recorder.ondataavailable=e=>{ if(e.data.size) store.chunks.push(e.data); };
  store.recorder.onstop=()=>{
    cancelAnimationFrame(raf);
    downloadBlob(new Blob(store.chunks,{type:'video/webm'}),`morph_seq_${RW}x${RH}_P2.webm`);
    store.recorder=null;
    $('recBtn').textContent='⏺ 录 WebM'; setHint(`✓ WebM 已保存(${RW}×${RH} · 🔩P2 实装布局)`); };
  store.recorder.start(); tick();
  $('recBtn').textContent='⏹ 停止保存'; setHint(`● 录制中(P2 ${RW}×${RH})… 满一圈 ${(frames/P.fps).toFixed(1)}s 即可停`);
}
