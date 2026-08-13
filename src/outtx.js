// 🖥 输出变换(导出末端):把渲染好的方形动画,适配进任意目标画幅(如 36:15 的屏幕),
// 并可【整体镜像 / 旋转 / 四角透视 warp】—— 全部有实时预览,所见即所得。
// 纯几何 + 画布搬运:无 warp 时走 drawImage(快、精确);有 warp 时按【逆向单应】逐像素采样(透视贴合)。

// 单位正方形 (0,0)(1,0)(1,1)(0,1) → 目标四边形(Heckbert 闭式解)。返回 3×3 矩阵 M(行主序 [a,b,c,d,e,f,g,h,i])。
export function unitToQuad(c){
  const [x0,y0]=c[0],[x1,y1]=c[1],[x2,y2]=c[2],[x3,y3]=c[3];
  const dx1=x1-x2, dx2=x3-x2, dx3=x0-x1+x2-x3;
  const dy1=y1-y2, dy2=y3-y2, dy3=y0-y1+y2-y3;
  let a,b,cc,d,e,f,g,h;
  if(Math.abs(dx3)<1e-9 && Math.abs(dy3)<1e-9){          // 仿射(无透视)
    a=x1-x0; b=x2-x1; cc=x0; d=y1-y0; e=y2-y1; f=y0; g=0; h=0;
  } else {
    const den=dx1*dy2 - dx2*dy1 || 1e-9;
    g=(dx3*dy2 - dx2*dy3)/den;
    h=(dx1*dy3 - dx3*dy1)/den;
    a=x1-x0+g*x1; b=x3-x0+h*x3; cc=x0;
    d=y1-y0+g*y1; e=y3-y0+h*y3; f=y0;
  }
  return [a,b,cc, d,e,f, g,h,1];
}
// 3×3 逆矩阵。
export function inv3(m){
  const [a,b,c,d,e,f,g,h,i]=m;
  const A=e*i-f*h, B=c*h-b*i, C=b*f-c*e,
        D=f*g-d*i, E=a*i-c*g, F=c*d-a*f,
        G=d*h-e*g, H=b*g-a*h, I=a*e-b*d;
  const det=a*A+b*D+c*G || 1e-9, s=1/det;
  return [A*s,B*s,C*s, D*s,E*s,F*s, G*s,H*s,I*s];
}
// 用 3×3 把 (x,y,1) 投影 → [x',y'](齐次除 w)。
function proj(m,x,y){ const X=m[0]*x+m[1]*y+m[2], Y=m[3]*x+m[4]*y+m[5], W=m[6]*x+m[7]*y+m[8]||1e-9; return [X/W, Y/W]; }

// 默认四角(无 warp):铺满目标(归一化 0..1)。顺序 = 左上,右上,右下,左下。
export const IDENTITY_CORNERS = [[0,0],[1,0],[1,1],[0,1]];

// 源 UV 的镜像/旋转:把采样坐标 (u,v)∈[0,1] 变换后再取源像素。rot=0/90/180/270(顺时针)。
function srcUV(u,v,mirX,mirY,rot){
  let a=u, b=v;
  switch(((rot%360)+360)%360){
    case 90:  { const t=a; a=b; b=1-t; break; }   // 顺时针 90
    case 180: { a=1-a; b=1-b; break; }
    case 270: { const t=a; a=1-b; b=t; break; }
  }
  if(mirX) a=1-a; if(mirY) b=1-b;
  return [a,b];
}

// 双线性采样 srcData(sw×sh)。越界返回全透明。
function sample(sd,sw,sh,fx,fy,out,oi){
  if(fx<0||fy<0||fx>sw-1||fy>sh-1){ out[oi]=0;out[oi+1]=0;out[oi+2]=0;out[oi+3]=0; return; }
  const x0=fx|0,y0=fy|0,x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1),tx=fx-x0,ty=fy-y0;
  const i00=(y0*sw+x0)*4,i10=(y0*sw+x1)*4,i01=(y1*sw+x0)*4,i11=(y1*sw+x1)*4;
  for(let k=0;k<4;k++){ const top=sd[i00+k]*(1-tx)+sd[i10+k]*tx, bot=sd[i01+k]*(1-tx)+sd[i11+k]*tx;
    out[oi+k]=top*(1-ty)+bot*ty; }
}

// 目标画幅四角(像素)。无 warp 时按 fit/fill/stretch 把源方块摆进目标;有 warp 时用 opts.corners(归一化)。
export function destCorners(sw, sh, opts){
  const {w,h,fit='fit',warp,corners}=opts;
  if(warp && corners) return corners.map(([x,y])=>[x*w, y*h]);
  if(fit==='stretch') return [[0,0],[w,0],[w,h],[0,h]];
  const s = fit==='fill' ? Math.max(w/sw,h/sh) : Math.min(w/sw,h/sh);
  const dw=sw*s, dh=sh*s, ox=(w-dw)/2, oy=(h-dh)/2;
  return [[ox,oy],[ox+dw,oy],[ox+dw,oy+dh],[ox,oy+dh]];
}

// 核心:src 画布 → 目标 out 画布(w×h),应用 fit/镜像/旋转/warp。写入 outCanvas 并返回它。
export function applyOutputTransform(src, opts, outCanvas){
  const {w,h,mirX,mirY,rot=0,warp}=opts;
  const out=outCanvas||document.createElement('canvas');
  if(out.width!==w||out.height!==h){ out.width=w; out.height=h; }
  const octx=out.getContext('2d');
  octx.clearRect(0,0,w,h);
  const sw=src.width, sh=src.height;
  const dc=destCorners(sw, sh, opts);
  // 快路径:无 warp 且是【铺满矩形】(fit/fill/stretch 的 dc 是轴对齐矩形)→ 用 drawImage(含镜像/旋转)。
  const axisAligned = !warp;
  if(axisAligned){
    const x0=dc[0][0], y0=dc[0][1], dw=dc[1][0]-dc[0][0], dh=dc[3][1]-dc[0][1];
    octx.save();
    // 先在目标矩形中心做镜像/旋转,再贴源
    const cx=x0+dw/2, cy=y0+dh/2;
    octx.translate(cx,cy);
    octx.rotate((((rot%360)+360)%360)*Math.PI/180);
    octx.scale(mirX?-1:1, mirY?-1:1);
    const r=((rot%360)+360)%360;
    const rw = (r===90||r===270) ? dh : dw, rh = (r===90||r===270) ? dw : dh;  // 旋转 90/270 时目标框宽高对调
    octx.drawImage(src, -rw/2, -rh/2, rw, rh);
    octx.restore();
    return out;
  }
  // warp:逆向单应逐像素。dest 四边形 → 源单位方,取逆矩阵;仅在四边形包围盒内循环。
  const M=inv3(unitToQuad(dc));      // 目标像素 → 源 (u,v)∈[0,1]
  const sd=src.getContext('2d').getImageData(0,0,sw,sh).data;
  const minX=Math.max(0,Math.floor(Math.min(...dc.map(p=>p[0])))), maxX=Math.min(w,Math.ceil(Math.max(...dc.map(p=>p[0]))));
  const minY=Math.max(0,Math.floor(Math.min(...dc.map(p=>p[1])))), maxY=Math.min(h,Math.ceil(Math.max(...dc.map(p=>p[1]))));
  const img=octx.createImageData(w,h), d=img.data;
  for(let y=minY;y<maxY;y++) for(let x=minX;x<maxX;x++){
    const [u,v]=proj(M, x+0.5, y+0.5);
    if(u<-0.001||v<-0.001||u>1.001||v>1.001) continue;   // 四边形外
    const [su,sv]=srcUV(u,v,mirX,mirY,rot);
    sample(sd,sw,sh, su*(sw-1), sv*(sh-1), d, (y*w+x)*4);
  }
  octx.putImageData(img,0,0);
  return out;
}
