// Hexa Dashboard — интерфейс (схема данных v2, дизайн «hexabyte»).
// Все расчёты — в core.js (HexaCore), общем с MCP-сервером: здесь только отрисовка и формы.
// Никаких зашитых значений: месяцы, курсы, заказчики, типы, суммы — всё из документа Firestore.
const C = window.HexaCore;
const { n, r2 } = C;

// ─── AUTH ─────────────────────────────────────────────────────
// Сменить пароль: в консоли
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('НовыйПароль'))
//     .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
// и вставить результат в AUTH_HASH.
const AUTH_HASH = '32e0c7d67ef0e643a0d0b7487b98f8c734c1ad58960063d4bef2c8dd20d35614';
const AUTH_SK = 'wbd_auth';
async function sha256(str){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function checkAuth(){
  if(sessionStorage.getItem(AUTH_SK)==='1'){$('auth-wall').classList.add('hidden');showLoading(true);initFirestore();}
  else setTimeout(()=>$('auth-input').focus(),50);
}
async function authSubmit(){
  if(await sha256($('auth-input').value)===AUTH_HASH){
    sessionStorage.setItem(AUTH_SK,'1');$('auth-wall').classList.add('hidden');showLoading(true);initFirestore();
  }else{
    $('auth-err').textContent='Неверный пароль';$('auth-input').value='';$('auth-input').focus();
    setTimeout(()=>{$('auth-err').textContent='';},2500);
  }
}

// ─── FIREBASE ─────────────────────────────────────────────────
firebase.initializeApp({
  apiKey:"AIzaSyAy2dKkjq0mukLj_JO8Iqz5ebnca7ZMIQw",
  authDomain:"hexa-web-dev.firebaseapp.com",
  projectId:"hexa-web-dev",
  storageBucket:"hexa-web-dev.firebasestorage.app",
  messagingSenderId:"617618063520",
  appId:"1:617618063520:web:0b86398afa0756edbd09c5"
});
const DOC=firebase.firestore().collection('webdev').doc('dashboard');

// ─── STATE ────────────────────────────────────────────────────
let D=null, readOnly=true, _saving=false;
let aid=null;                 // раскрытый проект
let view='list', showAll=false, fDebt=false;
let currentTab='projects';
const excludedProjects=new Set();
const PAGE=12;
let M=null;                   // состояние открытого модального окна

// ─── ОФОРМЛЕНИЕ (не данные) ───────────────────────────────────
const STATUS_DOT={'Сдан':'#22A06B','В работе':'#F59E0B','Холд':'#F05252','На проверке':'#3B82F6','На обслуживании':'#94A3B8','Обсуждение':'#CBD5E1'};
const PAY={
  not_invoiced:{label:'Без счёта',   name:'без счёта',        fg:'#5B6472'},
  awaiting:    {label:'Ждём оплату', name:'ждём оплату',      fg:'#854D0E'},
  partial:     {label:'Частично',    name:'оплачен частично', fg:'#854D0E'},
  paid:        {label:'Оплачен',     name:'оплачен',          fg:'#5B6472'},
};
const INV_ST={draft:'Черновик',sent:'Ждём оплату',paid:'Оплачен',cancelled:'Отменён'};
const TILES=[['#F6E3A6','#5A4500'],['#CFE6E1','#1F4A43'],['#F4D2C4','#6B2E17'],['#D3E0F2','#1F3F6B'],['#E2D8F0','#43306B']];
const DONUT=['#16202D','#FBCB08','#9F5CF7','#4CBBE4','#22A06B','#F4D2C4'];
const SERIES={rec:'#FBCB08',inv:'#4CBBE4',exp:'#16202D',prof:'#9F5CF7'};
const ISSUE_TITLES={
  hours_no_invoices:'Часы есть, счетов нет',
  invoice_overdue:'Счёт ждёт оплаты дольше 30 дней',
  payment_unlinked:'Поступление без привязки к счёту',
  payment_no_month:'Поступление без месяца',
  hours_no_note:'Запись часов без описания',
  month_no_rate:'Месяц без своего курса',
  delivered_no_month:'«Сдан», но нет месяца сдачи',
  support_not_invoiced:'Часы поддержки, не покрытые счётом',
  build_after_delivery:'Часы «разработки» после сдачи',
  origin_unknown:'Не указано: свой проект или чужой',
  needs_full_invoice:'Нужен счёт на полную сумму',
};
const TABS=[
  ['projects','Проекты','M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  ['monthly','По месяцам','M5.5 5h13A2.5 2.5 0 0 1 21 7.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-11A2.5 2.5 0 0 1 5.5 5ZM3 10h18M8 3v4M16 3v4'],
  ['clients','Заказчики','M12.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.7.8 2.7 2.6 3 5.2'],
  ['receivables','Дебиторка','M5.5 6h13A2.5 2.5 0 0 1 21 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-8A2.5 2.5 0 0 1 5.5 6ZM3 10h18M16 15h2'],
  ['issues','Проверка','M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM20 20l-3.6-3.6M8.5 11l2 2 3.5-4'],
];
const TAB_TITLE={projects:'Проекты',monthly:'По месяцам',clients:'Заказчики',receivables:'Дебиторка',issues:'Проверка данных'};

// ─── HELPERS ──────────────────────────────────────────────────
const $=id=>document.getElementById(id);
const fmt=v=>Math.round(v).toLocaleString('ru-RU');
const usd=v=>(v<0?'−$':'$')+fmt(Math.abs(v));
const usd2=v=>(v<0?'−$':'$')+Math.abs(v).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2});
const num=v=>(+v).toLocaleString('ru-RU',{maximumFractionDigits:2});
const hrs=v=>(+v).toLocaleString('ru-RU',{maximumFractionDigits:2});
const pct=(a,b)=>b>0?(Math.round(a/b*1000)/10).toLocaleString('ru-RU')+'%':'—';
const dash='—';
function esc(s){return String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")}
function escH(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
const proj=id=>D.projects.find(p=>p.id===id);
const clientName=p=>C.refName(D.clients,p.clientId);
const typeName=p=>C.refName(D.types,p.typeId);
const months=()=>D.months.map(m=>m.month);
const lastMonth=()=>D.months.length?D.months[D.months.length-1].month:'';
// текущий месяц, если он есть на шкале, иначе последний
const defaultMonth=()=>{const m=C.dateToMonth(C.todayISO());return D.months.some(x=>x.month===m)?m:lastMonth();};
const stats=(p,opt)=>C.projectStats(D,p,opt);
const RU_GEN=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function dateRu(iso){const d=new Date(iso);return isNaN(d)?'':`${d.getDate()} ${RU_GEN[d.getMonth()]} ${d.getFullYear()}`}
function dmy(iso){const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(iso||'');return m?`${m[3]}.${m[2]}.${m[1]}`:(iso||dash)}
function tileOf(p){const i=Math.max(0,D.types.findIndex(t=>t.id===p.typeId));return TILES[i%TILES.length]}
function monthOptions(sel,empty){
  return (empty!==undefined?`<option value="">${empty}</option>`:'')+months().map(m=>`<option value="${m}"${m===sel?' selected':''}>${m}</option>`).join('');
}
function invoicePaid(inv){return D.payments.filter(x=>x.invoiceId===inv.id).reduce((s,x)=>s+n(x.amount),0)}
function svgIcon(d,size=20){return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`}
const CHEV='<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const XICON='<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

// Калькулятор сумм ("2101+2101") без eval
function evalAmount(raw){
  if(raw===null||raw===undefined) return null;
  const s=String(raw).replace(/,/g,'.').replace(/\s+/g,'');
  if(!s||!/^[\d+\-*/().]+$/.test(s)) return null;
  let i=0;
  const numt=()=>{const m=/^\d+(\.\d+)?|^\.\d+/.exec(s.slice(i));if(!m)throw 0;i+=m[0].length;return parseFloat(m[0]);};
  const fac=()=>{if(s[i]==='-'){i++;return -fac();}if(s[i]==='('){i++;const v=ex();if(s[i++]!==')')throw 0;return v;}return numt();};
  const term=()=>{let v=fac();while(s[i]==='*'||s[i]==='/'){const o=s[i++];const r=fac();v=o==='*'?v*r:v/r;}return v;};
  const ex=()=>{let v=term();while(s[i]==='+'||s[i]==='-'){const o=s[i++];const r=term();v=o==='+'?v+r:v-r;}return v;};
  try{const v=ex();return i===s.length&&isFinite(v)?r2(v):null;}catch(e){return null;}
}

// ─── FIRESTORE ────────────────────────────────────────────────
async function persist(){
  if(readOnly||!D){toast('Только чтение — изменения не сохранены');return;}
  try{
    _saving=true;showSync(true);
    D.updatedAt=new Date().toISOString();
    await DOC.set(JSON.parse(JSON.stringify(D)));
  }catch(e){toast('Ошибка сохранения: '+e.message);console.error(e);}
  finally{showSync(false);_saving=false;}
}
function initFirestore(){
  DOC.onSnapshot(snap=>{
    showLoading(false);
    if(_saving) return;
    if(!snap.exists){blocker('Документ webdev/dashboard не найден. Восстанови данные через «Импорт».');readOnly=false;D=C.normalize({schemaVersion:C.SCHEMA_VERSION});render();return;}
    const data=snap.data();
    if((data.schemaVersion||0)<C.SCHEMA_VERSION){readOnly=true;blocker('Данные в старом формате — изменения не сохраняются. Нужна миграция: mcp/scripts/migrate.mjs.');return;}
    blocker(null);readOnly=false;
    D=C.normalize(data);
    syncSettingsInputs();render();
  },err=>{showLoading(false);toast('Ошибка подключения: '+err.message);console.error(err);});
}
function blocker(msg){$('blocker-slot').innerHTML=msg?`<div class="blocker">${escH(msg)}</div>`:''}
function showLoading(v){$('loading').style.display=v?'flex':'none'}
function showSync(v){$('sync-dot').classList.toggle('show',v)}

// ─── НАСТРОЙКИ ────────────────────────────────────────────────
const SETTINGS=[['rate','rate'],['costrate','costRate'],['eurrate','eurRate'],['expdelay','expDelay']];
function syncSettingsInputs(){for(const [id,k] of SETTINGS) if(document.activeElement!==$(id)) $(id).value=D.settings[k];}
let _setT=null;
function onSettingInput(id,k,int){
  const v=int?parseInt($(id).value,10):parseFloat($(id).value);
  if(!(v>=0)) return;
  D.settings[k]=v;renderCurrent();
  clearTimeout(_setT);_setT=setTimeout(persist,600);
}

// ─── РЕНДЕР: общий ────────────────────────────────────────────
function render(){
  if(!D) return;
  renderNav();renderHeader();renderCurrent();
}
function renderCurrent(){
  if(!D) return;
  renderNav();
  if(currentTab==='projects') renderProjects();
  else if(currentTab==='monthly') renderMonthly();
  else if(currentTab==='clients') renderClients();
  else if(currentTab==='receivables') renderReceivables();
  else if(currentTab==='issues') renderIssues();
}
function renderHeader(){
  $('eyebrow').textContent='Дашборд'+(D&&D.updatedAt?' · обновлено '+dateRu(D.updatedAt):'');
  $('page-title').textContent=TAB_TITLE[currentTab];
  $('mob-title').textContent=TAB_TITLE[currentTab];
  $('proj-tools').style.display=currentTab==='projects'?'':'none';
  $('v-grid').classList.toggle('on',view==='grid');$('v-list').classList.toggle('on',view==='list');
}
function renderNav(){
  const rc=D?C.receivables(D).length:0, iss=D?C.dataIssues(D).length:0;
  const badge={receivables:rc||'',issues:iss||''};
  $('nav').innerHTML=TABS.map(([k,l,d])=>`<button class="nav-btn${currentTab===k?' on':''}" onclick="switchTab('${k}')"${currentTab===k?' aria-current="page"':''}>${svgIcon(d)}<span class="lbl">${l}</span><span class="badge">${badge[k]||''}</span></button>`).join('');
}
function switchTab(tab){
  currentTab=tab;
  for(const [k] of TABS) $('view-'+k).classList.toggle('on',k===tab);
  renderHeader();renderCurrent();closeDrawer();
  window.scrollTo(0,0);
}

// ─── ПРОЕКТЫ ──────────────────────────────────────────────────
function filtered(){
  const q=$('search').value.trim().toLowerCase();
  const cl=$('f-client').value, ty=$('f-type').value, st=$('f-status').value, pay=$('f-pay').value;
  const mn=$('fmin').value===''?-Infinity:n($('fmin').value);
  const mx=$('fmax').value===''?Infinity:n($('fmax').value);
  return D.projects.filter(p=>{
    if(cl&&p.clientId!==cl) return false;
    if(ty&&p.typeId!==ty) return false;
    if(st&&(p.status||'')!==st) return false;
    const s=stats(p);
    if(pay&&s.paymentStatus!==pay) return false;
    if(fDebt&&!(s.debt>0)) return false;
    if(s.received<mn||s.received>mx) return false;
    if(q&&!(p.site+' '+clientName(p)+' '+typeName(p)+' '+(p.note||'')).toLowerCase().includes(q)) return false;
    return true;
  });
}
function onFilter(){showAll=false;renderProjects();}
function toggleDebt(){fDebt=!fDebt;onFilter();}
function setView(v){view=v;renderHeader();renderProjects();}
function reset(){
  for(const id of ['search','fmin','fmax']) $(id).value='';
  for(const id of ['f-client','f-type','f-status','f-pay']) $(id).value='';
  fDebt=false;showAll=false;aid=null;renderProjects();
}
function setClientFilter(id){
  if(currentTab!=='projects') switchTab('projects');
  reset();$('f-client').value=id;renderProjects();
}

function fillSelect(id,options){
  const el=$(id),cur=el.value;
  el.innerHTML=options.map(([v,l])=>`<option value="${escH(v)}">${escH(l)}</option>`).join('');
  el.value=options.some(o=>o[0]===cur)?cur:'';
}
function renderFilters(){
  const cnt=(key)=>{const m={};for(const p of D.projects){const k=key(p);m[k]=(m[k]||0)+1;}return m;};
  const byC=cnt(p=>p.clientId), byT=cnt(p=>p.typeId), byS=cnt(p=>p.status||''), byP=cnt(p=>stats(p).paymentStatus);
  fillSelect('f-client',[['','Все заказчики'],...D.clients.filter(c=>byC[c.id]).sort((a,b)=>byC[b.id]-byC[a.id]||a.name.localeCompare(b.name)).map(c=>[c.id,`${c.name} · ${byC[c.id]}`])]);
  fillSelect('f-type',[['','Все типы'],...D.types.filter(t=>byT[t.id]).sort((a,b)=>a.name.localeCompare(b.name)).map(t=>[t.id,`${t.name} · ${byT[t.id]}`])]);
  fillSelect('f-status',[['','Все статусы'],...C.STATUSES.map(s=>[s,`${s} · ${byS[s]||0}`])]);
  fillSelect('f-pay',[['','Любая оплата'],...C.PAY_STATUSES.map(s=>[s,`${PAY[s].label} · ${byP[s]||0}`])]);
  $('f-debt').classList.toggle('on',fDebt);$('f-debt').setAttribute('aria-pressed',fDebt);
}

function renderProjects(){
  renderFilters();
  const list=filtered();
  renderKpis(list);
  const rows=C.monthlyStats(D);
  $('legend-p').innerHTML=legendHTML();
  $('chart-projects').innerHTML=chartHTML(rows);scrollChartsToEnd();
  $('donut-projects').innerHTML=donutHTML(D.projects,false);
  $('ptitle').textContent=`${list.length===D.projects.length?'Все проекты':'Проекты'} · ${list.length}`;
  renderList(list);
}
function renderKpis(list){
  let inv=0,rec=0,debt=0,exp=0,h=0,hs=0,pr=0,epr=0,debtors=0;
  for(const p of list){const s=stats(p);inv+=s.invoiced;rec+=s.received;debt+=s.debt;exp+=s.expense;h+=s.hours;hs+=s.byPhase.support.hours;pr+=s.profit;epr+=s.expectedProfit;if(s.debt>0)debtors++;}
  $('cards').innerHTML=`
    <div class="kpi kpi-accent"><span class="k-l">Получено</span><span class="k-v">${usd(rec)}</span><span class="k-s">выставлено ${usd(inv)} · проектов: ${list.length}</span></div>
    <div class="kpi kpi-ink"><span class="k-l">Профит · маржа ${pct(pr,rec)}</span><span class="k-v">${usd(pr)}</span><span class="k-s">с долгами будет ${usd(epr)}</span></div>
    <div class="kpi kpi-violet"><span class="k-l">Должны</span><span class="k-v">${usd(debt)}</span><span class="k-s">${debtors?`проектов с долгом: ${debtors}`:'долгов нет'}</span></div>
    <div class="kpi kpi-white"><span class="k-l">Расход на часы</span><span class="k-v">${usd(exp)}</span><span class="k-s">${hrs(r2(h))} ч, из них поддержка ${hrs(r2(hs))}</span></div>`;
}

function renderList(list){
  const box=$('plist');
  const ae=document.activeElement;
  const keep=ae&&ae.classList&&ae.classList.contains('pnote')?{id:ae.dataset.id,v:ae.value,s:ae.selectionStart,e:ae.selectionEnd}:null;
  if(!list.length){box.innerHTML='<p class="empty">Ничего не найдено. Измените запрос или сбросьте фильтры.</p>';return;}
  let shown=showAll?list:list.slice(0,PAGE);
  if(aid&&!shown.some(p=>p.id===aid)&&list.some(p=>p.id===aid)){showAll=true;shown=list;}
  const more=!showAll&&list.length>PAGE?`<button class="btn more" onclick="showAll=true;renderProjects()">Показать все проекты: ${list.length}</button>`:'';
  box.innerHTML=(view==='grid'
    ?`<div class="pgrid">${shown.map(gridCard).join('')}</div>`
    :`<div class="plist">${shown.map(listRow).join('')}</div>`)+(more?`<div style="display:flex;justify-content:center;margin-top:20px">${more}</div>`:'');
  if(keep){const t=box.querySelector(`.pnote[data-id="${keep.id}"]`);if(t){t.value=keep.v;t.focus();try{t.setSelectionRange(keep.s,keep.e);}catch(e){}}}
  box.querySelectorAll('.pnote').forEach(autoGrow);
}

function projectTags(p,s){
  const t=[];
  if(p.warn) t.push('<span class="tag tag-warn" title="Неполные данные">⚠ неполные данные</span>');
  if(p.origin==='inherited') t.push('<span class="tag tag-inh">чужой</span>');
  else if(!p.origin) t.push('<span class="tag tag-warn">? свой или чужой</span>');
  if(p.supportIncluded) t.push('<span class="tag tag-sup">поддержка в стоимости</span>');
  if(p.profitShared) t.push(`<span class="tag ${p.profitShared==='Да'?'tag-ok':''}">профит поделен: ${p.profitShared.toLowerCase()}</span>`);
  return t.join('');
}
function subLine(p){
  const parts=[escH(clientName(p))];
  if(p.deliveryMonth) parts.push('сдан '+p.deliveryMonth);
  if(n(p.refPct)>0) parts.push('реферал '+num(p.refPct)+'%');
  return parts.join(' · ');
}
function listRow(p){
  const s=stats(p), [tb,tf]=tileOf(p), open=aid===p.id;
  return `<div class="prow${open?' open':''}" data-id="${p.id}" onclick="tog('${p.id}',event)">
    <span class="tile" style="background:${tb};color:${tf}" aria-hidden="true">${escH(p.site.charAt(0).toUpperCase())}</span>
    <div class="r-name"><span class="r-site">${escH(p.site)}</span><span class="r-sub">${subLine(p)}</span><span class="r-tags">${projectTags(p,s)}</span></div>
    <div class="r-note" onclick="event.stopPropagation()"><textarea class="pnote" data-id="${p.id}" rows="1" placeholder="Заметка…" aria-label="Заметка по ${escH(p.site)}" oninput="noteInput(this)" onblur="saveNote(this)">${escH(p.note)}</textarea></div>
    <span class="r-num"><b>${usd(s.received)}</b><span>${s.invoiced>s.received+0.5?'получено из '+usd(s.invoiced):'получено'}</span></span>
    <span class="r-mid"><span class="cap">${escH(typeName(p)||'без типа')}</span><b>${hrs(s.hours)} ч${s.byPhase.support.hours>0?' · подд. '+hrs(s.byPhase.support.hours):''}</b><span class="st"><i class="dot" style="background:${STATUS_DOT[p.status]||'#CBD5E1'}"></i>${escH(p.status||'без статуса')}</span></span>
    <span class="r-num"><b>${usd(s.expense)}</b><span>расход</span></span>
    <span class="r-num"><b class="${s.debt>0?'debt':''}" style="${s.debt>0?'':'color:var(--muted)'}">${s.debt>0?usd(s.debt):dash}</b><span>долг</span></span>
    <span class="r-prof"><b class="${s.profit>=0?'pos':'neg'}">${usd(s.profit)}</b><span>профит · маржа ${s.received>0?pct(s.profit,s.received):dash}</span><span style="font-weight:700;color:${PAY[s.paymentStatus].fg}">${PAY[s.paymentStatus].name}</span></span>
    <button class="chev" onclick="tog('${p.id}',event)" aria-expanded="${open}" aria-label="${open?'Свернуть':'Подробнее'}">${CHEV}</button>
    ${open?panelHTML(p,s):''}
  </div>`;
}
function gridCard(p){
  const s=stats(p), [tb,tf]=tileOf(p), mw=s.received>0?Math.max(0,Math.min(100,s.margin)):0;
  return `<article class="gcard${s.debt>0?' has-debt':''}" onclick="openProject('${p.id}','list')">
    <div class="g-top"><span class="tile" style="background:${tb};color:${tf}" aria-hidden="true">${escH(p.site.charAt(0).toUpperCase())}</span>
      <div style="min-width:0;display:flex;flex-direction:column;gap:1px"><span class="g-meta">${escH(clientName(p))}${typeName(p)?' · '+escH(typeName(p)):''}</span><span class="g-site">${escH(p.site)}</span></div></div>
    <div class="g-line"><span class="st"><i class="dot" style="background:${STATUS_DOT[p.status]||'#CBD5E1'};width:10px;height:10px"></i>${escH(p.status||'без статуса')}</span>
      <span style="color:${s.debt>0?'var(--amber)':PAY[s.paymentStatus].fg}">${s.debt>0?'долг '+usd(s.debt):PAY[s.paymentStatus].name}</span>${p.deliveryMonth?`<span class="muted" style="font-weight:600">сдан ${p.deliveryMonth}</span>`:''}</div>
    ${p.note?`<div class="g-note">${escH(p.note)}</div>`:''}
    <div class="g-box">
      <div class="g-nums"><span><small>Получено</small><b>${usd(s.received)}</b></span><span><small>Часов</small><b>${hrs(s.hours)}</b></span><span style="text-align:right"><small>Профит</small><b class="${s.profit>=0?'pos':'neg'}">${usd(s.profit)}</b></span></div>
      <div class="mbar"><span><i style="width:${mw}%"></i></span><small>маржа ${s.received>0?pct(s.profit,s.received):dash}</small></div>
    </div>
  </article>`;
}

// ── раскрытый проект ──
function panelHTML(p,s){
  const entries=D.hours.filter(h=>h.projectId===p.id).sort((a,b)=>C.cmpMonth(b.month,a.month)||String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  const invs=D.invoices.filter(i=>i.projectId===p.id).sort((a,b)=>String(b.issuedAt).localeCompare(String(a.issuedAt)));
  const pays=D.payments.filter(x=>x.projectId===p.id).sort((a,b)=>C.cmpMonth(b.month,a.month)||String(b.receivedAt).localeCompare(String(a.receivedAt)));
  const warr=p.deliveryMonth&&p.status==='Сдан'&&C.isMonth(p.deliveryMonth)?`гарантия ${p.deliveryMonth} → ${C.shiftMonth(p.deliveryMonth,2)}`:'';
  const tags=[
    p.origin==='inherited'?'<span class="tag tag-inh">чужой проект на поддержке</span>':p.origin==='own'?'<span class="tag">свой проект</span>':'<span class="tag tag-warn">происхождение не указано</span>',
    p.deliveryMonth?`<span class="tag">сдан ${p.deliveryMonth}${warr?' · '+warr:''}</span>`:'',
    p.supportIncluded?'<span class="tag tag-sup">поддержка входит в стоимость</span>':'',
    p.profitShared?`<span class="tag ${p.profitShared==='Да'?'tag-ok':''}">профит поделен: ${p.profitShared.toLowerCase()}</span>`:'',
    p.warn?'<span class="tag tag-warn">⚠ неполные данные</span>':'',
  ].join('');
  const hRows=entries.map(h=>{
    const manual=h.phaseManual&&h.phase!==C.autoPhase(p,h.month);
    const note=h.note?escH(h.note):(h.migrated?'<span class="muted">из старых данных</span>':'<span class="warn-txt">нет описания</span>');
    return `<div class="xi"><span class="l"><b>${h.month}</b> ${h.kind==='cost'?'<span class="ph k-cost" title="ставка себестоимости">себест.</span> ':''}<span class="ph ph-${h.phase}" title="${h.phaseManual?'фаза проставлена вручную':'фаза автоматически'}">${h.phase==='support'?'поддержка':'разработка'}${manual?' ✋':''}</span><br>${note}</span>
      <span class="v">${hrs(h.hours)} ч × €${num(h.rate)}<small>${usd2(r2(C.entryCostUSD(D,h)))}</small></span>
      <span class="acts"><button class="ib" title="Изменить" onclick="openHours('${p.id}','${h.id}')">✎</button><button class="ib ib-del" title="Удалить" onclick="delEntry('${h.id}')">✕</button></span></div>`;
  }).join('');
  const iRows=invs.map(i=>{
    const amtUSD=C.invoiceUSD(D,i), paid=invoicePaid(i), left=i.status==='sent'?Math.max(0,amtUSD-paid):0;
    const age=i.status==='sent'?C.daysBetween(i.issuedAt):null;
    return `<div class="xi xi-inv"><span class="l"><b>${dmy(i.issuedAt)}</b>${age!==null?` · <span class="${age>C.OVERDUE_DAYS?'warn-txt':''}">${age} дн.</span>`:''}<br>${escH(i.description)||dash}</span>
      <span class="v">${i.currency==='EUR'?'€'+num(i.amount):usd2(i.amount)}<small>${i.currency==='EUR'?'≈ '+usd(amtUSD)+' · ':''}${left>0?'остаток '+usd2(r2(left)):paid?'оплачено '+usd2(r2(paid)):''}</small></span>
      <span class="acts"><select class="inv-st inv-${i.status}" aria-label="Статус счёта" onchange="setInvoiceStatus('${i.id}',this.value)">${C.INVOICE_STATUSES.map(st=>`<option value="${st}"${st===i.status?' selected':''}>${INV_ST[st]}</option>`).join('')}</select><button class="ib ib-del" title="Удалить счёт" onclick="delInvoice('${i.id}')">✕</button></span></div>`;
  }).join('');
  const yRows=pays.map(x=>{
    const inv=invs.find(i=>i.id===x.invoiceId);
    return `<div class="xi"><span class="l"><b>${x.month||'<span class="warn-txt">нет месяца</span>'}</b>${x.receivedAt?' · '+dmy(x.receivedAt):''}<br>${escH(x.note)}${inv?`${x.note?' · ':''}по счёту ${dmy(inv.issuedAt)}`:' <span class="warn-txt">без счёта</span>'}</span>
      <span class="v">${usd2(x.amount)}</span>
      <span class="acts"><button class="ib ib-del" title="Удалить поступление" onclick="delPayment('${x.id}')">✕</button></span></div>`;
  }).join('');
  return `<div class="xpanel" onclick="event.stopPropagation()">
    <div class="xkpis">
      <div class="xkpi"><small>Получено</small><b>${usd(s.received)}</b><span>выставлено ${usd(s.invoiced)}${s.dop>0?' · правки '+usd(s.dop):''}</span></div>
      <div class="xkpi"><small>Долг</small><b class="${s.debt>0?'debt':''}">${usd(s.debt)}</b><span>${PAY[s.paymentStatus].label}</span></div>
      <div class="xkpi"><small>Часы · расход</small><b>${hrs(s.hours)} ч · ${usd(s.expense)}</b><span>€${fmt(s.expenseEUR)} · разраб. ${hrs(s.byPhase.build.hours)} ч / ${usd(s.byPhase.build.expense)} · подд. ${hrs(s.byPhase.support.hours)} ч / ${usd(s.byPhase.support.expense)}</span></div>
      <div class="xkpi"><small>Профит · маржа</small><b class="${s.profit>=0?'pos':'neg'}">${usd(s.profit)} · ${s.received>0?pct(s.profit,s.received):dash}</b><span>ожидаемый ${usd(s.expectedProfit)}${s.referral>0?` · реферал ${num(p.refPct)}% = ${usd(s.referral)}`:''}</span></div>
    </div>
    <div class="xtags">${tags}</div>
    <div class="xcols">
      <div class="xcol"><h3>Часы <small>${entries.length} зап.</small></h3>${hRows||'<span class="xempty">Часов пока нет</span>'}</div>
      <div class="xcol"><h3>Счета <small>${invs.length}</small></h3>${iRows||'<span class="xempty">Счетов нет</span>'}</div>
      <div class="xcol"><h3>Поступления <small>${pays.length}</small></h3>${yRows||'<span class="xempty">Поступлений нет</span>'}</div>
    </div>
    <div class="xactions">
      <button class="btn btn-ink" onclick="openHours('${p.id}')">Внести часы</button>
      <button class="btn" onclick="openInvoice('${p.id}')">Выставить счёт</button>
      <button class="btn" onclick="openPayment('${p.id}')">Добавить поступление</button>
      <button class="btn" onclick="openEdit('${p.id}')">Изменить</button>
      <button class="btn btn-danger" onclick="askDel('${p.id}')">Удалить</button>
    </div>
  </div>`;
}

// Раскрытие на месте: строка, по которой кликнули, остаётся на том же месте экрана
function tog(id,ev){
  if(ev){ev.stopPropagation();if(ev.target.closest&&ev.target.closest('.xpanel,.r-note'))return;}
  const row=document.querySelector(`.prow[data-id="${id}"]`);
  const top0=row?row.getBoundingClientRect().top:null;
  aid=aid===id?null:id;
  renderList(filtered());
  const row2=document.querySelector(`.prow[data-id="${id}"]`);
  if(row2&&top0!==null) window.scrollBy(0,row2.getBoundingClientRect().top-top0);
}
function openProject(id,forceView){
  if(currentTab!=='projects') switchTab('projects');
  reset();if(forceView){view=forceView;renderHeader();}
  aid=id;showAll=true;renderProjects();
  setTimeout(()=>{const r=document.querySelector(`.prow[data-id="${id}"]`);if(r)r.scrollIntoView({behavior:'smooth',block:'start'});},30);
}
function rerender(){render();}

// ── заметки ──
function autoGrow(t){t.style.height='auto';t.style.height=Math.min(t.scrollHeight+3,140)+'px';}
const _noteTimers={};
function noteInput(t){autoGrow(t);clearTimeout(_noteTimers[t.dataset.id]);_noteTimers[t.dataset.id]=setTimeout(()=>saveNote(t),1200);}
function saveNote(t){
  clearTimeout(_noteTimers[t.dataset.id]);
  const p=proj(t.dataset.id);if(!p)return;
  const v=t.value.replace(/\s+$/,'');
  if((p.note||'')===v) return;
  p.note=v;persist();
}

// ─── МОДАЛЬНЫЕ ОКНА ───────────────────────────────────────────
function openModal(html,small){
  $('modal').className='modal'+(small?' sm':'');
  $('modal').innerHTML=html;
  $('ov').classList.add('open');
  setTimeout(()=>{const f=$('modal').querySelector('[autofocus],input:not([type=checkbox]),select');if(f)f.focus();},60);
}
function closeM(){$('ov').classList.remove('open');M=null;}
function ovc(e){if(e.target===$('ov'))closeM();}
function mHead(title,sub){return `<div class="m-head"><div style="min-width:0;display:flex;flex-direction:column;gap:2px"><h2>${title}</h2>${sub?`<span class="sub">${sub}</span>`:''}</div><button class="m-x" onclick="closeM()" aria-label="Закрыть">${XICON}</button></div>`;}
function mFoot(label,fn,danger){return `<div class="m-foot"><span class="m-err" id="m-err"></span><button class="btn btn-outline" onclick="closeM()">Отмена</button><button class="btn ${danger?'btn-danger-solid':'btn-accent'}" onclick="${fn}">${label}</button></div>`;}
const mErr=t=>{$('m-err').textContent=t;};
const fld=(label,inner,cls='')=>`<label class="f ${cls}">${label}${inner}</label>`;

function confirmBox(title,text,label,fn){
  M={onOk:fn};
  openModal(mHead(title)+`<p class="m-note" style="background:none;padding:0">${text}</p>`+mFoot(label,'confirmOk()',true),true);
}
function confirmOk(){const f=M&&M.onOk;closeM();if(f)f();}

// ── проект ──
function openAdd(){
  if(readOnly||!D){toast('Только чтение');return;}
  openProjectForm(null);
}
function openEdit(id){openProjectForm(proj(id));}
function openProjectForm(p){
  M={kind:'project',id:p?p.id:null};
  const v=k=>p?escH(p[k]??''):'';
  const cl=document.getElementById('f-client').value;
  openModal(mHead(p?'Изменить проект':'Добавить проект',p?escH(p.site)+' · '+escH(clientName(p)):'')+`
    <div class="fgrid">
      ${fld('Сайт / домен *',`<input id="m-site" placeholder="example.com" value="${v('site')}" autofocus>`)}
      ${fld('Заказчик *',`<input id="m-client" list="m-dl-clients" autocomplete="off" placeholder="${escH(D.clients[0]?.name||'')}" value="${p?escH(clientName(p)):(cl?escH(C.refName(D.clients,cl)):'')}">`)}
      ${fld('Тип проекта',`<input id="m-type" list="m-dl-types" autocomplete="off" value="${p?escH(typeName(p)):''}">`)}
      ${fld('Происхождение',`<select id="m-origin">${[['own','Свой — строили сами'],['inherited','Чужой — взяли на поддержку'],['','— не указано —']].map(([k,l])=>`<option value="${k}"${(p?p.origin||'':'own')===k?' selected':''}>${l}</option>`).join('')}</select>`)}
      ${fld('Доп. расход / правки ($)',`<input id="m-dop" type="number" min="0" placeholder="0" value="${p&&n(p.dop)?p.dop:''}">`)}
      ${fld('Реферальный % партнёру',`<input id="m-ref" type="number" min="0" max="100" step="0.5" placeholder="0" value="${p&&n(p.refPct)?p.refPct:''}">`)}
      <label class="chk" style="flex-basis:100%"><input type="checkbox" id="m-warn"${p&&p.warn?' checked':''}>Пометить как неполные данные</label>
      ${fld('Заметки',`<textarea id="m-note" rows="2" placeholder="Что важно помнить по проекту…">${v('note')}</textarea>`,'w100')}
    </div>
    <h3 class="m-sec">Статус</h3>
    <div class="fgrid">
      ${fld('Статус проекта',`<select id="m-status"><option value="">— не задан —</option>${C.STATUSES.map(s=>`<option${(p?p.status:'Обсуждение')===s?' selected':''}>${s}</option>`).join('')}</select>`)}
      ${fld('Месяц сдачи (граница разработка / поддержка)',`<select id="m-deliv">${monthOptions(p?p.deliveryMonth:'','— не сдан —')}</select>`)}
      ${fld('Профит поделен',`<select id="m-shared">${[['','— не задан —'],['Да','Да'],['Нет','Нет']].map(([k,l])=>`<option value="${k}"${(p?p.profitShared||'':'')===k?' selected':''}>${l}</option>`).join('')}</select>`)}
      <label class="chk" style="align-self:flex-end"><input type="checkbox" id="m-sup"${p&&p.supportIncluded?' checked':''}>Поддержка входит в стоимость</label>
    </div>
    ${p?'':`<h3 class="m-sec">Счёт (необязательно)</h3>
    <div class="fgrid">
      ${fld('Сумма счёта',`<input id="m-invamt" placeholder="0 или 1000+500">`)}
      ${fld('Валюта',`<select id="m-invcur"><option>USD</option><option>EUR</option></select>`)}
    </div>
    <p class="info">Будет выставлен счёт со статусом «ждём оплату» на сегодняшнюю дату. Деньги потом — через «Добавить поступление».</p>`}
    <datalist id="m-dl-clients">${D.clients.map(c=>`<option value="${escH(c.name)}">`).join('')}</datalist>
    <datalist id="m-dl-types">${D.types.map(c=>`<option value="${escH(c.name)}">`).join('')}</datalist>
    ${mFoot('Сохранить','saveProject()')}`);
}
function saveProject(){
  const site=$('m-site').value.trim(), client=$('m-client').value.trim();
  if(!site) return mErr('Укажи домен');
  if(!client) return mErr('Укажи заказчика');
  if(D.projects.some(p=>p.id!==M.id&&p.site.toLowerCase()===site.toLowerCase())) return mErr('Такой проект уже есть');
  let invAmt=null;
  if(!M.id&&$('m-invamt').value.trim()){invAmt=evalAmount($('m-invamt').value);if(!(invAmt>0)) return mErr('Некорректная сумма счёта');}
  let p=M.id?proj(M.id):null;
  if(!p){p={id:C.uid()};D.projects.push(p);}
  const before={d:p.deliveryMonth,o:p.origin,s:p.status};
  Object.assign(p,{
    site, clientId:C.ensureRef(D.clients,client), typeId:C.ensureRef(D.types,$('m-type').value),
    origin:$('m-origin').value, status:$('m-status').value, deliveryMonth:$('m-deliv').value,
    dop:n($('m-dop').value), refPct:n($('m-ref').value), warn:$('m-warn').checked,
    supportIncluded:$('m-sup').checked, profitShared:$('m-shared').value, note:$('m-note').value.replace(/\s+$/,''),
  });
  if(before.d!==p.deliveryMonth||before.o!==p.origin||before.s!==p.status) C.refreshPhases(D,p.id);
  if(invAmt) D.invoices.push({id:'i'+C.uid(),projectId:p.id,amount:invAmt,currency:$('m-invcur').value,issuedAt:C.todayISO(),description:'Разработка',status:'sent'});
  const isNew=!M.id;
  closeM();persist();aid=p.id;
  if(isNew) openProject(p.id,'list'); else render();
}
function askDel(id){
  const p=proj(id);if(!p)return;
  const cnt=k=>D[k].filter(x=>x.projectId===p.id).length;
  confirmBox('Удалить проект?',`«${escH(p.site)}» будет удалён вместе с записями часов (${cnt('hours')}), счетами (${cnt('invoices')}) и поступлениями (${cnt('payments')}). Это нельзя отменить.`,'Удалить',()=>{
    D.projects=D.projects.filter(x=>x.id!==id);
    for(const k of ['hours','invoices','payments']) D[k]=D[k].filter(x=>x.projectId!==id);
    if(aid===id) aid=null;
    persist();render();toast('Проект удалён');
  });
}

// ── часы ──
function openHours(projectId,entryId){
  if(readOnly||!D){toast('Только чтение');return;}
  const e=entryId?D.hours.find(h=>h.id===entryId):null;
  const p=projectId?proj(projectId):null;
  M={kind:'hours',projectId:p?p.id:'',entryId:e?e.id:null};
  const kind=e?e.kind:'dev';
  const projSel=p?'':fld('Проект *',`<select id="m-proj" onchange="M.projectId=this.value;hoursPreview()"><option value="">— выбери проект —</option>${[...D.projects].sort((a,b)=>a.site.localeCompare(b.site)).map(x=>`<option value="${x.id}">${escH(x.site)} · ${escH(clientName(x))}</option>`).join('')}</select>`,'w100');
  openModal(mHead(e?'Изменить запись часов':'Внести часы',p?escH(p.site)+' · '+escH(clientName(p)):'')+`
    <div class="fgrid">
      ${projSel}
      ${fld('Месяц',`<select id="m-month" onchange="hoursPreview()">${monthOptions(e?e.month:defaultMonth())}</select>`,'w180')}
      ${fld('Часы',`<input id="m-hours" inputmode="decimal" placeholder="0" value="${e?e.hours:''}" oninput="hoursPreview()"${p?' autofocus':''}>`,'w120')}
      ${fld('Вид',`<select id="m-kind" onchange="$('m-rate').value=C.defaultRate(D,this.value);hoursPreview()"><option value="dev"${kind==='dev'?' selected':''}>разработка</option><option value="cost"${kind==='cost'?' selected':''}>себестоимость</option></select>`,'w180')}
      ${fld('Ставка, €/ч',`<input id="m-rate" type="number" min="0" step="0.5" value="${e?e.rate:C.defaultRate(D,kind)}" oninput="hoursPreview()">`,'w120')}
      ${fld('Фаза',`<select id="m-phase" onchange="hoursPreview()"><option value="auto"${!e||!e.phaseManual?' selected':''}>авто — по месяцу сдачи</option><option value="build"${e&&e.phaseManual&&e.phase==='build'?' selected':''}>разработка</option><option value="support"${e&&e.phaseManual&&e.phase==='support'?' selected':''}>поддержка</option></select>`,'w180')}
      ${fld('Что делали',`<input id="m-hnote" placeholder="что делали" value="${e?escH(e.note):''}" onkeydown="if(event.key==='Enter')saveHours()">`,'w100')}
    </div>
    <p class="m-note" id="m-preview"></p>
    ${mFoot(e?'Сохранить':'Добавить','saveHours()')}`);
  hoursPreview();
}
function hoursPreview(){
  const h=evalAmount($('m-hours').value)||0, rate=n($('m-rate').value), month=$('m-month').value;
  const p=M.projectId?proj(M.projectId):null;
  const ph=$('m-phase').value==='auto'?(p?C.autoPhase(p,month):null):$('m-phase').value;
  $('m-preview').innerHTML=`Расход по записи: <b>${usd2(r2(h*rate*C.monthRate(D,month)))}</b> <span class="muted">— ${hrs(h)} ч × €${num(rate)} × курс ${num(C.monthRate(D,month))}${ph?` · фаза: ${ph==='support'?'поддержка':'разработка'}`:''}</span>`;
}
function saveHours(){
  const p=proj(M.projectId);
  if(!p) return mErr('Выбери проект');
  const hours=evalAmount($('m-hours').value);
  if(hours===null||hours<0) return mErr('Укажи часы');
  const month=$('m-month').value, kind=$('m-kind').value, rate=n($('m-rate').value)||C.defaultRate(D,kind);
  const ph=$('m-phase').value, note=$('m-hnote').value.trim();
  let e=M.entryId?D.hours.find(h=>h.id===M.entryId):null;
  if(!e){e={id:'h'+C.uid(),projectId:p.id,createdAt:new Date().toISOString()};D.hours.push(e);}
  Object.assign(e,{month,hours:r2(hours),kind,rate,note,phaseManual:ph!=='auto'});
  e.phase=ph==='auto'?C.autoPhase(p,month):ph;
  delete e.migrated;
  if(!(e.hours>0)) D.hours=D.hours.filter(h=>h.id!==e.id);
  closeM();persist();
  if(currentTab==='projects'){aid=p.id;} render();
  toast(note?'Часы записаны':'Записано без описания — попадёт в «Проверку»');
}
function delEntry(id){
  const e=D.hours.find(h=>h.id===id);if(!e)return;
  confirmBox('Удалить запись часов?',`${hrs(e.hours)} ч за ${e.month}${e.note?' — '+escH(e.note):''}`,'Удалить',()=>{
    D.hours=D.hours.filter(h=>h.id!==id);persist();render();
  });
}

// ── счета ──
function openInvoice(projectId){
  const p=proj(projectId);if(!p)return;
  M={kind:'invoice',projectId};
  openModal(mHead('Выставить счёт',escH(p.site)+' · '+escH(clientName(p)))+`
    <div class="fgrid">
      ${fld('Сумма',`<input id="m-iamt" placeholder="0 или 1000+500" autofocus>`,'w180')}
      ${fld('Валюта',`<select id="m-icur"><option>USD</option><option>EUR</option></select>`,'w120')}
      ${fld('Дата счёта',`<input id="m-idate" type="date" value="${C.todayISO()}">`,'w180')}
      ${fld('За что',`<input id="m-idesc" placeholder="разработка, поддержка за месяц…" onkeydown="if(event.key==='Enter')saveInvoice()">`,'w100')}
      ${fld('Статус',`<select id="m-ist"><option value="sent">ждём оплату</option><option value="draft">черновик</option><option value="paid">уже оплачен</option></select>`)}
    </div>
    <p class="info">Счёт в евро пересчитывается в доллары по курсу месяца выставления.</p>
    ${mFoot('Добавить счёт','saveInvoice()')}`);
}
function saveInvoice(){
  const amt=evalAmount($('m-iamt').value);
  if(!(amt>0)) return mErr('Укажи сумму');
  const date=$('m-idate').value||C.todayISO();
  if(!D.months.some(m=>m.month===C.dateToMonth(date))) return mErr(`Месяца ${C.dateToMonth(date)} нет на шкале — добавь его во вкладке «По месяцам»`);
  D.invoices.push({id:'i'+C.uid(),projectId:M.projectId,amount:amt,currency:$('m-icur').value,issuedAt:date,description:$('m-idesc').value.trim(),status:$('m-ist').value});
  aid=M.projectId;closeM();persist();render();toast('Счёт добавлен');
}
function setInvoiceStatus(id,st){
  const inv=D.invoices.find(i=>i.id===id);if(!inv)return;
  const apply=()=>{inv.status=st;delete inv.migrated;persist();render();};
  if(st==='cancelled'&&invoicePaid(inv)>0){render();confirmBox('Отменить счёт?','По этому счёту уже есть поступления. Деньги останутся полученными, но счёт перестанет учитываться в выставленном.','Отменить счёт',apply);return;}
  apply();
}
function delInvoice(id){
  const inv=D.invoices.find(i=>i.id===id);if(!inv)return;
  const linked=D.payments.filter(x=>x.invoiceId===id);
  confirmBox('Удалить счёт?',`Счёт от ${dmy(inv.issuedAt)} на ${inv.currency==='EUR'?'€'+num(inv.amount):usd2(inv.amount)}${linked.length?`. По нему есть поступления (${linked.length}) — они останутся, но без привязки к счёту`:''}.`,'Удалить',()=>{
    for(const x of linked) x.invoiceId='';
    D.invoices=D.invoices.filter(i=>i.id!==id);persist();render();
  });
}

// ── поступления ──
function openPayment(projectId){
  const p=proj(projectId);if(!p)return;
  const invs=D.invoices.filter(i=>i.projectId===p.id&&i.status!=='cancelled');
  const open=invs.filter(i=>i.status==='sent');
  M={kind:'payment',projectId,invoiceId:open.length===1?open[0].id:(open[0]?open[0].id:'')};
  openModal(mHead('Добавить поступление',escH(p.site)+' · '+escH(clientName(p)))+`
    <div class="fgrid">
      ${fld('Сумма, USDT',`<input id="m-pamt" placeholder="0" autofocus>`)}
      ${fld('Дата поступления',`<input id="m-pdate" type="date" value="${C.todayISO()}">`)}
    </div>
    <div class="pick" role="group" aria-label="По какому счёту" id="m-pick"></div>
    ${fld('Заметка',`<input id="m-pnote" placeholder="заметка" onkeydown="if(event.key==='Enter')savePayment()">`,'w100')}
    ${mFoot('Добавить поступление','savePayment()')}`);
  renderPick();
}
function renderPick(){
  const invs=D.invoices.filter(i=>i.projectId===M.projectId&&i.status!=='cancelled').sort((a,b)=>String(b.issuedAt).localeCompare(String(a.issuedAt)));
  const opt=(id,label,state)=>`<button type="button" class="${M.invoiceId===id?'on':''}" aria-pressed="${M.invoiceId===id}" onclick="M.invoiceId='${id}';renderPick()"><span style="min-width:0;overflow-wrap:anywhere">${label}</span><small>${state}</small></button>`;
  $('m-pick').innerHTML='<span style="font-size:13px;font-weight:700;color:var(--muted)">По счёту</span>'+invs.map(i=>{
    const left=Math.max(0,C.invoiceUSD(D,i)-invoicePaid(i));
    return opt(i.id,`${dmy(i.issuedAt)} · ${i.currency==='EUR'?'€'+num(i.amount):usd2(i.amount)}${i.description?' · '+escH(i.description):''}`,i.status==='sent'?'остаток '+usd2(r2(left)):INV_ST[i.status].toLowerCase());
  }).join('')+opt('','Без счёта','');
}
function savePayment(){
  const amt=evalAmount($('m-pamt').value);
  if(!(amt>0)) return mErr('Укажи сумму');
  const date=$('m-pdate').value||C.todayISO(), month=C.dateToMonth(date);
  if(!D.months.some(m=>m.month===month)) return mErr(`Месяца ${month} нет на шкале — добавь его во вкладке «По месяцам»`);
  D.payments.push({id:'p'+C.uid(),projectId:M.projectId,invoiceId:M.invoiceId,amount:amt,receivedAt:date,month,note:$('m-pnote').value.trim()});
  if(M.invoiceId) C.syncInvoiceStatus(D,M.invoiceId);
  aid=M.projectId;closeM();persist();render();toast('Поступление записано');
}
function delPayment(id){
  const x=D.payments.find(y=>y.id===id);if(!x)return;
  confirmBox('Удалить поступление?',`${usd2(x.amount)} за ${x.month}${x.note?' — '+escH(x.note):''}`,'Удалить',()=>{
    D.payments=D.payments.filter(y=>y.id!==id);
    if(x.invoiceId) C.syncInvoiceStatus(D,x.invoiceId);
    persist();render();
  });
}

// ─── ГРАФИК И ДОНАТ ───────────────────────────────────────────
function legendHTML(){
  return [['Получено',SERIES.rec],['Выставлено',SERIES.inv],['Расход',SERIES.exp],['Профит',SERIES.prof]].map(([l,c])=>`<span><i style="background:${c}"></i>${l}</span>`).join('');
}
function niceStep(x){const p=Math.pow(10,Math.floor(Math.log10(x)));const f=x/p;return (f<=1?1:f<=2?2:f<=5?5:10)*p;}
function kfmt(v){if(v===0)return '0';const a=Math.abs(v);const s=a>=1000?(a/1000).toLocaleString('ru-RU',{maximumFractionDigits:1})+'k':String(a);return (v<0?'−':'')+s;}
function chartHTML(rows){
  const nn=rows.length;if(!nn) return '<p class="info">Нет месяцев на шкале</p>';
  const W=720,H=200;
  const prof=r=>r.received-r.expense;
  const vals=rows.flatMap(r=>[r.received,r.invoiced,r.expense,prof(r)]);
  const hi=Math.max(0,...vals), lo=Math.min(0,...vals);
  const step=niceStep((hi-lo)/4||1), top=Math.ceil(hi/step)*step||step, bot=Math.floor(lo/step)*step;
  const y=v=>(top-v)/(top-bot)*H, x=i=>(i+.5)*W/nn;
  const curve=f=>{const p=rows.map((r,i)=>[x(i),y(f(r))]);let s=`M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;for(let i=1;i<nn;i++){const m=((p[i-1][0]+p[i][0])/2).toFixed(1);s+=`C${m} ${p[i-1][1].toFixed(1)} ${m} ${p[i][1].toFixed(1)} ${p[i][0].toFixed(1)} ${p[i][1].toFixed(1)}`;}return s;};
  const area=f=>curve(f)+`L${x(nn-1).toFixed(1)} ${y(0).toFixed(1)}L${x(0).toFixed(1)} ${y(0).toFixed(1)}Z`;
  const ticks=[];for(let v=top;v>=bot-1e-9;v-=step) ticks.push(v);
  const every=Math.max(1,Math.ceil(nn/7));
  const cols=rows.map((r,i)=>{
    const tip=i<nn/2?'left:75%':'right:75%';
    return `<button class="ch-col" aria-label="${r.month}: получено ${usd(r.received)}, выставлено ${usd(r.invoiced)}, расход ${usd(r.expense)}, профит ${usd(prof(r))}">
      <span class="ch-dot" style="top:${(y(prof(r))-5).toFixed(1)}px"></span>
      <span class="ch-tip" style="${tip}"><strong style="font-size:14px">${r.month}</strong>
        <span><i style="background:${SERIES.rec}"></i>Получено: ${usd(r.received)}</span>
        <span><i style="background:${SERIES.inv}"></i>Выставлено: ${usd(r.invoiced)}</span>
        <span><i style="background:${SERIES.exp};outline:1.5px solid #fff"></i>Расход: ${usd(r.expense)}</span>
        <span><i style="background:${SERIES.prof};height:4px;border-radius:2px"></i>Профит: ${usd(prof(r))}</span>
        <span style="color:#D9DCE1">Курс: ${num(r.eurRate)}${r.ownRate?'':' (общий)'}</span></span>
    </button>`;}).join('');
  return `<div class="chart">
    <div class="ch-y" aria-hidden="true">${ticks.map(v=>`<span>${kfmt(v)}</span>`).join('')}</div>
    <div class="ch-scroll"><div class="ch-body" style="--n:${nn}"><div class="ch-plot">
      <svg role="img" aria-label="Получено, выставлено, расход и профит по месяцам" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        ${ticks.map(v=>`<path d="M0 ${y(v).toFixed(1)}H${W}" stroke="${v===0?'#9DB0BB':'#ECEDF0'}" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('')}
        <path d="${area(r=>r.received)}" fill="${SERIES.rec}" fill-opacity=".24"/>
        <path d="${area(r=>r.expense)}" fill="${SERIES.exp}" fill-opacity=".10"/>
        <path d="${curve(r=>r.invoiced)}" fill="none" stroke="${SERIES.inv}" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>
        <path d="${curve(r=>r.received)}" fill="none" stroke="${SERIES.rec}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
        <path d="${curve(r=>r.expense)}" fill="none" stroke="${SERIES.exp}" stroke-width="2" vector-effect="non-scaling-stroke"/>
        <path d="${curve(prof)}" fill="none" stroke="${SERIES.prof}" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="ch-cols" style="grid-template-columns:repeat(${nn},minmax(0,1fr))">${cols}</div>
    </div>
    <div class="ch-x" aria-hidden="true" style="grid-template-columns:repeat(${nn},minmax(0,1fr))">${rows.map((r,i)=>`<span${i%every===0?'':' class="minor"'}>${r.month}</span>`).join('')}</div></div></div>
  </div>`;
}
// На телефоне график листается по горизонтали — показываем сначала последние месяцы
function scrollChartsToEnd(){const go=()=>document.querySelectorAll('.ch-scroll').forEach(el=>{el.scrollLeft=el.scrollWidth;});go();requestAnimationFrame(go);}
function donutHTML(projects,withSums,opt){
  const by={};let total=0;
  for(const p of projects){const v=stats(p,opt).received;by[p.clientId]=(by[p.clientId]||0)+v;total+=v;}
  if(total<=0) return '<p class="info">Поступлений нет</p>';
  const sorted=Object.entries(by).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const topN=5; // одинаково на главной и во вкладке «Заказчики», чтобы доли и цвета совпадали
  const parts=sorted.slice(0,topN).map(([id,v])=>[C.refName(D.clients,id)||'—',v]);
  const rest=sorted.slice(topN).reduce((s,[,v])=>s+v,0);
  if(rest>0) parts.push(['Остальные',rest]);
  // Каждый сектор — отдельная дуга с явными концами (а не пунктир по кругу:
  // у замкнутого круга на стыке Chrome рисует кривой угол).
  const R=56,CX=75,CY=75;
  const pt=a=>[(CX+R*Math.cos(a)).toFixed(2),(CY+R*Math.sin(a)).toFixed(2)];
  let acc=0;
  const segs=parts.map(([nm,v],i)=>{
    const color=DONUT[i%DONUT.length], frac=v/total;
    if(frac>=0.9999) return `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color}" stroke-width="26"/>`;
    const a0=-Math.PI/2+acc*2*Math.PI, a1=a0+frac*2*Math.PI;acc+=frac;
    const [x0,y0]=pt(a0),[x1,y1]=pt(a1);
    return `<path d="M${x0} ${y0}A${R} ${R} 0 ${frac>0.5?1:0} 1 ${x1} ${y1}" fill="none" stroke="${color}" stroke-width="26"/>`;
  }).join('');
  return `<div class="donut"><div class="donut-c"><svg role="img" aria-label="Доля заказчиков в полученных деньгах" width="150" height="150" viewBox="0 0 150 150">${segs}</svg><span>Получено</span></div>
    <div class="donut-l">${parts.map(([nm,v],i)=>`<div><i style="background:${DONUT[i%DONUT.length]}"></i><span class="nm">${escH(nm)}</span>${withSums?`<span class="muted">${usd(v)}</span>`:''}<b>${Math.round(v/total*100)}%</b></div>`).join('')}</div></div>`;
}

// ─── ПО МЕСЯЦАМ ───────────────────────────────────────────────
function renderMonthly(){
  $('mf-reset').hidden=!excludedProjects.size;
  const rows=C.monthlyStats(D,{exclude:excludedProjects});
  $('legend-m').innerHTML=legendHTML();
  $('chart-monthly').innerHTML=chartHTML(rows);scrollChartsToEnd();
  const delay=parseInt(D.settings.expDelay,10)||0;
  $('monthly-info').textContent='Получено — по месяцу поступления · Выставлено — по дате счёта · Расход — часы × ставка записи × курс месяца'+(delay?` (сдвинут на +${delay} мес.)`:'')+' · Профит — получено минус расход. Курс можно поправить прямо в таблице; пустое поле — общий курс. Нажми на проект в строке, чтобы исключить его из расчёта.';
  const T={inv:0,rec:0,exp:0};
  $('monthly-table').innerHTML=`<thead><tr><th>Месяц</th><th>Курс $/€</th><th>Выставлено</th><th>Получено</th><th>Расход</th><th>Профит</th><th>Маржа</th><th class="l" style="min-width:260px">Проекты</th></tr></thead><tbody>`+rows.map(r=>{
    T.inv+=r.invoiced;T.rec+=r.received;T.exp+=r.expense;
    const any=r.received||r.expense;
    const tags=r.allProjects.map(id=>{const p=proj(id);if(!p)return '';const off=excludedProjects.has(id);return `<button class="ptag${off?' off':''}" aria-pressed="${off}" onclick="toggleMonthlyProject('${id}')" title="${off?'Включить':'Исключить'}: ${escH(p.site)}">${escH(p.site)}</button>`;}).join('');
    return `<tr>
      <td style="font-weight:800" class="nw">${r.month}</td>
      <td><input class="rate-in${r.ownRate?'':' def'}" value="${r.ownRate?r.eurRate:''}" placeholder="${D.settings.eurRate}" aria-label="Курс ${r.month}" title="${r.ownRate?'Курс месяца':'Не задан — берётся общий'}" onchange="setMonthRate('${r.month}',this.value)"></td>
      <td>${r.invoiced?usd(r.invoiced):dash}</td>
      <td style="font-weight:700">${r.received?usd(r.received):dash}</td>
      <td>${r.expense?usd(r.expense):dash}${r.expense?`<small>разр. ${usd(r.build.expense)} · подд. ${usd(r.support.expense)}</small>`:''}</td>
      <td style="font-weight:800" class="${any?(r.profit>=0?'pos':'neg'):''}">${any?usd(r.profit):dash}${r.invoiced&&Math.round(r.invoiced)!==Math.round(r.received)?`<small>ожид. ${usd(r.expectedProfit)}</small>`:''}</td>
      <td>${r.received>0?pct(r.profit,r.received):dash}</td>
      <td class="l">${tags}</td>
    </tr>`;
  }).join('')+`<tr class="total"><td>Итого</td><td></td><td>${usd(T.inv)}</td><td>${usd(T.rec)}</td><td>${usd(T.exp)}</td><td class="${T.rec-T.exp>=0?'pos':'neg'}">${usd(T.rec-T.exp)}</td><td>${pct(T.rec-T.exp,T.rec)}</td><td></td></tr></tbody>`;
}
function toggleMonthlyProject(id){excludedProjects.has(id)?excludedProjects.delete(id):excludedProjects.add(id);renderMonthly();}
function resetMonthlyFilter(){excludedProjects.clear();renderMonthly();}
function addMonth(){const m=C.shiftMonth(lastMonth(),1);D.months.push({month:m});persist();renderCurrent();toast(`Добавлен ${m} — задай ему курс`);}
function addPrevMonth(){const m=C.shiftMonth(D.months[0].month,-1);D.months.unshift({month:m});persist();renderCurrent();toast(`Добавлен ${m}`);}
function setMonthRate(month,val){
  const m=D.months.find(x=>x.month===month);if(!m)return;
  const v=parseFloat(String(val).replace(',','.'));
  if(val===''||!(v>0)) delete m.eurRate; else m.eurRate=v;
  persist();renderCurrent();
}

// ─── ЗАКАЗЧИКИ ────────────────────────────────────────────────
function renderClients(){
  const fs=$('cs-from'),ts=$('cs-to'),fv=fs.value,tv=ts.value;
  fs.innerHTML=monthOptions(fv,'с начала');ts.innerHTML=monthOptions(tv,'по сегодня');
  const from=fs.value||undefined,to=ts.value||undefined;
  const s=C.clientSummary(D,{from,to});
  const row=(r,total)=>`<tr class="${total?'total':''}">
    <td>${total?'Итого':`<button class="link" onclick="setClientFilter('${r.clientId}')">${escH(r.client)}</button>`}</td>
    <td>${r.projects}</td>
    <td>${hrs(r.hours)}<small>разр. ${hrs(r.build.hours)} · подд. ${hrs(r.support.hours)}</small></td>
    <td>${usd(r.expense)}<small>разр. ${usd(r.build.expense)} · подд. ${usd(r.support.expense)}</small></td>
    <td>${r.invoiced?usd(r.invoiced):dash}</td>
    <td>${r.received?usd(r.received):dash}</td>
    <td class="${r.debt>0?'debt':''}" style="${r.debt>0?'font-weight:800':'color:var(--muted)'}">${r.debt>0?usd(r.debt):dash}</td>
    <td style="font-weight:800" class="${r.profit>=0?'pos':'neg'}">${usd(r.profit)}</td>
    <td>${r.received>0?pct(r.profit,r.received):dash}</td></tr>`;
  const table=(title,sub,rows,total)=>`<section class="card"><div class="card-h"><h2>${title}</h2><span class="card-sub">${sub}</span></div>
    <div class="tw"><table class="tbl" style="min-width:900px"><thead><tr><th>Заказчик</th><th>Проектов</th><th>Часы</th><th>Расход</th><th>Выставлено</th><th>Получено</th><th>Долг</th><th>Профит</th><th>Маржа</th></tr></thead>
    <tbody>${rows.length?rows.map(r=>row(r)).join('')+row(total,true):'<tr><td colspan="9" class="l muted" style="text-align:center;padding:18px">Нет данных за период</td></tr>'}</tbody></table></div></section>`;
  $('clients-body').innerHTML=
    (from||to?`<div class="info-box">За период ${from||'…'} — ${to||'…'}: часы и расход — по месяцу работы, выставлено — по дате счёта, получено — по месяцу поступления. Допрасходы без даты в периоде не учитываются; долг — на сегодня.</div>`:'')+
    `<section class="card"><div class="card-h"><h2>Доля заказчиков</h2><span class="card-sub">в полученных деньгах${from||to?' за период':' за всё время'}</span></div>${donutHTML(D.projects,true,{from,to})}</section>`+
    table('Свои проекты','строили сами — фикс-прайс + поддержка',s.own,s.totalOwn)+
    (s.inherited.length?table('Чужие проекты на поддержке','без стартового дохода — маржу не сравнивать со своими',s.inherited,s.totalInherited):'');
}

// ─── ДЕБИТОРКА ────────────────────────────────────────────────
function renderReceivables(){
  const list=C.receivables(D);
  const total=list.reduce((s,r)=>s+r.outstanding,0);
  const by={};for(const r of list){const k=r.client||'—';(by[k]||(by[k]={sum:0,n:0})).sum+=r.outstanding;by[k].n++;}
  $('view-receivables').innerHTML=`
    <div class="kpis">
      <div class="kpi kpi-accent"><span class="k-l">Всего должны</span><span class="k-v">${usd(total)}</span><span class="k-s">счетов: ${list.length}</span></div>
      ${Object.entries(by).sort((a,b)=>b[1].sum-a[1].sum).map(([c,v])=>`<div class="kpi kpi-white"><span class="k-l">${escH(c)}</span><span class="k-v">${usd(v.sum)}</span><span class="k-s">счетов: ${v.n}</span></div>`).join('')}
    </div>
    <section class="card"><div class="card-h"><h2>Неоплаченные счета</h2><span class="card-sub">старые — сверху · нажми на проект, чтобы открыть его</span></div>
    <div class="tw"><table class="tbl" style="min-width:900px"><thead><tr><th>Заказчик</th><th class="l">Проект</th><th class="l">За что</th><th class="l">Выставлен</th><th>Возраст</th><th>Сумма</th><th>Оплачено</th><th>Остаток</th></tr></thead><tbody>
    ${list.length?list.map(r=>`<tr>
      <td style="font-weight:800">${escH(r.client)}</td>
      <td class="l"><button class="link" onclick="openProject('${r.projectId}','list')">${escH(r.site)}</button></td>
      <td class="l muted" style="font-size:13px">${escH(r.description)||dash}</td>
      <td class="l nw">${dmy(r.issuedAt)}</td>
      <td class="nw" style="font-weight:700;color:${r.ageDays>C.OVERDUE_DAYS?'var(--red)':'inherit'}">${r.ageDays} дн.</td>
      <td class="nw">${r.currency==='EUR'?'€'+num(r.amount)+`<small>≈ ${usd(r.amountUSD)}</small>`:usd2(r.amount)}</td>
      <td>${r.paid?usd2(r.paid):dash}</td>
      <td class="debt" style="font-weight:800">${usd2(r.outstanding)}</td></tr>`).join(''):'<tr><td colspan="8" class="l muted" style="text-align:center;padding:24px">Никто не должен 🎉</td></tr>'}
    </tbody></table></div></section>`;
}

// ─── ПРОВЕРКА ─────────────────────────────────────────────────
function renderIssues(){
  const all=C.dataIssues(D);
  const groups={};for(const i of all)(groups[i.type]||(groups[i.type]=[])).push(i);
  const order=[...Object.keys(ISSUE_TITLES).filter(k=>groups[k]),...Object.keys(groups).filter(k=>!ISSUE_TITLES[k])];
  $('view-issues').innerHTML=all.length?order.map(k=>`<section class="card" style="gap:4px">
    <div class="issue-h"><h2>${ISSUE_TITLES[k]||k}</h2><span class="cnt">${groups[k].length}</span></div>
    ${groups[k].map(i=>{
      const go=i.projectId?`openProject('${i.projectId}','list')`:i.month?`switchTab('monthly')`:'';
      const extra=i.amount!==undefined?usd(i.amount)+(i.hours!==undefined?' · '+hrs(i.hours)+' ч':''):i.hours!==undefined?hrs(i.hours)+' ч':i.ageDays!==undefined?i.ageDays+' дн.':'';
      return `<button class="issue" ${go?`onclick="${go}"`:'disabled style="cursor:default"'}><span>${escH(i.title)}</span><b>${extra}</b></button>`;
    }).join('')}</section>`).join(''):'<p class="empty">Проблем не найдено ✅</p>';
}

// ─── ЭКСПОРТ / ИМПОРТ ─────────────────────────────────────────
function exportData(){
  if(!D) return;
  const blob=new Blob([JSON.stringify({...D,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`hexa-dashboard-${C.todayISO()}.json`;a.click();URL.revokeObjectURL(a.href);
  toast('Данные экспортированы');
}
function triggerImport(){$('imp-input').click()}
function importData(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const data=JSON.parse(ev.target.result);
      if((data.schemaVersion||0)<C.SCHEMA_VERSION){toast('Это экспорт старого формата — его нужно прогнать через миграцию');return;}
      confirmBox('Заменить все данные?',`Текущие данные будут заменены содержимым файла (${(data.projects||[]).length} проектов).`,'Заменить',async()=>{
        delete data.exportedAt;D=C.normalize(data);readOnly=false;aid=null;
        await persist();syncSettingsInputs();render();toast(`Импортировано ${D.projects.length} проектов`);
      });
    }catch(err){toast('Ошибка: '+err.message);}
  };
  reader.readAsText(file);e.target.value='';
}

// ─── DRAWER / TOAST / EVENTS ──────────────────────────────────
function openDrawer(){$('sb').classList.add('drawer-open');$('drawer-ov').classList.add('open');}
function closeDrawer(){$('sb').classList.remove('drawer-open');$('drawer-ov').classList.remove('open');}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),2800);}

for(const [id,k] of SETTINGS) $(id).addEventListener('input',()=>onSettingInput(id,k,k==='expDelay'));
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape') return;
  if($('ov').classList.contains('open')) closeM();
  else if($('sb').classList.contains('drawer-open')) closeDrawer();
  else if(aid&&currentTab==='projects'&&!(document.activeElement&&document.activeElement.classList.contains('pnote'))){aid=null;renderList(filtered());}
});
document.querySelectorAll('.logo-slot').forEach(el=>el.appendChild($('logo-tpl').content.cloneNode(true)));
renderNav();
checkAuth();
