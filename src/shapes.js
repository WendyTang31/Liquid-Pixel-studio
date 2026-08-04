// 形状包围盒统一写入口:数值输入、方向键微移、对齐吸附都经这里改形状,
// 各类型的特殊性(path 按比例缩放锚点、text 高度定宽)只此一处处理。
import { pathBBox } from './path.js';
import { measureText } from './pipeline.js';

// 矩形/椭圆 → 可编辑 path(圆/方也能用钢笔的全部功能:锚点/手柄/多选/旋转/骨骼)。
// 矩形=4 尖角;椭圆=4 锚点带 kappa 贝塞尔柄(光滑)。保留 bool/solidFill/layerId/采样/rig 等全部字段。
const KAPPA=0.5522847498;
export function shapeToPath(sh){
  if(sh.type==='path') return sh;
  const {x,y,w,h}=sh; let points;
  if(sh.type==='rect'){
    points=[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
  } else if(sh.type==='ellipse'){
    const cx=x+w/2, cy=y+h/2, rx=w/2, ry=h/2, k=KAPPA;
    points=[
      {x:cx+rx,y:cy, hIn:{x:cx+rx,y:cy-ry*k}, hOut:{x:cx+rx,y:cy+ry*k}},
      {x:cx,y:cy+ry, hIn:{x:cx+rx*k,y:cy+ry}, hOut:{x:cx-rx*k,y:cy+ry}},
      {x:cx-rx,y:cy, hIn:{x:cx-rx,y:cy+ry*k}, hOut:{x:cx-rx,y:cy-ry*k}},
      {x:cx,y:cy-ry, hIn:{x:cx-rx*k,y:cy-ry}, hOut:{x:cx+rx*k,y:cy-ry}},
    ];
  } else return null; // text/image 不转
  return {...sh, type:'path', bezier:true, points};
}

export function applyShapeBBox(sh, nx, ny, nw, nh){
  if(sh.type==='path'){
    const sx=sh.w<1e-6?1:nw/sh.w, sy=sh.h<1e-6?1:nh/sh.h;
    const S=(px,py)=>({x:nx+(px-sh.x)*sx, y:ny+(py-sh.y)*sy});
    sh.points=sh.points.map(p=>{ const o=S(p.x,p.y);            // 缩放时保留贝塞尔柄(此前会丢)
      if(p.hIn) o.hIn=S(p.hIn.x,p.hIn.y); if(p.hOut) o.hOut=S(p.hOut.x,p.hOut.y); return o; });
    Object.assign(sh, pathBBox(sh.points));
  } else if(sh.type==='text'){
    sh.x=nx; sh.y=ny; sh.h=Math.max(14,nh); sh.w=measureText(sh.text, sh.h); // 文字宽随字号
  } else {
    sh.x=nx; sh.y=ny; sh.w=Math.max(1,nw); sh.h=Math.max(1,nh);
  }
}
