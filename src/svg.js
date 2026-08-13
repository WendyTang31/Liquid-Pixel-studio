// SVG 导入:把 Illustrator 等矢量软件导出的 SVG(含贝塞尔控制点)解析成本工具的 path 形状 ——
// 锚点带 hIn/hOut(绝对坐标控制柄),与钢笔工具 / 木偶变形 / 实心填充完全同构。导入后即可编辑、
// 打关键帧做动画、贴到 3D 车身。控制点全程保留(不重采样),这正是相较"位图→点阵"的关键优势。
//
// 工作流:Illustrator ▸ File ▸ Save As / Export ▸ SVG(默认设置即可)→ 这里导入。
// 支持 <path>(M/L/H/V/C/S/Q/T/A/Z 全量,含相对小写)+ rect/circle/ellipse/line/polyline/polygon;
// 元素/分组 transform 与 viewBox 经 getScreenCTM 归一;整组按包围盒等比拟合进画布并居中。
//
// parsePathD / arcToCubics 是纯几何,可 node 单测;importSvgShapes 需 DOM(取变换矩阵)。
import { pathBBox } from './path.js';

// SVG 文本 → DOM 文档。先剥离 XML 注释:很多手写/工具导出的 SVG 注释里含 "----"(双连字符),
// 浏览器当图片渲染时宽容,但 DOMParser 的 image/svg+xml 严格模式会报 "Comment must not contain '--'"
// 直接解析失败。注释与几何无关,整段删掉最稳。
export function parseSvgDoc(svgText){
  const clean=(svgText||'').replace(/<!--[\s\S]*?-->/g, '');
  const doc=new DOMParser().parseFromString(clean, 'image/svg+xml');
  if(doc.querySelector('parsererror')) throw new Error('SVG 解析失败(文件可能不是有效 SVG)');
  const svg=doc.querySelector('svg');
  if(!svg) throw new Error('未找到 <svg> 根节点');
  return svg;
}

// ── <path d="…"> 解析 ──
// 返回子路径数组:每个 = { anchors:[{x,y,hIn?,hOut?}], closed:bool }。
// hOut = 该锚点【指向下一点】的出柄;hIn = 【来自上一点】的入柄(与 path.fillBezierPath 约定一致)。
export function parsePathD(d){
  const toks=(d||'').match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)||[];
  let i=0; const num=()=>parseFloat(toks[i++]);
  const subs=[]; let sub=null;
  let cx=0, cy=0, sx=0, sy=0, cmd=null, prevC2=null, prevQ=null;
  const startSub=(x,y)=>{ sub={anchors:[{x,y}], closed:false}; subs.push(sub); cx=sx=x; cy=sy=y; prevC2=prevQ=null; };
  const lineTo=(x,y)=>{ if(!sub) startSub(x,y); else sub.anchors.push({x,y}); cx=x; cy=y; prevC2=prevQ=null; };
  const cubicTo=(x1,y1,x2,y2,x,y)=>{ if(!sub) startSub(cx,cy);
    const a=sub.anchors[sub.anchors.length-1]; a.hOut={x:x1,y:y1};
    sub.anchors.push({x,y,hIn:{x:x2,y:y2}}); cx=x; cy=y; prevC2={x:x2,y:y2}; prevQ=null; };
  const quadTo=(qx,qy,x,y)=>{ // 二次贝塞尔 → 等价三次
    cubicTo(cx+2/3*(qx-cx), cy+2/3*(qy-cy), x+2/3*(qx-x), y+2/3*(qy-y), x, y); prevQ={x:qx,y:qy}; prevC2=null; };
  while(i<toks.length){
    if(/[A-Za-z]/.test(toks[i])){ cmd=toks[i]; i++; } // 命令;数字打头=沿用上一命令(隐式重复)
    if(cmd==null) break;
    const rel=cmd>='a', C=cmd.toUpperCase();
    if(C==='M'){ let x=num(),y=num(); if(rel){x+=cx;y+=cy;} startSub(x,y); cmd=rel?'l':'L'; } // M 之后隐式为 L
    else if(C==='L'){ let x=num(),y=num(); if(rel){x+=cx;y+=cy;} lineTo(x,y); }
    else if(C==='H'){ let x=num(); if(rel)x+=cx; lineTo(x,cy); }
    else if(C==='V'){ let y=num(); if(rel)y+=cy; lineTo(cx,y); }
    else if(C==='C'){ let x1=num(),y1=num(),x2=num(),y2=num(),x=num(),y=num();
      if(rel){x1+=cx;y1+=cy;x2+=cx;y2+=cy;x+=cx;y+=cy;} cubicTo(x1,y1,x2,y2,x,y); }
    else if(C==='S'){ let x2=num(),y2=num(),x=num(),y=num(); if(rel){x2+=cx;y2+=cy;x+=cx;y+=cy;}
      const r=prevC2?{x:2*cx-prevC2.x,y:2*cy-prevC2.y}:{x:cx,y:cy}; cubicTo(r.x,r.y,x2,y2,x,y); }
    else if(C==='Q'){ let qx=num(),qy=num(),x=num(),y=num(); if(rel){qx+=cx;qy+=cy;x+=cx;y+=cy;} quadTo(qx,qy,x,y); }
    else if(C==='T'){ let x=num(),y=num(); if(rel){x+=cx;y+=cy;}
      const q=prevQ?{x:2*cx-prevQ.x,y:2*cy-prevQ.y}:{x:cx,y:cy}; quadTo(q.x,q.y,x,y); }
    else if(C==='A'){ let rx=num(),ry=num(),rot=num(),laf=num(),sf=num(),x=num(),y=num(); if(rel){x+=cx;y+=cy;}
      for(const seg of arcToCubics(cx,cy,rx,ry,rot,laf,sf,x,y)) cubicTo(...seg); cx=x; cy=y; prevC2=prevQ=null; }
    else if(C==='Z'){ if(sub){ sub.closed=true; const a=sub.anchors; // 收尾锚点与起点重合则并回起点
        if(a.length>1 && Math.hypot(a[a.length-1].x-sx,a[a.length-1].y-sy)<1e-3){
          const last=a.pop(); if(last.hIn) a[0].hIn=last.hIn; } }
      cx=sx; cy=sy; cmd=null; }
    else { i++; }
  }
  return subs.filter(s=>s.anchors.length>=2);
}

// SVG 椭圆弧 → 一串三次贝塞尔(端点参数化,单段 ≤90°)。返回 [[x1,y1,x2,y2,x,y], …]。
export function arcToCubics(x1,y1, rx,ry, phiDeg, laf, sf, x2,y2){
  if(rx===0||ry===0||(x1===x2&&y1===y2)) return [[x1,y1,x2,y2,x2,y2]]; // 退化为直线
  rx=Math.abs(rx); ry=Math.abs(ry);
  const phi=phiDeg*Math.PI/180, cp=Math.cos(phi), sp=Math.sin(phi);
  const dx=(x1-x2)/2, dy=(y1-y2)/2;
  const x1p=cp*dx+sp*dy, y1p=-sp*dx+cp*dy;
  let rx2=rx*rx, ry2=ry*ry; const lam=x1p*x1p/rx2+y1p*y1p/ry2;
  if(lam>1){ const s=Math.sqrt(lam); rx*=s; ry*=s; rx2=rx*rx; ry2=ry*ry; }
  const sign=(laf!==sf)?1:-1;
  const co=sign*Math.sqrt(Math.max(0,(rx2*ry2-rx2*y1p*y1p-ry2*x1p*x1p)/(rx2*y1p*y1p+ry2*x1p*x1p)));
  const cxp=co*rx*y1p/ry, cyp=-co*ry*x1p/rx;
  const cx=cp*cxp-sp*cyp+(x1+x2)/2, cy=sp*cxp+cp*cyp+(y1+y2)/2;
  const ang=(ux,uy,vx,vy)=>{ let a=Math.acos(Math.max(-1,Math.min(1,(ux*vx+uy*vy)/(Math.hypot(ux,uy)*Math.hypot(vx,vy)))));
    return (ux*vy-uy*vx<0)?-a:a; };
  let th1=ang(1,0,(x1p-cxp)/rx,(y1p-cyp)/ry);
  let dth=ang((x1p-cxp)/rx,(y1p-cyp)/ry,(-x1p-cxp)/rx,(-y1p-cyp)/ry);
  if(!sf&&dth>0)dth-=2*Math.PI; if(sf&&dth<0)dth+=2*Math.PI;
  const n=Math.max(1,Math.ceil(Math.abs(dth)/(Math.PI/2))), delta=dth/n, tq=4/3*Math.tan(delta/4);
  const out=[]; let t=th1;
  for(let s=0;s<n;s++){
    const c1=Math.cos(t), s1=Math.sin(t), t2=t+delta, c2=Math.cos(t2), s2=Math.sin(t2);
    const p2x=cx+rx*cp*c2-ry*sp*s2, p2y=cy+rx*sp*c2+ry*cp*s2;
    const d1x=-rx*cp*s1-ry*sp*c1, d1y=-rx*sp*s1+ry*cp*c1;
    const d2x=-rx*cp*s2-ry*sp*c2, d2y=-rx*sp*s2+ry*cp*c2;
    const p1x=cx+rx*cp*c1-ry*sp*s1, p1y=cy+rx*sp*c1+ry*cp*s1;
    out.push([p1x+tq*d1x, p1y+tq*d1y, p2x-tq*d2x, p2y-tq*d2y, p2x, p2y]); t=t2;
  }
  return out;
}

// 圆/椭圆 → 4 锚点(右下左上)带对称贝塞尔柄(kappa),光滑闭合。
function ellipseAnchors(cx,cy,rx,ry){ const k=0.5522847498;
  const A=(x,y,hi,ho)=>({x,y,hIn:hi,hOut:ho});
  return [
    A(cx+rx,cy, {x:cx+rx,y:cy-ry*k}, {x:cx+rx,y:cy+ry*k}),
    A(cx,cy+ry, {x:cx+rx*k,y:cy+ry}, {x:cx-rx*k,y:cy+ry}),
    A(cx-rx,cy, {x:cx-rx,y:cy+ry*k}, {x:cx-rx,y:cy-ry*k}),
    A(cx,cy-ry, {x:cx-rx*k,y:cy-ry}, {x:cx+rx*k,y:cy-ry}),
  ];
}

// 单个 SVG 图元 → 子路径数组(用户坐标,未应用变换)。
function elementToSubs(el){
  const tag=el.tagName.toLowerCase();
  const n=(a,d=0)=>{ const v=parseFloat(el.getAttribute(a)); return isFinite(v)?v:d; };
  if(tag==='path') return parsePathD(el.getAttribute('d'));
  if(tag==='rect'){ const x=n('x'),y=n('y'),w=n('width'),h=n('height');
    return w>0&&h>0?[{anchors:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}], closed:true}]:[]; }
  if(tag==='circle'){ const r=n('r'); return r>0?[{anchors:ellipseAnchors(n('cx'),n('cy'),r,r), closed:true}]:[]; }
  if(tag==='ellipse'){ const rx=n('rx'),ry=n('ry'); return rx>0&&ry>0?[{anchors:ellipseAnchors(n('cx'),n('cy'),rx,ry), closed:true}]:[]; }
  if(tag==='line') return [{anchors:[{x:n('x1'),y:n('y1')},{x:n('x2'),y:n('y2')}], closed:false}];
  if(tag==='polyline'||tag==='polygon'){
    const p=(el.getAttribute('points')||'').trim().split(/[\s,]+/).map(Number).filter(v=>isFinite(v));
    const a=[]; for(let i=0;i+1<p.length;i+=2) a.push({x:p[i],y:p[i+1]});
    return a.length>=2?[{anchors:a, closed:tag==='polygon'}]:[]; }
  return [];
}

function applyMatrix(sub, m){
  if(!m) return sub;
  const tf=p=>({x:m.a*p.x+m.c*p.y+m.e, y:m.b*p.x+m.d*p.y+m.f});
  for(const a of sub.anchors){ const q=tf(a); a.x=q.x; a.y=q.y;
    if(a.hIn) a.hIn=tf(a.hIn); if(a.hOut) a.hOut=tf(a.hOut); }
  return sub;
}

// 描边线 → 实心胶囊(stadium)轮廓:两端圆头(stroke-linecap:round)。固定 6 锚点拓扑
// (两条直边 + 两个半圆帽,每帽一个尖点锚,kappa 贝塞尔柄圆滑)—— 拓扑恒定,才能让"同一肢体在
// 各关键帧间"逐锚点最短路插值(木偶变形),而非重采样大变形。返回局部坐标子路径(未应用变换)。
function roundCapsule(ax,ay, bx,by, hw){
  const k=0.5522847498;               // 四分之一圆的 kappa
  let dx=bx-ax, dy=by-ay; const len=Math.hypot(dx,dy)||1e-6;
  dx/=len; dy/=len;                   // 单位轴向 d
  const nx=-dy, ny=dx;               // 单位法向 n
  const kh=k*hw;
  const P=(x,y,hi,ho)=>({x,y,hIn:hi,hOut:ho});
  // 六锚:P1=A+n, P2=B+n, P3=B+d(尖), P4=B-n, P5=A-n, P6=A-d(尖)
  const A=[ax,ay], B=[bx,by];
  const add=(p,ux,uy,s)=>({x:p[0]+ux*s, y:p[1]+uy*s});
  const P1=add(A,nx,ny,hw), P2=add(B,nx,ny,hw), P3=add(B,dx,dy,hw),
        P4=add(B,-nx,-ny,hw), P5=add(A,-nx,-ny,hw), P6=add(A,-dx,-dy,hw);
  // 直边 P1→P2、P4→P5 无柄;圆帽段用切向 kappa 柄。control=端点 ± 行进切向·kh
  return [{ closed:true, anchors:[
    P(P1.x,P1.y, {x:P1.x-dx*kh,y:P1.y-dy*kh}, null),                                  // 帽尾入柄 / 直边出
    P(P2.x,P2.y, null,                        {x:P2.x+dx*kh,y:P2.y+dy*kh}),           // 直边入 / 帽首出
    P(P3.x,P3.y, {x:P3.x+nx*kh,y:P3.y+ny*kh}, {x:P3.x-nx*kh,y:P3.y-ny*kh}),           // B 尖
    P(P4.x,P4.y, {x:P4.x+dx*kh,y:P4.y+dy*kh}, null),                                  // 帽尾入 / 直边出
    P(P5.x,P5.y, null,                        {x:P5.x-dx*kh,y:P5.y-dy*kh}),           // 直边入 / 帽首出
    P(P6.x,P6.y, {x:P6.x-nx*kh,y:P6.y-ny*kh}, {x:P6.x+nx*kh,y:P6.y+ny*kh}),           // A 尖
  ]}];
}

// 元素 → 填充子路径:描边线(fill:none + stroke-width)按胶囊填充,其余走 elementToSubs。
// strokeW:该元素的描边宽度(局部单位),0 表示按普通轮廓。
function elementToFillSubs(el){
  const tag=el.tagName.toLowerCase();
  const sw=parseFloat(el.getAttribute('stroke-width')
        || (el.ownerDocument.defaultView||window).getComputedStyle?.(el)?.strokeWidth) || 0;
  if(tag==='line' && sw>1){ const n=a=>parseFloat(el.getAttribute(a))||0;
    return roundCapsule(n('x1'),n('y1'),n('x2'),n('y2'), sw/2); }
  return elementToSubs(el);
}

// 元素是【描边】还是【填充】:计算样式里 fill:none(或全透明)且 stroke 存在、线宽>0 → 描边。
// 用它保留 SVG 的描边语义(如走路骨架的四肢线),导入后【不自动填实】,可继续调线宽 / 切换填充。
function strokeInfoOf(el){
  const cs=(el.ownerDocument.defaultView||window).getComputedStyle?.(el);
  const fill=(cs?.fill ?? el.getAttribute('fill') ?? '').trim();
  const stroke=(cs?.stroke ?? el.getAttribute('stroke') ?? '').trim();
  const sw=parseFloat(cs?.strokeWidth ?? el.getAttribute('stroke-width')) || 0;
  // 只把 none/transparent 或【4 段 rgba 且 alpha=0】视为无填充 —— 注意 rgb(0,0,0)=纯黑(蓝通道0)不是透明!
  const noFill = fill==='none' || fill==='transparent' || (fill.startsWith('rgba(') && /,\s*0(\.0+)?\s*\)\s*$/.test(fill));
  const hasStroke = !!stroke && stroke!=='none' && sw>0;
  return { isStroke: noFill && hasStroke, sw };
}
// m 的线性缩放因子(把局部线宽换算到 viewBox 空间;纯旋转/平移=1)。
function matScale(m){ return m ? (Math.sqrt(Math.abs(m.a*m.d - m.b*m.c))||1) : 1; }
// 一个源元素 → 子路径 + 该组的描边宽度(0=填充)。描边:取中心线(不填胶囊);填充:走 elementToFillSubs。
function elementToImportSubs(el, m){
  const info=strokeInfoOf(el);
  const subs = info.isStroke ? elementToSubs(el) : elementToFillSubs(el);
  return { subs, sw: info.isStroke ? info.sw*matScale(m) : 0 };
}

// 是否含 SMIL 动画(<animate>/<animateTransform>/<animateMotion>)—— 有则可采样成关键帧序列。
export function svgHasAnimation(svgText){
  return /<animate(Transform|Motion)?[\s>]/i.test(svgText||'');
}

// SMIL 里所有 <animate*> 的 keyTimes 并集(0..1)= 动画真正定义的关键帧时刻。
// 用它采样,才不会像固定 N 帧那样把「周期性走路」采成同一相位(帧 1-4 全同、走路消失)。
function collectKeyTimes(svg){
  const set=new Set();
  svg.querySelectorAll('animate,animateTransform,animateMotion').forEach(a=>{
    const kt=a.getAttribute('keyTimes'); if(!kt) return;
    kt.split(';').forEach(s=>{ const v=parseFloat(s); if(isFinite(v)) set.add(Math.min(1,Math.max(0,v))); });
  });
  return [...set].sort((a,b)=>a-b);
}
// 帧姿态签名:所有锚点坐标量化拼接 —— 同姿态(静止保持期)→ 同签名,用于折叠连续静止帧。
function frameSig(frame){ let s=''; for(const sub of frame) for(const a of sub.anchors) s+=(a.x*10|0)+','+(a.y*10|0)+';'; return s; }
// 均匀抽稀到 n 个(保留首尾)。
function uniformPick(arr, n){ if(arr.length<=n) return arr;
  const out=[]; for(let i=0;i<n;i++) out.push(arr[Math.round(i*(arr.length-1)/(n-1))]); return out; }

// 动画 SVG → 关键帧序列。把 SMIL 动画(嵌套 <animateTransform> 骨架,如走路循环)在【SVG 自带的 keyTimes】
// 逐时刻采样:setCurrentTime 定住,读各图元 getScreenCTM(含被动画的祖先变换)→ 实心轮廓;每个源元素分配
// 一个贯穿所有帧的 layerId → 相邻帧木偶变形,平滑复现走路。连续静止帧折叠成一帧并记为 hold(保留停顿节奏)。
// 返回 { frames, cycleSec, durations, holds, states } 或 null(无动画)。
export function importSvgAnimation(svgText, W, H, allocLid, nextId, opts={}){
  if(typeof opts==='number') opts={frameCount:opts};   // 向后兼容旧签名(第6参=帧数)
  if(!svgHasAnimation(svgText)) return null;
  const svg=parseSvgDoc(svgText);
  const parseDur=el=>{ const m=/([\d.]+)\s*(ms|s)?/.exec(el?.getAttribute('dur')||''); return m?parseFloat(m[1])*(m[2]==='ms'?0.001:1):0; };
  const timedEls=[...svg.querySelectorAll('animate,animateTransform,animateMotion')];
  // 周期:优先取【带 keyTimes 的动画】的 dur —— 那才是真正的循环(如走路 0.75s)。
  // ⚠ 不能笼统取"首个 dur":有的 SVG 外层还套了一个把人从左搬到右的 locomotion(如 12s,from/to 无 keyTimes),
  // 它排在最前,若拿它当周期,就会把 0.75s 的走路按 12s 采样 → 相位乱跳、逐帧姿态不连续 = 人物变形。
  const keyed=timedEls.filter(a=>a.getAttribute('keyTimes'));
  let cycleSec = keyed.length ? Math.min(...keyed.map(parseDur).filter(d=>d>0)) : 0;
  if(!cycleSec) cycleSec = parseDur(svg.querySelector('[dur]')) || 1;
  cycleSec = cycleSec || 1;
  // 🚶 剥掉【搬运整体位移的载体动画】(locomotion):dur 远长于走路循环、且是整体 translate/motion。
  // 它把人物沿 X 轴平移一大段 —— 采样时被烘进坐标,人物会被缩得极小且滑动,而这段位移并不属于走路循环本身。
  // 剥掉后人物【原地跑】;想让它横穿画面,用编辑器「角色(并行走动)」的 x0→x1 / 🔁跑不停,更可控。
  let stripped=0;
  for(const a of timedEls){
    const t=(a.getAttribute('type')||'').toLowerCase(), tag=a.tagName.toLowerCase();
    if(parseDur(a) > cycleSec*1.5 && (t==='translate' || tag==='animatemotion')){ a.remove(); stripped++; }
  }
  const MAXF=Math.max(8, opts.maxFrames||48);
  // 采样时刻:优先用 SMIL 自带 keyTimes(真正的关键帧);没有则均匀密采样兜底。去掉 τ=1 收尾(与 τ=0 同姿)。
  let times=collectKeyTimes(svg).map(k=>k*cycleSec);
  if(times.length<3){ const n=Math.max(8, opts.frameCount||48); times=[]; for(let f=0;f<n;f++) times.push((f/n)*cycleSec); }
  times=times.filter((t,i,a)=> t<cycleSec-1e-6 && (i===0||t>a[i-1]+1e-9));
  const holder=document.createElement('div');
  holder.style.cssText='position:absolute;left:-99999px;top:0;opacity:0;pointer-events:none';
  holder.appendChild(svg); document.body.appendChild(holder);
  const raw=[];
  try{
    try{ svg.pauseAnimations(); }catch(_){}
    const prims=[...svg.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')];
    // 每个元素一个稳定 layerId(贯穿所有帧)。多子路径元素按 *100+subIdx 派生,仍恒定。
    const baseLid=prims.map(()=>allocLid());
    for(const t of times){
      try{ svg.setCurrentTime(t); }catch(_){}
      let root=null; try{ root=svg.getScreenCTM(); }catch(_){}
      const rootInv=root?root.inverse():null;
      const frame=[];
      prims.forEach((el,ei)=>{
        let m=null;
        if(rootInv){ try{ const s=el.getScreenCTM(); if(s) m=rootInv.multiply(s); }catch(_){} }
        const {subs, sw}=elementToImportSubs(el, m);       // 描边元素 → 中心线+线宽;填充 → 轮廓
        subs.forEach((sub,si)=>{ applyMatrix(sub, m); sub._lid=baseLid[ei]*100+si; sub._sw=sw; frame.push(sub); });
      });
      raw.push({frame, t, sig:frameSig(frame)});
    }
  } finally { holder.remove(); }
  if(!raw.length || !raw[0].frame.length) throw new Error('SVG 动画里没有可采样的图元');
  // 折叠【连续相同姿态】(静止保持期)→ 一帧,静止时长记进该帧的 hold;移动帧照留 → 走路 8 个周期完整保留。
  const kept=[];
  for(const r of raw){ const prev=kept[kept.length-1];
    if(prev && prev.sig===r.sig){ prev.tEnd=r.t; } else kept.push({frame:r.frame, t:r.t, tEnd:r.t, sig:r.sig}); }
  const picks = kept.length>MAXF ? uniformPick(kept, MAXF) : kept;   // 仍过多 → 均匀抽稀(保序保首尾)
  // 逐帧时长:hold=本帧静止保持;dur=到下一帧(末帧回绕首帧)的过渡时长 → 还原真实节奏(走路快、抬头停顿久)。
  const durations=[], holds=[];
  for(let i=0;i<picks.length;i++){ const c=picks[i], n=picks[(i+1)%picks.length];
    holds.push(Math.max(0, c.tEnd - c.t));
    durations.push(Math.max(0.04, i<picks.length-1 ? (n.t - c.tEnd) : (cycleSec - c.tEnd + picks[0].t))); }
  const frames=picks.map(p=>p.frame);
  // 全帧统一包围盒 → 同一拟合变换(图形定住,只有肢体在动,不逐帧跳动/缩放)
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  const seen=p=>{ if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; };
  for(const fr of frames) for(const s of fr) for(const a of s.anchors){ seen(a); if(a.hIn)seen(a.hIn); if(a.hOut)seen(a.hOut); }
  const bw=Math.max(1e-3,maxX-minX), bh=Math.max(1e-3,maxY-minY);
  const sc=Math.min(0.82*W/bw, 0.82*H/bh);
  const ox=(W-bw*sc)/2 - minX*sc, oy=(H-bh*sc)/2 - minY*sc;
  const T=p=>({x:p.x*sc+ox, y:p.y*sc+oy});
  const outFrames=frames.map(fr=>fr.map(s=>{
    const pts=s.anchors.map(a=>{ const o=T(a); if(a.hIn)o.hIn=T(a.hIn); if(a.hOut)o.hOut=T(a.hOut); return o; });
    const sw=(s._sw||0)*sc;                              // 描边线宽同样按拟合比例缩放
    return { id:nextId(), type:'path', bezier:true, points:pts, bool:'add', layerId:s._lid,
             ...(sw>0.3 ? {strokeW:+sw.toFixed(2)} : {solidFill:true}),   // 描边→线宽(不填);填充→实心
             ...pathBBox(pts) };
  }));
  return { frames:outFrames, cycleSec, durations, holds, states:outFrames.length };
}

// 主入口:SVG 文本 → 本工具 path 形状数组(已应用变换、等比拟合进 W×H 画布并居中)。
// nextId:取新 shape id 的函数(store.shapeId++)。
export function importSvgShapes(svgText, W, H, nextId){
  const svg=parseSvgDoc(svgText);
  // 注入离屏 DOM(非 display:none,否则 getScreenCTM 返回 null)→ 用 getScreenCTM 归一分组/元素变换
  const holder=document.createElement('div');
  holder.style.cssText='position:absolute;left:-99999px;top:0;opacity:0;pointer-events:none';
  holder.appendChild(svg); document.body.appendChild(holder);
  const subs=[];
  try{
    let root=null; try{ root=svg.getScreenCTM(); }catch(_){}
    const rootInv=root?root.inverse():null;
    for(const el of svg.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')){
      let m=null;
      if(rootInv){ try{ const s=el.getScreenCTM(); if(s) m=rootInv.multiply(s); }catch(_){} }
      const {subs:esubs, sw}=elementToImportSubs(el, m);   // 保留描边:描边元素→中心线+线宽,不自动填实
      for(const sub of esubs){ applyMatrix(sub, m); sub._sw=sw; subs.push(sub); }
    }
  } finally { holder.remove(); }
  if(!subs.length) throw new Error('SVG 里没有可导入的矢量形状(path/rect/circle/ellipse/polygon)');
  // 拟合:全体锚点+控制柄的包围盒 → 等比缩放居中进画布(留边)
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  const seen=p=>{ if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; };
  for(const s of subs) for(const a of s.anchors){ seen(a); if(a.hIn)seen(a.hIn); if(a.hOut)seen(a.hOut); }
  const bw=Math.max(1e-3,maxX-minX), bh=Math.max(1e-3,maxY-minY);
  const sc=Math.min(0.82*W/bw, 0.82*H/bh);
  const ox=(W-bw*sc)/2 - minX*sc, oy=(H-bh*sc)/2 - minY*sc;
  const T=p=>({x:p.x*sc+ox, y:p.y*sc+oy});
  return subs.map(s=>{
    const pts=s.anchors.map(a=>{ const o=T(a); if(a.hIn)o.hIn=T(a.hIn); if(a.hOut)o.hOut=T(a.hOut); return o; });
    const sw=(s._sw||0)*sc;
    return { id:nextId(), type:'path', bezier:true, points:pts, bool:'add',
             ...(sw>0.3 ? {strokeW:+sw.toFixed(2)} : {solidFill:true}), ...pathBBox(pts) };
  });
}
