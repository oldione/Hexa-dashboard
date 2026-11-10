#!/usr/bin/env node
// Миграция webdev/dashboard со схемы v1 на v2 со сверкой сумм до цента.
//   node scripts/migrate.mjs --in old.json --out new.json     — пробный прогон на файле
//   node scripts/migrate.mjs --live --backup b.json --write   — боевой: бэкап, миграция, запись
import fs from 'fs';
import '../../core.js';
import * as store from '../src/store.js';
const C = globalThis.HexaCore;

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const has = k => process.argv.includes(k);

// Решения по ТЗ (раздел «Миграция») и ответы владельца
const OVERRIDES = {
  // Витрины Banking: получена предоплата 50%, полная цена — 2 × 2101
  fullInvoice: { 'key-hub.online': 4202, 'mine-block.shop': 4202, 'gameplace.tech': 4202, 'playkeys.online': 4202 },
  // Реальные часы из ТЗ (вместо эквивалентных «сумма ÷ 20»)
  hoursSplit: {
    'key-hub.online':  { month: 'Окт 26', parts: [{ hours: 41, rate: 20, kind: 'dev' }, { hours: 51, rate: 15, kind: 'cost' }] },
    'mine-block.shop': { month: 'Окт 26', parts: [{ hours: 41.5, rate: 20, kind: 'dev' }, { hours: 35.5, rate: 15, kind: 'cost' }] },
    'gameplace.tech':  { month: 'Окт 26', parts: [{ hours: 41, rate: 20, kind: 'dev' }, { hours: 44, rate: 15, kind: 'cost' }] },
    'playkeys.online': { month: 'Окт 26', parts: [{ hours: 41, rate: 20, kind: 'dev' }, { hours: 11.5, rate: 15, kind: 'cost' }] },
  },
  inherited: ['steamerspay.com', 'skinportfun.com'],
  originUnknown: ['travelmasters.kz', 'gearmikey.com', 'angrybloxx.com', 'zombifycraft.com'],
  typeAliases: { 'Game keys': 'Game key', 'Landing': 'landing' },
};

// ─── Старый расчёт (v1), как в app.js до рефакторинга ─────────
function oldCalc(old) {
  const n = C.n, rate = n(old.rate) || 20, x = n(old.eurRate) || 1.08, delay = parseInt(old.expDelay) || 0;
  const per = {}, monthly = Object.fromEntries((old.months || []).map(m => [m, { income: 0, expense: 0 }]));
  for (const p of old.projects) {
    const h = (p.months || []).reduce((s, m) => s + n(m.hours), 0);
    const exp = h * rate * x, inc = n(p.income);
    per[p.id] = { site: p.site, income: inc, expense: exp, profit: inc - exp - n(p.dop) - inc * n(p.refPct) / 100 };
    for (const m of p.months || []) {
      const t = delay ? C.shiftMonth(m.month, delay) : m.month;
      if (monthly[t]) monthly[t].expense += n(m.hours) * rate * x;
      if (n(m.extraIncome) > 0) { const im = monthly[t] ? t : m.month; if (monthly[im]) monthly[im].income += n(m.extraIncome); }
    }
    const prep = Math.max(0, n(p.prepaymentAmt)), incM = p.paymentMonth || p.deliveryMonth || '', prepM = p.prepaymentMonth || incM;
    if (prepM && monthly[prepM] && prep > 0) monthly[prepM].income += prep;
    if (incM && monthly[incM] && inc - prep > 0) monthly[incM].income += inc - prep;
  }
  return { per, monthly };
}

function reconcile(old, data) {
  const o = oldCalc(old), errs = [];
  const cent = (a, b) => Math.abs(C.r2(a) - C.r2(b)) < 0.005;
  let T = { oi: 0, ni: 0, oe: 0, ne: 0, op: 0, np: 0 };
  for (const p of data.projects) {
    const s = C.projectStats(data, p), q = o.per[p.id];
    T.oi += q.income; T.ni += s.received; T.oe += q.expense; T.ne += s.expense; T.op += q.profit; T.np += s.profit;
    for (const [k, a, b] of [['доход', q.income, s.received], ['расход', q.expense, s.expense], ['прибыль', q.profit, s.profit]])
      if (!cent(a, b)) errs.push(`${p.site}: ${k} было ${C.r2(a)}, стало ${b}`);
  }
  for (const m of C.monthlyStats(data)) {
    const q = o.monthly[m.month];
    if (!cent(q.income, m.received)) errs.push(`${m.month}: доход было ${C.r2(q.income)}, стало ${m.received}`);
    if (!cent(q.expense, m.expense)) errs.push(`${m.month}: расход было ${C.r2(q.expense)}, стало ${m.expense}`);
  }
  // Ожидаемое отклонение: проекты с реальной разбивкой часов, где в старых данных часы были округлены.
  // Допуск — 0,10 € × курс на проект; всё прочее должно совпасть до цента.
  const tol = Object.keys(OVERRIDES.hoursSplit).length * 0.1 * (C.n(old.eurRate) || 1) + 0.005;
  const expected = [], hard = [];
  for (const e of errs) {
    const site = e.split(':')[0];
    const m = /было (-?[\d.]+), стало (-?[\d.]+)/.exec(e);
    const d = m ? Math.abs(+m[1] - +m[2]) : Infinity;
    const isSite = !!OVERRIDES.hoursSplit[site];
    const isMonth = Object.values(OVERRIDES.hoursSplit).some(x => x.month === site);
    const ok = !/доход/.test(e) && ((isSite && d <= 0.13) || (isMonth && d <= tol));
    (ok ? expected : hard).push(e);
  }
  for (const [k, a, b] of [['доход', T.oi, T.ni], ['расход', T.oe, T.ne], ['прибыль', T.op, T.np]]) {
    if (cent(a, b)) continue;
    const d = Math.abs(a - b);
    (k !== 'доход' && d <= tol ? expected : hard).push(`ИТОГО ${k}: было ${C.r2(a)}, стало ${C.r2(b)} (Δ ${C.r2(b - a)})`);
  }
  return { errs: hard, expected, totals: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, C.r2(v)])) };
}

// ─── main ─────────────────────────────────────────────────────
let old, updateTime;
if (has('--live')) {
  const r = await fetch(store.DOC_URL + '?key=' + store.API_KEY); // сырой документ ради updateTime
  if (!r.ok) throw new Error('read ' + r.status);
  const raw = await r.json();
  updateTime = raw.updateTime;
  old = store.decodeFields(raw.fields || {});
  const bk = arg('--backup');
  if (!bk) throw new Error('--live требует --backup <file>');
  fs.writeFileSync(bk, JSON.stringify(raw));
  console.log('бэкап сырого документа:', bk, 'updateTime', updateTime);
} else {
  old = JSON.parse(fs.readFileSync(arg('--in'), 'utf8'));
}
if (old.schemaVersion >= 2) { console.log('Документ уже в схеме v2 — миграция не нужна.'); process.exit(0); }

const { data, log } = C.migrateV1(old, OVERRIDES);
data.updatedAt = new Date().toISOString();
data.migratedAt = data.updatedAt;
const rec = reconcile(old, data);

console.log(`\nпроектов ${data.projects.length}, записей часов ${data.hours.length}, счетов ${data.invoices.length}, поступлений ${data.payments.length}`);
console.log(`заказчиков ${data.clients.length}: ${data.clients.map(c => c.name).join(', ')}`);
console.log(`типов ${data.types.length}: ${data.types.map(c => c.name).join(', ')}`);
console.log('происхождение:', JSON.stringify(data.projects.reduce((a, p) => (a[p.origin || '(вручную)'] = (a[p.origin || '(вручную)'] || 0) + 1, a), {})));
console.log('\nкорректировки:'); log.forEach(l => console.log('  ' + l));
console.log('\nсверка итогов:', JSON.stringify(rec.totals));
if (rec.expected.length) console.log('ℹ ожидаемые отклонения (округление часов в старых данных):\n  ' + rec.expected.join('\n  '));
console.log(rec.errs.length ? '❌ РАСХОЖДЕНИЯ:\n  ' + rec.errs.join('\n  ') : '✅ остальные проекты, месяцы и итоги совпадают до цента');
console.log('размер документа ~', Math.round(JSON.stringify(data).length / 1024), 'КБ (лимит Firestore 1024)');
if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify(data, null, 1));

if (has('--write')) {
  if (rec.errs.length) { console.error('Запись отменена: есть расхождения.'); process.exit(1); }
  await store.writeRaw(data, updateTime);
  console.log('✅ записано в Firestore');
}
