// 🚶 角色面板:管理并行动画轨(走路小人)。每个角色一张紧凑卡片:显隐 / 改名 / 左右起止位置(=走动)
// / 上下位置 / 缩放 / 速度 / 删除。位移与缩放不改帧,故无需重建序列 —— 逐帧现读、即时生效。
import { store } from '../store.js';
import { W, H } from '../config.js';
import { enterCharEdit } from './charedit.js';

const $=id=>document.getElementById(id);

export function renderCharacters(){
  const box=$('charList'); if(!box) return;
  box.innerHTML='';
  const hint=$('charHint'); if(hint) hint.style.display=store.characters.length?'none':'block';
  store.characters.forEach((ch,idx)=>{
    const card=document.createElement('div');
    card.style.cssText='border:1px solid #2a3330;border-radius:6px;padding:6px 7px;background:'
      +(idx===store.activeChar?'#1c2622':'#161b19')+';display:flex;flex-direction:column;gap:5px';
    card.onclick=()=>{ store.activeChar=idx; renderCharacters(); };
    // 头行:显隐 + 名 + 删除
    const head=document.createElement('div'); head.style.cssText='display:flex;align-items:center;gap:6px';
    const eye=document.createElement('span'); eye.textContent=ch.visible?'👁':'🚫'; eye.style.cursor='pointer'; eye.title='显示/隐藏';
    eye.onclick=e=>{ e.stopPropagation(); ch.visible=!ch.visible; renderCharacters(); };
    const name=document.createElement('input'); name.value=ch.name; name.title='角色名(双击改)';
    name.style.cssText='flex:1;background:transparent;border:none;color:#dfe;font:12px system-ui;outline:none';
    name.onchange=()=>{ ch.name=name.value||ch.name; };
    const editing=(store.editingChar===ch);
    const edit=document.createElement('span'); edit.textContent=editing?'✏️…':'✏️'; edit.style.cursor='pointer';
    edit.title=editing?'正在编辑此角色的帧':'编辑此角色的帧(改图形 / 每帧停留·过渡时长)';
    edit.onclick=e=>{ e.stopPropagation(); enterCharEdit(ch); };
    const del=document.createElement('span'); del.textContent='🗑'; del.style.cursor='pointer'; del.title='删除该角色';
    del.onclick=e=>{ e.stopPropagation(); if(store.editingChar===ch) return; store.characters.splice(idx,1);
      store.activeChar=Math.min(store.activeChar, store.characters.length-1); renderCharacters(); };
    head.append(eye,name,edit,del); card.appendChild(head);
    if(editing){ const bar=document.createElement('div'); bar.textContent='✏ 编辑中 —— 顶部「✓ 完成编辑角色」保存';
      bar.style.cssText='font:11px system-ui;color:#2cc4f5'; card.appendChild(bar); }
    // 数值行工厂
    const rowNum=(label,a,b,ka,kb,step=10,title='')=>{
      const r=document.createElement('div'); r.style.cssText='display:flex;align-items:center;gap:4px;font:11px system-ui;color:#9fb'; r.title=title;
      const lab=document.createElement('span'); lab.textContent=label; lab.style.cssText='width:40px;opacity:.8';
      const mk=(k)=>{ const inp=document.createElement('input'); inp.type='number'; inp.step=step; inp.value=Math.round(ch[k]);
        inp.style.cssText='width:52px;background:#0d1210;border:1px solid #2a3330;border-radius:4px;color:#dfe;font:11px system-ui;padding:2px 4px';
        inp.onclick=e=>e.stopPropagation();
        inp.oninput=()=>{ ch[k]=parseFloat(inp.value)||0; }; return inp; };
      r.append(lab, mk(ka)); if(kb){ const arrow=document.createElement('span'); arrow.textContent='→'; arrow.style.opacity='.6'; r.append(arrow, mk(kb)); }
      return r;
    };
    card.appendChild(rowNum('左右','x0','x1','x0','x1',10,'走动:从左位置走到右位置(px,相对画面中心)。设 -240→240 = 从左走到右'));
    card.appendChild(rowNum('上下','y0','y1','y0','y1',10,'纵向起止(px)。走斜线/远近可用'));
    // 缩放 + 速度 + 快捷
    const r3=document.createElement('div'); r3.style.cssText='display:flex;align-items:center;gap:6px;font:11px system-ui;color:#9fb';
    const scaleI=document.createElement('input'); scaleI.type='number'; scaleI.step='0.05'; scaleI.min='0.05'; scaleI.value=ch.scale;
    scaleI.title='缩放'; scaleI.style.cssText='width:48px;background:#0d1210;border:1px solid #2a3330;border-radius:4px;color:#dfe;font:11px system-ui;padding:2px 4px';
    scaleI.onclick=e=>e.stopPropagation(); scaleI.oninput=()=>{ ch.scale=Math.max(0.05,parseFloat(scaleI.value)||1); };
    const speedI=document.createElement('input'); speedI.type='number'; speedI.step='0.1'; speedI.min='0.1'; speedI.value=ch.speed;
    speedI.title='走动/播放速度'; speedI.style.cssText='width:44px;background:#0d1210;border:1px solid #2a3330;border-radius:4px;color:#dfe;font:11px system-ui;padding:2px 4px';
    speedI.onclick=e=>e.stopPropagation(); speedI.oninput=()=>{ ch.speed=Math.max(0.1,parseFloat(speedI.value)||1); };
    const rotI=document.createElement('input'); rotI.type='number'; rotI.step='5'; rotI.value=Math.round(ch.rot||0);
    rotI.title='整体旋转(度)'; rotI.style.cssText='width:44px;background:#0d1210;border:1px solid #2a3330;border-radius:4px;color:#dfe;font:11px system-ui;padding:2px 4px';
    rotI.onclick=e=>e.stopPropagation(); rotI.oninput=()=>{ ch.rot=parseFloat(rotI.value)||0; };
    const cross=document.createElement('button'); cross.textContent='整屏走过'; cross.title='一键设为从画面左外走到右外';
    cross.style.cssText='font:11px system-ui;background:#223;border:1px solid #2a3330;border-radius:4px;color:#8ef;cursor:pointer;padding:2px 6px';
    cross.onclick=e=>{ e.stopPropagation(); ch.x0=-W*0.62; ch.x1=W*0.62; ch.y0=ch.y1=0; renderCharacters(); };
    r3.append(mkLabel('缩放'),scaleI,mkLabel('旋转'),rotI,mkLabel('速度'),speedI,cross); card.appendChild(r3);
    box.appendChild(card);
  });
}
function mkLabel(t){ const s=document.createElement('span'); s.textContent=t; s.style.opacity='.8'; return s; }
