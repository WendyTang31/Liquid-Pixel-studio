// 🔩 物理布局映射(P1 创作布局 → P2 实装布局)· 车尾 LED 灯带(ALIAS)
//
// 动画在 P1(5 个模组竖直堆叠、全部正向)里创作;实车上模组 2/3 是【旋转 90° 并排】安装的(P2)。
// 导出时按模组把画面裁切→旋转→平移,于是包到车身上后画面才是对的。
//
// 铁律(与 LED 硬件一致,勿改):
//   · 5 个模组各 128×64(P2.5,320×160mm),控制器画布 = 单张 128×320
//   · 各模组像素间距相同 → 【永不缩放】。只做 裁切 / 90° 旋转 / 平移
//   · 【最近邻,零插值零抗锯齿】:一个源像素恰好落到一个目标像素。P2.5 屏上一个像素就是一颗灯珠,
//     任何混合都会糊掉边缘,毁掉本项目"干净渐变而非模糊"的视觉语言。
//
// 本文件是【纯函数】:只吃 {width,height,data} 这样的 ImageData 形状,不碰 DOM、不改入参 → 可 node 单测。
export const LED_W = 128, LED_H = 320;

// 侧板旋转方向:实装若镜像了,只改这一个常量即可整体翻转(允许 'cw' | 'ccw')。
export const SIDE_PANEL_ROTATION = 'cw';

// 模组映射表 —— 改布局只动这张表,不动 transform 代码。
// src=[x,y,w,h] 取自 P1;dst=[x,y] 是 P2 里的左上角;rotate=顺时针角度。
// 旋转后的目标尺寸由 src 的 w/h 与 rotate 推出(90/270 → h×w),不写死。
export const MODULE_MAP = [
  { name: 'front',      src: [0,   0, 128, 64], dst: [0,   0],   rotate: 0  },
  { name: 'side_left',  src: [0,  64, 128, 64], dst: [0,  64],   rotate: 90 },
  { name: 'side_right', src: [0, 128, 128, 64], dst: [64, 64],   rotate: 90 },
  { name: 'rear_upper', src: [0, 192, 128, 64], dst: [0, 192],   rotate: 0  },
  { name: 'rear_lower', src: [0, 256, 128, 64], dst: [0, 256],   rotate: 0  },
];

// 旋转后的目标区域尺寸。
export function destSize(w, h, rot){ return (rot === 90 || rot === 270) ? [h, w] : [w, h]; }

// 源像素 (sx,sy) → 旋转后区域内的 (dx,dy)。屏幕坐标系(原点左上,y 向下)。
//   90 顺时针:dx = h-1-sy, dy = sx   —— 源上边(sy 小)落到右侧(dx 大),与控制器分组顺序一致
//   270 = 90 逆时针
export function mapPixel(sx, sy, w, h, rot){
  switch(rot){
    case 90:  return [h - 1 - sy, sx];
    case 180: return [w - 1 - sx, h - 1 - sy];
    case 270: return [sy, w - 1 - sx];
    default:  return [sx, sy];
  }
}

// 某模组的实际旋转角:逐模组覆盖(现场校正)优先;否则按表,并受 SIDE_PANEL_ROTATION 整体翻转
// (只影响表里写 90 的侧板 —— 那正是"实装可能镜像"的那两块)。
export function effectiveRot(entry, override, side){
  if(override !== null && override !== undefined) return ((override % 360) + 360) % 360;
  if(entry.rotate === 90 && (side || SIDE_PANEL_ROTATION) === 'ccw') return 270;
  return ((entry.rotate % 360) + 360) % 360;
}

// 纯变换:读一张 128×320 的 P1 帧,返回【新的】128×320 P2 帧。不修改入参。
// opts: { map, rotations:[per-module override|null], side:'cw'|'ccw' }
// 未被任何模组覆盖到的像素 = 不透明黑(LED 灭灯的语义;默认表铺满全画面,通常用不到)。
export function transformP1toP2(src, opts = {}){
  const W = src.width, H = src.height;
  const map = opts.map || MODULE_MAP;
  const rots = opts.rotations || [];
  const side = opts.side || SIDE_PANEL_ROTATION;
  const s = src.data;
  const d = new Uint8ClampedArray(W * H * 4);
  for(let i = 3; i < d.length; i += 4) d[i] = 255;   // 底色:不透明黑

  map.forEach((m, mi) => {
    const [sx0, sy0, w, h] = m.src;
    const [dx0, dy0] = m.dst;
    const rot = effectiveRot(m, rots[mi], side);
    for(let sy = 0; sy < h; sy++){
      const ay = sy0 + sy;
      if(ay < 0 || ay >= H) continue;
      for(let sx = 0; sx < w; sx++){
        const ax = sx0 + sx;
        if(ax < 0 || ax >= W) continue;
        const [rx, ry] = mapPixel(sx, sy, w, h, rot);
        const dx = dx0 + rx, dy = dy0 + ry;
        if(dx < 0 || dy < 0 || dx >= W || dy >= H) continue;   // 越界写入丢弃(覆盖角度异常时的护栏)
        const si = (ay * W + ax) * 4, di = (dy * W + dx) * 4;
        d[di] = s[si]; d[di+1] = s[si+1]; d[di+2] = s[si+2]; d[di+3] = s[si+3];
      }
    }
  });
  return { width: W, height: H, data: d };
}

// ── 校准帧(P1 布局)──
// 每个模组:各自底色 + N 条竖条(N=模组序号 1..5)+ 左上角白色小方块(旋转见证)+ 2px 描边。
// 经 P2 变换后打到硬件上,一眼就能读出"模组顺序 / 旋转方向"对不对:
// 例如模组 2 的左上白块,若旋转正确(90 CW)会出现在其旋转块的【右上角】。
const CAL_COLORS = [
  [255,  64,  64],   // 1 front       红
  [ 64, 255,  96],   // 2 side_left   绿
  [ 64, 160, 255],   // 3 side_right  蓝
  [255, 208,  64],   // 4 rear_upper  黄
  [208, 112, 255],   // 5 rear_lower  紫
];
export function makeCalibrationFrame(map = MODULE_MAP, W = LED_W, H = LED_H){
  const d = new Uint8ClampedArray(W * H * 4);
  for(let i = 3; i < d.length; i += 4) d[i] = 255;
  const put = (x, y, c) => { if(x<0||y<0||x>=W||y>=H) return;
    const i = (y * W + x) * 4; d[i]=c[0]; d[i+1]=c[1]; d[i+2]=c[2]; d[i+3]=255; };
  map.forEach((m, mi) => {
    const [x0, y0, w, h] = m.src;
    const col = CAL_COLORS[mi % CAL_COLORS.length];
    const dim = [col[0]*0.22|0, col[1]*0.22|0, col[2]*0.22|0];
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) put(x0+x, y0+y, dim);      // 底色(暗)
    const bars = mi + 1;                                                 // N 条竖条 = 模组序号
    const bw = Math.max(2, Math.round(w / (bars * 4)));
    for(let b=0;b<bars;b++){
      const cx = Math.round((b + 1) * w / (bars + 1));
      for(let x=cx-(bw>>1); x<cx-(bw>>1)+bw; x++)
        for(let y=6; y<h-6; y++) put(x0+x, y0+y, col);
    }
    for(let t=0;t<2;t++){                                                // 2px 描边
      for(let x=0;x<w;x++){ put(x0+x, y0+t, col); put(x0+x, y0+h-1-t, col); }
      for(let y=0;y<h;y++){ put(x0+t, y0+y, col); put(x0+w-1-t, y0+y, col); }
    }
    const q = Math.max(4, Math.round(Math.min(w, h) / 8));               // 左上角白块 = 旋转见证
    for(let y=2;y<2+q;y++) for(let x=2;x<2+q;x++) put(x0+x, y0+y, [255,255,255]);
  });
  return { width: W, height: H, data: d };
}
