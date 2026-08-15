// 🖥 输出变换(导出末端):把渲染好的方形动画,适配进任意目标画幅(如 36:15 的屏幕),
// 并可【整体镜像 / 旋转 / 四角透视 warp】—— 全部有实时预览,所见即所得。
// 纯几何 + 画布搬运:无 warp 时走 drawImage(快、精确);有 warp 时按【逆向单应】逐像素采样(透视贴合)。

// 十六进制颜色 → [r,g,b](本地小工具,避免为一处依赖引入 DOM 模块;支持 #rgb / #rrggbb)。
function hex2rgbLocal(h){ h=(h||'#000000').replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join('');
  const n=parseInt(h,16)||0; return [(n>>16)&255,(n>>8)&255,n&255]; }

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

// ── 网格 warp(mesh):(gx+1)×(gy+1) 个控制点,行主序,归一化目标坐标。每点可拖 → 分区精细 warp。──
// 默认 = 规则网格(铺满目标)。gx=gy=1 即 2×2 = 四角(退化为透视 corner-pin)。
export function defaultMesh(gx,gy){
  const pts=[]; for(let j=0;j<=gy;j++) for(let i=0;i<=gx;i++) pts.push([i/gx, j/gy]); return pts;
}
const mAt=(mesh,gx,i,j)=>mesh[j*(gx+1)+i];
// 双线性求任意 (u,v)∈[0,1] 在当前网格里的目标点 —— 用于改网格密度时保形重采样。
export function evalMesh(mesh,gx,gy,u,v){
  const fx=Math.max(0,Math.min(gx,u*gx)), fy=Math.max(0,Math.min(gy,v*gy));
  const i=Math.min(gx-1,Math.max(0,Math.floor(fx))), j=Math.min(gy-1,Math.max(0,Math.floor(fy)));
  const tx=fx-i, ty=fy-j;
  const a=mAt(mesh,gx,i,j), b=mAt(mesh,gx,i+1,j), c=mAt(mesh,gx,i,j+1), d=mAt(mesh,gx,i+1,j+1);
  const lx=(p,q)=>[p[0]+(q[0]-p[0])*tx, p[1]+(q[1]-p[1])*tx];
  const top=lx(a,b), bot=lx(c,d);
  return [top[0]+(bot[0]-top[0])*ty, top[1]+(bot[1]-top[1])*ty];
}
// 改网格密度:在旧网格上按新规则位置求值 → 保持当前 warp 形状,不清零。
export function resampleMesh(mesh,gx,gy,ngx,ngy){
  const out=[]; for(let j=0;j<=ngy;j++) for(let i=0;i<=ngx;i++) out.push(evalMesh(mesh,gx,gy,i/ngx,j/ngy)); return out;
}
// 3 点仿射:源三角 s→目标三角 d,返回 canvas setTransform 参数 [a,d,b,e,c,f]。
function affine3(s,d){
  const Si=inv3([s[0][0],s[0][1],1, s[1][0],s[1][1],1, s[2][0],s[2][1],1]);
  const col=k=>[ Si[0]*d[0][k]+Si[1]*d[1][k]+Si[2]*d[2][k],
                 Si[3]*d[0][k]+Si[4]*d[1][k]+Si[5]*d[2][k],
                 Si[6]*d[0][k]+Si[7]*d[1][k]+Si[8]*d[2][k] ];
  const [a,b,c]=col(0), [dd,e,f]=col(1);
  return [a,dd,b,e,c,f];   // setTransform(m11,m12,m21,m22,dx,dy)
}
// 目标三角略微向外扩(抗三角接缝的细线/漏隙)。扩得更足一点 → 相邻三角充分交叠,
// 高分辨率导出时不再露出对角接缝细线(小预览里本就看不见,全尺寸视频里才明显)。
function inflate(tri,px){ const cx=(tri[0][0]+tri[1][0]+tri[2][0])/3, cy=(tri[0][1]+tri[1][1]+tri[2][1])/3;
  return tri.map(([x,y])=>{ const dx=x-cx,dy=y-cy,L=Math.hypot(dx,dy)||1; return [x+dx/L*px, y+dy/L*px]; }); }
// 镜像/旋转预处理:先把源翻/转进临时画布,网格再 warp 它(方位与快路径一致)。
function preTransform(src,mirX,mirY,rot){
  const r=((rot%360)+360)%360, sw=src.width, sh=src.height;
  const w=(r===90||r===270)?sh:sw, h=(r===90||r===270)?sw:sh;
  const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d');
  g.translate(w/2,h/2); g.rotate(r*Math.PI/180); g.scale(mirX?-1:1, mirY?-1:1); g.drawImage(src,-sw/2,-sh/2);
  return c;
}
// 网格 warp:逐格 2 三角,把源规则网格仿射贴到目标形变网格。快、复用 drawImage、可任意密。
function meshWarp(src, octx, w, h, mesh, gx, gy, mirX, mirY, rot){
  const pre=(mirX||mirY||rot) ? preTransform(src,mirX,mirY,rot) : src;
  const pw=pre.width, ph=pre.height;
  // 不再在这里 clearRect —— 上游 applyOutputTransform 已按背景色填充/清空整幅。保留那层底色 →
  // 三角接缝处的漏隙露出的是背景色(如白),而非透明/黑,配合下面更足的三角交叠,导出全尺寸不见对角细线。
  for(let j=0;j<gy;j++) for(let i=0;i<gx;i++){
    // 源四角(像素)+ 目标四角(像素)
    const sTL=[i/gx*pw, j/gy*ph], sTR=[(i+1)/gx*pw, j/gy*ph], sBL=[i/gx*pw,(j+1)/gy*ph], sBR=[(i+1)/gx*pw,(j+1)/gy*ph];
    const P0=mAt(mesh,gx,i,j), P1=mAt(mesh,gx,i+1,j), P2=mAt(mesh,gx,i,j+1), P3=mAt(mesh,gx,i+1,j+1);
    const dTL=[P0[0]*w,P0[1]*h], dTR=[P1[0]*w,P1[1]*h], dBL=[P2[0]*w,P2[1]*h], dBR=[P3[0]*w,P3[1]*h];
    const tris=[[[sTL,sTR,sBL],[dTL,dTR,dBL]], [[sTR,sBR,sBL],[dTR,dBR,dBL]]];
    for(const [s,d] of tris){
      const di=inflate(d,1.0);   // 更足的交叠余量,遮住相邻三角间的对角接缝
      octx.save();
      octx.beginPath(); octx.moveTo(di[0][0],di[0][1]); octx.lineTo(di[1][0],di[1][1]); octx.lineTo(di[2][0],di[2][1]); octx.closePath(); octx.clip();
      const m=affine3(s,di); octx.setTransform(m[0],m[1],m[2],m[3],m[4],m[5]);
      octx.drawImage(pre,0,0);
      octx.restore();
    }
  }
  octx.setTransform(1,0,0,1,0,0);
}

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
  const {w,h,fit='fit',warp,corners,sx=1,sy=1}=opts;
  if(warp && corners) return corners.map(([x,y])=>[x*w, y*h]);
  if(fit==='stretch') return [[0,0],[w,0],[w,h],[0,h]];
  if(fit==='manual'){
    // 手动拉伸:以「等比留边」为基准(不变形时铺满可用空间),再各自乘用户倍率 sx/sy —— 想拉多宽自己定,
    // 空出的地方由 applyOutputTransform 的背景色填满。sx=sy=1 即等比留边;sx>sy 横向拉宽。
    const s0=Math.min(w/sw, h/sh);
    const dw=sw*s0*sx, dh=sh*s0*sy, ox=(w-dw)/2, oy=(h-dh)/2;
    return [[ox,oy],[ox+dw,oy],[ox+dw,oy+dh],[ox,oy+dh]];
  }
  const s = fit==='fill' ? Math.max(w/sw,h/sh) : Math.min(w/sw,h/sh);
  const dw=sw*s, dh=sh*s, ox=(w-dw)/2, oy=(h-dh)/2;
  return [[ox,oy],[ox+dw,oy],[ox+dw,oy+dh],[ox,oy+dh]];
}

// 🪞 双边镜像(中线对称):与 P2 实装导出的 mirrorSymmetricH 同逻辑 —— 沿中线把画面镜像叠加成对称。
// axis:'h'=沿【竖直中线】左右对称(默认);'v'=沿【水平中线】上下对称。返回对称后的新画布。
// 合并:透明底→source-over(内容并集);不透明→按底色明暗取 darken/lighten,内容像素胜出。
export function symMirror(src, axis, transBg){
  const w=src.width, h=src.height;
  const out=document.createElement('canvas'); out.width=w; out.height=h;
  const ctx=out.getContext('2d',{willReadFrequently:true}); ctx.imageSmoothingEnabled=false;
  ctx.drawImage(src,0,0);
  const tmp=document.createElement('canvas'); tmp.width=w; tmp.height=h;
  const tc=tmp.getContext('2d'); tc.imageSmoothingEnabled=false;
  if(axis==='v') tc.setTransform(1,0,0,-1,0,h); else tc.setTransform(-1,0,0,1,w,0);  // 翻转副本
  tc.drawImage(src,0,0); tc.setTransform(1,0,0,1,0,0);
  let mode='source-over';
  if(!transBg){ const d=ctx.getImageData(0,0,1,1).data; mode=((d[0]+d[1]+d[2])/3>128)?'darken':'lighten'; }
  ctx.save(); ctx.globalCompositeOperation=mode; ctx.drawImage(tmp,0,0); ctx.restore();
  return out;
}

// 把源 src 按 fit 方式画进 dw×dh 的框(居中)。fit:'fit'=等比留边;'fill'=等比裁满;'stretch'=拉伸填满。
function fitInto(ctx, src, dw, dh, fit){
  const sw=src.width, sh=src.height;
  if(fit==='stretch'){ ctx.drawImage(src,0,0,dw,dh); return; }
  const s = fit==='fill' ? Math.max(dw/sw,dh/sh) : Math.min(dw/sw,dh/sh);
  const rw=sw*s, rh=sh*s;
  ctx.drawImage(src, (dw-rw)/2, (dh-rh)/2, rw, rh);
}
// 🪞🪞 双边【铺满】:把动画装进目标画幅的【一半】,再镜像到另一半 —— 填满整条宽灯带的左右/上下两半。
// axis:'h'=左右两半(左半装动画→镜像到右半);'v'=上下两半。与「对称叠加」不同:那是整幅沿中线叠加(内容已满幅时用);
// 这里是给「方形动画塞进 36:15 宽屏、想让内容双边充满整幅」用的。产物已是 w×h 目标尺寸 → 后续 fit 走 stretch(恒等)。
export function symFill(src, axis, w, h, fit){
  const out=document.createElement('canvas'); out.width=w; out.height=h;
  const ctx=out.getContext('2d'); ctx.imageSmoothingEnabled=false;
  if(axis==='v'){
    const hh=Math.max(1,Math.round(h/2));
    const half=document.createElement('canvas'); half.width=w; half.height=hh;
    const hc=half.getContext('2d'); hc.imageSmoothingEnabled=false; fitInto(hc, src, w, hh, fit);
    ctx.drawImage(half,0,0);                                             // 上半
    ctx.save(); ctx.setTransform(1,0,0,-1,0,h); ctx.drawImage(half,0,0); ctx.restore(); // 下半=镜像
  } else {
    const hw=Math.max(1,Math.round(w/2));
    const half=document.createElement('canvas'); half.width=hw; half.height=h;
    const hc=half.getContext('2d'); hc.imageSmoothingEnabled=false; fitInto(hc, src, hw, h, fit);
    ctx.drawImage(half,0,0);                                             // 左半
    ctx.save(); ctx.setTransform(-1,0,0,1,w,0); ctx.drawImage(half,0,0); ctx.restore(); // 右半=镜像
  }
  return out;
}

// 核心:src 画布 → 目标 out 画布(w×h),应用 双边镜像/fit/镜像/旋转/warp。写入 outCanvas 并返回它。
export function applyOutputTransform(src, opts, outCanvas){
  // 🪞 双边镜像【最先施加】(在 fit/旋转/warp 之前)—— 与 P2「镜像在分屏切割之前」一致,后续变换作用于已对称的内容。
  const sm=opts.symMirror;
  if(sm==='hfill' || sm==='vfill'){
    src=symFill(src, sm==='hfill'?'h':'v', opts.w, opts.h, opts.fit||'fit'); // 已生成 w×h → 后续 fit 恒等
    opts={...opts, fit:'stretch'};
  } else if(sm && sm!=='off'){
    src=symMirror(src, sm, opts.transBg);                                   // 整幅对称叠加(旧行为)
  }
  const {w,h,mirX,mirY,rot=0,warp}=opts;
  const out=outCanvas||document.createElement('canvas');
  if(out.width!==w||out.height!==h){ out.width=w; out.height=h; }
  const octx=out.getContext('2d');
  // 🎨 留边填充:非透明底时,先把整幅填成【背景色】—— 于是「等比留边」空出来的边不再是黑/透明,
  // 而是画布背景色(如白):图形保持原比例不变,四周用背景色补满整条画幅(用户想要的「填白 fill」)。
  // 「等比裁满/拉伸」会盖满整幅,这层底色被覆盖、无副作用;透明底(transBg)则保持透明。
  const bgHex = (!opts.transBg && opts.bg) ? opts.bg : null;
  if(bgHex){ octx.fillStyle=bgHex; octx.fillRect(0,0,w,h); } else octx.clearRect(0,0,w,h);
  const sw=src.width, sh=src.height;
  // 🕸 网格 warp:mesh(gx×gy 控制点)。>1×1 → 逐格三角仿射(任意密、可分区精细拖);
  //    1×1(四角)→ 走透视 homography(更"正"的透视贴合)。mesh 行主序,四角 = TL,TR,BL,BR。
  if(warp && opts.mesh){
    const m=opts.mesh;
    if(opts.gx>1 || opts.gy>1){ meshWarp(src, octx, w, h, m, opts.gx, opts.gy, mirX, mirY, rot); return out; }
    opts={...opts, corners:[m[0], m[1], m[3], m[2]]};   // TL,TR,BR,BL(homography 角序)
  }
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
  if(bgHex){ const [br,bg2,bb]=hex2rgbLocal(bgHex);            // putImageData 会整幅替换 → 先把四边形外铺成背景色
    for(let p=0;p<d.length;p+=4){ d[p]=br; d[p+1]=bg2; d[p+2]=bb; d[p+3]=255; } }
  for(let y=minY;y<maxY;y++) for(let x=minX;x<maxX;x++){
    const [u,v]=proj(M, x+0.5, y+0.5);
    if(u<-0.001||v<-0.001||u>1.001||v>1.001) continue;   // 四边形外
    const [su,sv]=srcUV(u,v,mirX,mirY,rot);
    sample(sd,sw,sh, su*(sw-1), sv*(sh-1), d, (y*w+x)*4);
  }
  octx.putImageData(img,0,0);
  return out;
}
