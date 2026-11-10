// Общая логика MCP-инструментов дашборда — используется и локальным (stdio)
// сервером, и облачным (Cloudflare Worker). Хранилище передаётся снаружи.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// ─── КОНСТАНТЫ И ХЕЛПЕРЫ (зеркало app.js) ─────────────────────
const RU_M = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const STATUSES = ['Сдан', 'В работе', 'Холд', 'На проверке', 'Обсуждение'];
const PAY_STATUSES = ['Yes', 'partially paid', 'No'];
const SHARED = ['Да', 'Нет'];

const n = v => (isNaN(+v) ? 0 : +v);
const round2 = v => Math.round(v * 100) / 100;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

function shiftMonth(monthStr, delta) {
  if (!monthStr) return monthStr;
  const [mon, yr] = monthStr.split(' ');
  const mi = RU_M.indexOf(mon);
  if (mi < 0) return monthStr;
  const total = mi + delta;
  const newMi = ((total % 12) + 12) % 12;
  const newYr = parseInt(yr) + Math.floor(total / 12);
  return `${RU_M[newMi]} ${String(newYr).padStart(2, '0')}`;
}

// Безопасный калькулятор для дохода ("5000+1000", "(3000+500)*2") — без eval,
// т.к. Cloudflare Workers запрещают Function()/eval.
function evalIncome(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw).replace(/\s+/g, '');
  if (!s || !/^[\d+\-*/().]+$/.test(s)) return null;
  let i = 0;
  const peek = () => s[i];
  function num() {
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(s.slice(i));
    if (!m) throw 0;
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function factor() {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') { i++; const v = expr(); if (s[i++] !== ')') throw 0; return v; }
    return num();
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') { const op = s[i++]; const r = factor(); v = op === '*' ? v * r : v / r; }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  try {
    const v = expr();
    return i === s.length && Number.isFinite(v) ? round2(v) : null;
  } catch { return null; }
}

function normMonths(MONTHS, existing) {
  const map = new Map((existing || []).map(m => [m.month, m]));
  return MONTHS.map(m => {
    const e = map.get(m) || {};
    return { month: m, hours: n(e.hours || 0), extraIncome: n(e.extraIncome || 0) };
  });
}

function settingsOf(data) {
  return {
    rate: n(data.rate) || 20,
    eurRate: n(data.eurRate) || 1.08,
    expDelay: parseInt(data.expDelay) || 0,
  };
}

function calc(p, s) {
  const h = (p.months || []).reduce((acc, m) => acc + n(m.hours), 0);
  const c = h * s.rate * s.eurRate;
  const ref = n(p.refPct) > 0 ? (p.income * n(p.refPct)) / 100 : 0;
  const pr = p.income - c - n(p.dop) - ref;
  const extra = (p.months || []).reduce((acc, m) => acc + n(m.extraIncome), 0);
  return {
    hours: round2(h),
    expense: round2(c),
    referral: round2(ref),
    profit: round2(pr),
    marginPct: p.income > 0 ? round2((pr / p.income) * 100) : 0,
    extraIncomeTotal: round2(extra),
  };
}

// Зеркало incomeSplit() из app.js: предоплата без месяца падает в месяц оплаты/сдачи.
function incomeSplit(p) {
  const prep = Math.max(0, n(p.prepaymentAmt));
  const incomeMonth = p.paymentMonth || p.deliveryMonth || '';
  const prepMonth = p.prepaymentMonth || incomeMonth;
  const remaining = Math.max(0, n(p.income) - prep);
  const unassigned = (prepMonth ? 0 : prep) + (incomeMonth ? 0 : remaining);
  return { prep, prepMonth, remaining, incomeMonth, unassigned };
}

function computeMonthly(data) {
  const s = settingsOf(data);
  const MONTHS = data.months || [];
  const stats = {};
  MONTHS.forEach(m => { stats[m] = { income: 0, expense: 0, projects: [] }; });
  const touch = (m, site) => { if (!stats[m].projects.includes(site)) stats[m].projects.push(site); };

  (data.projects || []).forEach(p => {
    (p.months || []).forEach(m => {
      const shifted = s.expDelay > 0 ? shiftMonth(m.month, s.expDelay) : m.month;
      if (stats[shifted]) stats[shifted].expense += n(m.hours) * s.rate * s.eurRate;
      if (n(m.extraIncome) > 0) {
        const incMonth = stats[shifted] ? shifted : m.month;
        if (stats[incMonth]) { stats[incMonth].income += n(m.extraIncome); touch(incMonth, p.site); }
      }
    });
    const sp = incomeSplit(p);
    if (sp.prepMonth && stats[sp.prepMonth] && sp.prep > 0) {
      stats[sp.prepMonth].income += sp.prep; touch(sp.prepMonth, p.site);
    }
    if (sp.incomeMonth && stats[sp.incomeMonth] && sp.remaining > 0) {
      stats[sp.incomeMonth].income += sp.remaining; touch(sp.incomeMonth, p.site);
    }
  });

  return MONTHS.map(m => ({
    month: m,
    income: Math.round(stats[m].income),
    expense: Math.round(stats[m].expense),
    profit: Math.round(stats[m].income) - Math.round(stats[m].expense),
    projects: stats[m].projects,
  }));
}

function findProject(projects, ref) {
  const q = String(ref).trim().toLowerCase();
  const exact = projects.find(p => p.id === ref || (p.site || '').toLowerCase() === q);
  if (exact) return exact;
  const partial = projects.filter(p => (p.site || '').toLowerCase().includes(q) || (p.id || '').toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`Неоднозначно: «${ref}» подходит к ${partial.map(p => p.site).join(', ')}`);
  throw new Error(`Проект «${ref}» не найден. Есть: ${projects.map(p => p.site).join(', ')}`);
}

function checkMonth(MONTHS, m, field) {
  if (m && !MONTHS.includes(m)) {
    throw new Error(`${field}: месяц «${m}» отсутствует в дашборде. Доступны: ${MONTHS.join(', ')}. Добавь его через add_month.`);
  }
}

// ─── ЧТЕНИЕ / ЗАПИСЬ ──────────────────────────────────────────
function normalize(data) {
  data.months = data.months || [];
  data.projects = (data.projects || []).map(p => ({ ...p, months: normMonths(data.months, p.months) }));
  return data;
}

function makeIO(store) {
  return {
    load: async () => normalize(await store.load()),
    // Применяет fn к свежим данным и пишет документ целиком (как persist() в app.js).
    mutate: fn => store.mutate(raw => {
      const data = normalize(raw); // normalize мутирует raw и возвращает его же
      const before = { projects: data.projects.length, months: data.months.length };
      const result = fn(data);
      const out = {
        projects: data.projects,
        months: data.months,
        rate: data.rate ?? 20,
        eurRate: data.eurRate ?? 1.08,
        expDelay: data.expDelay ?? 0,
        updatedAt: new Date().toISOString(),
      };
      // Предохранитель от порчи данных: ни одна операция не убирает месяцы
      // и не удаляет больше одного проекта за раз.
      if (!Array.isArray(out.projects) || !Array.isArray(out.months) ||
          out.months.length < before.months || out.projects.length < before.projects - 1) {
        throw new Error('Отмена записи: операция привела бы к потере данных.');
      }
      for (const k of Object.keys(raw)) delete raw[k];
      Object.assign(raw, out);
      return result;
    }),
  };
}

function projectView(p, s, withMonths = true) {
  const out = {
    id: p.id, site: p.site, client: p.client, type: p.type || '',
    status: p.status || '', income: p.income, dop: n(p.dop), refPct: n(p.refPct),
    warn: !!p.warn,
    deliveryMonth: p.deliveryMonth || '', prepaymentMonth: p.prepaymentMonth || '',
    prepaymentAmt: n(p.prepaymentAmt), paymentMonth: p.paymentMonth || '',
    paymentStatus: p.paymentStatus || '', profitShared: p.profitShared || '',
    note: p.note || '',
    ...calc(p, s),
  };
  if (withMonths) out.months = (p.months || []).filter(m => n(m.hours) > 0 || n(m.extraIncome) > 0);
  return out;
}

const ok = obj => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const wrap = fn => async args => {
  try { return await fn(args); }
  catch (e) { return { isError: true, content: [{ type: 'text', text: '⚠ ' + e.message }] }; }
};

// ─── MCP SERVER ───────────────────────────────────────────────
export function createServer(store) {
const { load, mutate } = makeIO(store);
const server = new McpServer({ name: 'hexa-dashboard', version: '1.1.0' }, {
  instructions:
    'Дашборд фриланс веб-проектов. Деньги в USD (доход в USDT). ' +
    'Расход = часы × ставка(€/ч) × курс($/€). Прибыль = доход − расход − доп.расходы − реферал(доход×refPct%). ' +
    'Месяцы — строки вида "Авг 25" (Янв Фев Мар Апр Май Июн Июл Авг Сен Окт Ноя Дек + 2 цифры года). ' +
    'Проект можно указывать по id или домену (site), допускается часть домена. ' +
    'Перед удалением проекта всегда переспрашивай пользователя.',
});

const monthField = z.string().describe('Месяц в формате "Авг 25"');
const projectRef = z.string().describe('id проекта или домен (можно часть, напр. "zumboo")');

server.registerTool('get_overview', {
  title: 'Обзор дашборда',
  description: 'Настройки (ставка, курс, сдвиг расходов), список месяцев и итоги по всем проектам.',
  inputSchema: {},
}, wrap(async () => {
  const data = await load();
  const s = settingsOf(data);
  const rows = data.projects.map(p => projectView(p, s, false));
  const sum = k => round2(rows.reduce((a, r) => a + n(r[k]), 0));
  return ok({
    settings: s,
    months: data.months,
    updatedAt: data.updatedAt,
    totals: { projects: rows.length, income: sum('income'), expense: sum('expense'), dop: sum('dop'), referral: sum('referral'), profit: sum('profit'), hours: sum('hours') },
    byStatus: STATUSES.map(st => ({ status: st, count: rows.filter(r => r.status === st).length })),
  });
}));

server.registerTool('list_projects', {
  title: 'Список проектов',
  description: 'Список проектов с расчётом часов, расхода и прибыли. Фильтры необязательны.',
  inputSchema: {
    client: z.string().optional().describe('Фильтр по клиенту (без учёта регистра, подстрока)'),
    status: z.enum(STATUSES).optional(),
    type: z.string().optional().describe('Фильтр по типу (подстрока)'),
    paymentStatus: z.enum(PAY_STATUSES).optional(),
    search: z.string().optional().describe('Поиск по домену/клиенту/типу'),
  },
}, wrap(async ({ client, status, type, paymentStatus, search }) => {
  const data = await load();
  const s = settingsOf(data);
  const has = (v, q) => (v || '').toLowerCase().includes(q.toLowerCase());
  const list = data.projects.filter(p =>
    (!client || has(p.client, client)) &&
    (!status || p.status === status) &&
    (!type || has(p.type, type)) &&
    (!paymentStatus || p.paymentStatus === paymentStatus) &&
    (!search || has(p.site, search) || has(p.client, search) || has(p.type, search)));
  return ok(list.map(p => projectView(p, s, false)));
}));

server.registerTool('get_project', {
  title: 'Проект',
  description: 'Полные данные одного проекта, включая часы и доплаты по месяцам.',
  inputSchema: { project: projectRef },
}, wrap(async ({ project }) => {
  const data = await load();
  return ok(projectView(findProject(data.projects, project), settingsOf(data)));
}));

const projectFields = {
  client: z.string().optional(),
  type: z.string().optional(),
  income: z.union([z.number(), z.string()]).optional().describe('Доход в USDT: число или выражение "5000+1000"'),
  dop: z.number().optional().describe('Доп. расходы, $'),
  refPct: z.number().min(0).max(100).optional().describe('% реферала партнёру'),
  warn: z.boolean().optional().describe('Флаг-предупреждение'),
  status: z.enum(STATUSES).optional(),
  deliveryMonth: z.string().optional().describe('Месяц сдачи ("" — сбросить)'),
  prepaymentMonth: z.string().optional().describe('Месяц предоплаты ("" — сбросить)'),
  prepaymentAmt: z.number().optional().describe('Сумма предоплаты, $'),
  paymentMonth: z.string().optional().describe('Месяц оплаты остатка ("" — сбросить)'),
  paymentStatus: z.enum(PAY_STATUSES).optional(),
  profitShared: z.enum(SHARED).optional().describe('Прибыль поделена'),
  note: z.string().optional().describe('Заметка по проекту (заменяет текущую целиком; "" — очистить)'),
};

function applyFields(p, f, MONTHS) {
  for (const k of ['deliveryMonth', 'prepaymentMonth', 'paymentMonth']) {
    if (f[k] !== undefined) checkMonth(MONTHS, f[k], k);
  }
  if (f.income !== undefined) {
    const v = evalIncome(f.income);
    if (v === null || v < 0) throw new Error(`Некорректный доход: ${f.income}`);
    p.income = v;
  }
  for (const k of ['client', 'type', 'status', 'deliveryMonth', 'prepaymentMonth', 'paymentMonth', 'paymentStatus', 'profitShared', 'warn', 'note']) {
    if (f[k] !== undefined) p[k] = f[k];
  }
  for (const k of ['dop', 'refPct', 'prepaymentAmt']) {
    if (f[k] !== undefined) p[k] = n(f[k]);
  }
}

server.registerTool('add_project', {
  title: 'Добавить проект',
  description: 'Создаёт новый проект. Обязательны site, client, income.',
  inputSchema: {
    site: z.string().describe('Домен, напр. "example.com"'),
    ...projectFields,
    client: z.string(),
    income: z.union([z.number(), z.string()]).describe('Доход в USDT: число или выражение "5000+1000"'),
    hours: z.record(z.string(), z.number()).optional().describe('Часы по месяцам: {"Окт 26": 12.5}'),
  },
}, wrap(async ({ site, hours, ...fields }) => {
  const p = await mutate(data => {
    if (data.projects.some(x => (x.site || '').toLowerCase() === site.trim().toLowerCase())) {
      throw new Error(`Проект ${site} уже существует`);
    }
    const p = {
      id: uid(), site: site.trim(), client: '', type: '', income: 0, dop: 0, refPct: 0, warn: false,
      status: 'Обсуждение', deliveryMonth: '', prepaymentMonth: '', prepaymentAmt: 0,
      paymentMonth: '', paymentStatus: 'No', profitShared: 'Нет', note: '',
      months: normMonths(data.months, []),
    };
    applyFields(p, fields, data.months);
    for (const [m, h] of Object.entries(hours || {})) {
      checkMonth(data.months, m, 'hours');
      p.months.find(x => x.month === m).hours = n(h);
    }
    data.projects.push(p);
    return projectView(p, settingsOf(data));
  });
  return ok({ created: p });
}));

server.registerTool('update_project', {
  title: 'Изменить проект',
  description: 'Меняет поля проекта (только переданные), включая заметку note. Для часов используй log_hours.',
  inputSchema: { project: projectRef, site: z.string().optional().describe('Новый домен'), ...projectFields },
}, wrap(async ({ project, site, ...fields }) => {
  const res = await mutate(data => {
    const p = findProject(data.projects, project);
    const before = projectView(p, settingsOf(data), false);
    if (site !== undefined) p.site = site.trim();
    applyFields(p, fields, data.months);
    const after = projectView(p, settingsOf(data), false);
    const changed = Object.fromEntries(Object.keys(after).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map(k => [k, { from: before[k], to: after[k] }]));
    return { site: p.site, changed };
  });
  return ok(res);
}));

server.registerTool('log_hours', {
  title: 'Часы по месяцу',
  description: 'Записывает часы проекта за месяц. mode="add" прибавляет к текущим, "set" — заменяет.',
  inputSchema: {
    project: projectRef,
    month: monthField,
    hours: z.number().describe('Количество часов'),
    mode: z.enum(['add', 'set']).default('add'),
  },
}, wrap(async ({ project, month, hours, mode }) => {
  const res = await mutate(data => {
    checkMonth(data.months, month, 'month');
    const p = findProject(data.projects, project);
    const m = p.months.find(x => x.month === month);
    const from = m.hours;
    m.hours = round2(Math.max(0, mode === 'set' ? hours : m.hours + hours));
    return { site: p.site, month, hours: { from, to: m.hours }, totalHours: calc(p, settingsOf(data)).hours };
  });
  return ok(res);
}));

server.registerTool('set_extra_income', {
  title: 'Доплата по месяцу',
  description: 'Доп. доход ($) проекта за месяц (доплаты сверх основного дохода). mode="add" или "set".',
  inputSchema: {
    project: projectRef,
    month: monthField,
    amount: z.number(),
    mode: z.enum(['add', 'set']).default('set'),
  },
}, wrap(async ({ project, month, amount, mode }) => {
  const res = await mutate(data => {
    checkMonth(data.months, month, 'month');
    const p = findProject(data.projects, project);
    const m = p.months.find(x => x.month === month);
    const from = m.extraIncome;
    m.extraIncome = round2(Math.max(0, mode === 'set' ? amount : m.extraIncome + amount));
    return { site: p.site, month, extraIncome: { from, to: m.extraIncome } };
  });
  return ok(res);
}));

server.registerTool('delete_project', {
  title: 'Удалить проект',
  description: 'Безвозвратно удаляет проект. Вызывай только после явного подтверждения пользователя; confirm должен быть true.',
  inputSchema: { project: projectRef, confirm: z.literal(true) },
  annotations: { destructiveHint: true },
}, wrap(async ({ project }) => {
  const site = await mutate(data => {
    const p = findProject(data.projects, project);
    data.projects = data.projects.filter(x => x.id !== p.id);
    return p.site;
  });
  return ok(`Удалён: ${site}`);
}));

server.registerTool('add_month', {
  title: 'Добавить месяц',
  description: 'Добавляет месяц в конец ("next") или в начало ("prev") шкалы. Можно указать until — добавить все месяцы до него включительно.',
  inputSchema: {
    direction: z.enum(['next', 'prev']).default('next'),
    until: monthField.optional(),
  },
}, wrap(async ({ direction, until }) => {
  const added = await mutate(data => {
    const added = [];
    for (let i = 0; i < 36; i++) {
      const edge = direction === 'next' ? data.months[data.months.length - 1] : data.months[0];
      const m = shiftMonth(edge, direction === 'next' ? 1 : -1);
      if (data.months.includes(m)) break;
      direction === 'next' ? data.months.push(m) : data.months.unshift(m);
      added.push(m);
      if (!until || m === until) break;
    }
    if (until && !data.months.includes(until)) throw new Error(`Не удалось дойти до ${until}`);
    data.projects.forEach(p => { p.months = normMonths(data.months, p.months); });
    return added;
  });
  return ok(added.length ? `Добавлено: ${added.join(', ')}` : 'Ничего не добавлено (месяц уже есть)');
}));

server.registerTool('update_settings', {
  title: 'Настройки',
  description: 'Меняет ставку (€/ч), курс ($/€) и/или сдвиг расходов в месяцах.',
  inputSchema: {
    rate: z.number().positive().optional().describe('Ставка, €/ч'),
    eurRate: z.number().positive().optional().describe('Курс, $ за €'),
    expDelay: z.number().int().min(0).optional().describe('Сдвиг расходов, мес.'),
  },
}, wrap(async ({ rate, eurRate, expDelay }) => {
  const s = await mutate(data => {
    if (rate !== undefined) data.rate = rate;
    if (eurRate !== undefined) data.eurRate = eurRate;
    if (expDelay !== undefined) data.expDelay = expDelay;
    return settingsOf(data);
  });
  return ok({ settings: s });
}));

server.registerTool('monthly_stats', {
  title: 'Помесячная аналитика',
  description: 'Доход/расход/прибыль по месяцам — та же логика, что во вкладке «Помесячно». Также суммы, не попавшие ни в один месяц (нет месяца оплаты/сдачи).',
  inputSchema: {
    from: monthField.optional(),
    to: monthField.optional(),
  },
}, wrap(async ({ from, to }) => {
  const data = await load();
  let rows = computeMonthly(data);
  const i0 = from ? data.months.indexOf(from) : 0;
  const i1 = to ? data.months.indexOf(to) : data.months.length - 1;
  rows = rows.slice(Math.max(0, i0), i1 + 1);
  const missing = data.projects.filter(p => incomeSplit(p).unassigned > 0)
    .map(p => ({ site: p.site, unassigned: incomeSplit(p).unassigned }));
  const tot = k => rows.reduce((a, r) => a + r[k], 0);
  return ok({
    settings: settingsOf(data),
    months: rows,
    totals: { income: tot('income'), expense: tot('expense'), profit: tot('profit') },
    incomeNotInAnyMonth: missing,
  });
}));

return server;
}
