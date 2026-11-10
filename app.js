// Hexa Dashboard — интерфейс (схема данных v2). Все расчёты — в core.js (HexaCore),
// общем с MCP-сервером, чтобы дашборд и Claude считали одинаково.
const C = window.HexaCore;
const { n, r2 } = C;

// ─── AUTH ─────────────────────────────────────────────────────
// Чтобы сменить пароль — запусти в консоли:
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('НовыйПароль'))
//     .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
// и вставь результат в AUTH_HASH:
const AUTH_HASH = '32e0c7d67ef0e643a0d0b7487b98f8c734c1ad58960063d4bef2c8dd20d35614';
const AUTH_SK = 'wbd_auth';

async function sha256(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function checkAuth(){
  if(sessionStorage.getItem(AUTH_SK)==='1'){
    document.getElementById('auth-wall').classList.add('hidden');
    showLoading(true);
    initFirestore();
  }
}
async function authSubmit(){
  const val=document.getElementById('auth-input').value;
  const err=document.getElementById('auth-err');
  if(await sha256(val)===AUTH_HASH){
    sessionStorage.setItem(AUTH_SK,'1');
    document.getElementById('auth-wall').classList.add('hidden');
    showLoading(true);
    initFirestore();
  }else{
    err.textContent='Неверный пароль';
    document.getElementById('auth-input').value='';
    document.getElementById('auth-input').focus();
    setTimeout(()=>{err.textContent='';},2500);
  }
}

// ─── FIREBASE ─────────────────────────────────────────────────
firebase.initializeApp({
  apiKey: "AIzaSyAy2dKkjq0mukLj_JO8Iqz5ebnca7ZMIQw",
  authDomain: "hexa-web-dev.firebaseapp.com",
  projectId: "hexa-web-dev",
  storageBucket: "hexa-web-dev.firebasestorage.app",
  messagingSenderId: "617618063520",
  appId: "1:617618063520:web:0b86398afa0756edbd09c5"
});
const DOC = firebase.firestore().collection('webdev').doc('dashboard');

// ─── STATE ────────────────────────────────────────────────────
let D=null;               // документ v2 (C.normalize)
let readOnly=true;        // пока не загружены корректные данные — ничего не пишем
let aid=null, eid=null, did=null;
let fClient='', fType='', fStatus='Все', fPay='';
let editEntryId=null;     // запись часов, которую редактируем в форме
let _saving=false;
let currentTab='projects';
const excludedProjects=new Set();

const STATUSES=[
  {val:'Сдан',       cls:'сдан',       dot:'#0FC47A', bg:'#E4F9EF', color:'#0A6E40'},
  {val:'В работе',   cls:'вработе',    dot:'#F59E0B', bg:'#FFFBEB', color:'#854D0E'},
  {val:'Холд',       cls:'холд',       dot:'#F05252', bg:'#FEE2E2', color:'#991B1B'},
  {val:'На проверке',cls:'напроверке', dot:'#3B82F6', bg:'#EFF6FF', color:'#1E40AF'},
  {val:'Обсуждение', cls:'обсуждение', dot:'#94A3B8', bg:'#F1F5F9', color:'#475569'},
];
const PAY={
  not_invoiced:{cls:'p-none',   label:'Без счёта'},
  awaiting:    {cls:'p-no',     label:'Ждём оплату'},
  partial:     {cls:'p-partial',label:'Частично'},
  paid:        {cls:'p-yes',    label:'Оплачен'},
};
const INV_ST={draft:'Черновик',sent:'Отправлен',paid:'Оплачен',cancelled:'Отменён'};
const ISSUE_TITLES={
  hours_no_invoices:'Часы есть, счетов нет',
  invoice_overdue:'Счёт ждёт оплаты дольше 30 дней',
  payment_unlinked:'Поступление без привязки к счёту',
  payment_no_month:'Поступление без месяца',
  hours_no_note:'Запись часов без описания',
  month_no_rate:'Месяц без своего курса',
  delivered_no_month:'«Сдан», но нет месяца сдачи',
  support_not_invoiced:'Часы поддержки без счёта в том же месяце',
  build_after_delivery:'Часы «разработки» после сдачи',
  origin_unknown:'Не указано: свой проект или чужой',
  needs_full_invoice:'Нужен счёт на полную сумму',
};

// ─── HELPERS ──────────────────────────────────────────────────
const $=id=>document.getElementById(id);
function fmt(v){return Math.round(v).toLocaleString('ru-RU')}
function fmt2(v){return (+v).toLocaleString('ru-RU',{maximumFractionDigits:2})}
function fh(v){return v%1===0?v:parseFloat((+v).toFixed(2))}
function esc(s){return(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")}
function escH(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
const proj=id=>D.projects.find(p=>p.id===id);
const clientName=p=>C.refName(D.clients,p.clientId);
const typeName=p=>C.refName(D.types,p.typeId);
const months=()=>D.months.map(m=>m.month);
const lastMonth=()=>D.months.length?D.months[D.months.length-1].month:'';
const stats=(p,opt)=>C.projectStats(D,p,opt);
const dash='<span style="color:var(--text3)">—</span>';
const money=v=>v?'$'+fmt(v):dash;

// Безопасный калькулятор сумм ("2101+2101") — без eval
function evalAmount(raw){
  if(raw===null||raw===undefined) return null;
  const s=String(raw).replace(/,/g,'.').replace(/\s+/g,'');
  if(!s) return null;
  if(!/^[\d+\-*/().]+$/.test(s)) return null;
  let i=0;
  const num=()=>{const m=/^\d+(\.\d+)?|^\.\d+/.exec(s.slice(i));if(!m)throw 0;i+=m[0].length;return parseFloat(m[0]);};
  const fac=()=>{if(s[i]==='-'){i++;return -fac();}if(s[i]==='('){i++;const v=ex();if(s[i++]!==')')throw 0;return v;}return num();};
  const term=()=>{let v=fac();while(s[i]==='*'||s[i]==='/'){const o=s[i++];const r=fac();v=o==='*'?v*r:v/r;}return v;};
  const ex=()=>{let v=term();while(s[i]==='+'||s[i]==='-'){const o=s[i++];const r=term();v=o==='+'?v+r:v-r;}return v;};
  try{const v=ex();return i===s.length&&isFinite(v)?r2(v):null;}catch(e){return null;}
}

function statusBadge(s){
  if(!s) return '';
  const info=STATUSES.find(x=>x.val===s);
  if(!info) return `<span class="sbadge s-default">${escH(s)}</span>`;
  return `<span class="sbadge" style="background:${info.bg};color:${info.color}"><span style="width:6px;height:6px;border-radius:50%;background:${info.dot};display:inline-block;flex-shrink:0"></span>${s}</span>`;
}
const payBadge=st=>`<span class="pbadge ${PAY[st].cls}">${PAY[st].label}</span>`;
function profitBadge(v){if(!v)return '';return `<span class="pfbadge ${v==='Да'?'pf-yes':'pf-no'}">Профит: ${v}</span>`;}
function originBadge(p){
  if(p.origin==='inherited') return '<span class="orig-badge orig-inh" title="Чужой проект на поддержке">↪ чужой</span>';
  if(!p.origin) return '<span class="orig-badge orig-unk" title="Не указано: свой или чужой">? происхождение</span>';
  return '';
}
function warrantyEnd(m){return m&&C.isMonth(m)?C.shiftMonth(m,2):null}
function monthOptions(sel,withEmpty){
  return (withEmpty?`<option value="">${withEmpty}</option>`:'')+months().map(m=>`<option value="${m}"${m===sel?' selected':''}>${m}</option>`).join('');
}

// ─── FIRESTORE ────────────────────────────────────────────────
async function persist(){
  if(readOnly||!D){toast('⚠ Только чтение — изменения не сохранены');return;}
  try{
    _saving=true;showSync(true);
    D.updatedAt=new Date().toISOString();
    await DOC.set(JSON.parse(JSON.stringify(D))); // JSON — убираем undefined (Firestore их не принимает)
  }catch(e){
    toast('⚠ Ошибка сохранения: '+e.message);console.error(e);
  }finally{showSync(false);_saving=false;}
}

function initFirestore(){
  DOC.onSnapshot(snap=>{
    showLoading(false);
    if(_saving) return;
    if(!snap.exists){blocker('Документ webdev/dashboard не найден. Восстанови данные из экспорта через «Импорт».');readOnly=false;D=C.normalize({schemaVersion:C.SCHEMA_VERSION});render();return;}
    const data=snap.data();
    if((data.schemaVersion||0)<C.SCHEMA_VERSION){
      readOnly=true;
      blocker('Данные ещё в старом формате. Дашборд обновлён, а миграция базы пока не выполнена — изменения не сохраняются. Запусти mcp/scripts/migrate.mjs.');
      return;
    }
    blocker(null);
    readOnly=false;
    D=C.normalize(data);
    syncSettingsInputs();
    render();
  },err=>{showLoading(false);toast('⚠ Ошибка подключения: '+err.message);console.error(err);});
}
function blocker(msg){
  let el=$('blocker');
  if(!msg){if(el)el.remove();return;}
  if(!el){el=document.createElement('div');el.id='blocker';el.className='blocker';document.querySelector('.main').prepend(el);}
  el.innerHTML='⚠ '+escH(msg);
}
function showLoading(v){$('loading').style.display=v?'flex':'none'}
function showSync(v){$('sync-dot').classList.toggle('show',v)}

// ─── SETTINGS ─────────────────────────────────────────────────
function syncSettingsInputs(){
  const s=D.settings;
  for(const [id,k] of [['rate','rate'],['costrate','costRate'],['eurrate','eurRate'],['expdelay','expDelay']]){
    if(document.activeElement!==$(id)) $(id).value=s[k];
  }
}
let _setT=null;
function onSettingInput(id,k,int){
  const v=int?parseInt($(id).value,10):parseFloat($(id).value);
  if(!(v>=0)) return;
  D.settings[k]=v;
  renderCurrent();
  clearTimeout(_setT);_setT=setTimeout(persist,600);
}

// ─── FILTERS ──────────────────────────────────────────────────
function filtered(){
  const q=$('search').value.toLowerCase();
  const mn=n($('fmin').value)||0;
  const mx=$('fmax').value===''?Infinity:n($('fmax').value);
  return D.projects.filter(p=>{
    if(fClient&&p.clientId!==fClient) return false;
    if(fType&&p.typeId!==fType) return false;
    if(fStatus!=='Все'&&(p.status||'')!==fStatus) return false;
    const s=stats(p);
    if(fPay&&s.paymentStatus!==fPay) return false;
    if(s.received<mn||s.received>mx) return false;
    if(q&&!p.site.toLowerCase().includes(q)&&!clientName(p).toLowerCase().includes(q)&&!typeName(p).toLowerCase().includes(q)) return false;
    return true;
  });
}
function setC(c){fClient=c;closeD();render();closeDrawer();if(currentTab!=='projects')switchTab('projects');}
function setT(t){fType=t;closeD();render()}
function setSt(s){fStatus=s;closeD();render()}
function setPay(s){fPay=s;closeD();render()}
function reset(){
  fClient='';fType='';fStatus='Все';fPay='';
  $('search').value='';$('fmin').value='';$('fmax').value='';
  closeD();render();
}

// ─── RENDER: PROJECTS ─────────────────────────────────────────
function render(){
  if(!D) return;
  renderNav();renderTypes();renderStatusPills();renderPayPills();renderCards();renderTable();
  fillDatalists();renderTabCounts();
  if(aid) renderDet();
  if(currentTab!=='projects') renderCurrent();
}
function renderCurrent(){
  if(!D) return;
  if(currentTab==='projects'){renderCards();renderTable();if(aid)renderDet();}
  else if(currentTab==='monthly') renderMonthly();
  else if(currentTab==='clients') renderClients();
  else if(currentTab==='receivables') renderReceivables();
  else if(currentTab==='issues') renderIssues();
  renderTabCounts();
}
function renderTabCounts(){
  const rc=C.receivables(D);
  $('cnt-receivables').textContent=rc.length?'$'+fmt(rc.reduce((s,r)=>s+r.outstanding,0)):'';
  const iss=C.dataIssues(D).length;
  $('cnt-issues').textContent=iss||'';
}

function renderNav(){
  if(fClient&&!D.clients.some(c=>c.id===fClient)) fClient='';
  const used=D.clients.filter(c=>D.projects.some(p=>p.clientId===c.id)).sort((a,b)=>a.name.localeCompare(b.name));
  const items=[{id:'',name:'Все клиенты',cnt:D.projects.length},...used.map(c=>({id:c.id,name:c.name,cnt:D.projects.filter(p=>p.clientId===c.id).length}))];
  $('nav').innerHTML=items.map(c=>`<div class="ni${fClient===c.id?' on':''}" onclick="setC('${c.id}')"><span class="nl">${escH(c.name)}</span><span class="nc">${c.cnt}</span></div>`).join('');
  $('mob-clients').innerHTML=items.map(c=>`<div class="mob-pill${fClient===c.id?' on':''}" onclick="setC('${c.id}')">${c.id?escH(c.name):'Все'}<span class="mc">${c.cnt}</span></div>`).join('');
}
function renderTypes(){
  if(fType&&!D.types.some(t=>t.id===fType)) fType='';
  const used=D.types.filter(t=>D.projects.some(p=>p.typeId===t.id)).sort((a,b)=>a.name.localeCompare(b.name));
  $('type-pills').innerHTML=[`<div class="pill${!fType?' on':''}" onclick="setT('')">Все типы</div>`,
    ...used.map(t=>`<div class="pill${fType===t.id?' on':''}" onclick="setT('${t.id}')">${escH(t.name)}</div>`)].join('');
}
function renderStatusPills(){
  $('status-pills').innerHTML=`<div class="spill${fStatus==='Все'?' on':''}" onclick="setSt('Все')">Все статусы</div>`+STATUSES.map(s=>{
    const cnt=D.projects.filter(p=>p.status===s.val).length;
    return `<div class="spill${fStatus===s.val?` on ss-${s.cls}`:''}" onclick="setSt('${esc(s.val)}')"><span class="spill-dot" style="background:${s.dot}"></span>${s.val} <span style="font-size:10px;opacity:.7">${cnt}</span></div>`;
  }).join('');
}
function renderPayPills(){
  const cnt={};for(const p of D.projects){const s=stats(p).paymentStatus;cnt[s]=(cnt[s]||0)+1;}
  $('pay-pills').innerHTML=`<div class="spill${!fPay?' on':''}" onclick="setPay('')">Все</div>`+C.PAY_STATUSES.map(k=>
    `<div class="spill${fPay===k?' on':''}" onclick="setPay('${k}')"><span class="pbadge ${PAY[k].cls}" style="padding:0 6px">${PAY[k].label}</span> <span style="font-size:10px;opacity:.7">${cnt[k]||0}</span></div>`).join('');
}
function renderCards(){
  const list=filtered();
  let inv=0,rec=0,debt=0,exp=0,h=0,hb=0,hs=0,pr=0,epr=0;
  for(const p of list){const s=stats(p);inv+=s.invoiced;rec+=s.received;debt+=s.debt;exp+=s.expense;h+=s.hours;hb+=s.byPhase.build.hours;hs+=s.byPhase.support.hours;pr+=s.profit;epr+=s.expectedProfit;}
  const m=rec>0?Math.round(pr/rec*1000)/10:0;
  const debtors=list.filter(p=>stats(p).debt>0).length;
  $('cards').innerHTML=`
    <div class="sc c1"><div class="sc-ico">💰</div><div class="sc-lbl">Получено</div><div class="sc-val v-teal">$${fmt(rec)}</div><div class="sc-sub">выставлено $${fmt(inv)} · ${list.length} проектов</div></div>
    <div class="sc c4"><div class="sc-ico">💸</div><div class="sc-lbl">Должны</div><div class="sc-val v-yel">$${fmt(debt)}</div><div class="sc-sub">${debtors?`${debtors} проект(ов) с долгом`:'долгов нет'}</div></div>
    <div class="sc c2"><div class="sc-ico">⏱</div><div class="sc-lbl">Расход</div><div class="sc-val">$${fmt(exp)}</div><div class="sc-sub">${fh(r2(h))} ч · разраб. ${fh(r2(hb))} · поддержка ${fh(r2(hs))}</div></div>
    <div class="sc c3"><div class="sc-ico">📈</div><div class="sc-lbl">Профит · маржа ${m}%</div><div class="sc-val v-green">$${fmt(pr)}</div><div class="sc-sub">ожидаемый с долгами $${fmt(epr)}</div></div>`;
}

function renderTable(){
  const list=filtered();
  const tbody=$('tbody'), det=$('det');
  if(det.parentElement!==$('det-home')) $('det-home').appendChild(det);
  const ae=document.activeElement;
  const keep=ae&&ae.classList&&ae.classList.contains('pnote')?{id:ae.dataset.id,v:ae.value,s:ae.selectionStart,e:ae.selectionEnd}:null;
  $('ptitle').textContent=`Проектов: ${list.length}`;
  if(!list.length){tbody.innerHTML=`<tr><td colspan="8" class="empty-row">Ничего не найдено</td></tr>`;det.style.display='none';return;}
  tbody.innerHTML=list.map(p=>{
    const s=stats(p);
    const mc=s.margin>=75?'#0FC47A':s.margin>=55?'#F59E0B':'#F05252';
    const mp=Math.max(0,Math.min(100,s.margin));
    const wb=p.warn?`<span class="bdg ba">⚠</span>`:'';
    const deliv=p.deliveryMonth?`<span class="deliv-tag">📅 ${p.deliveryMonth}</span>`:'';
    const refb=n(p.refPct)>0?`<span class="ref-badge">🤝 ${n(p.refPct)}%</span>`:'';
    const sel=aid===p.id;
    return`<tr data-id="${p.id}" onclick="tog('${p.id}')" class="prow${sel?' sel':''}">
      <td>
        <div class="pn">${escH(p.site)}${wb}</div>
        <div class="pm">${escH(clientName(p))}${typeName(p)?' · '+escH(typeName(p)):''}</div>
        <div class="p-badges">${statusBadge(p.status)}${payBadge(s.paymentStatus)}${profitBadge(p.profitShared)}${originBadge(p)}${deliv}${refb}</div>
      </td>
      <td class="note-td" onclick="event.stopPropagation()"><textarea class="pnote" data-id="${p.id}" rows="2" placeholder="Заметка…" oninput="noteInput(this)" onblur="saveNote(this)">${escH(p.note)}</textarea></td>
      <td class="r">${money(s.received)}${s.invoiced>s.received+0.5?`<div class="sub-r">из $${fmt(s.invoiced)}</div>`:''}</td>
      <td class="r ${s.debt>0?'debt':''}">${s.debt>0?'$'+fmt(s.debt):dash}</td>
      <td class="r">${fh(s.hours)}${s.byPhase.support.hours>0?`<div class="sub-r">подд. ${fh(s.byPhase.support.hours)}</div>`:''}</td>
      <td class="r">$${fmt(s.expense)}</td>
      <td class="r ${s.profit>=0?'pos':'neg'}">$${fmt(s.profit)}</td>
      <td><div class="mbar"><div class="mbt"><div class="mbf" style="width:${mp}%;background:${mc}"></div></div><span class="mbn">${s.received>0?Math.round(s.margin*10)/10+'%':'—'}</span></div></td>
    </tr>${sel?`<tr class="det-row"><td colspan="8" id="det-slot"></td></tr>`:''}`;
  }).join('');
  const slot=$('det-slot');
  if(slot) slot.appendChild(det); else det.style.display='none';
  if(keep){const t=tbody.querySelector(`.pnote[data-id="${keep.id}"]`);if(t){t.value=keep.v;t.focus();try{t.setSelectionRange(keep.s,keep.e);}catch(e){}}}
  tbody.querySelectorAll('.pnote').forEach(autoGrow);
}

// Раскрытие под строкой; кликнутая строка остаётся на том же месте экрана
function tog(id){
  const row=document.querySelector(`#tbody tr[data-id="${id}"]`);
  const top0=row?row.getBoundingClientRect().top:null;
  editEntryId=null;
  if(aid===id){aid=null;renderTable();}
  else{aid=id;renderTable();renderDet();}
  const row2=document.querySelector(`#tbody tr[data-id="${id}"]`);
  if(row2&&top0!==null) window.scrollBy(0,row2.getBoundingClientRect().top-top0);
}
function openProject(id){
  if(currentTab!=='projects') switchTab('projects');
  fClient='';fType='';fStatus='Все';fPay='';$('search').value='';$('fmin').value='';$('fmax').value='';
  aid=id;editEntryId=null;render();
  setTimeout(()=>{const r=document.querySelector(`#tbody tr[data-id="${id}"]`);if(r)r.scrollIntoView({behavior:'smooth',block:'start'});},30);
}
function closeD(){aid=null;editEntryId=null;$('det').style.display='none';renderTable();}

// ─── NOTES ────────────────────────────────────────────────────
function autoGrow(t){t.style.height='auto';t.style.height=Math.min(t.scrollHeight+2,140)+'px';}
const _noteTimers={};
function noteInput(t){autoGrow(t);clearTimeout(_noteTimers[t.dataset.id]);_noteTimers[t.dataset.id]=setTimeout(()=>saveNote(t),1200);}
function saveNote(t){
  clearTimeout(_noteTimers[t.dataset.id]);
  const p=proj(t.dataset.id);if(!p)return;
  const v=t.value.replace(/\s+$/,'');
  if((p.note||'')===v) return;
  p.note=v;persist();
}

// ─── DETAIL PANEL ─────────────────────────────────────────────
function renderDet(){
  const p=proj(aid);if(!p){aid=null;return;}
  const s=stats(p);
  $('ds').textContent=p.site;
  $('dm').textContent=[clientName(p),typeName(p)].filter(Boolean).join(' · ');
  let badges='';
  if(p.status) badges+=`<span class="dh-sbadge">${escH(p.status)}</span>`;
  badges+=`<span class="dh-pbadge">${PAY[s.paymentStatus].label}</span>`;
  badges+=`<span class="dh-deliv">${p.origin==='inherited'?'↪ Чужой, на поддержке':p.origin==='own'?'🏗 Свой проект':'❓ Происхождение не указано'}</span>`;
  if(p.deliveryMonth) badges+=`<span class="dh-deliv">📅 Сдан: ${p.deliveryMonth}</span>`;
  if(p.profitShared) badges+=`<span class="dh-pbadge">${p.profitShared==='Да'?'✅':'⏳'} Профит: ${p.profitShared}</span>`;
  if(s.referral>0) badges+=`<span class="dh-deliv" style="background:rgba(167,139,250,.25)">🤝 Реферал: ${n(p.refPct)}% = $${fmt(s.referral)}</span>`;
  $('dh-badges').innerHTML=badges;
  $('warranty-row').innerHTML=p.deliveryMonth&&p.status==='Сдан'?`<div class="warranty-row">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      Гарантийный период: ${p.deliveryMonth} → ${warrantyEnd(p.deliveryMonth)||'—'}</div>`:'';
  const mc=s.margin>=75?'var(--green)':s.margin>=55?'var(--amber)':'var(--red)';
  $('dkpi').innerHTML=`
    <div class="kpi"><div class="kpi-l">Получено</div><div class="kpi-v kv-blue">$${fmt(s.received)}</div><div class="kpi-s">выставлено $${fmt(s.invoiced)}${s.dop>0?` · правки $${fmt(s.dop)}`:''}</div></div>
    <div class="kpi"><div class="kpi-l">Долг</div><div class="kpi-v" style="color:${s.debt>0?'var(--amber)':'var(--text3)'}">$${fmt(s.debt)}</div><div class="kpi-s">${PAY[s.paymentStatus].label}</div></div>
    <div class="kpi"><div class="kpi-l">Часы · расход</div><div class="kpi-v">${fh(s.hours)} ч</div><div class="kpi-s">$${fmt(s.expense)} · €${fmt(s.expenseEUR)}<br>разраб. ${fh(s.byPhase.build.hours)} ч / $${fmt(s.byPhase.build.expense)} · подд. ${fh(s.byPhase.support.hours)} ч / $${fmt(s.byPhase.support.expense)}</div></div>
    <div class="kpi"><div class="kpi-l">Профит · маржа</div><div class="kpi-v kv-green">$${fmt(s.profit)}</div><div class="kpi-s"><b style="color:${mc}">${s.received>0?Math.round(s.margin*10)/10+'%':'—'}</b> · ожидаемый $${fmt(s.expectedProfit)}</div></div>`;
  renderHoursSection(p);renderInvoicesSection(p);renderPaymentsSection(p);
  const det=$('det'),slot=$('det-slot');
  if(slot&&det.parentElement!==slot) slot.appendChild(det);
  det.style.display=slot?'block':'none';
}

// ── Часы ──
function renderHoursSection(p){
  const entries=D.hours.filter(h=>h.projectId===p.id).sort((a,b)=>C.cmpMonth(b.month,a.month)||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  const ed=editEntryId?D.hours.find(h=>h.id===editEntryId):null;
  const kind=ed?ed.kind:'dev';
  const rows=entries.map(h=>{
    const auto=C.autoPhase(p,h.month);
    return `<tr class="${ed&&ed.id===h.id?'editing':''}">
      <td class="nw">${h.month}</td>
      <td class="r">${fh(h.hours)}</td>
      <td class="r nw">€${fh(h.rate)}</td>
      <td><span class="kind-b k-${h.kind}">${h.kind==='cost'?'себест.':'разраб.'}</span></td>
      <td><span class="phase-b ph-${h.phase}" title="${h.phaseManual?'Проставлено вручную':'Автоматически'}">${h.phase==='support'?'поддержка':'разработка'}${h.phaseManual&&h.phase!==auto?' ✋':''}</span></td>
      <td class="note-cell">${h.note?escH(h.note):(h.migrated?'<span class="muted">из старых данных</span>':'<span class="warn-txt">нет описания</span>')}</td>
      <td class="r nw">$${fmt2(r2(C.entryCostUSD(D,h)))}</td>
      <td class="acts nw"><button class="ib" title="Изменить" onclick="editEntry('${h.id}')">✎</button><button class="ib ib-del" title="Удалить" onclick="delEntry('${h.id}')">✕</button></td>
    </tr>`;
  }).join('');
  $('dsec-hours').innerHTML=`
    <div class="dsec-h"><span>⏱ Часы <span class="muted">${entries.length} записей</span></span></div>
    <div class="dform">
      <select class="fi fi-sm" id="he-month">${monthOptions(ed?ed.month:lastMonth())}</select>
      <input class="fi fi-sm" id="he-hours" type="number" min="0" step="0.25" placeholder="часы" value="${ed?ed.hours:''}" style="width:80px">
      <select class="fi fi-sm" id="he-kind" onchange="$('he-rate').value=C.defaultRate(D,this.value)">
        <option value="dev"${kind==='dev'?' selected':''}>разработка</option><option value="cost"${kind==='cost'?' selected':''}>себестоимость</option></select>
      <span class="fl">€/ч</span><input class="fi fi-sm" id="he-rate" type="number" min="0" step="0.5" value="${ed?ed.rate:C.defaultRate(D,kind)}" style="width:70px">
      <select class="fi fi-sm" id="he-phase">
        <option value="auto"${!ed||!ed.phaseManual?' selected':''}>фаза: авто</option>
        <option value="build"${ed&&ed.phaseManual&&ed.phase==='build'?' selected':''}>разработка</option>
        <option value="support"${ed&&ed.phaseManual&&ed.phase==='support'?' selected':''}>поддержка</option></select>
      <input class="fi fi-sm" id="he-note" placeholder="что делали" value="${ed?escH(ed.note):''}" style="flex:1;min-width:160px" onkeydown="if(event.key==='Enter')saveEntry()">
      <button class="btn btn-teal btn-sm" onclick="saveEntry()">${ed?'Сохранить':'+ Добавить'}</button>
      ${ed?'<button class="btn btn-sm" onclick="editEntryId=null;renderDet()">Отмена</button>':''}
    </div>
    ${entries.length?`<div class="tw"><table class="mtbl dtbl"><thead><tr><th>Месяц</th><th class="r">Часы</th><th class="r">Ставка</th><th>Вид</th><th>Фаза</th><th>Что делали</th><th class="r">Расход</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="empty-sec">Часов пока нет</div>'}`;
}
function editEntry(id){editEntryId=id;renderDet();setTimeout(()=>$('he-hours')&&$('he-hours').focus(),20);}
function saveEntry(){
  const p=proj(aid);if(!p)return;
  const hours=evalAmount($('he-hours').value);
  if(hours===null||hours<0){toast('Укажи часы');$('he-hours').focus();return;}
  const month=$('he-month').value, kind=$('he-kind').value, rate=n($('he-rate').value)||C.defaultRate(D,kind);
  const ph=$('he-phase').value, note=$('he-note').value.trim();
  let e=editEntryId?D.hours.find(h=>h.id===editEntryId):null;
  if(!e){e={id:'h'+C.uid(),projectId:p.id,createdAt:new Date().toISOString()};D.hours.push(e);}
  Object.assign(e,{month,hours:r2(hours),kind,rate,note,phaseManual:ph!=='auto'});
  e.phase=ph==='auto'?C.autoPhase(p,month):ph;
  delete e.migrated;
  if(!(e.hours>0)) D.hours=D.hours.filter(h=>h.id!==e.id);
  editEntryId=null;persist();render();
  if(!note) toast('Запись без описания — попадёт в «Проверку»');
}
function delEntry(id){
  const e=D.hours.find(h=>h.id===id);if(!e)return;
  if(!confirm(`Удалить запись ${e.hours} ч за ${e.month}${e.note?' — '+e.note:''}?`)) return;
  D.hours=D.hours.filter(h=>h.id!==id);editEntryId=null;persist();render();
}

// ── Счета ──
function invoicePaid(inv){return D.payments.filter(x=>x.invoiceId===inv.id).reduce((s,x)=>s+n(x.amount),0);}
function renderInvoicesSection(p){
  const invs=D.invoices.filter(i=>i.projectId===p.id).sort((a,b)=>String(b.issuedAt).localeCompare(String(a.issuedAt)));
  const rows=invs.map(i=>{
    const usd=C.invoiceUSD(D,i), paid=invoicePaid(i), left=i.status==='sent'?Math.max(0,usd-paid):0;
    const age=i.status==='sent'?C.daysBetween(i.issuedAt):null;
    return `<tr class="${i.status==='cancelled'?'zero':''}">
      <td class="nw">${i.issuedAt||dash}${age!==null?`<div class="sub-r ${age>C.OVERDUE_DAYS?'warn-txt':''}">${age} дн.</div>`:''}</td>
      <td class="note-cell">${escH(i.description)||dash}</td>
      <td class="r nw">${i.currency==='EUR'?'€'+fmt2(i.amount)+`<div class="sub-r">≈ $${fmt(usd)}</div>`:'$'+fmt2(i.amount)}</td>
      <td class="r nw">${paid?'$'+fmt2(r2(paid)):dash}</td>
      <td class="r nw ${left>0?'debt':''}">${left>0?'$'+fmt2(r2(left)):dash}</td>
      <td><select class="fi fi-xs inv-st inv-${i.status}" onchange="setInvoiceStatus('${i.id}',this.value)">${C.INVOICE_STATUSES.map(st=>`<option value="${st}"${st===i.status?' selected':''}>${INV_ST[st]}</option>`).join('')}</select></td>
    </tr>`;
  }).join('');
  $('dsec-invoices').innerHTML=`
    <div class="dsec-h"><span>🧾 Счета <span class="muted">выставлено $${fmt(stats(p).invoiced)}</span></span></div>
    <div class="dform">
      <input class="fi fi-sm" id="iv-amt" placeholder="сумма" style="width:110px" onkeydown="if(event.key==='Enter')addInvoice()">
      <select class="fi fi-sm" id="iv-cur"><option>USD</option><option>EUR</option></select>
      <input class="fi fi-sm" id="iv-date" type="date" value="${C.todayISO()}">
      <input class="fi fi-sm" id="iv-desc" placeholder="за что (разработка, поддержка октябрь…)" style="flex:1;min-width:160px" onkeydown="if(event.key==='Enter')addInvoice()">
      <select class="fi fi-sm" id="iv-st"><option value="sent">отправлен</option><option value="draft">черновик</option><option value="paid">уже оплачен</option></select>
      <button class="btn btn-teal btn-sm" onclick="addInvoice()">+ Счёт</button>
    </div>
    ${invs.length?`<div class="tw"><table class="mtbl dtbl"><thead><tr><th>Дата</th><th>За что</th><th class="r">Сумма</th><th class="r">Оплачено</th><th class="r">Остаток</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="empty-sec">Счетов нет</div>'}`;
}
function addInvoice(){
  const p=proj(aid);if(!p)return;
  const amt=evalAmount($('iv-amt').value);
  if(!(amt>0)){toast('Укажи сумму счёта');$('iv-amt').focus();return;}
  const date=$('iv-date').value||C.todayISO();
  if(!D.months.some(m=>m.month===C.dateToMonth(date))){toast(`Месяца ${C.dateToMonth(date)} нет на шкале — добавь его во вкладке «По месяцам»`);return;}
  D.invoices.push({id:'i'+C.uid(),projectId:p.id,amount:amt,currency:$('iv-cur').value,issuedAt:date,description:$('iv-desc').value.trim(),status:$('iv-st').value});
  persist();render();toast('Счёт добавлен');
}
function setInvoiceStatus(id,st){
  const inv=D.invoices.find(i=>i.id===id);if(!inv)return;
  if(st==='cancelled'&&invoicePaid(inv)>0&&!confirm('По счёту уже есть поступления. Всё равно отменить?')){renderDet();return;}
  inv.status=st;delete inv.migrated;persist();render();
}

// ── Поступления ──
function renderPaymentsSection(p){
  const pays=D.payments.filter(x=>x.projectId===p.id).sort((a,b)=>C.cmpMonth(b.month,a.month)||String(b.receivedAt).localeCompare(String(a.receivedAt)));
  const invs=D.invoices.filter(i=>i.projectId===p.id);
  const open=invs.filter(i=>i.status==='sent');
  const invLabel=i=>`${i.issuedAt} · ${i.currency==='EUR'?'€':'$'}${fmt2(i.amount)}${i.description?' · '+i.description:''}`;
  const rows=pays.map(x=>{
    const inv=invs.find(i=>i.id===x.invoiceId);
    return `<tr>
      <td class="nw">${x.month||'<span class="warn-txt">нет месяца</span>'}<div class="sub-r">${x.receivedAt||''}</div></td>
      <td class="r nw">$${fmt2(x.amount)}</td>
      <td class="note-cell">${inv?escH(invLabel(inv)):'<span class="warn-txt">без счёта</span>'}</td>
      <td class="note-cell">${escH(x.note)}</td>
      <td class="acts"><button class="ib ib-del" title="Удалить" onclick="delPayment('${x.id}')">✕</button></td>
    </tr>`;
  }).join('');
  $('dsec-payments').innerHTML=`
    <div class="dsec-h"><span>💵 Поступления <span class="muted">получено $${fmt(stats(p).received)}</span></span></div>
    <div class="dform">
      <input class="fi fi-sm" id="pm-amt" placeholder="сумма, USDT" style="width:120px" onkeydown="if(event.key==='Enter')addPayment()">
      <input class="fi fi-sm" id="pm-date" type="date" value="${C.todayISO()}">
      <select class="fi fi-sm" id="pm-inv" style="max-width:280px">
        ${open.map(i=>`<option value="${i.id}">счёт ${escH(invLabel(i))} · ост. $${fmt(Math.max(0,C.invoiceUSD(D,i)-invoicePaid(i)))}</option>`).join('')}
        ${invs.filter(i=>i.status!=='sent'&&i.status!=='cancelled').map(i=>`<option value="${i.id}">счёт ${escH(invLabel(i))} (${INV_ST[i.status]})</option>`).join('')}
        <option value="">без счёта</option>
      </select>
      <input class="fi fi-sm" id="pm-note" placeholder="заметка" style="flex:1;min-width:120px" onkeydown="if(event.key==='Enter')addPayment()">
      <button class="btn btn-teal btn-sm" onclick="addPayment()">+ Поступление</button>
    </div>
    ${pays.length?`<div class="tw"><table class="mtbl dtbl"><thead><tr><th>Месяц</th><th class="r">Сумма</th><th>По счёту</th><th>Заметка</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="empty-sec">Поступлений нет</div>'}`;
}
function addPayment(){
  const p=proj(aid);if(!p)return;
  const amt=evalAmount($('pm-amt').value);
  if(!(amt>0)){toast('Укажи сумму');$('pm-amt').focus();return;}
  const date=$('pm-date').value||C.todayISO(), month=C.dateToMonth(date);
  if(!D.months.some(m=>m.month===month)){toast(`Месяца ${month} нет на шкале — добавь его во вкладке «По месяцам»`);return;}
  const invId=$('pm-inv').value;
  D.payments.push({id:'p'+C.uid(),projectId:p.id,invoiceId:invId,amount:amt,receivedAt:date,month,note:$('pm-note').value.trim()});
  if(invId) C.syncInvoiceStatus(D,invId);
  persist();render();toast('Поступление записано');
}
function delPayment(id){
  const x=D.payments.find(y=>y.id===id);if(!x)return;
  if(!confirm(`Удалить поступление $${fmt2(x.amount)} (${x.month})?`)) return;
  D.payments=D.payments.filter(y=>y.id!==id);
  if(x.invoiceId) C.syncInvoiceStatus(D,x.invoiceId);
  persist();render();
}

// ─── PROJECT MODAL ────────────────────────────────────────────
function fillDatalists(){
  $('dl-clients').innerHTML=D.clients.map(c=>`<option value="${escH(c.name)}">`).join('');
  $('dl-types').innerHTML=D.types.map(c=>`<option value="${escH(c.name)}">`).join('');
}
function openAdd(){
  if(readOnly){toast('Только чтение');return;}
  eid=null;
  $('mtitle').textContent='Новый проект';
  for(const id of ['fs','fc','ft','fd','frefpct','fnote','finvamt']) $(id).value='';
  if(fClient) $('fc').value=C.refName(D.clients,fClient);
  $('forigin').value='own';$('fw').checked=false;$('fstatus').value='Обсуждение';$('fprofitshared').value='';
  $('fdelivery').innerHTML=monthOptions('','— не указан —');
  $('new-invoice-block').style.display='';$('finvcur').value='USD';
  $('ferr').textContent='';
  $('ov').classList.add('open');
  setTimeout(()=>$('fs').focus(),150);
}
function openEdit(){
  const p=proj(aid);if(!p)return;
  eid=p.id;
  $('mtitle').textContent='Редактировать проект';
  $('fs').value=p.site;$('fc').value=clientName(p);$('ft').value=typeName(p);
  $('forigin').value=p.origin||'';$('fd').value=p.dop||'';$('frefpct').value=p.refPct||'';
  $('fw').checked=!!p.warn;$('fstatus').value=p.status||'';$('fprofitshared').value=p.profitShared||'';
  $('fnote').value=p.note||'';
  $('fdelivery').innerHTML=monthOptions(p.deliveryMonth||'','— не указан —');
  $('new-invoice-block').style.display='none';
  $('ferr').textContent='';
  $('ov').classList.add('open');
}
function closeM(){$('ov').classList.remove('open')}
function ovc(e){if(e.target===$('ov'))closeM()}
function save(){
  const site=$('fs').value.trim(), client=$('fc').value.trim();
  if(!site){$('ferr').textContent='Укажи домен';return}
  if(!client){$('ferr').textContent='Укажи заказчика';return}
  if(D.projects.some(p=>p.id!==eid&&p.site.toLowerCase()===site.toLowerCase())){$('ferr').textContent='Такой проект уже есть';return}
  let invAmt=null;
  if(!eid&&$('finvamt').value.trim()){
    invAmt=evalAmount($('finvamt').value);
    if(!(invAmt>0)){$('ferr').textContent='Некорректная сумма счёта';return}
  }
  let p=eid?proj(eid):null;
  if(!p){p={id:C.uid()};D.projects.push(p);}
  const before={d:p.deliveryMonth,o:p.origin};
  Object.assign(p,{
    site, clientId:C.ensureRef(D.clients,client), typeId:C.ensureRef(D.types,$('ft').value),
    origin:$('forigin').value, status:$('fstatus').value, deliveryMonth:$('fdelivery').value,
    dop:n($('fd').value), refPct:n($('frefpct').value), warn:$('fw').checked,
    profitShared:$('fprofitshared').value, note:$('fnote').value.replace(/\s+$/,''),
  });
  if(before.d!==p.deliveryMonth||before.o!==p.origin) C.refreshPhases(D,p.id);
  if(invAmt) D.invoices.push({id:'i'+C.uid(),projectId:p.id,amount:invAmt,currency:$('finvcur').value,issuedAt:C.todayISO(),description:'Разработка',status:'sent'});
  persist();closeM();aid=p.id;render();
}
function askDel(){
  const p=proj(aid);if(!p)return;did=p.id;
  const cnt=k=>D[k].filter(x=>x.projectId===p.id).length;
  $('ctxt').textContent=`Удалить «${p.site}» вместе с часами (${cnt('hours')}), счетами (${cnt('invoices')}) и поступлениями (${cnt('payments')})? Нельзя отменить.`;
  $('cov').classList.add('open');
}
function closeC(){$('cov').classList.remove('open');did=null}
function doDel(){
  D.projects=D.projects.filter(p=>p.id!==did);
  for(const k of ['hours','invoices','payments']) D[k]=D[k].filter(x=>x.projectId!==did);
  persist();closeC();closeD();render();
}

// ─── MONTHS ───────────────────────────────────────────────────
function addMonth(){
  const next=C.shiftMonth(lastMonth(),1);
  D.months.push({month:next});persist();renderCurrent();toast(`Добавлен ${next} — задай ему курс`);
}
function addPrevMonth(){
  const prev=C.shiftMonth(D.months[0].month,-1);
  D.months.unshift({month:prev});persist();renderCurrent();toast(`Добавлен ${prev}`);
}
function setMonthRate(month,val){
  const m=D.months.find(x=>x.month===month);if(!m)return;
  const v=parseFloat(String(val).replace(',','.'));
  if(val===''||!(v>0)) delete m.eurRate; else m.eurRate=v;
  persist();renderCurrent();
}

// ─── TABS ─────────────────────────────────────────────────────
let monthlyChart=null;
function switchTab(tab){
  currentTab=tab;
  for(const t of ['projects','monthly','clients','receivables','issues']){
    $('view-'+t).classList.toggle('on',t===tab);
    $('tab-'+t).classList.toggle('on',t===tab);
  }
  renderCurrent();
}

// ─── MONTHLY ──────────────────────────────────────────────────
function renderMonthly(){
  $('mf-reset-btn').style.display=excludedProjects.size?'inline-block':'none';
  const rows=C.monthlyStats(D,{exclude:excludedProjects});
  const delay=parseInt(D.settings.expDelay,10)||0;
  $('chart-sub').textContent='Получено — по месяцу поступления · Выставлено — по дате счёта · Расход — часы × ставка записи × курс месяца'+(delay?` · расход сдвинут на +${delay} мес.`:'')+' · Профит — получено минус расход';
  const ctx=$('monthly-chart').getContext('2d');
  if(monthlyChart) monthlyChart.destroy();
  monthlyChart=new Chart(ctx,{
    type:'bar',
    data:{labels:rows.map(r=>r.month),datasets:[
      {label:'Получено',data:rows.map(r=>Math.round(r.received)),backgroundColor:'rgba(15,196,122,.75)',borderColor:'#0FC47A',borderWidth:1.5,borderRadius:6,borderSkipped:false},
      {label:'Выставлено',data:rows.map(r=>Math.round(r.invoiced)),backgroundColor:'rgba(46,134,193,.12)',borderColor:'#2E86C1',borderWidth:1.5,borderRadius:6,borderSkipped:false},
      {label:'Расход',data:rows.map(r=>Math.round(r.expense)),backgroundColor:'rgba(240,82,82,.65)',borderColor:'#F05252',borderWidth:1.5,borderRadius:6,borderSkipped:false},
      {label:'Профит',data:rows.map(r=>Math.round(r.received)-Math.round(r.expense)),type:'line',borderColor:'#1A2B3C',borderWidth:2.5,pointBackgroundColor:'#1A2B3C',pointRadius:3,tension:.35,fill:false},
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',labels:{font:{family:'Nunito',weight:'700',size:12},usePointStyle:true,padding:16}},
        tooltip:{backgroundColor:'#1A2B3C',titleFont:{family:'Nunito',weight:'700'},bodyFont:{family:'Nunito'},padding:12,callbacks:{label:c=>` ${c.dataset.label}: $${c.parsed.y.toLocaleString('ru-RU')}`}}},
      scales:{x:{grid:{color:'#DFF0EF'},ticks:{font:{family:'Nunito',weight:'700',size:11}}},y:{grid:{color:'#DFF0EF'},ticks:{font:{family:'Nunito',size:11},callback:v=>'$'+v.toLocaleString('ru-RU')}}}}
  });
  const T={invoiced:0,received:0,expense:0};
  $('monthly-tbody').innerHTML=rows.map(r=>{
    T.invoiced+=r.invoiced;T.received+=r.received;T.expense+=r.expense;
    const any=r.received||r.expense;
    const tags=r.allProjects.map(id=>{const p=proj(id);if(!p)return '';const off=excludedProjects.has(id);
      return `<span class="proj-tag${off?' off':''}" onclick="toggleMonthlyProject('${id}')" title="${off?'Включить':'Отключить'}: ${escH(p.site)}"><span class="pt-dot"></span>${escH(p.site)}</span>`;}).join('');
    const split=r.expense?`<div class="sub-r">разр. $${fmt(r.build.expense)} · подд. $${fmt(r.support.expense)}</div>`:'';
    return `<tr>
      <td style="font-weight:800" class="nw">${r.month}</td>
      <td class="r"><input class="rate-in${r.ownRate?'':' rate-def'}" value="${r.ownRate?r.eurRate:''}" placeholder="${D.settings.eurRate}" title="${r.ownRate?'Курс месяца':'Курс не задан — берётся общий'}" onchange="setMonthRate('${r.month}',this.value)"></td>
      <td class="r">${money(r.invoiced)}</td>
      <td class="r">${money(r.received)}</td>
      <td class="r">${money(r.expense)}${split}</td>
      <td class="r ${any?(r.profit>=0?'pos':'neg'):''}">${any?'$'+fmt(r.profit):dash}${r.invoiced!==r.received&&r.invoiced?`<div class="sub-r">ожид. $${fmt(r.expectedProfit)}</div>`:''}</td>
      <td class="r">${r.received>0?Math.round(r.margin*10)/10+'%':dash}</td>
      <td>${tags}</td>
    </tr>`;
  }).join('')+`<tr class="total-row"><td>ИТОГО</td><td></td>
    <td class="r">$${fmt(T.invoiced)}</td><td class="r">$${fmt(T.received)}</td><td class="r">$${fmt(T.expense)}</td>
    <td class="r ${T.received-T.expense>=0?'pos':'neg'}">$${fmt(T.received-T.expense)}</td>
    <td class="r">${T.received>0?Math.round((T.received-T.expense)/T.received*1000)/10+'%':''}</td><td></td></tr>`;
  const noRate=D.months.filter(m=>!(n(m.eurRate)>0)).map(m=>m.month);
  const note=$('no-deliv-note');
  note.style.display=noRate.length?'block':'none';
  note.innerHTML=noRate.length?`⚠ Нет своего курса: ${noRate.join(', ')} — для расходов берётся общий ${D.settings.eurRate}. Впиши курс в колонку «Курс $/€».`:'';
}
function toggleMonthlyProject(id){excludedProjects.has(id)?excludedProjects.delete(id):excludedProjects.add(id);renderMonthly();}
function resetMonthlyFilter(){excludedProjects.clear();renderMonthly();}

// ─── CLIENTS ──────────────────────────────────────────────────
function renderClients(){
  const fromSel=$('cs-from'),toSel=$('cs-to');
  const fv=fromSel.value,tv=toSel.value;
  fromSel.innerHTML=monthOptions(fv,'с начала');toSel.innerHTML=monthOptions(tv,'по сегодня');
  const from=fromSel.value||undefined,to=toSel.value||undefined;
  const s=C.clientSummary(D,{from,to});
  const row=r=>`<tr class="${r.clientId!==undefined?'click-row':''}" ${r.clientId?`onclick="setC('${r.clientId}')"`:''}>
    <td style="font-weight:800">${escH(r.client)}</td>
    <td class="r">${r.projects}</td>
    <td class="r">${fh(r.hours)}<div class="sub-r">разр. ${fh(r.build.hours)} · подд. ${fh(r.support.hours)}</div></td>
    <td class="r">$${fmt(r.expense)}<div class="sub-r">разр. $${fmt(r.build.expense)} · подд. $${fmt(r.support.expense)}</div></td>
    <td class="r">${money(r.invoiced)}</td>
    <td class="r">${money(r.received)}</td>
    <td class="r ${r.debt>0?'debt':''}">${r.debt>0?'$'+fmt(r.debt):dash}</td>
    <td class="r ${r.profit>=0?'pos':'neg'}">$${fmt(r.profit)}</td>
    <td class="r">${r.received>0?r.margin+'%':dash}</td>
  </tr>`;
  const table=(title,sub,rows,total)=>`<div class="panel"><div class="ph"><span class="ph-title">${title}</span><span class="muted" style="font-size:11px;font-weight:700">${sub}</span></div>
    <div class="tw"><table><thead><tr><th>Заказчик</th><th class="r">Проектов</th><th class="r">Часы</th><th class="r">Расход</th><th class="r">Выставлено</th><th class="r">Получено</th><th class="r">Долг</th><th class="r">Профит</th><th class="r">Маржа</th></tr></thead>
    <tbody>${rows.length?rows.map(row).join('')+`<tr class="total-row">${row(total).replace(/^<tr[^>]*>/,'').replace(/<\/tr>$/,'')}</tr>`:'<tr><td colspan="9" class="empty-row">Нет данных за период</td></tr>'}</tbody></table></div></div>`;
  $('clients-body').innerHTML=
    (from||to?`<div class="info-note">Период ${from||'…'} — ${to||'…'}: часы и расход — по месяцу работы, выставлено — по дате счёта, получено — по месяцу поступления. Допрасходы без даты в периоде не учитываются; долг — на сегодня.</div>`:'')+
    table('Свои проекты','строили сами — фикс-прайс + поддержка',s.own,s.totalOwn)+
    (s.inherited.length?table('Чужие проекты на поддержке','без стартового дохода — маржу не сравнивать со своими',s.inherited,s.totalInherited):'');
}

// ─── RECEIVABLES ──────────────────────────────────────────────
function renderReceivables(){
  const list=C.receivables(D);
  const total=list.reduce((s,r)=>s+r.outstanding,0);
  const by={};for(const r of list) by[r.client||'—']=(by[r.client||'—']||0)+r.outstanding;
  $('recv-body').innerHTML=`
    <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
      <div class="sc c4"><div class="sc-ico">💸</div><div class="sc-lbl">Всего должны</div><div class="sc-val v-yel">$${fmt(total)}</div><div class="sc-sub">${list.length} счетов</div></div>
      ${Object.entries(by).sort((a,b)=>b[1]-a[1]).map(([c,v])=>`<div class="sc"><div class="sc-lbl">${escH(c)}</div><div class="sc-val" style="font-size:22px">$${fmt(v)}</div></div>`).join('')}
    </div>
    <div class="panel"><div class="ph"><span class="ph-title">Неоплаченные счета</span><span class="muted" style="font-size:11px;font-weight:700">старые — сверху</span></div>
    <div class="tw"><table><thead><tr><th>Заказчик</th><th>Проект</th><th>За что</th><th>Выставлен</th><th class="r">Возраст</th><th class="r">Сумма</th><th class="r">Оплачено</th><th class="r">Остаток</th></tr></thead><tbody>
    ${list.length?list.map(r=>`<tr class="click-row" onclick="openProject('${r.projectId}')">
      <td style="font-weight:800">${escH(r.client)}</td><td>${escH(r.site)}</td><td class="note-cell">${escH(r.description)||dash}</td>
      <td class="nw">${r.issuedAt}</td><td class="r nw ${r.ageDays>C.OVERDUE_DAYS?'warn-txt':''}">${r.ageDays} дн.</td>
      <td class="r nw">${r.currency==='EUR'?'€'+fmt2(r.amount):'$'+fmt2(r.amount)}</td><td class="r">${r.paid?'$'+fmt2(r.paid):dash}</td>
      <td class="r debt">$${fmt2(r.outstanding)}</td></tr>`).join(''):'<tr><td colspan="8" class="empty-row">Никто не должен 🎉</td></tr>'}
    </tbody></table></div></div>`;
}

// ─── DATA ISSUES ──────────────────────────────────────────────
function renderIssues(){
  const all=C.dataIssues(D);
  const groups={};for(const i of all)(groups[i.type]||(groups[i.type]=[])).push(i);
  const order=Object.keys(ISSUE_TITLES).filter(k=>groups[k]);
  $('issues-body').innerHTML=all.length?order.map(k=>`<div class="panel issue-grp">
    <div class="ph"><span class="ph-title">${ISSUE_TITLES[k]}</span><span class="tab-cnt">${groups[k].length}</span></div>
    <div class="issue-list">${groups[k].map(i=>{
      const go=i.projectId?`openProject('${i.projectId}')`:i.month?`switchTab('monthly')`:'';
      const extra=i.amount!==undefined?` <b class="${i.amount<0?'neg':'pos'}">$${fmt(i.amount)}</b>`:i.hours!==undefined?` <span class="muted">${fh(i.hours)} ч</span>`:'';
      return `<div class="issue${go?' click-row':''}" ${go?`onclick="${go}"`:''}>${escH(i.title)}${extra}</div>`;
    }).join('')}</div></div>`).join(''):'<div class="panel"><div class="empty-row" style="padding:40px;text-align:center">Проблем не найдено ✅</div></div>';
}

// ─── EXPORT / IMPORT ──────────────────────────────────────────
function exportData(){
  const blob=new Blob([JSON.stringify({...D,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`webdev-v2-${C.todayISO()}.json`;a.click();URL.revokeObjectURL(a.href);
  toast('Данные экспортированы');
}
function triggerImport(){$('imp-input').click()}
function importData(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async ev=>{
    try{
      const data=JSON.parse(ev.target.result);
      if((data.schemaVersion||0)<C.SCHEMA_VERSION){toast('Это экспорт старого формата — его нужно прогнать через миграцию');return;}
      if(!confirm(`Заменить все данные содержимым файла (${(data.projects||[]).length} проектов)?`)) return;
      delete data.exportedAt;
      D=C.normalize(data);readOnly=false;
      await persist();closeD();render();toast(`Импортировано ${D.projects.length} проектов`);
    }catch(err){toast('Ошибка: '+err.message);}
  };
  reader.readAsText(file);e.target.value='';
}

// ─── DRAWER / TOAST ───────────────────────────────────────────
function openDrawer(){$('sb').classList.add('drawer-open');$('drawer-ov').classList.add('open');document.body.style.overflow='hidden';}
function closeDrawer(){$('sb').classList.remove('drawer-open');$('drawer-ov').classList.remove('open');document.body.style.overflow='';}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),2800);}

// ─── EVENTS ───────────────────────────────────────────────────
$('rate').addEventListener('input',()=>onSettingInput('rate','rate'));
$('costrate').addEventListener('input',()=>onSettingInput('costrate','costRate'));
$('eurrate').addEventListener('input',()=>onSettingInput('eurrate','eurRate'));
$('expdelay').addEventListener('input',()=>onSettingInput('expdelay','expDelay',true));
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if($('cov').classList.contains('open')) closeC();
    else if($('ov').classList.contains('open')) closeM();
    else if($('sb').classList.contains('drawer-open')) closeDrawer();
    else if(editEntryId){editEntryId=null;renderDet();}
    else if(aid) closeD();
  }
});

checkAuth();
