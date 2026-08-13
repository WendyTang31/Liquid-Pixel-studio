// 🚶 角色面板:管理并行动画轨(走路小人)。每个角色一张紧凑卡片:显隐 / 改名 / 左右起止位置(=走动)
// / 上下位置 / 缩放 / 速度 / 删除。位移与缩放不改帧,故无需重建序列 —— 逐帧现读、即时生效。
import { store } from '../store.js';
import { W, H } from '../config.js';
import { setHint } from '../utils.js';
import { charLoopSec, setCharLoopSec } from '../characters.js';
import { enterCharEdit, combineSelectedIntoCharacter, newEmptyCharacter } from './charedit.js';
import { pushUndo } from '../state.js';

const $=id=>document.getElementById(id);

export function renderCharacters(){
  const box=$('charList'); if(!box) return;
  box.innerHTML='';
  const hint=$('charHint'); if(hint) hint.style.display=store.characters.length?'none':'block';
  // 顶部:把主时间轴上 Shift+多选的帧组合成一个角色
  const topRow=document.createElement('div'); topRow.style.cssText='display:flex;gap:4px;margin-bottom:2px';
  const combine=document.createElement('button'); combine.textContent='＋ 选中帧→角色';
  combine.title='在胶片条 Shift+点选若干帧,点此把它们组合成一个角色(移出主时间轴,可独立循环/走位)';
  combine.style.cssText='flex:1;font:11px system-ui;background:#1a2b22;border:1px solid #2a3330;border-radius:5px;color:#8ef;cursor:pointer;padding:4px 6px';
  combine.onclick=()=>combineSelectedIntoCharacter();
  const neu=document.createElement('button'); neu.textContent='＋ 新建角色';
  neu.title='新建一个空角色并进入编辑 → Ctrl+V 把剪切(Ctrl+X)的帧贴进来';
  neu.style.cssText='flex:1;font:11px system-ui;background:#1a2230;border:1px solid #2a3330;border-radius:5px;color:#8ef;cursor:pointer;padding:4px 6px';
  neu.onclick=()=>newEmptyCharacter();
  topRow.append(combine,neu); box.appendChild(topRow);
  store.characters.forEach((ch,idx)=>{
    const card=document.createElement('div');
    card.style.cssText='border:1px solid #2a3330;border-radius:6px;padding:6px 7px;background:'
      +(idx===store.activeChar?'#1c2622':'#161b19')+';display:flex;flex-direction:column;gap:5px';
    card.onclick=()=>{ store.activeChar=idx; enterCharEdit(ch); }; // 点卡片 = 打开该角色的帧(载入胶片条编辑)
    // 头行:显隐 + 名 + 删除
    const head=document.createElement('div'); head.style.cssText='display:flex;align-items:center;gap:6px';
    const eye=document.createElement('span'); eye.textContent=ch.visible?'👁':'🚫'; eye.style.cursor='pointer'; eye.title='显示/隐藏';
    eye.onclick=e=>{ e.stopPropagation(); ch.visible=!ch.visible; renderCharacters(); };
    const name=document.createElement('input'); name.value=ch.name; name.title='角色名(点这里直接改)';
    name.style.cssText='flex:1;background:transparent;border:none;color:#dfe;font:12px system-ui;outline:none';
    name.onclick=e=>e.stopPropagation();               // 别让点名字触发卡片(会重建面板→输不进字)
    name.onkeydown=e=>{ e.stopPropagation(); if(e.key==='Enter') name.blur(); };
    name.oninput=()=>{ ch.name=name.value; };           // 逐字生效,不依赖失焦
    const editing=(store.editingChar===ch);
    const edit=document.createElement('span'); edit.textContent=editing?'✏️…':'✏️'; edit.style.cursor='pointer';
    edit.title=editing?'正在编辑此角色的帧':'编辑此角色的帧(改图形 / 每帧停留·过渡时长)';
    edit.onclick=e=>{ e.stopPropagation(); enterCharEdit(ch); };
    const del=document.createElement('span'); del.textContent='🗑'; del.style.cursor='pointer'; del.title='删除该角色';
    del.onclick=e=>{ e.stopPropagation();
      if(store.editingChar===ch){ setHint('请先「✓ 完成编辑角色」再删除'); return; }
      pushUndo();                                       // 可 Ctrl+Z 撤销删除
      store.characters.splice(idx,1);
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
    const durI=document.createElement('input'); durI.type='number'; durI.step='0.1'; durI.min='0.05';
    try{ durI.value=+charLoopSec(ch).toFixed(2); }catch(_){ durI.value=ch.cycleSec||1; }
    durI.title='整体循环时长(秒):走完一整圈用多久。数值越小 = 步频越快';
    durI.style.cssText='width:48px;background:#0d1210;border:1px solid #2a3330;border-radius:4px;color:#dfe;font:11px system-ui;padding:2px 4px';
    // 步频/速度倍率:直接调 ch.speed,越大步子迈得越快(1=原速,2=快一倍)。与「时长」互为倒数,双向实时联动。
    const spdI=document.createElement('input'); spdI.type='number'; spdI.step='0.25'; spdI.min='0.1'; spdI.value=+(ch.speed||1).toFixed(2);
    spdI.title='步频/速度倍率:1=按 SVG 原速,2=快一倍,0.5=慢一半。嫌"慢动作"就往上调。';
    spdI.style.cssText='width:44px;background:#0d1210;border:1px solid #2a3330;border-radius:4px;color:#dfe;font:11px system-ui;padding:2px 4px';
    durI.onclick=e=>e.stopPropagation(); durI.oninput=()=>{ const v=parseFloat(durI.value); if(v>0){ setCharLoopSec(ch,v); spdI.value=+(ch.speed||1).toFixed(2); } };
    spdI.onclick=e=>e.stopPropagation(); spdI.oninput=()=>{ const v=parseFloat(spdI.value); if(v>0){ ch.speed=v; try{ durI.value=+charLoopSec(ch).toFixed(2); }catch(_){} } };
    const rotI=document.createElement('input'); rotI.type='number'; rotI.step='5'; rotI.value=Math.round(ch.rot||0);
    rotI.title='整体旋转(度)'; rotI.style.cssText='width:44px;background:#0d1210;border:1px solid #2a3330;border-radius:4px;color:#dfe;font:11px system-ui;padding:2px 4px';
    rotI.onclick=e=>e.stopPropagation(); rotI.oninput=()=>{ ch.rot=parseFloat(rotI.value)||0; };
    const cross=document.createElement('button'); cross.textContent='整屏走过'; cross.title='一键设为从画面左外走到右外';
    cross.style.cssText='font:11px system-ui;background:#223;border:1px solid #2a3330;border-radius:4px;color:#8ef;cursor:pointer;padding:2px 6px';
    cross.onclick=e=>{ e.stopPropagation(); ch.x0=-W*0.62; ch.x1=W*0.62; ch.y0=ch.y1=0; renderCharacters(); };
    r3.append(mkLabel('缩放'),scaleI,mkLabel('旋转'),rotI,mkLabel('步频×'),spdI,mkLabel('时长'),durI,cross); card.appendChild(r3);

    // r4:镜像 + 出场同步
    const r4=document.createElement('div'); r4.style.cssText='display:flex;align-items:center;gap:8px;font:11px system-ui;color:#9fb;flex-wrap:wrap';
    const chk=(label,get,set,tip)=>{ const w=document.createElement('label');
      w.style.cssText='display:flex;align-items:center;gap:3px;cursor:pointer'; w.title=tip;
      const c=document.createElement('input'); c.type='checkbox'; c.checked=get();
      c.onclick=e=>e.stopPropagation(); c.onchange=()=>set(c.checked);
      const t=document.createElement('span'); t.textContent=label;
      w.append(c,t); return w; };
    r4.append(
      chk('⇋镜像', ()=>!!ch.mirX, v=>ch.mirX=v, '整体水平镜像:跑向左 ⇄ 跑向右'),
      chk('⇅翻转', ()=>!!ch.mirY, v=>ch.mirY=v, '整体垂直镜像(上下翻)'));
    // 同步方式
    const syncSel=document.createElement('select');
    syncSel.style.cssText='background:#0d1210;border:1px solid #2a3330;border-radius:4px;color:#dfe;font:11px system-ui;padding:1px 3px';
    syncSel.title='自由:独立循环,与主时间轴无关。跟随主时间轴:与箭头等主动画严格同步,每个主循环从「延迟」处开始出场';
    [['free','⏱自由'],['timeline','🔗跟主轴']].forEach(([v,t])=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; syncSel.appendChild(o); });
    syncSel.value=ch.sync||'free'; syncSel.onclick=e=>e.stopPropagation();
    syncSel.onchange=()=>{ ch.sync=syncSel.value; renderCharacters(); };
    // 延迟出场
    const delayI=document.createElement('input'); delayI.type='number'; delayI.step='0.1'; delayI.min='0'; delayI.value=ch.delay||0;
    delayI.title='延迟出场(秒):自由模式=开场 N 秒后出现;跟主轴模式=每个主循环第 N 秒才出现(如箭头先走、小人后跑)';
    delayI.style.cssText='width:42px;background:#0d1210;border:1px solid #2a3330;border-radius:4px;color:#dfe;font:11px system-ui;padding:2px 4px';
    delayI.onclick=e=>e.stopPropagation(); delayI.oninput=()=>{ ch.delay=Math.max(0,parseFloat(delayI.value)||0); };
    r4.append(syncSel, mkLabel('延迟'), delayI, mkLabel('s'));
    card.appendChild(r4);

    // r5:圈数(一趟位移跑几圈步子)+ 跑更远预设
    const r5=document.createElement('div'); r5.style.cssText='display:flex;align-items:center;gap:6px;font:11px system-ui;color:#9fb;flex-wrap:wrap';
    const lapI=document.createElement('input'); lapI.type='number'; lapI.step='1'; lapI.min='1'; lapI.value=ch.laps||1;
    lapI.title='一趟位移要跑几圈步子。1=跑一圈就走完全程(到头弹回);2=迈两轮步子、位置一路向前推进,中途不回原位 —— 想一次跑更远就调大它。步频不变,只是走得更远。';
    lapI.style.cssText='width:42px;background:#0d1210;border:1px solid #2a3330;border-radius:4px;color:#dfe;font:11px system-ui;padding:2px 4px';
    lapI.onclick=e=>e.stopPropagation();
    lapI.oninput=()=>{ ch.laps=Math.max(1, Math.round(parseFloat(lapI.value)||1)); };
    // ⚠ 曾经这里是「跑更远 ×2」:把行程无限拉长。那是错的 —— 画布只有 W 宽,行程越长,
    // 人在画外的时间越久(实测 ±1500 时只有 18% 时间可见),看起来就是"跑到边上变一条线、又凭空
    // 出现在中间"。想跑更久请加【圈数】(步子更多、横穿更慢),想永远向前请勾【🔁跑不停】。
    const far=document.createElement('button'); far.textContent='慢一点(圈数+1)';
    far.title='多迈一轮步子横穿同一段距离 —— 跑得更久、步频不变,且全程可见(不会跑到画外看不见)';
    far.style.cssText='font:11px system-ui;background:#223;border:1px solid #2a3330;border-radius:4px;color:#8ef;cursor:pointer;padding:2px 6px';
    far.onclick=e=>{ e.stopPropagation();
      if(!(ch.x1-ch.x0)){ ch.x0=-W*0.62; ch.x1=W*0.62; }  // 还没设行程 → 先给个整屏横穿
      ch.laps=Math.max(1,(ch.laps||1))+1;
      renderCharacters(); };
    const wrapCk=chk('🔁跑不停', ()=>!!ch.wrap, v=>{ ch.wrap=v; renderCharacters(); },
      '环绕平移:跑出右边画外就立刻从左边画外接着进来,永远向前跑,接缝在画外看不见。\n想"一直往前跑"请用这个 —— 把行程拉到几千像素是没用的,画布只有这么宽,人跑出去就看不见了。');
    r5.append(mkLabel('圈数'), lapI, far, wrapCk);
    card.appendChild(r5);
    box.appendChild(card);
  });
}
function mkLabel(t){ const s=document.createElement('span'); s.textContent=t; s.style.opacity='.8'; return s; }
