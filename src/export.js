// 导出层:PNG 序列(JSZip)+ MP4 直出(WebCodecs VideoEncoder→mp4-muxer,离线逐帧确定性)
// + WebM 实时录制(MediaRecorder)。PNG/MP4 都走预览同一条 sampleFrame,离线任意分辨率
// 逐帧渲染 —— 所见即所得、帧级确定;WebM 是实时捕获(手感预览用)。
import JSZip from 'jszip';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { P } from './config.js';
import { store } from './store.js';
import { $, getExpSize, setHint, downloadBlob, toBlobP, nextFrame } from './utils.js';
import { sampleFrame } from './engine.js';
import { renderToImageData } from './render.js';
import { rebuildSequence } from './sequence.js';
import { resampleAll } from './pipeline.js';
import { setMode } from './ui/stage.js';

// 离线渲染器:建好复用画布,drawFrame(f) 把第 f 帧(含 2×超采样 + 辉光)画进 ec。
// PNG 与 MP4 共用 —— 两条导出路径的画面逐像素一致。
function makeOfflineRenderer(EW, EH){
  const ec=document.createElement('canvas'); ec.width=EW; ec.height=EH;
  const ectx=ec.getContext('2d');
  const ss=P.ss2x?2:1;
  const big=document.createElement('canvas'); big.width=EW*ss; big.height=EH*ss;
  const bctx=big.getContext('2d');
  const glowCv=document.createElement('canvas'); glowCv.width=EW; glowCv.height=EH;
  const glowCtx=glowCv.getContext('2d');
  function drawFrame(f){
    const g=f/P.fps;
    const fr=sampleFrame(store.SEQ, store.states, g, g, P); // g 同时作墙钟 → 导出确定
    if(ss===2){ renderToImageData(bctx,EW*2,EH*2,fr.balls,fr.col,P,fr.solids,fr.cam); ectx.drawImage(big,0,0,EW,EH); }
    else renderToImageData(ectx,EW,EH,fr.balls,fr.col,P,fr.solids,fr.cam);
    if(P.glow>0){
      glowCtx.clearRect(0,0,EW,EH); glowCtx.drawImage(ec,0,0);
      ectx.save();
      ectx.filter=`blur(${Math.max(2,Math.round(EW/160))}px)`;
      ectx.globalCompositeOperation='lighter'; ectx.globalAlpha=P.glow;
      ectx.drawImage(glowCv,0,0);
      ectx.restore();
    }
  }
  return { ec, drawFrame };
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
  const [EW,EH]=getExpSize();
  const frames=frameCount(); if(!frames) return;
  store.exporting=true; $('pngBtn').textContent='… 渲染中';
  const { ec, drawFrame }=makeOfflineRenderer(EW,EH);
  const zip=new JSZip();
  for(let f=0;f<frames;f++){
    drawFrame(f);
    zip.file(`frame_${String(f).padStart(4,'0')}.png`, await toBlobP(ec));
    if(f%5===0){ setHint(`导出中 ${f+1}/${frames}…`); await nextFrame(); }
  }
  setHint('打包 zip…');
  downloadBlob(await zip.generateAsync({type:'blob'}),
    `morph_seq_${EW}x${EH}_${P.fps}fps_${frames}f.zip`);
  setHint(`✓ 已导出整条序列 ${frames} 帧 (${EW}×${EH}, ${store.SEQ.T.toFixed(1)}s)`);
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
  let [EW,EH]=getExpSize();
  EW-=EW%2; EH-=EH%2;                       // H.264(yuv420)要求偶数边长
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
    const { ec, drawFrame }=makeOfflineRenderer(EW,EH);
    const usPerFrame=1e6/fps;
    for(let f=0;f<frames;f++){
      if(encErr) throw encErr;
      drawFrame(f);
      const vf=new VideoFrame(ec, { timestamp:Math.round(f*usPerFrame), duration:Math.round(usPerFrame) });
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
      `morph_${EW}x${EH}_${fps}fps_${frames}f.mp4`);
    setHint(`✓ 已导出 MP4 ${frames} 帧 (${EW}×${EH}, ${store.SEQ.T.toFixed(1)}s, H.264)`);
  }catch(err){
    setHint('⚠ MP4 编码失败:'+(err?.message||err)+' —— 可改用 🎞 PNG 序列');
  }
  $('mp4Btn').textContent='🎬 MP4'; store.exporting=false;
}

export function toggleRecord(){
  if(store.recorder){ store.recorder.stop(); return; }
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
