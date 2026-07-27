// GPU 渲染层(WebGL2):与 CPU fieldLoop 同一场函数 f=Σr²/d²、同一软边/gamma/混色公式,
// 只是逐像素求值搬到片元着色器 —— 编辑器预览因此能开高分辨率(2×)且不占主线程。
// 导出仍走 CPU(逐帧确定性、离屏可控);这层只服务实时预览,符合 CLAUDE.md
// "WebGL 只重写渲染层,引擎与数据层不动"的预留口径。
import { W, H } from './config.js';
import { hex2rgb } from './utils.js';

const MAXB=4096; // 球数据纹理宽度(x,y,r 打包 RGBA32F 一行)

const VERT=`#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.,1.); }`;

const FRAG=`#version 300 es
precision highp float;
uniform sampler2D uBalls;  // RGBA32F: x,y(归一化), r(按 W 归一化), 未用
uniform sampler2D uCols;   // RGBA8: 球颜色
uniform int uN;
uniform float uThr,uSoft,uGamma;
uniform vec3 uBg,uCol;
uniform bool uColored;
uniform vec2 uWH;          // 编辑器像素空间 (W,H) —— 与 CPU 同单位,数值可对齐
in vec2 vUV;
out vec4 outC;
void main(){
  vec2 p=vec2(vUV.x*uWH.x, (1.0-vUV.y)*uWH.y); // 画布 y 向下,与 CPU 一致
  float f=0.0; vec3 acc=vec3(0.0);
  for(int i=0;i<${MAXB};i++){
    if(i>=uN) break;
    vec4 b=texelFetch(uBalls, ivec2(i,0), 0);
    vec2 d=p-vec2(b.x*uWH.x, b.y*uWH.y);
    float r=b.z*uWH.x;
    float w=r*r/(dot(d,d)+1e-6);
    f+=w;
    if(uColored) acc+=w*texelFetch(uCols, ivec2(i,0), 0).rgb*255.0;
  }
  float lo=uThr-uSoft, hi=uThr+uSoft;
  float a=clamp((f-lo)/(hi-lo),0.0,1.0);
  a=a*a*(3.0-2.0*a);
  if(abs(uGamma-1.0)>1e-4) a=pow(a,uGamma);
  vec3 col=uColored&&f>1e-9 ? acc/f : uCol;
  outC=vec4(mix(uBg,col,a)/255.0,1.0);
}`;

export function createGLRenderer(canvas){
  const gl=canvas.getContext('webgl2',{antialias:false, premultipliedAlpha:false});
  if(!gl) return null;
  const sh=(type,src)=>{ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s; };
  let prog;
  try{
    prog=gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER,VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER,FRAG));
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  }catch(e){ return null; }
  gl.useProgram(prog);
  // 全屏三角形
  const vb=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,vb);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1, 3,-1, -1,3]),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  // 球数据 / 颜色纹理
  const mkTex=(unit)=>{ const t=gl.createTexture();
    gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return t; };
  const texB=mkTex(0);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,MAXB,1,0,gl.RGBA,gl.FLOAT,null);
  const texC=mkTex(1);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,MAXB,1,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  const U=n=>gl.getUniformLocation(prog,n);
  gl.uniform1i(U('uBalls'),0); gl.uniform1i(U('uCols'),1);
  const uN=U('uN'), uThr=U('uThr'), uSoft=U('uSoft'), uGamma=U('uGamma'),
        uBg=U('uBg'), uCol=U('uCol'), uColored=U('uColored'), uWH=U('uWH');
  const ballBuf=new Float32Array(MAXB*4);
  const colBuf=new Uint8Array(MAXB*4);
  return function render(balls,col,P){
    const n=Math.min(balls.length,MAXB);
    let colored=false;
    for(let i=0;i<n;i++){
      const b=balls[i];
      ballBuf[i*4]=b.x; ballBuf[i*4+1]=b.y; ballBuf[i*4+2]=b.r; ballBuf[i*4+3]=0;
      const c=b.c; if(c) colored=true;
      colBuf[i*4]=c?c[0]:col[0]; colBuf[i*4+1]=c?c[1]:col[1]; colBuf[i*4+2]=c?c[2]:col[2]; colBuf[i*4+3]=255;
    }
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texB);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,Math.max(1,n),1,gl.RGBA,gl.FLOAT,ballBuf.subarray(0,Math.max(1,n)*4));
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,texC);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,Math.max(1,n),1,gl.RGBA,gl.UNSIGNED_BYTE,colBuf.subarray(0,Math.max(1,n)*4));
    const bg=hex2rgb(P.colBg);
    gl.uniform1i(uN,n);
    gl.uniform1f(uThr,P.thr); gl.uniform1f(uSoft,P.soft); gl.uniform1f(uGamma,P.gamma);
    gl.uniform3f(uBg,bg[0],bg[1],bg[2]);
    gl.uniform3f(uCol,col[0],col[1],col[2]);
    gl.uniform1i(uColored,colored?1:0);
    gl.uniform2f(uWH,W,H);
    gl.drawArrays(gl.TRIANGLES,0,3);
  };
}
