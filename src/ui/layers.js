// 左侧图层面板(AE 式):当前状态的形状列表,顶行 = 最上层(即绘制顺序的最后)。
// 点选 / 双击改名 / 👁显隐 / 🔒锁定 / 拖动排序。数据上只动 shapes 数组顺序与
// sh.name/hidden/locked 三个普通字段 —— 随 shapes 深拷贝自然进工程/撤销/自动保存,
// 老工程缺省即"可见、未锁",零迁移成本。
// (与 inspector 互相引用:两边都是 hoisted 函数声明,ES module 循环无害 —— 同 filmstrip 先例。)
import { store, cur } from '../store.js';
import { $, setHint } from '../utils.js';
import { pushUndo } from '../state.js';
import { shapesChanged } from '../pipeline.js';
import { updateSelBox } from './inspector.js';

const TYPEICON={rect:'▭', ellipse:'◯', text:'T', path:'✎', image:'🖼'};
export const shapeLabel=sh=> sh.name ||
  (sh.type==='text' ? `"${sh.text}"` : ({rect:'矩形',ellipse:'椭圆',path:'轮廓',image:'图片'}[sh.type]||sh.type));

let dragFrom=null; // 正在拖动的数组下标

// 数组重排:把 from 抽出后插到 to。
function moveShape(from,to){
  const s=cur(), [sh]=s.shapes.splice(from,1);
  s.shapes.splice(to,0,sh);
}

export function renderLayers(){
  const list=$('lyList'); if(!list) return;
  list.innerHTML='';
  const s=cur(); if(!s) return;
  if(!s.shapes.length){
    list.innerHTML='<div class="small" style="padding:2px 4px">(空 — 用左侧工具画形状)</div>';
    return;
  }
  // 顶行 = 数组末位(最上层),与 AE 图层面板方向一致
  for(let i=s.shapes.length-1;i>=0;i--){
    const sh=s.shapes[i];
    const row=document.createElement('div');
    row.className='lyrow'+(store.sel===sh?' sel':'')+(sh.hidden?' hidden':'');
    row.draggable=true;
    const boolIc=sh.bool==='sub'?'➖':'';
    row.innerHTML=`<span class="ic">${TYPEICON[sh.type]||'?'}</span>`+
      `<span class="nm" title="双击改名">${boolIc}${sh.rel?'🔗':''}${escapeHtml(shapeLabel(sh))}</span>`+
      `<span class="tg ${sh.hidden?'':'on'}" data-t="eye" title="显示/隐藏(隐藏 = 不进蒙版不出点)">${sh.hidden?'―':'👁'}</span>`+
      `<span class="tg ${sh.locked?'on':''}" data-t="lock" title="锁定:画布上不可选不可动(面板里仍可点)">${sh.locked?'🔒':'🔓'}</span>`;
    // 点行 = 选中(锁定的也允许 —— 面板是解锁/改名的入口)
    row.onclick=e=>{
      if(e.target.dataset.t==='eye'){ pushUndo(); sh.hidden=!sh.hidden;
        shapesChanged(s); updateSelBox(); return; }
      if(e.target.dataset.t==='lock'){ sh.locked=!sh.locked; renderLayers(); return; }
      store.sel=sh; updateSelBox();
    };
    // 双击名字 = 行内改名
    row.querySelector('.nm').ondblclick=e=>{
      e.stopPropagation();
      const nm=row.querySelector('.nm');
      nm.innerHTML=`<input type="text" value="${escapeAttr(sh.name||shapeLabel(sh))}">`;
      const inp=nm.querySelector('input');
      inp.focus(); inp.select();
      const commit=()=>{ const v=inp.value.trim(); sh.name=v||undefined; renderLayers(); };
      inp.onblur=commit;
      inp.onkeydown=ev=>{ if(ev.key==='Enter') inp.blur(); if(ev.key==='Escape'){ inp.onblur=null; renderLayers(); } ev.stopPropagation(); };
    };
    // 拖动排序:落点在目标行上半 = 放到其上方(数组更靠后),下半 = 下方
    row.ondragstart=ev=>{ dragFrom=i; ev.dataTransfer.effectAllowed='move'; };
    row.ondragover=ev=>{ ev.preventDefault();
      const r=row.getBoundingClientRect();
      row.classList.toggle('dropAbove', ev.clientY < r.top+r.height/2);
      row.classList.toggle('dropBelow', ev.clientY >= r.top+r.height/2); };
    row.ondragleave=()=>row.classList.remove('dropAbove','dropBelow');
    row.ondrop=ev=>{ ev.preventDefault(); row.classList.remove('dropAbove','dropBelow');
      if(dragFrom===null||dragFrom===i) return;
      const above=ev.clientY < row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;
      pushUndo();
      const f=dragFrom, j=i-(f<i?1:0);       // 抽出后目标的新下标
      moveShape(f, above? j+1 : j);          // 视觉上方 = 数组更靠后
      dragFrom=null; shapesChanged(cur()); updateSelBox();
      setHint('已调整图层顺序(上=前)');
    };
    row.ondragend=()=>{ dragFrom=null; };
    list.appendChild(row);
  }
}

const escapeHtml=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const escapeAttr=escapeHtml;
