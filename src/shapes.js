// 形状包围盒统一写入口:数值输入、方向键微移、对齐吸附都经这里改形状,
// 各类型的特殊性(path 按比例缩放锚点、text 高度定宽)只此一处处理。
import { pathBBox } from './path.js';
import { measureText } from './pipeline.js';

export function applyShapeBBox(sh, nx, ny, nw, nh){
  if(sh.type==='path'){
    const sx=sh.w<1e-6?1:nw/sh.w, sy=sh.h<1e-6?1:nh/sh.h;
    sh.points=sh.points.map(p=>({x:nx+(p.x-sh.x)*sx, y:ny+(p.y-sh.y)*sy}));
    Object.assign(sh, pathBBox(sh.points));
  } else if(sh.type==='text'){
    sh.x=nx; sh.y=ny; sh.h=Math.max(14,nh); sh.w=measureText(sh.text, sh.h); // 文字宽随字号
  } else {
    sh.x=nx; sh.y=ny; sh.w=Math.max(1,nw); sh.h=Math.max(1,nh);
  }
}
