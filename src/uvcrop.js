// 🧩 按取景框导出(给 Blender 用)
//
// 3D 预览器里每个投影面/UV 层都有一个「取景框」(cx,cy,cw,ch,归一化画布坐标)—— 只有框内的画面
// 会被贴到模型上,框外的部分根本不参与投影。但导出至今给的是【整张画布】,于是:
//   · 框外那些永远用不到的画面白占了分辨率;
//   · 模型对称、左右共用同一块 UV 时,只有半边有内容。
// 本模块把导出改成「裁到框内 + 按需镜像补全」:输出 = 框内画面(+它的镜像),框外一律丢弃。
//
// 纯几何 + 画布搬运,零重采样以外的处理:裁切是同尺寸 1:1 拷贝,镜像是 scale(-1) 翻转绘制。
import { P } from './config.js';

export const uvCropOn = () => !!(P.uvCrop && P.uvCrop.on);
export const uvCropCfg = () => Object.assign({ on:false, patch:'', mirror:'h', res:4096 }, P.uvCrop||{});

// 读 3D 预览器写下的取景框列表(morph-uvlayout)。返回 [{name,cx,cy,cw,ch}]。
export function uvPatches(){
  try{
    const l=JSON.parse(localStorage.getItem('morph-uvlayout')||'null');
    return (l?.patches||[]).filter(p=>p && p.cw>0 && p.ch>0)
      .map(p=>({ name:p.name||'(未命名)', cx:p.cx||0, cy:p.cy||0, cw:p.cw, ch:p.ch }));
  }catch(_){ return []; }
}
// 当前选中的取景框;没选或找不到 → 取第一个;都没有 → null。
export function activePatch(){
  const list=uvPatches(); if(!list.length) return null;
  const { patch }=uvCropCfg();
  return list.find(p=>p.name===patch) || list[0];
}

// 镜像模式 → 输出相对于「一块裁切」的倍数(宽,高)。
export function mirrorScale(mode){
  switch(mode){
    case 'h': case 'hl': return [2,1];   // 左右拼:本身 + 水平镜像
    case 'v': case 'vt': return [1,2];   // 上下拼
    case 'quad':         return [2,2];   // 四向对称
    default:             return [1,1];   // 只要框内
  }
}

// 输出尺寸:让最长边等于 res(4K 等),并保持裁切区的真实长宽比 —— 不拉伸不变形。
// 同时回推「方形渲染分辨率 R」:裁切区在 R×R 画布里正好落到所需像素数。
export function planSize(patch, mode, res){
  const [mw,mh]=mirrorScale(mode);
  const aspect=(patch.cw*mw)/(patch.ch*mh);           // 输出宽高比
  let outW, outH;
  if(aspect>=1){ outW=res; outH=Math.max(2,Math.round(res/aspect)); }
  else         { outH=res; outW=Math.max(2,Math.round(res*aspect)); }
  // 一块裁切在输出里占的像素
  const tileW=Math.round(outW/mw), tileH=Math.round(outH/mh);
  // 方形渲染分辨率:tileW 对应画布上的 cw 比例 → R = tileW/cw(取宽高两者较大者,保证不欠采样)
  const R=Math.min(8192, Math.max(256, Math.round(Math.max(tileW/patch.cw, tileH/patch.ch))));
  return { outW:tileW*mw, outH:tileH*mh, tileW, tileH, R };
}

// 把方形渲染结果 src(R×R)按取景框裁出来,并按 mode 镜像拼成输出画布。
// 关键:框外的一切都不进输出 —— 这正是"不要没被投影的部分"。
export function composeCrop(src, patch, mode, plan, out){
  const { outW, outH, tileW, tileH }=plan;
  if(out.width!==outW || out.height!==outH){ out.width=outW; out.height=outH; }
  const g=out.getContext('2d');
  g.imageSmoothingEnabled=true; g.imageSmoothingQuality='high';
  g.clearRect(0,0,outW,outH);
  const R=src.width;
  const sx=patch.cx*R, sy=patch.cy*R, sw=patch.cw*R, sh=patch.ch*R;   // 画布上的取景框(像素)
  // 在 (dx,dy) 画一块,fx/fy 表示是否翻转
  const tile=(dx,dy,fx,fy)=>{
    g.save();
    g.translate(dx + (fx?tileW:0), dy + (fy?tileH:0));
    g.scale(fx?-1:1, fy?-1:1);
    g.drawImage(src, sx,sy,sw,sh, 0,0, tileW,tileH);
    g.restore();
  };
  switch(mode){
    case 'h':  tile(0,0,false,false);      tile(tileW,0,true,false);  break; // 本身 | 右镜像
    case 'hl': tile(0,0,true,false);       tile(tileW,0,false,false); break; // 左镜像 | 本身
    case 'v':  tile(0,0,false,false);      tile(0,tileH,false,true);  break; // 本身 / 下镜像
    case 'vt': tile(0,0,false,true);       tile(0,tileH,false,false); break; // 上镜像 / 本身
    case 'quad':
      tile(0,0,false,false);     tile(tileW,0,true,false);
      tile(0,tileH,false,true);  tile(tileW,tileH,true,true);         break;
    default:   tile(0,0,false,false);                                  break; // 只要框内
  }
  return out;
}
