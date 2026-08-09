// 导出层:PNG 序列(JSZip)+ MP4 直出(WebCodecs VideoEncoder→mp4-muxer,离线逐帧确定性)
// + WebM 实时录制(MediaRecorder)。PNG/MP4 都走预览同一条 sampleFrame,离线任意分辨率
// 逐帧渲染 —— 所见即所得、帧级确定;WebM 是实时捕获(手感预览用)。
import JSZip from 'jszip';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { P } from './config.js';
import { store } from './store.js';
import { $, getExpSize, setHint, downloadBlob, toBlobP, nextFrame } from './utils.js';
import { sampleFrame } from './engine.js';
import { computeVectorPolys, rasterizeVectorSolids } from './vector.js';
import { renderToImageData } from './render.js';
import { rebuildSequence } from './sequence.js';
import { resampleAll } from './pipeline.js';
import { setMode } from './ui/stage.js';
import { LED_W, LED_H } from './ledmap.js';
import { p2On, p2Size, p2Scale, makeCanvas, transformCanvasP1toP2 } from './ledcanvas.js';

// 🔩 物理布局导出:开启时尺寸锁成 128×320 的整数倍(1×=硬件原生;N×=原生高清渲染,模组网格同步放大)。
// 关闭时原样返回用户设置 → 与既有构建逐字节一致。
function expSize(){ return p2On() ? p2Size() : getExpSize(); }

// 离线渲染器:建好复用画布,drawFrame(f) 把第 f 帧(含 2×超采样 + 辉光)画进 ec。
// PNG 与 MP4 共用 —— 两条导出路径的画面逐像素一致。
// 返回的 out 才是【应当被编码/存盘的画布】:P2 模式下 = 变换后的画布,否则就是 ec 本身。
function makeOfflineRenderer(EW, EH){
  const ec=document.createElement('canvas'); ec.width=EW; ec.height=EH;
  const ectx=ec.getContext('2d');
  // 抗锯齿超采样:2× 内部渲染再缩回。但输出已很大时(≥3000px)关掉 —— 6000px+ 的内部画布内存/耗时太大,
  // 且此分辨率下 SDF 软边本身已提供干净抗锯齿。既保证"无噪边",又不至于超大导出时爆内存。
  const ss=(P.ss2x && Math.max(EW,EH)*2<=6000)?2:1;
  const big=document.createElement('canvas'); big.width=EW*ss; big.height=EH*ss;
  const bctx=big.getContext('2d');
  const glowCv=document.createElement('canvas'); glowCv.width=EW; glowCv.height=EH;
  const glowCtx=glowCv.getContext('2d');
  function drawFrame(f){
    const g=f/P.fps;
    const fr=sampleFrame(store.SEQ, store.states, g, g, P); // g 同时作墙钟 → 导出确定
    const solids=(fr.solids||[]).concat(rasterizeVectorSolids(computeVectorPolys(store.states, store.SEQ, g, g, P)));
    if(ss===2){ renderToImageData(bctx,EW*2,EH*2,fr.balls,fr.col,P,solids,fr.cam); ectx.drawImage(big,0,0,EW,EH); }
    else renderToImageData(ectx,EW,EH,fr.balls,fr.col,P,solids,fr.cam);
    if(P.glow>0){
      glowCtx.clearRect(0,0,EW,EH); glowCtx.drawImage(ec,0,0);
      ectx.save();
      ectx.filter=`blur(${Math.max(2,Math.round(EW/160))}px)`;
      ectx.globalCompositeOperation='lighter'; ectx.globalAlpha=P.glow;
      ectx.drawImage(glowCv,0,0);
      ectx.restore();
    }
  }
  // P2:每帧渲染完成后(辉光之后)做最后一步布局变换 —— 最近邻、逐像素、零缩放。
  const p2 = p2On() ? makeCanvas(EW, EH) : null;
  function drawOut(f){ drawFrame(f); if(p2) transformCanvasP1toP2(ec, p2); }
  return { ec, out: p2 || ec, drawFrame: drawOut };
}

// 帧数护栏:PNG/MP4 共用。
function frameCount(){
  const frames=Math.round(store.SEQ.T*P.fps);
  if(frames<2){ setHint('⚠ 序列太短'); return 0; }
  if(frames>1200){ setHint(`⚠ ${frames} 帧超上限1200,请缩短停留/过渡或降帧率`); return 0; }
  return frames;
}

export async function exportPNG(){
  if(store.exporting) return;
  resampleAll(); rebuildSequence();
  const [EW,EH]=expSize();
  const frames=frameCount(); if(!frames) return;
  store.exporting=true; $('pngBtn').textContent='… 渲染中';
  const { out, drawFrame }=makeOfflineRenderer(EW,EH);
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
  setHint(`✓ 已导出整条序列 ${frames} 帧 (${EW}×${EH}${p2On()?' · 🔩P2 实装布局':''}, ${store.SEQ.T.toFixed(1)}s)`);
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
    const { out, drawFrame }=makeOfflineRenderer(EW,EH);
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
    setHint(`✓ 已导出 MP4 ${frames} 帧 (${EW}×${EH}${p2On()?' · 🔩P2 实装布局':''}, ${store.SEQ.T.toFixed(1)}s, H.264)`);
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
