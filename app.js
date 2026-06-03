const LSK='wbd6',LSR='wbd6r',LSM='wbd6m';

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
  const hash=await sha256(val);
  if(hash===AUTH_HASH){
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
const RU_M=['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const DEFAULT_MONTHS=['Авг 25','Сен 25','Окт 25','Ноя 25','Дек 25','Янв 26','Фев 26','Мар 26','Апр 26'];

// ─── FIREBASE INIT ────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAy2dKkjq0mukLj_JO8Iqz5ebnca7ZMIQw",
  authDomain: "hexa-web-dev.firebaseapp.com",
  projectId: "hexa-web-dev",
  storageBucket: "hexa-web-dev.firebasestorage.app",
  messagingSenderId: "617618063520",
  appId: "1:617618063520:web:0b86398afa0756edbd09c5"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const DOC = db.collection('webdev').doc('dashboard');

const STATUSES=[
  {val:'Сдан',       cls:'сдан',       dot:'#0FC47A', bg:'#E4F9EF', color:'#0A6E40'},
  {val:'В работе',   cls:'вработе',    dot:'#F59E0B', bg:'#FFFBEB', color:'#854D0E'},
  {val:'Холд',       cls:'холд',       dot:'#F05252', bg:'#FEE2E2', color:'#991B1B'},
  {val:'На проверке',cls:'напроверке', dot:'#3B82F6', bg:'#EFF6FF', color:'#1E40AF'},
  {val:'Обсуждение', cls:'обсуждение', dot:'#94A3B8', bg:'#F1F5F9', color:'#475569'},
];

const PAY_OPTS=[
  {val:'Yes',           cls:'p-yes',    label:'Yes'},
  {val:'partially paid',cls:'p-partial',label:'Частично'},
  {val:'No',            cls:'p-no',     label:'No'},
];

function statusInfo(s){return STATUSES.find(x=>x.val===s)||null}
function statusBadge(s, large){
  if(!s) return '';
  const info=statusInfo(s);
  if(!info) return `<span class="sbadge s-default">${s}</span>`;
  return `<span class="sbadge" style="background:${info.bg};color:${info.color}"><span style="width:${large?7:6}px;height:${large?7:6}px;border-radius:50%;background:${info.dot};display:inline-block;flex-shrink:0"></span>${s}</span>`;
}
function payBadge(v){
  const o=PAY_OPTS.find(x=>x.val===v);
  if(!o) return '';
  return `<span class="pbadge ${o.cls}">${o.label}</span>`;
}
function profitBadge(v){
  if(!v) return '';
  const cls=v==='Да'?'pf-yes':'pf-no';
  return `<span class="pfbadge ${cls}">Профит: ${v}</span>`;
}

function nextMonthStr(last){
  const[mon,yr]=last.split(' ');
  const mi=RU_M.indexOf(mon);
  const year=parseInt(yr);
  if(mi<0) return null;
  return mi===11?`Янв ${year+1}`:`${RU_M[mi+1]} ${year}`;
}

function prevMonthStr(first){
  const[mon,yr]=first.split(' ');
  const mi=RU_M.indexOf(mon);
  const year=parseInt(yr);
  if(mi<0) return null;
  return mi===0?`Дек ${year-1}`:`${RU_M[mi-1]} ${year}`;
}

// Warranty: next 2 months after delivery
function warrantyEnd(delivMonth){
  if(!delivMonth) return null;
  let m=delivMonth;
  m=nextMonthStr(m);
  m=nextMonthStr(m);
  return m;
}

const INI=[{"id":"meshquill","site":"meshquill.com","client":"Marina","type":"Creartistive+chat","income":7951,"dop":0,"warn":false,"status":"Сдан","deliveryMonth":"Авг 25","paymentStatus":"Yes","profitShared":"Да","months":[{"month":"Авг 25","hours":26.5},{"month":"Сен 25","hours":0},{"month":"Окт 25","hours":0},{"month":"Ноя 25","hours":0},{"month":"Дек 25","hours":0},{"month":"Янв 26","hours":0},{"month":"Фев 26","hours":0},{"month":"Мар 26","hours":0},{"month":"Апр 26","hours":0}]},{"id":"lootfrost","site":"lootfrost.ru","client":"Mary Antifraud","type":"CS skins","income":6095,"dop":323.8,"warn":true,"status":"Сдан","deliveryMonth":"Сен 25","paymentStatus":"Yes","profitShared":"Да","months":[{"month":"Авг 25","hours":0},{"month":"Сен 25","hours":0},{"month":"Окт 25","hours":0},{"month":"Ноя 25","hours":0},{"month":"Дек 25","hours":6},{"month":"Янв 26","hours":0},{"month":"Фев 26","hours":0},{"month":"Мар 26","hours":0},{"month":"Апр 26","hours":0}]},{"id":"islandnook","site":"islandnook.net","client":"AG.WebSites","type":"Private islands","income":5221,"dop":93.1,"warn":false,"status":"В работе","deliveryMonth":"","paymentStatus":"partially paid","profitShared":"Нет","months":[{"month":"Авг 25","hours":1.5},{"month":"Сен 25","hours":28.5},{"month":"Окт 25","hours":0},{"month":"Ноя 25","hours":0},{"month":"Дек 25","hours":0},{"month":"Янв 26","hours":0},{"month":"Фев 26","hours":4},{"month":"Мар 26","hours":8.5},{"month":"Апр 26","hours":31}]},{"id":"ruststation","site":"ruststation.com","client":"AG.WebSites","type":"Rust server","income":5221,"dop":221.2,"warn":false,"status":"Сдан","deliveryMonth":"Ноя 25","paymentStatus":"Yes","profitShared":"Да","months":[{"month":"Авг 25","hours":16},{"month":"Сен 25","hours":32.5},{"month":"Окт 25","hours":12},{"month":"Ноя 25","hours":13.5},{"month":"Дек 25","hours":0},{"month":"Янв 26","hours":0},{"month":"Фев 26","hours":3.5},{"month":"Мар 26","hours":4.5},{"month":"Апр 26","hours":2.5}]},{"id":"craftlynx","site":"craftlynx.net","client":"AG.WebSites","type":"Minecraft server","income":5221,"dop":68.9,"warn":false,"status":"Сдан","deliveryMonth":"Авг 25","paymentStatus":"Yes","profitShared":"Да","months":[{"month":"Авг 25","hours":19.5},{"month":"Сен 25","hours":0.5},{"month":"Окт 25","hours":0},{"month":"Ноя 25","hours":0},{"month":"Дек 25","hours":0},{"month":"Янв 26","hours":0},{"month":"Фев 26","hours":2},{"month":"Мар 26","hours":3.25},{"month":"Апр 26","hours":0}]},{"id":"promptsolid","site":"promptsolid.net","client":"AG.WebSites","type":"3D shapes AI","income":5221,"dop":919.3,"warn":false,"status":"Холд","deliveryMonth":"","paymentStatus":"partially paid","profitShared":"Нет","months":[{"month":"Авг 25","hours":0},{"month":"Сен 25","hours":0},{"month":"Окт 25","hours":37},{"month":"Ноя 25","hours":3},{"month":"Дек 25","hours":0},{"month":"Янв 26","hours":0},{"month":"Фев 26","hours":0},{"month":"Мар 26","hours":5},{"month":"Апр 26","hours":0}]},{"id":"pixvolo","site":"pixvolo.com","client":"AG.WebSites","type":"AI tools","income":5221,"dop":390.9,"warn":false,"status":"Сдан","deliveryMonth":"Окт 25","paymentStatus":"Yes","profitShared":"Да","months":[{"month":"Авг 25","hours":50},{"month":"Сен 25","hours":0.5},{"month":"Окт 25","hours":0},{"month":"Ноя 25","hours":2},{"month":"Дек 25","hours":0},{"month":"Янв 26","hours":6},{"month":"Фев 26","hours":0},{"month":"Мар 26","hours":1.5},{"month":"Апр 26","hours":1}]},{"id":"aigoods","site":"ai-goods.eu","client":"UA frontshops","type":"AI market","income":7008,"dop":279.6,"warn":false,"status":"Сдан","deliveryMonth":"Ноя 25","paymentStatus":"Yes","profitShared":"Да","months":[{"month":"Авг 25","hours":24},{"month":"Сен 25","hours":17},{"month":"Окт 25","hours":0},{"month":"Ноя 25","hours":6},{"month":"Дек 25","hours":2.5},{"month":"Янв 26","hours":0},{"month":"Фев 26","hours":0},{"month":"Мар 26","hours":0},{"month":"Апр 26","hours":1.35}]},{"id":"hawknocturne","site":"hawknocturne.com","client":"Mike X","type":"CS2 skins","income":6967,"dop":0,"warn":false,"status":"Сдан","deliveryMonth":"Янв 26","paymentStatus":"Yes","profitShared":"Нет","months":[{"month":"Авг 25","hours":0},{"month":"Сен 25","hours":0},{"month":"Окт 25","hours":0},{"month":"Ноя 25","hours":140.5},{"month":"Дек 25","hours":0},{"month":"Янв 26","hours":18},{"month":"Фев 26","hours":0},{"month":"Мар 26","hours":0},{"month":"Апр 26","hours":0}]},{"id":"skineagle","site":"skineagle.com","client":"AG.WebSites","type":"CS2 skins","income":6728,"dop":0,"warn":false,"status":"Сдан","deliveryMonth":"Янв 26","paymentStatus":"Yes","profitShared":"Да","months":[{"month":"Авг 25","hours":0},{"month":"Сен 25","hours":0},{"month":"Окт 25","hours":0},{"month":"Ноя 25","hours":28},{"month":"Дек 25","hours":40},{"month":"Янв 26","hours":0},{"month":"Фев 26","hours":0},{"month":"Мар 26","hours":0},{"month":"Апр 26","hours":0}]},{"id":"critcrate","site":"critcrate.com","client":"AG.WebSites","type":"Dota 2 skins","income":6728,"dop":0,"warn":false,"status":"Сдан","deliveryMonth":"Янв 26","paymentStatus":"Yes","profitShared":"Да","months":[{"month":"Авг 25","hours":0},{"month":"Сен 25","hours":0},{"month":"Окт 25","hours":0},{"month":"Ноя 25","hours":25},{"month":"Дек 25","hours":41.5},{"month":"Янв 26","hours":0},{"month":"Фев 26","hours":0},{"month":"Мар 26","hours":0},{"month":"Апр 26","hours":0}]},{"id":"beatwizard","site":"beatwizard.net","client":"AG.WebSites","type":"Music generation","income":8452,"dop":0,"warn":false,"status":"Сдан","deliveryMonth":"Фев 26","paymentStatus":"Yes","profitShared":"Да","months":[{"month":"Авг 25","hours":0},{"month":"Сен 25","hours":0},{"month":"Окт 25","hours":0},{"month":"Ноя 25","hours":0},{"month":"Дек 25","hours":31},{"month":"Янв 26","hours":103},{"month":"Фев 26","hours":1},{"month":"Мар 26","hours":0},{"month":"Апр 26","hours":0}]},{"id":"skinswarehouse","site":"skinswarehouse.com","client":"Banking","type":"Skins marketplace","income":9442,"dop":0,"warn":false,"status":"В работе","deliveryMonth":"Янв 26","paymentStatus":"partially paid","profitShared":"Нет","months":[{"month":"Авг 25","hours":0},{"month":"Сен 25","hours":0},{"month":"Окт 25","hours":24},{"month":"Ноя 25","hours":5.5},{"month":"Дек 25","hours":43},{"month":"Янв 26","hours":76},{"month":"Фев 26","hours":53.5},{"month":"Мар 26","hours":20},{"month":"Апр 26","hours":10.25}]},{"id":"ideayard","site":"ideayard.net","client":"Albina","type":"Skins marketplace","income":7175,"dop":0,"warn":false,"status":"Сдан","deliveryMonth":"Мар 26","paymentStatus":"Yes","profitShared":"Нет","months":[{"month":"Авг 25","hours":0},{"month":"Сен 25","hours":0},{"month":"Окт 25","hours":0},{"month":"Ноя 25","hours":0},{"month":"Дек 25","hours":66},{"month":"Янв 26","hours":0},{"month":"Фев 26","hours":102.5},{"month":"Мар 26","hours":2.5},{"month":"Апр 26","hours":0.5}]},{"id":"guymz","site":"guymz.io","client":"ECOM","type":"Game keys","income":9054,"dop":0,"warn":false,"status":"Сдан","deliveryMonth":"Фев 26","paymentStatus":"Yes","profitShared":"Да","months":[{"month":"Авг 25","hours":0},{"month":"Сен 25","hours":0},{"month":"Окт 25","hours":0},{"month":"Ноя 25","hours":0},{"month":"Дек 25","hours":29.75},{"month":"Янв 26","hours":66.5},{"month":"Фев 26","hours":4},{"month":"Мар 26","hours":1.75},{"month":"Апр 26","hours":0.25}]},{"id":"zumboo","site":"zumboo.io","client":"ECOM","type":"Minecraft server","income":8966,"dop":0,"warn":false,"status":"На проверке","deliveryMonth":"Апр 26","paymentStatus":"partially paid","profitShared":"Нет","months":[{"month":"Авг 25","hours":0},{"month":"Сен 25","hours":0},{"month":"Окт 25","hours":0},{"month":"Ноя 25","hours":0},{"month":"Дек 25","hours":0},{"month":"Янв 26","hours":0},{"month":"Фев 26","hours":34},{"month":"Мар 26","hours":27.75},{"month":"Апр 26","hours":7.1}]}];

let P=[],MONTHS=[],aid=null,eid=null,did=null,fClient='Все',fType='Все',fStatus='Все';
let _saving=false;

function normMonths(existing){
  const map=new Map((existing||[]).map(m=>[m.month,m.hours]));
  return MONTHS.map(m=>({month:m,hours:n(map.get(m)||0)}));
}

async function persist(){
  try{
    _saving=true;
    showSync(true);
    await DOC.set({
      projects:P,
      months:MONTHS,
      rate:gr(),
      eurRate:gx(),
      updatedAt:new Date().toISOString()
    });
    showSync(false);
    _saving=false;
  }catch(e){
    showSync(false);
    _saving=false;
    toast('⚠ Ошибка сохранения: '+e.message);
    console.error(e);
  }
}

function initFirestore(){
  DOC.onSnapshot(snap=>{
    showLoading(false);
    if(!snap.exists){
      // Первый запуск — загружаем дефолтные данные
      P=JSON.parse(JSON.stringify(INI));
      MONTHS=[...DEFAULT_MONTHS];
      persist();
      return;
    }
    if(_saving) return; // не перезаписываем пока сами сохраняем
    const data=snap.data();
    MONTHS=data.months||[...DEFAULT_MONTHS];
    P=(data.projects||[]).map(p=>({...p,months:normMonths(p.months)}));
    if(data.rate) document.getElementById('rate').value=data.rate;
    if(data.eurRate) document.getElementById('eurrate').value=data.eurRate;
    render();
    if(aid&&P.find(p=>p.id===aid)) renderDet();
  }, err=>{
    showLoading(false);
    toast('⚠ Ошибка подключения: '+err.message);
    console.error(err);
  });
}

function showLoading(v){document.getElementById('loading').style.display=v?'flex':'none'}
function showSync(v){
  const el=document.getElementById('sync-dot');
  el.classList.toggle('show',v);
}

function addMonth(){
  const last=MONTHS[MONTHS.length-1];
  const next=nextMonthStr(last);
  if(!next||MONTHS.includes(next)){toast('Месяц уже добавлен');return;}
  MONTHS.push(next);
  P.forEach(p=>{if(!p.months.find(m=>m.month===next))p.months.push({month:next,hours:0});});
  persist();
  const curVals=getCurrentModalHoursByName();
  fillDeliverySelect(document.getElementById('fdelivery').value);
  buildModalMonths(null,true,curVals);
  toast(`Добавлен: ${next}`);
}

function addPrevMonth(){
  const first=MONTHS[0];
  const prev=prevMonthStr(first);
  if(!prev||MONTHS.includes(prev)){toast('Месяц уже добавлен');return;}
  MONTHS.unshift(prev);
  P.forEach(p=>{if(!p.months.find(m=>m.month===prev))p.months.unshift({month:prev,hours:0});});
  persist();
  const curVals=getCurrentModalHoursByName();
  fillDeliverySelect(document.getElementById('fdelivery').value);
  buildModalMonths(null,false,curVals);
  toast(`Добавлен: ${prev}`);
}

// Сохраняем значения по названию месяца (не по индексу) — индексы меняются при добавлении в начало
function getCurrentModalHoursByName(){
  const v={};
  MONTHS.forEach((m,i)=>{const el=document.getElementById('mh'+i);if(el)v[m]=el.value;});
  return v;
}

function getCurrentModalHours(){
  const v={};
  MONTHS.forEach((_,i)=>{const el=document.getElementById('mh'+i);if(el)v[i]=el.value;});
  return v;
}

function buildModalMonths(existingVals, highlightLast, byName){
  document.getElementById('mins').innerHTML=MONTHS.map((m,i)=>{
    const isNew=highlightLast&&i===MONTHS.length-1;
    // byName = values keyed by month name (used after add/remove)
    // existingVals = values keyed by index (legacy)
    let v='';
    if(byName&&byName[m]!==undefined) v=byName[m];
    else if(existingVals&&existingVals[i]!==undefined) v=existingVals[i];
    return`<div class="mc${isNew?' new-month':''}">
      <label>${m}</label>
      <input type="number" min="0" step="0.25" id="mh${i}" value="${v}" placeholder="0">
    </div>`;
  }).join('');
}

function buildM(p){
  const map=new Map((p?.months||[]).map(m=>[m.month,m.hours]));
  const byName={};
  MONTHS.forEach(m=>{const h=n(map.get(m)||0);byName[m]=h||'';});
  buildModalMonths(null,false,byName);
}

function fillDeliverySelect(currentVal){
  const opts='<option value="">— не указан —</option>'+
    MONTHS.map(m=>`<option value="${m}">${m}</option>`).join('');
  const sel=document.getElementById('fdelivery');
  sel.innerHTML=opts;
  sel.value=currentVal||'';
  document.getElementById('fpaymonth').innerHTML=opts;
  document.getElementById('fprepaymonth').innerHTML=opts;
}

function gr(){return parseFloat(document.getElementById('rate').value)||20}
function gx(){return parseFloat(document.getElementById('eurrate').value)||1.08}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2)}
function n(v){return isNaN(+v)?0:+v}
function fmt(v){return Math.round(v).toLocaleString('ru-RU')}
function fh(v){return v%1===0?v:parseFloat((+v).toFixed(2))}
function esc(s){return(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")}

// Кол-во месяцев между двумя строками вида "Авг 25"
function monthDiff(from, to){
  if(!from||!to) return null;
  const parse=s=>{const[mon,yr]=s.split(' ');return{mi:RU_M.indexOf(mon),yr:parseInt(yr)};};
  const a=parse(from), b=parse(to);
  if(a.mi<0||b.mi<0) return null;
  return (b.yr-a.yr)*12+(b.mi-a.mi);
}

function calc(p){
  const r=gr(), x=gx();
  const h=p.months.reduce((s,m)=>s+n(m.hours),0);
  const c=h*r*x;
  const ref=n(p.refPct)>0 ? p.income*n(p.refPct)/100 : 0;
  const pr=p.income-c-n(p.dop)-ref;
  const m=p.income>0?pr/p.income*100:0;
  return{h,c,ref,pr,m};
}

function clients(){return['Все',...[...new Set(P.map(p=>p.client))].sort()]}
function types(){return['Все',...[...new Set(P.map(p=>p.type||'').filter(Boolean))].sort()]}

function filtered(){
  const q=document.getElementById('search').value.toLowerCase();
  const mn=n(document.getElementById('fmin').value)||0;
  const mx=n(document.getElementById('fmax').value)||Infinity;
  return P.filter(p=>{
    if(fClient!=='Все'&&p.client!==fClient) return false;
    if(fType!=='Все'&&p.type!==fType) return false;
    if(fStatus!=='Все'&&(p.status||'')!==fStatus) return false;
    if(p.income<mn||p.income>mx) return false;
    if(q&&!p.site.toLowerCase().includes(q)&&!p.client.toLowerCase().includes(q)&&!(p.type||'').toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderNav(){
  if(fClient!=='Все'&&!P.find(p=>p.client===fClient)) fClient='Все';
  const html=clients().map(c=>{
    const cnt=c==='Все'?P.length:P.filter(p=>p.client===c).length;
    return`<div class="ni${fClient===c?' on':''}" onclick="setC('${esc(c)}')">
      <span class="nl">${c==='Все'?'Все клиенты':c}</span>
      <span class="nc">${cnt}</span>
    </div>`;
  }).join('');
  document.getElementById('nav').innerHTML=html;
  document.getElementById('mob-clients').innerHTML=clients().map(c=>{
    const cnt=c==='Все'?P.length:P.filter(p=>p.client===c).length;
    return`<div class="mob-pill${fClient===c?' on':''}" onclick="setC('${esc(c)}')">${c==='Все'?'Все':c}<span class="mc">${cnt}</span></div>`;
  }).join('');
}

function renderTypes(){
  if(fType!=='Все'&&!P.find(p=>p.type===fType)) fType='Все';
  document.getElementById('type-pills').innerHTML=types().map(t=>
    `<div class="pill${fType===t?' on':''}" onclick="setT('${esc(t)}')">${t==='Все'?'Все типы':t}</div>`
  ).join('');
}

function renderStatusPills(){
  const all=[{val:'Все',dot:'#9DB0BB',bg:'',color:''},...STATUSES];
  document.getElementById('status-pills').innerHTML=all.map(s=>{
    const isOn=fStatus===s.val;
    if(s.val==='Все'){
      return`<div class="spill${isOn?' on':''}" onclick="setSt('Все')">Все статусы</div>`;
    }
    const cnt=P.filter(p=>p.status===s.val).length;
    return`<div class="spill${isOn?` on ss-${s.cls}`:''}" onclick="setSt('${esc(s.val)}')">
      <span class="spill-dot" style="background:${s.dot}"></span>${s.val} <span style="font-size:10px;opacity:.7">${cnt}</span>
    </div>`;
  }).join('');
}

function renderCards(){
  const list=filtered(),r=gr();
  let ti=0,tc=0,th=0,tp=0;
  list.forEach(p=>{const c=calc(p);ti+=p.income;th+=c.h;tc+=c.c;tp+=c.pr;});
  const am=ti>0?Math.round(tp/ti*1000)/10:0;
  document.getElementById('cards').innerHTML=`
    <div class="sc c1"><div class="sc-ico">💰</div><div class="sc-lbl">Выручка</div><div class="sc-val v-teal">$${fmt(ti)}</div><div class="sc-sub">${list.length} проектов · avg $${fmt(list.length?ti/list.length:0)}</div></div>
    <div class="sc c2"><div class="sc-ico">⏱</div><div class="sc-lbl">Расход</div><div class="sc-val">$${fmt(tc)}</div><div class="sc-sub">${fh(th)} ч × ${r}€ × ${gx()}$/€</div></div>
    <div class="sc c3"><div class="sc-ico">📈</div><div class="sc-lbl">Профит</div><div class="sc-val v-green">$${fmt(tp)}</div><div class="sc-sub">avg $${fmt(list.length?tp/list.length:0)}</div></div>
    <div class="sc c4"><div class="sc-ico">🎯</div><div class="sc-lbl">Маржа</div><div class="sc-val v-yel">${am}%</div><div class="sc-sub">по выборке</div></div>`;
}

function renderTable(){
  const list=filtered();
  document.getElementById('ptitle').textContent=`Проектов: ${list.length}`;
  if(!list.length){document.getElementById('tbody').innerHTML=`<tr><td colspan="6" class="empty-row">Ничего не найдено</td></tr>`;return;}
  document.getElementById('tbody').innerHTML=list.map(p=>{
    const{h,c,pr,m}=calc(p);
    const mc=m>=75?'#0FC47A':m>=55?'#F59E0B':'#F05252';
    const mp=Math.max(0,Math.min(100,m));
    const wb=p.warn?`<span class="bdg ba">⚠</span>`:'';
    const sb=statusBadge(p.status,false);
    const pb=payBadge(p.paymentStatus);
    const pfb=profitBadge(p.profitShared);
    const deliv=p.deliveryMonth?`<span class="deliv-tag">📅 ${p.deliveryMonth}</span>`:'';
    const refb=n(p.refPct)>0?`<span class="ref-badge">🤝 ${n(p.refPct)}%</span>`:'';
    return`<tr onclick="tog('${p.id}')" class="${aid===p.id?'sel':''}">
      <td>
        <div class="pn">${p.site}${wb}</div>
        <div class="pm">${p.client}${p.type?' · '+p.type:''}</div>
        <div class="p-badges">${sb}${pb}${pfb}${deliv}${refb}</div>
      </td>
      <td class="r">$${fmt(p.income)}</td>
      <td class="r">${fh(h)}</td>
      <td class="r">$${fmt(c)}</td>
      <td class="r ${pr>=0?'pos':'neg'}">$${fmt(pr)}</td>
      <td><div class="mbar"><div class="mbt"><div class="mbf" style="width:${mp}%;background:${mc}"></div></div><span class="mbn">${Math.round(m*10)/10}%</span></div></td>
    </tr>`;
  }).join('');
}

function tog(id){if(aid===id){closeD();return;}aid=id;renderTable();renderDet();}

function closeD(){
  aid=null;
  document.getElementById('det').style.display='none';
  renderTable();
}

function renderDet(){
  const p=P.find(x=>x.id===aid);if(!p)return;
  const{h,c,pr,m}=calc(p);const r=gr();
  document.getElementById('ds').textContent=p.site;
  document.getElementById('dm').textContent=[p.client,p.type].filter(Boolean).join(' · ');

  // Вычисляем заранее — нужны и в бейджах, и в KPI
  const durMonths = monthDiff(p.prepaymentMonth, p.paymentMonth);
  const durLabel = durMonths !== null
    ? (durMonths === 0 ? 'в том же месяце' : `${durMonths} мес.`)
    : null;
  const refAmt = n(p.refPct) > 0 ? p.income * n(p.refPct) / 100 : 0;
  const refKpi = refAmt > 0
    ? `<div class="kpi"><div class="kpi-l">Реферал партнёру</div><div class="kpi-v kpi-ref">$${fmt(refAmt)}</div><div class="kpi-s" style="color:#6B21A8">${n(p.refPct)}% от выручки</div></div>`
    : '';

  // Badges in header
  const wEnd=warrantyEnd(p.deliveryMonth);
  let badges='';
  if(p.status) badges+=`<span class="dh-sbadge">${p.status}</span>`;
  if(p.deliveryMonth) badges+=`<span class="dh-deliv">📅 Сдан: ${p.deliveryMonth}</span>`;
  if(p.prepaymentMonth) badges+=`<span class="dh-deliv">💰 Предоплата: ${p.prepaymentMonth}</span>`;
  if(durLabel) badges+=`<span class="dh-deliv">⏱ Разработка: ${durLabel}</span>`;
  if(p.paymentStatus) badges+=`<span class="dh-pbadge">${p.paymentStatus==='Yes'?'✅':p.paymentStatus==='No'?'❌':'🟡'} ${p.paymentStatus}</span>`;
  if(p.profitShared) badges+=`<span class="dh-pbadge">${p.profitShared==='Да'?'✅':'⏳'} Профит: ${p.profitShared}</span>`;
  if(refAmt>0) badges+=`<span class="dh-deliv" style="background:rgba(167,139,250,.25)">🤝 Реферал: ${n(p.refPct)}% = $${fmt(refAmt)}</span>`;
  document.getElementById('dh-badges').innerHTML=badges;

  // Warranty row
  let warr='';
  if(p.deliveryMonth&&p.status==='Сдан'){
    warr=`<div class="warranty-row">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      Гарантийный период: ${p.deliveryMonth} → ${wEnd||'—'}
    </div>`;
  }
  document.getElementById('warranty-row').innerHTML=warr;

  const mc2=m>=75?'var(--green)':m>=55?'var(--amber)':'var(--red)';

  document.getElementById('dkpi').innerHTML=`
    <div class="kpi"><div class="kpi-l">Выручка</div><div class="kpi-v kv-blue">$${fmt(p.income)}</div>${p.dop>0?`<div class="kpi-s">+ $${fmt(p.dop)} правки</div>`:''}</div>
    <div class="kpi"><div class="kpi-l">Часов всего</div><div class="kpi-v">${fh(h)} ч</div><div class="kpi-s">${r}€/ч × ${gx()}$/€</div></div>
    <div class="kpi"><div class="kpi-l">Расход</div><div class="kpi-v">$${fmt(c)}</div></div>
    ${refKpi}
    <div class="kpi"><div class="kpi-l">Профит · маржа</div><div class="kpi-v kv-green">$${fmt(pr)}</div><div class="kpi-s" style="color:${mc2};font-weight:800">${Math.round(m*10)/10}%</div></div>`;

  const mxH=Math.max(...p.months.map(mo=>n(mo.hours)),1);
  document.getElementById('dmon').innerHTML=MONTHS.map(mName=>{
    const entry=p.months.find(x=>x.month===mName);
    const mh=entry?n(entry.hours):0;
    const mc3=mh*r*gx();
    const pct=Math.round(mh/mxH*100);
    const bc=mh>70?'#F05252':mh>25?'#F59E0B':'#0FC6BE';
    const z=mh===0;
    const isDeliv=p.deliveryMonth===mName;
    return`<tr class="${z?'zero':''}" style="${isDeliv?'background:#EFF6FF':''}">
      <td style="padding-left:20px">${mName}${isDeliv?` <span style="font-size:10px;color:#1E40AF;font-weight:800">📅 сдача</span>`:''}</td>
      <td class="r">${z?'—':fh(mh)+' ч'}</td>
      <td class="r">${z?'—':'$'+fmt(mc3)}</td>
      <td>${z?'':`<div class="mbi"><div class="mbit"><div class="mbif" style="width:${pct}%;background:${bc}"></div></div></div>`}</td>
    </tr>`;
  }).join('');

  const det=document.getElementById('det');
  det.style.display='block';
  setTimeout(()=>det.scrollIntoView({behavior:'smooth',block:'start'}),50);
}

function setC(c){fClient=c;closeD();render();closeDrawer()}
function setT(t){fType=t;closeD();render()}
function setSt(s){fStatus=s;closeD();render()}
function reset(){
  fClient='Все';fType='Все';fStatus='Все';
  document.getElementById('search').value='';
  document.getElementById('fmin').value='';
  document.getElementById('fmax').value='';
  closeD();render();
}

function render(){
  renderNav();renderTypes();renderStatusPills();renderCards();renderTable();
}

// ─── MODAL ─────────────────────────────────────────────────────
function openAdd(){
  eid=null;
  document.getElementById('mtitle').textContent='Добавить проект';
  ['fs','fc','ft'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fi').value='';
  document.getElementById('fi-preview').textContent='';
  document.getElementById('fi-preview').className='fi-preview';
  document.getElementById('fd').value='';
  document.getElementById('frefpct').value='';
  document.getElementById('fw').checked=false;
  document.getElementById('fstatus').value='';
  document.getElementById('fpayment').value='';
  document.getElementById('fprofitshared').value='';
  document.getElementById('ferr').textContent='';
  fillDeliverySelect('');
  document.getElementById('fpaymonth').value='';
  document.getElementById('fprepaymonth').value='';
  buildM(null);
  document.getElementById('ov').classList.add('open');
  setTimeout(()=>document.getElementById('fs').focus(),150);
}

function openEdit(){
  const p=P.find(x=>x.id===aid);if(!p)return;
  eid=p.id;
  document.getElementById('mtitle').textContent='Редактировать проект';
  document.getElementById('fs').value=p.site;
  document.getElementById('fc').value=p.client;
  document.getElementById('ft').value=p.type||'';
  document.getElementById('fi').value=p.income;
  onIncomeInput();
  document.getElementById('fd').value=p.dop||'';
  document.getElementById('frefpct').value=p.refPct||'';
  document.getElementById('fw').checked=!!p.warn;
  document.getElementById('fstatus').value=p.status||'';
  document.getElementById('fpayment').value=p.paymentStatus||'';
  document.getElementById('fprofitshared').value=p.profitShared||'';
  document.getElementById('ferr').textContent='';
  fillDeliverySelect(p.deliveryMonth||'');
  document.getElementById('fpaymonth').value=p.paymentMonth||'';
  document.getElementById('fprepaymonth').value=p.prepaymentMonth||'';
  buildM(p);
  document.getElementById('ov').classList.add('open');
}

function closeM(){document.getElementById('ov').classList.remove('open')}
function ovc(e){if(e.target===document.getElementById('ov'))closeM()}

function save(){
  const site=document.getElementById('fs').value.trim();
  const client=document.getElementById('fc').value.trim();
  const incomeRaw=document.getElementById('fi').value;
  const income=evalIncome(incomeRaw);
  if(!site){document.getElementById('ferr').textContent='Укажи домен';return}
  if(!client){document.getElementById('ferr').textContent='Укажи клиента';return}
  if(income===null||income<0){document.getElementById('ferr').textContent='Укажи корректный доход';return}
  const months=MONTHS.map((m,i)=>({month:m,hours:n(parseFloat(document.getElementById('mh'+i).value)||0)}));
  const obj={
    id:eid||uid(),site,client,
    type:document.getElementById('ft').value.trim(),
    income,
    dop:n(parseFloat(document.getElementById('fd').value)||0),
    refPct:n(parseFloat(document.getElementById('frefpct').value)||0),
    warn:document.getElementById('fw').checked,
    status:document.getElementById('fstatus').value,
    deliveryMonth:document.getElementById('fdelivery').value,
    prepaymentMonth:document.getElementById('fprepaymonth').value,
    paymentMonth:document.getElementById('fpaymonth').value,
    paymentStatus:document.getElementById('fpayment').value,
    profitShared:document.getElementById('fprofitshared').value,
    months
  };
  if(eid){const i=P.findIndex(p=>p.id===eid);if(i>=0)P[i]=obj;}
  else P.push(obj);
  persist();closeM();aid=eid?obj.id:null;render();if(aid)renderDet();
}

function askDel(){
  const p=P.find(x=>x.id===aid);if(!p)return;
  did=p.id;
  document.getElementById('ctxt').textContent=`Удалить «${p.site}»? Нельзя отменить.`;
  document.getElementById('cov').classList.add('open');
}
function closeC(){document.getElementById('cov').classList.remove('open');did=null}
function doDel(){P=P.filter(p=>p.id!==did);persist();closeC();closeD();render();}

// ─── EXPORT / IMPORT ─────────────────────────────────────────
function exportData(){
  const data={projects:P,months:MONTHS,rate:gr(),eurRate:gx(),exportedAt:new Date().toISOString()};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`webdev-${new Date().toISOString().slice(0,10)}.json`;
  a.click();URL.revokeObjectURL(a.href);
  toast('Данные экспортированы');
}
function triggerImport(){document.getElementById('imp-input').click()}
function importData(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async ev=>{
    try{
      const data=JSON.parse(ev.target.result);
      if(data.projects&&Array.isArray(data.projects)){
        P=data.projects;
        if(data.months) MONTHS=data.months;
        if(data.rate) document.getElementById('rate').value=data.rate;
        if(data.eurRate) document.getElementById('eurrate').value=data.eurRate;
        P.forEach(p=>{p.months=normMonths(p.months);});
        await persist();closeD();render();
        toast(`Импортировано ${P.length} проектов`);
      }else toast('Неверный формат');
    }catch(err){toast('Ошибка: '+err.message);}
  };
  reader.readAsText(file);
  e.target.value='';
}

// ─── QUICK EDIT PAYMENT MONTH ────────────────────────────────
function quickEditPayment(id){
  aid = id;
  openEdit();
  // After modal opens, scroll to and highlight the payment month field
  setTimeout(()=>{
    const el = document.getElementById('fpaymonth');
    if(el){
      el.style.borderColor = 'var(--teal)';
      el.style.background = '#E0FAF9';
      el.scrollIntoView({behavior:'smooth', block:'center'});
      el.focus();
    }
  }, 200);
}

// ─── TABS ────────────────────────────────────────────────────
let currentTab = 'projects';
let monthlyChart = null;

function switchTab(tab) {
  currentTab = tab;
  document.getElementById('view-projects').classList.toggle('hidden', tab !== 'projects');
  document.getElementById('view-monthly').classList.toggle('active', tab === 'monthly');
  document.getElementById('tab-projects').classList.toggle('on', tab === 'projects');
  document.getElementById('tab-monthly').classList.toggle('on', tab === 'monthly');
  if (tab === 'monthly') renderMonthly();
}

// ─── MONTHLY ANALYTICS ───────────────────────────────────────
function computeMonthly() {
  const rate = gr(), x = gx();
  const stats = {};
  MONTHS.forEach(m => { stats[m] = {income:0, expense:0, projects:[]}; });

  P.forEach(p => {
    // Расход: часы × ставка€ × курс → $
    (p.months || []).forEach(m => {
      if (stats[m.month]) stats[m.month].expense += n(m.hours) * rate * x;
    });
    // Доход: привязываем к месяцу получения оплаты (не к сдаче)
    const incomeMonth = p.paymentMonth || p.deliveryMonth; // fallback на сдачу если не указан
    if (incomeMonth && stats[incomeMonth]) {
      stats[incomeMonth].income += p.income;
      stats[incomeMonth].projects.push(p.site);
    }
  });
  return stats;
}

function renderMonthly() {
  const stats = computeMonthly();
  const rate = gr();

  const labels = MONTHS;
  const incomeData = MONTHS.map(m => Math.round(stats[m].income));
  const expenseData = MONTHS.map(m => Math.round(stats[m].expense));
  const profitData = MONTHS.map((m,i) => incomeData[i] - expenseData[i]);

  // Count projects without paymentMonth (not tracked in chart)
  const noDeliv = P.filter(p => !p.paymentMonth && !p.deliveryMonth);

  // Update chart
  const ctx = document.getElementById('monthly-chart').getContext('2d');
  if (monthlyChart) monthlyChart.destroy();
  monthlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Доход',
          data: incomeData,
          backgroundColor: 'rgba(15,196,122,.75)',
          borderColor: '#0FC47A',
          borderWidth: 1.5,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Расход',
          data: expenseData,
          backgroundColor: 'rgba(240,82,82,.65)',
          borderColor: '#F05252',
          borderWidth: 1.5,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Профит',
          data: profitData,
          type: 'line',
          borderColor: '#2E86C1',
          backgroundColor: 'rgba(46,134,193,.1)',
          borderWidth: 2.5,
          pointBackgroundColor: '#2E86C1',
          pointRadius: 4,
          tension: 0.35,
          fill: false,
          yAxisID: 'y',
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {mode: 'index', intersect: false},
      plugins: {
        legend: {
          position: 'top',
          labels: {
            font: {family:'Nunito', weight:'700', size:12},
            usePointStyle: true,
            padding: 16,
          }
        },
        tooltip: {
          backgroundColor: '#1A2B3C',
          titleFont: {family:'Nunito', weight:'700'},
          bodyFont: {family:'Nunito'},
          padding: 12,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString('ru-RU')}`
          }
        }
      },
      scales: {
        x: {
          grid: {color: '#DFF0EF'},
          ticks: {font: {family:'Nunito', weight:'700', size:11}}
        },
        y: {
          grid: {color: '#DFF0EF'},
          ticks: {
            font: {family:'Nunito', size:11},
            callback: v => '$' + v.toLocaleString('ru-RU')
          }
        }
      }
    }
  });

  // Render table
  let totIncome=0, totExpense=0;
  document.getElementById('monthly-tbody').innerHTML = MONTHS.map(m => {
    const {income, expense, projects} = stats[m];
    const profit = income - expense;
    const margin = income > 0 ? Math.round(profit/income*1000)/10 : null;
    const pc = profit >= 0 ? 'pos' : 'neg';
    totIncome += income; totExpense += expense;
    return `<tr>
      <td style="font-weight:800">${m}</td>
      <td class="r">${income > 0 ? '$'+fmt(income) : '<span style="color:var(--text3)">—</span>'}</td>
      <td class="r">${expense > 0 ? '$'+fmt(expense) : '<span style="color:var(--text3)">—</span>'}</td>
      <td class="r ${income>0||expense>0?pc:''}">${income>0||expense>0 ? '$'+fmt(profit) : '<span style="color:var(--text3)">—</span>'}</td>
      <td class="r">${margin !== null ? margin+'%' : '<span style="color:var(--text3)">—</span>'}</td>
      <td style="font-size:12px;color:var(--text2)">${projects.length ? projects.join(', ') : ''}</td>
    </tr>`;
  }).join('') + `<tr class="total-row">
    <td>ИТОГО</td>
    <td class="r">$${fmt(totIncome)}</td>
    <td class="r">$${fmt(totExpense)}</td>
    <td class="r ${totIncome-totExpense>=0?'pos':'neg'}">$${fmt(totIncome-totExpense)}</td>
    <td class="r">${totIncome>0?Math.round((totIncome-totExpense)/totIncome*1000)/10+'%':''}</td>
    <td></td>
  </tr>`;

  // Note about projects without payment month
  const noteEl = document.getElementById('no-deliv-note');
  if (noDeliv.length > 0) {
    noteEl.style.display = 'block';
    const links = noDeliv.map(p =>
      `<button onclick="quickEditPayment('${p.id}')" style="background:var(--white);border:1.5px solid var(--border2);border-radius:8px;padding:3px 10px;font-size:11px;font-weight:700;color:var(--teal2);cursor:pointer;font-family:Nunito,sans-serif;transition:all .15s" onmouseover="this.style.background='var(--green-bg)'" onmouseout="this.style.background='var(--white)'">${p.site} ✏️</button>`
    ).join(' ');
    noteEl.innerHTML = `⚠ Не указан месяц оплаты — доход не учтён в графике:<br><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${links}</div>`;
  } else {
    noteEl.style.display = 'none';
  }
}

// ─── DRAWER ──────────────────────────────────────────────────
function openDrawer(){
  document.getElementById('sb').classList.add('drawer-open');
  document.getElementById('drawer-ov').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeDrawer(){
  document.getElementById('sb').classList.remove('drawer-open');
  document.getElementById('drawer-ov').classList.remove('open');
  document.body.style.overflow='';
}

// ─── TOAST ───────────────────────────────────────────────────
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2500);
}

// ─── EVENTS ──────────────────────────────────────────────────
document.getElementById('rate').addEventListener('input',()=>{persist();render();if(aid)renderDet();});
document.getElementById('eurrate').addEventListener('input',()=>{persist();render();if(aid)renderDet();});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if(document.getElementById('cov').classList.contains('open')) closeC();
    else if(document.getElementById('ov').classList.contains('open')) closeM();
    else if(document.getElementById('sb').classList.contains('drawer-open')) closeDrawer();
    else if(aid) closeD();
  }
});


// ─── INCOME CALCULATOR ──────────────────────────────────────────
// Safe expression evaluator: only numbers, +, -, *, /, (, ), spaces, dots
function evalIncome(raw){
  if(!raw||!raw.toString().trim()) return null;
  const s=raw.toString().replace(/,/g,'.').trim();
  // If plain number
  if(/^\d+(\.\d+)?$/.test(s)){const v=parseFloat(s);return isNaN(v)?null:v;}
  // If expression with allowed chars only
  if(!/^[\d\s+\-*/(). ]+$/.test(s)) return null;
  try{
    // eslint-disable-next-line no-new-func
    const v=Function('"use strict";return('+s+')')();
    return typeof v==='number'&&isFinite(v)?Math.round(v*100)/100:null;
  }catch(e){return null;}
}

function onIncomeInput(){
  const raw=document.getElementById('fi').value;
  const prev=document.getElementById('fi-preview');
  if(!raw.trim()){prev.textContent='';prev.className='fi-preview';return;}
  // Check if it's an expression (has operators)
  if(/[+\-*/]/.test(raw)){
    const v=evalIncome(raw);
    if(v!==null){
      prev.textContent='= $'+v.toLocaleString('ru-RU');
      prev.className='fi-preview ok';
    }else{
      prev.textContent='Некорректное выражение';
      prev.className='fi-preview err';
    }
  }else{
    const v=parseFloat(raw.replace(',','.'));
    if(!isNaN(v)){
      prev.textContent='$'+v.toLocaleString('ru-RU');
      prev.className='fi-preview plain';
    }else{
      prev.textContent='Некорректное значение';
      prev.className='fi-preview err';
    }
  }
}

function onIncomeBlur(){
  // Don't collapse expression — keep as-is so user can edit
}

// ── Mini popup calculator ──
function toggleCalcPopup(e){
  e.stopPropagation();
  const popup=document.getElementById('calc-popup');
  const isOpen=popup.classList.contains('open');
  if(isOpen){popup.classList.remove('open');return;}
  // Init with current fi value as first line
  const cur=document.getElementById('fi').value;
  const curVal=evalIncome(cur);
  document.getElementById('calc-lines').innerHTML='';
  calcLineCount=0;
  addCalcLine(curVal!==null&&curVal>0?curVal:'');
  addCalcLine('');
  updateCalcTotal();
  popup.classList.add('open');
  // Close on outside click
  setTimeout(()=>document.addEventListener('click',closeCalcOutside,{once:true}),10);
}

function closeCalcOutside(e){
  const popup=document.getElementById('calc-popup');
  if(!popup.contains(e.target)&&popup.classList.contains('open')){
    popup.classList.remove('open');
  }
}

let calcLineCount=0;
function addCalcLine(val=''){
  const id='cl'+calcLineCount++;
  const div=document.createElement('div');
  div.className='calc-line';
  div.id='cld'+id;
  div.innerHTML=`<input type="text" id="${id}" placeholder="сумма" value="${val}" oninput="updateCalcTotal()">
    <button class="rm" type="button" onclick="removeCalcLine('cld${id}')">✕</button>`;
  document.getElementById('calc-lines').appendChild(div);
  setTimeout(()=>{const el=document.getElementById(id);if(el)el.focus();},50);
  updateCalcTotal();
}

function removeCalcLine(lineId){
  const el=document.getElementById(lineId);
  if(el){el.remove();updateCalcTotal();}
}

function updateCalcTotal(){
  const inputs=document.querySelectorAll('#calc-lines input');
  let total=0;
  inputs.forEach(inp=>{
    const v=evalIncome(inp.value);
    if(v!==null) total+=v;
  });
  document.getElementById('calc-total-val').textContent='$'+Math.round(total).toLocaleString('ru-RU');
}

function applyCalc(){
  const inputs=document.querySelectorAll('#calc-lines input');
  const parts=[];
  let total=0;
  inputs.forEach(inp=>{
    const raw=inp.value.trim();
    if(!raw) return;
    const v=evalIncome(raw);
    if(v!==null){parts.push(raw);total+=v;}
  });
  const fi=document.getElementById('fi');
  if(parts.length===1){
    fi.value=evalIncome(parts[0]);
  }else if(parts.length>1){
    fi.value=parts.join('+');
  }
  document.getElementById('calc-popup').classList.remove('open');
  onIncomeInput();
}

checkAuth();
