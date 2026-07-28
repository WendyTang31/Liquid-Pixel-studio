// 导出层:PNG 序列(JSZip,离线逐帧确定性渲染)+ WebM 实时录制(MediaRecorder)。
// 关键:导出用的正是预览同一条 sampleFrame,只是换了任意分辨率的渲染器 —— 所见即所得。
import JSZip from 'jszip';
import { P } from './config.js';
import { store } from './store.js';
import { $, getExpSize, setHint, downloadBlob, toBlobP, nextFrame } from './utils.js';
import { sampleFrame } from './engine.js';
import { renderToImageData } from './render.js';
import { rebuildSequence } from './sequence.js';
import { resampleAll } from './pipeline.js';
import { setMode } from './ui/stage.js';

export async function exportPNG(){
  if(store.exporting) return;
  resampleAll(); rebuildSequence();
  const [EW,EH]=getExpSize();
  const frames=Math.round(store.SEQ.T*P.fps);
  if(frames<2){ setHint('⚠ 序列太短'); return; }
  if(frames>1200){ setHint(`⚠ ${frames} 帧超上限1200,请缩短停留/过渡或降帧率`); return; }
  store.exporting=true; $('pngBtn').textContent='… 渲染中';
  const ec=document.createElement('canvas'); ec.width=EW; ec.height=EH;
  const ectx=ec.getContext('2d');
  // 2×超采样:内部按双倍分辨率渲染,drawImage 双线性缩回 → 边缘更细腻
  const ss=P.ss2x?2:1;
  const big=document.createElement('canvas'); big.width=EW*ss; big.height=EH*ss;
  const bctx=big.getContext('2d');
  // 辉光:成品帧模糊后 lighter 加亮叠回(经典 bloom 近似);经拷贝画布避免自引用绘制
  const glowCv=document.createElement('canvas'); glowCv.width=EW; glowCv.height=EH;
  const glowCtx=glowCv.getContext('2d');
  const zip=new JSZip();
  for(let f=0;f<frames;f++){
    const g=f/P.fps;
    const fr=sampleFrame(store.SEQ, store.states, g, g, P); // 导出与预览共用 sampleFrame
    if(ss===2){ renderToImageData(bctx,EW*2,EH*2,fr.balls,fr.col,P,fr.solids,fr.cam); ectx.drawImage(big,0,0,EW,EH); }
    else renderToImageData(ectx,EW,EH,fr.balls,fr.col,P,fr.solids,fr.cam);
    if(P.glow>0){
      glowCtx.clearRect(0,0,EW,EH); glowCtx.drawImage(ec,0,0);
      ectx.save();
      ectx.filter=`blur(${Math.max(2,Math.round(EW/160))}px)`;
      ectx.globalCompositeOperation='lighter';
      ectx.globalAlpha=P.glow;
      ectx.drawImage(glowCv,0,0);
      ectx.restore();
    }
    zip.file(`frame_${String(f).padStart(4,'0')}.png`, await toBlobP(ec));
    if(f%5===0){ setHint(`导出中 ${f+1}/${frames}…`); await nextFrame(); }
  }
  setHint('打包 zip…');
  downloadBlob(await zip.generateAsync({type:'blob'}),
    `morph_seq_${EW}x${EH}_${P.fps}fps_${frames}f.zip`);
  setHint(`✓ 已导出整条序列 ${frames} 帧 (${EW}×${EH}, ${store.SEQ.T.toFixed(1)}s)`);
  $('pngBtn').textContent='🎞 PNG 序列'; store.exporting=false;
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
