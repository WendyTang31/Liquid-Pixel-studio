// 图片工具:亮度/透明直方图、Otsu 自动阈值、二值化 —— 纯像素数学,可独立单测。
// decodeImageShape 是唯一碰 DOM 的部分(Image 解码),供上传流程与工程/撤销重做的
// 反序列化(JSON 往返丢失运行时缓存的 _img)复用同一份逻辑。

// 亮度直方图(ITU-R BT.709 权重),RGBA 像素数组 → 256 桶计数。
export function luminanceHistogram(data){
  const hist=new Uint32Array(256);
  for(let i=0;i<data.length;i+=4){
    // Math.round 而非 |0:三项浮点乘加偶尔比整数少一丝(如 40 算成 39.999999999999986),
    // 向零截断会系统性偏低一档,四舍五入才对得上肉眼预期的灰度值。
    const v=Math.min(255,Math.round(0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2]));
    hist[v]++;
  }
  return hist;
}
export function alphaHistogram(data){
  const hist=new Uint32Array(256);
  for(let i=3;i<data.length;i+=4) hist[data[i]]++;
  return hist;
}
// 图片是否带有意义的透明通道(而不是全不透明的照片/JPEG)。
export function hasMeaningfulAlpha(data){
  for(let i=3;i<data.length;i+=4) if(data[i]<250) return true;
  return false;
}

// Otsu 大津法:遍历所有阈值,取"类间方差"最大的那个 —— 经典、稳健的自动二值化阈值算法。
export function otsuThreshold(hist){
  const total=hist.reduce((a,b)=>a+b,0);
  if(total===0) return 128;
  let sum=0; for(let i=0;i<256;i++) sum+=i*hist[i];
  let sumB=0, wB=0, maxVar=-1, threshold=128;
  for(let t=0;t<256;t++){
    wB+=hist[t]; if(wB===0) continue;
    const wF=total-wB; if(wF===0) break;
    sumB+=t*hist[t];
    const mB=sumB/wB, mF=(sum-sumB)/wF;
    const between=wB*wF*(mB-mF)*(mB-mF);
    if(between>maxVar){ maxVar=between; threshold=t; }
  }
  return threshold;
}

// 二值化:原地把 RGBA 改写成"内部=可见(按 add/sub 取白/黑,alpha 255)、外部=完全透明"的贴图。
// 外部透明是关键 —— drawImage 贴回主蒙版时透明像素不覆盖目标,天然实现 add/sub 只影响内部区域,
// 和 rect/ellipse/text/path 靠 fillStyle 实现 add/sub 是同一效果,只是 drawImage 不认 fillStyle。
export function binarize(data, {threshold, invert, useAlpha, addColor255}){
  for(let i=0;i<data.length;i+=4){
    const v=useAlpha ? data[i+3] : (0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2]);
    const inside = invert ? (v<threshold) : (v>threshold);
    if(inside){ const c=addColor255?255:0; data[i]=data[i+1]=data[i+2]=c; data[i+3]=255; }
    else data[i+3]=0;
  }
}

// 半调灰度化:与 binarize 相对。R=放置(在黑场之上即 255),G/B=亮度值,外部全透明。
// 蒙版的 R 通道继续担任"形状内外"判定(与全工具链兼容),G 通道携带亮度供半调采样
// (r=dotR·√B)。threshold 在此模式下语义是"黑场底限":低于它视为背景。
export function grayscaleize(data,{threshold,invert,useAlpha}){
  for(let i=0;i<data.length;i+=4){
    let v=useAlpha ? data[i+3] : (0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2]);
    if(invert) v=255-v;
    v=Math.min(255,Math.round(v));
    const inside=v>threshold;
    if(inside){ data[i]=255; data[i+1]=v; data[i+2]=v; data[i+3]=255; }
    else data[i+3]=0;
  }
}

// dataURL → 解码好的 <img>,挂到 sh._img(非可枚举,JSON.stringify 自动跳过,不会混进工程文件)。
// 按 dataURL 缓存:撤销/重做/多次打开同一工程时同一张图不用重复解码。
const _imgCache=new Map();
export function decodeImageShape(sh){
  const cached=_imgCache.get(sh.imgDataURL);
  if(cached){ Object.defineProperty(sh,'_img',{value:cached,enumerable:false,configurable:true}); return Promise.resolve(cached); }
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{ _imgCache.set(sh.imgDataURL,img);
      Object.defineProperty(sh,'_img',{value:img,enumerable:false,configurable:true}); resolve(img); };
    img.onerror=()=>resolve(null);
    img.src=sh.imgDataURL;
  });
}
