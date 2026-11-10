// MCP-инструменты дашборда (схема v2). Используются и локальным (stdio) сервером,
// и облачным (Cloudflare Worker). Весь расчётный слой — в ../../core.js (общий с дашбордом).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import '../../core.js';

const C = globalThis.HexaCore;
const { n, r2 } = C;

// ─── ЧТЕНИЕ / ЗАПИСЬ ──────────────────────────────────────────
const COLLECTIONS = ['projects', 'hours', 'invoices', 'payments', 'clients', 'types', 'months'];

function checkSchema(raw) {
  if ((raw.schemaVersion || 0) < C.SCHEMA_VERSION) {
    throw new Error('Данные дашборда ещё в старом формате (v1). Нужна миграция: mcp/scripts/migrate.mjs.');
  }
}

function makeIO(store) {
  return {
    load: async () => { const raw = await store.load(); checkSchema(raw); return C.normalize(raw); },
    // fn(data) мутирует data. allowShrink — коллекции, из которых операция может удалять записи.
    // Предохранитель: всё остальное уменьшаться не может, проектов — максимум минус один.
    mutate: (fn, allowShrink = []) => store.mutate(raw => {
      checkSchema(raw);
      const data = C.normalize(raw);
      const before = Object.fromEntries(COLLECTIONS.map(k => [k, data[k].length]));
      const result = fn(data);
      for (const k of COLLECTIONS) {
        if (!Array.isArray(data[k])) throw new Error(`Отмена записи: пропала коллекция ${k}`);
        const lost = before[k] - data[k].length;
        if (lost > 0 && k !== 'projects' && !allowShrink.includes(k)) throw new Error(`Отмена записи: операция удалила бы ${lost} из ${k}`);
      }
      const lostP = before.projects - data.projects.length;
      if (lostP > 1 || (lostP === 1 && !allowShrink.includes('projects'))) throw new Error('Отмена записи: операция удалила бы проекты');
      data.updatedAt = new Date().toISOString();
      return result;
    }),
  };
}

// ─── ХЕЛПЕРЫ ──────────────────────────────────────────────────
function findProject(data, ref) {
  const q = String(ref).trim().toLowerCase();
  const exact = data.projects.find(p => p.id === ref || (p.site || '').toLowerCase() === q);
  if (exact) return exact;
  const part = data.projects.filter(p => (p.site || '').toLowerCase().includes(q));
  if (part.length === 1) return part[0];
  if (part.length > 1) throw new Error(`Неоднозначно: «${ref}» подходит к ${part.map(p => p.site).join(', ')}`);
  throw new Error(`Проект «${ref}» не найден`);
}
function findClient(data, ref) {
  const c = C.findRef(data.clients, ref);
  if (!c) throw new Error(`Заказчик «${ref}» не найден. Есть: ${data.clients.map(x => x.name).join(', ')}`);
  return c;
}
function checkMonth(data, m, field) {
  if (!m) return;
  if (!C.isMonth(m)) throw new Error(`${field}: «${m}» — не месяц. Формат: "Окт 26".`);
  if (!data.months.some(x => x.month === m)) throw new Error(`${field}: месяца «${m}» нет в дашборде (${data.months[0]?.month} — ${data.months.at(-1)?.month}). Добавь через add_month.`);
}
function checkDate(d, field) {
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`${field}: дата в формате YYYY-MM-DD`);
}
// Значение справочника: существующее (без учёта регистра/пробелов/конечной s) или новое только по флагу.
function lev(a, b) {
  const m = a.length, k = b.length, dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(k).fill(0)]);
  for (let j = 1; j <= k; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= k; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][k];
}
function resolveRef(list, name, allowCreate, label, flag) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  const hit = C.findRef(list, clean);
  if (hit) return hit.id;
  if (allowCreate) return C.ensureRef(list, clean);
  const q = C.normKey(clean);
  const sim = list.filter(x => { const k = C.normKey(x.name); return k.includes(q) || q.includes(k) || lev(k, q) <= 2; }).map(x => x.name);
  throw new Error(`${label} «${clean}» нет в справочнике.${sim.length ? ` Похоже на: ${sim.join(', ')}.` : ''} Есть: ${list.map(x => x.name).join(', ')}. Новое значение — только с ${flag}: true.`);
}
const clientName = (data, p) => C.refName(data.clients, p.clientId);
const typeName = (data, p) => C.refName(data.types, p.typeId);

function projectBrief(data, p, opt) {
  const s = C.projectStats(data, p, opt);
  return {
    id: p.id, site: p.site, client: clientName(data, p), type: typeName(data, p), status: p.status,
    origin: p.origin || '(не указано)', deliveryMonth: p.deliveryMonth,
    invoiced: s.invoiced, received: s.received, debt: s.debt, paymentStatus: s.paymentStatus,
    hours: s.hours, hoursByPhase: { build: s.byPhase.build.hours, support: s.byPhase.support.hours },
    hoursByKind: { dev: s.byKind.dev.hours, cost: s.byKind.cost.hours },
    expense: s.expense, dop: s.dop, refPct: n(p.refPct), referral: s.referral,
    profit: s.profit, margin: s.margin, expectedProfit: s.expectedProfit,
    note: p.note || '',
  };
}
function projectFull(data, p) {
  const s = C.projectStats(data, p);
  const months = {};
  for (const h of data.hours.filter(x => x.projectId === p.id).sort((a, b) => C.cmpMonth(a.month, b.month))) {
    (months[h.month] ||= []).push({
      id: h.id, hours: h.hours, rate: h.rate, kind: h.kind, phase: h.phase + (h.phaseManual ? ' (вручную)' : ''),
      note: h.note || '', expenseUSD: r2(C.entryCostUSD(data, h)),
    });
  }
  return {
    ...projectBrief(data, p), warn: !!p.warn, profitShared: p.profitShared,
    byPhase: s.byPhase, byKind: s.byKind, expenseEUR: s.expenseEUR,
    hoursByMonth: months,
    invoices: data.invoices.filter(i => i.projectId === p.id).map(i => invoiceView(data, i)),
    payments: data.payments.filter(x => x.projectId === p.id).map(x => ({ id: x.id, amount: x.amount, month: x.month, receivedAt: x.receivedAt, invoiceId: x.invoiceId || null, note: x.note || '' })),
  };
}
function invoiceView(data, i) {
  const paid = data.payments.filter(x => x.invoiceId === i.id).reduce((s, x) => s + n(x.amount), 0);
  const usd = C.invoiceUSD(data, i);
  return {
    id: i.id, projectId: i.projectId, site: (data.projects.find(p => p.id === i.projectId) || {}).site,
    amount: i.amount, currency: i.currency, amountUSD: r2(usd), status: i.status, issuedAt: i.issuedAt,
    description: i.description || '', paid: r2(paid), outstanding: i.status === 'sent' ? r2(Math.max(0, usd - paid)) : 0,
  };
}
const autoCloseInvoice = (data, invId) => C.syncInvoiceStatus(data, invId);

const ISSUE_LABELS = {
  hours_no_invoices: 'Часы есть, счетов нет',
  invoice_overdue: 'Счёт sent старше 30 дней',
  payment_unlinked: 'Поступление без привязки к счёту',
  payment_no_month: 'Поступление без месяца',
  hours_no_note: 'Запись часов без описания',
  month_no_rate: 'Месяц без своего курса',
  delivered_no_month: '«Сдан» без месяца сдачи',
  support_not_invoiced: 'Часы поддержки без счёта в том же месяце',
  build_after_delivery: 'Часы build после месяца сдачи',
  origin_unknown: 'Не указано происхождение (own / inherited)',
  needs_full_invoice: 'Нужен счёт на полную сумму',
};
const ISSUE_CODES = Object.keys(ISSUE_LABELS);

const ok = obj => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const wrap = fn => async args => {
  try { return await fn(args); }
  catch (e) { return { isError: true, content: [{ type: 'text', text: '⚠ ' + e.message }] }; }
};

// ─── SERVER ───────────────────────────────────────────────────
export function createServer(store) {
  const { load, mutate } = makeIO(store);
  const server = new McpServer({ name: 'hexa-dashboard', version: '2.0.0' }, {
    instructions: [
      'Дашборд фриланс веб-проектов. Всё отображается в USD.',
      'Часы — отдельные записи: hours × rate(€/ч) × курс месяца ($/€). kind: dev (ставка по умолчанию 20) или cost (себестоимость, 15). phase: build (разработка, до сдачи) или support (поддержка после сдачи) — проставляется автоматически, можно поправить.',
      'Деньги: счета (invoices: draft/sent/paid/cancelled, USD или EUR) и поступления (payments, USDT, с месяцем). Долг = счета sent − поступления по ним. paymentStatus вычисляется: not_invoiced / awaiting / partial / paid.',
      'Прибыль = получено − расход − допрасходы − реферал (refPct% от полученного). expectedProfit — с учётом долга по выставленным счетам.',
      'Месяцы — строки "Окт 26". Проект указывается по домену (можно часть). Заказчик и тип нормализуются по справочнику.',
      'Перед delete_project и delete_payment всегда переспрашивай пользователя.',
    ].join(' '),
  });

  const monthF = z.string().describe('Месяц, формат "Окт 26"');
  const projectF = z.string().describe('Домен проекта или его часть, напр. "key-hub"');

  // ── обзор ──
  server.registerTool('get_overview', {
    title: 'Обзор дашборда',
    description: 'Настройки, месяцы с курсами, справочники и итоги: выставлено, получено, долг, часы, расход, прибыль.',
    inputSchema: {},
  }, wrap(async () => {
    const d = await load();
    const t = C.clientSummary(d);
    return ok({
      settings: d.settings,
      months: d.months.map(m => ({ month: m.month, eurRate: C.monthRate(d, m.month), own: n(m.eurRate) > 0 })),
      clients: d.clients.map(c => c.name), types: d.types.map(c => c.name),
      totals: { projects: d.projects.length, ...pick(t.total, ['hours', 'expense', 'invoiced', 'received', 'debt', 'profit', 'margin', 'expectedProfit', 'build', 'support']) },
      byStatus: C.STATUSES.map(s => ({ status: s, count: d.projects.filter(p => p.status === s).length })),
      byPaymentStatus: C.PAY_STATUSES.map(s => ({ status: s, count: d.projects.filter(p => C.projectStats(d, p).paymentStatus === s).length })),
      dataIssues: C.dataIssues(d).length,
      updatedAt: d.updatedAt,
    });
  }));

  server.registerTool('list_projects', {
    title: 'Список проектов',
    description: 'Проекты с выставленным, полученным, долгом, статусом оплаты, часами (build/support, dev/cost), расходом и прибылью.',
    inputSchema: {
      client: z.string().optional(), type: z.string().optional(),
      status: z.enum(C.STATUSES).optional(),
      paymentStatus: z.enum(C.PAY_STATUSES).optional(),
      origin: z.enum(['own', 'inherited', 'unknown']).optional(),
      hasDebt: z.boolean().optional().describe('true — только с долгом, false — только без долга'),
      search: z.string().optional().describe('Подстрока домена'),
      from: monthF.optional().describe('Период: с месяца (часы и деньги за период)'), to: monthF.optional(),
    },
  }, wrap(async a => {
    const d = await load();
    const cl = a.client ? findClient(d, a.client).id : null;
    const ty = a.type ? (C.findRef(d.types, a.type) || {}).id : null;
    const list = d.projects.filter(p =>
      (!cl || p.clientId === cl) && (!a.type || p.typeId === ty) && (!a.status || p.status === a.status) &&
      (!a.origin || (a.origin === 'unknown' ? !p.origin : p.origin === a.origin)) &&
      (!a.search || p.site.toLowerCase().includes(a.search.toLowerCase())));
    const out = list.map(p => projectBrief(d, p, { from: a.from, to: a.to })).filter(p => (!a.paymentStatus || p.paymentStatus === a.paymentStatus) && (a.hasDebt === undefined || (p.debt > 0) === a.hasDebt));
    return ok(out);
  }));

  server.registerTool('get_project', {
    title: 'Проект',
    description: 'Карточка проекта: деньги, разрез build/support и dev/cost, записи часов по месяцам с описаниями, счета и поступления.',
    inputSchema: { project: projectF },
  }, wrap(async ({ project }) => { const d = await load(); return ok(projectFull(d, findProject(d, project))); }));

  // ── проекты ──
  const projectFields = {
    client: z.string().optional().describe('Заказчик из справочника (регистр не важен)'),
    createClient: z.boolean().optional().describe('Разрешить создать нового заказчика, если его нет в справочнике'),
    type: z.string().optional().describe('Тип проекта из справочника (регистр не важен)'),
    createType: z.boolean().optional().describe('Разрешить создать новый тип'),
    status: z.enum(C.STATUSES).optional(),
    origin: z.enum(['own', 'inherited']).optional().describe('own — строили сами, inherited — чужой на поддержке'),
    deliveryMonth: z.string().optional().describe('Месяц сдачи ("" — сбросить)'),
    dop: z.number().optional().describe('Допрасходы, $'),
    refPct: z.number().min(0).max(100).optional().describe('% реферала партнёру'),
    warn: z.boolean().optional(), profitShared: z.enum(['Да', 'Нет']).optional(),
    note: z.string().optional().describe('Заметка (заменяет целиком)'),
  };
  function applyProject(d, p, f) {
    if (f.deliveryMonth) checkMonth(d, f.deliveryMonth, 'deliveryMonth');
    if (f.client !== undefined) p.clientId = resolveRef(d.clients, f.client, f.createClient, 'Заказчика', 'createClient');
    if (f.type !== undefined) p.typeId = resolveRef(d.types, f.type, f.createType, 'Типа', 'createType');
    for (const k of ['status', 'origin', 'deliveryMonth', 'warn', 'profitShared', 'note']) if (f[k] !== undefined) p[k] = f[k];
    for (const k of ['dop', 'refPct']) if (f[k] !== undefined) p[k] = n(f[k]);
    if (f.deliveryMonth !== undefined || f.origin !== undefined) C.refreshPhases(d, p.id);
  }

  server.registerTool('add_project', {
    title: 'Добавить проект',
    description: 'Создаёт проект (обязательны site и client). Деньги — отдельно через add_invoice / add_payment. Заказчик и тип берутся из справочника; новое значение — только с createClient / createType.',
    inputSchema: { site: z.string(), ...projectFields, client: z.string() },
  }, wrap(async ({ site, ...f }) => ok(await mutate(d => {
    if (d.projects.some(p => p.site.toLowerCase() === site.trim().toLowerCase())) throw new Error(`${site} уже есть`);
    const p = { id: C.uid(), site: site.trim(), clientId: '', typeId: '', status: 'Обсуждение', origin: 'own', deliveryMonth: '', dop: 0, refPct: 0, warn: false, profitShared: 'Нет', note: '' };
    d.projects.push(p);
    applyProject(d, p, f);
    return { created: projectBrief(d, p) };
  }))));

  server.registerTool('update_project', {
    title: 'Изменить проект',
    description: 'Меняет поля проекта (только переданные). Смена deliveryMonth/origin пересчитывает авто-фазы часов.',
    inputSchema: { project: projectF, site: z.string().optional().describe('Новый домен'), ...projectFields },
  }, wrap(async ({ project, site, ...f }) => ok(await mutate(d => {
    const p = findProject(d, project);
    const before = projectBrief(d, p);
    if (site) p.site = site.trim();
    applyProject(d, p, f);
    const after = projectBrief(d, p);
    return { site: p.site, changed: diff(before, after) };
  }))));

  server.registerTool('delete_project', {
    title: 'Удалить проект',
    description: 'Безвозвратно удаляет проект вместе с его часами, счетами и поступлениями. Только после явного подтверждения пользователя; confirm: true.',
    inputSchema: { project: projectF, confirm: z.literal(true) },
    annotations: { destructiveHint: true },
  }, wrap(async ({ project }) => ok(await mutate(d => {
    const p = findProject(d, project);
    const cnt = k => d[k].filter(x => x.projectId === p.id).length;
    const res = `Удалён ${p.site}: часов ${cnt('hours')}, счетов ${cnt('invoices')}, поступлений ${cnt('payments')}`;
    d.projects = d.projects.filter(x => x.id !== p.id);
    for (const k of ['hours', 'invoices', 'payments']) d[k] = d[k].filter(x => x.projectId !== p.id);
    return res;
  }, ['projects', 'hours', 'invoices', 'payments']))));

  // ── часы ──
  server.registerTool('log_hours', {
    title: 'Записать часы',
    description: 'mode=add создаёт НОВУЮ запись (не прибавляет к существующей — у месяца может быть несколько записей с разными ставками); mode=set заменяет ВСЕ записи проекта за месяц одной. Возвращает id записи. rate по умолчанию — из настроек для kind (dev 20 / cost 15). phase проставляется автоматически, если не передана.',
    inputSchema: {
      project: projectF, month: monthF, hours: z.number().min(0),
      mode: z.enum(['add', 'set']).default('add'),
      kind: z.enum(['dev', 'cost']).default('dev').describe('dev — разработка по ставке, cost — себестоимость (серверы, фронт, дизайн)'),
      rate: z.number().positive().optional().describe('€/ч для этой записи'),
      note: z.string().optional().describe('Что именно делали'),
      phase: z.enum(['build', 'support']).optional().describe('Только если автоматика ошибается'),
    },
  }, wrap(async a => ok(await mutate(d => {
    checkMonth(d, a.month, 'month');
    const p = findProject(d, a.project);
    let removed = 0;
    if (a.mode === 'set') {
      removed = d.hours.filter(h => h.projectId === p.id && h.month === a.month).length;
      d.hours = d.hours.filter(h => !(h.projectId === p.id && h.month === a.month));
    }
    const e = {
      id: 'h' + C.uid(), projectId: p.id, month: a.month, hours: r2(a.hours),
      rate: a.rate ?? C.defaultRate(d, a.kind), kind: a.kind,
      phase: a.phase || C.autoPhase(p, a.month), phaseManual: !!a.phase,
      note: a.note || '', createdAt: new Date().toISOString(),
    };
    if (e.hours > 0) d.hours.push(e);
    const monthTotal = d.hours.filter(h => h.projectId === p.id && h.month === a.month).reduce((s, h) => s + n(h.hours), 0);
    return { id: e.hours > 0 ? e.id : null, site: p.site, entry: { ...e, expenseUSD: r2(C.entryCostUSD(d, e)) }, replacedEntries: removed, monthHours: r2(monthTotal), projectHours: C.projectStats(d, p).hours, warning: e.note ? undefined : 'Запись без описания попадёт в data_issues' };
  }, a.mode === 'set' ? ['hours'] : []))));

  server.registerTool('update_hours', {
    title: 'Изменить запись часов',
    description: 'Правит одну запись часов по id (id — из log_hours или get_project → hoursByMonth): часы, ставку, вид, фазу, описание, месяц. phase: "auto" вернёт автоматическую фазу.',
    inputSchema: {
      id: z.string(), hours: z.number().min(0).optional(), rate: z.number().positive().optional(),
      kind: z.enum(['dev', 'cost']).optional(), phase: z.enum(['build', 'support', 'auto']).optional(),
      note: z.string().optional(), month: monthF.optional(),
    },
  }, wrap(async a => ok(await mutate(d => {
    const e = d.hours.find(h => h.id === a.id);
    if (!e) throw new Error(`Запись часов ${a.id} не найдена`);
    const p = d.projects.find(x => x.id === e.projectId);
    const before = { ...e };
    if (a.month) { checkMonth(d, a.month, 'month'); e.month = a.month; }
    for (const k of ['hours', 'rate', 'kind', 'note']) if (a[k] !== undefined) e[k] = a[k];
    if (a.phase === 'auto') { e.phaseManual = false; }
    else if (a.phase) { e.phase = a.phase; e.phaseManual = true; }
    if (!e.phaseManual) e.phase = C.autoPhase(p, e.month);
    delete e.migrated;
    return { id: e.id, site: p?.site, changed: diff(before, e), entry: { ...e, expenseUSD: r2(C.entryCostUSD(d, e)) } };
  }))));

  server.registerTool('delete_hours', {
    title: 'Удалить запись часов',
    description: 'Удаляет одну ошибочную запись часов по id.',
    inputSchema: { id: z.string() },
  }, wrap(async ({ id }) => ok(await mutate(d => {
    const e = d.hours.find(h => h.id === id);
    if (!e) throw new Error(`Запись часов ${id} не найдена`);
    const p = d.projects.find(x => x.id === e.projectId);
    d.hours = d.hours.filter(h => h.id !== id);
    return { deleted: id, site: p?.site, entry: { month: e.month, hours: e.hours, rate: e.rate, kind: e.kind, note: e.note }, projectHours: p ? C.projectStats(d, p).hours : null };
  }, ['hours']))));

  // ── деньги ──
  server.registerTool('add_invoice', {
    title: 'Выставить счёт',
    description: 'Создаёт счёт по проекту. currency EUR пересчитывается в USD по курсу месяца выставления. status по умолчанию sent. Возвращает id счёта и пересчитанный paymentStatus проекта.',
    inputSchema: {
      project: projectF, amount: z.number().positive(), currency: z.enum(['USD', 'EUR']).default('USD'),
      description: z.string().optional(), status: z.enum(['draft', 'sent', 'paid']).default('sent'),
      issuedAt: z.string().optional().describe('Дата YYYY-MM-DD, по умолчанию сегодня'),
    },
  }, wrap(async a => ok(await mutate(d => {
    const p = findProject(d, a.project);
    checkDate(a.issuedAt, 'issuedAt');
    const inv = { id: 'i' + C.uid(), projectId: p.id, amount: a.amount, currency: a.currency, issuedAt: a.issuedAt || C.todayISO(), description: a.description || '', status: a.status };
    d.invoices.push(inv);
    const pb = projectBrief(d, p);
    return { id: inv.id, paymentStatus: pb.paymentStatus, invoice: invoiceView(d, inv), project: pick(pb, ['site', 'invoiced', 'received', 'debt', 'paymentStatus']) };
  }))));

  server.registerTool('update_invoice', {
    title: 'Изменить счёт',
    description: 'Меняет сумму, валюту, описание, дату или статус счёта. Отменить — status: cancelled.',
    inputSchema: {
      invoice: z.string().describe('id счёта'), amount: z.number().positive().optional(), currency: z.enum(['USD', 'EUR']).optional(),
      description: z.string().optional(), status: z.enum(C.INVOICE_STATUSES).optional(), issuedAt: z.string().optional(),
    },
  }, wrap(async a => ok(await mutate(d => {
    const inv = d.invoices.find(i => i.id === a.invoice);
    if (!inv) throw new Error(`Счёт ${a.invoice} не найден`);
    checkDate(a.issuedAt, 'issuedAt');
    const before = invoiceView(d, inv);
    for (const k of ['amount', 'currency', 'description', 'status', 'issuedAt']) if (a[k] !== undefined) inv[k] = a[k];
    delete inv.migrated;
    if (a.amount !== undefined || a.currency !== undefined) C.syncInvoiceStatus(d, inv.id);
    const p = d.projects.find(x => x.id === inv.projectId);
    return { id: inv.id, paymentStatus: p ? projectBrief(d, p).paymentStatus : null, changed: diff(before, invoiceView(d, inv)), invoice: invoiceView(d, inv) };
  }))));

  server.registerTool('delete_invoice', {
    title: 'Удалить счёт',
    description: 'Удаляет ошибочный счёт. Если по нему уже есть поступления — сначала переспроси пользователя и вызови с confirm: true; поступления останутся, но без привязки к счёту. Для отменённых по-настоящему счетов лучше update_invoice status=cancelled.',
    inputSchema: { invoice: z.string().describe('id счёта'), confirm: z.boolean().optional() },
    annotations: { destructiveHint: true },
  }, wrap(async ({ invoice, confirm }) => ok(await mutate(d => {
    const inv = d.invoices.find(i => i.id === invoice);
    if (!inv) throw new Error(`Счёт ${invoice} не найден`);
    const linked = d.payments.filter(x => x.invoiceId === invoice);
    if (linked.length && !confirm) {
      throw new Error(`По счёту есть ${linked.length} поступлени(е/я) на $${r2(linked.reduce((s, x) => s + n(x.amount), 0))}. Переспроси пользователя; при удалении они останутся без привязки к счёту. Повтори с confirm: true.`);
    }
    for (const x of linked) x.invoiceId = '';
    d.invoices = d.invoices.filter(i => i.id !== invoice);
    const p = d.projects.find(x => x.id === inv.projectId);
    return { deleted: invoice, site: p?.site, unlinkedPayments: linked.map(x => x.id), paymentStatus: p ? projectBrief(d, p).paymentStatus : null };
  }, ['invoices']))));

  server.registerTool('add_payment', {
    title: 'Записать поступление',
    description: 'Записывает пришедшие деньги в USDT как есть, без пересчёта, и привязывает к счёту. Если счёт не указан, а у проекта ровно один неоплаченный — привяжет к нему. Полностью покрытый счёт становится paid. Возвращает id и paymentStatus проекта.',
    inputSchema: {
      project: projectF, amount: z.number().positive().describe('Сумма в USDT'),
      month: monthF.optional().describe('Месяц поступления; по умолчанию — из receivedAt или текущий'),
      receivedAt: z.string().optional().describe('Дата YYYY-MM-DD, по умолчанию сегодня'),
      invoice: z.string().optional().describe('id счёта; если не указан и у проекта один неоплаченный счёт — привяжется к нему'),
      noInvoice: z.boolean().optional().describe('Явно без привязки к счёту'),
      note: z.string().optional(),
    },
  }, wrap(async a => ok(await mutate(d => {
    const p = findProject(d, a.project);
    checkDate(a.receivedAt, 'receivedAt');
    const receivedAt = a.receivedAt || C.todayISO();
    const month = a.month || C.dateToMonth(receivedAt);
    checkMonth(d, month, 'month');
    let invId = a.invoice || '';
    if (invId && !d.invoices.some(i => i.id === invId && i.projectId === p.id)) throw new Error(`Счёт ${invId} не относится к ${p.site}`);
    if (!invId && !a.noInvoice) {
      const open = d.invoices.filter(i => i.projectId === p.id && i.status === 'sent');
      if (open.length === 1) invId = open[0].id;
      else if (open.length > 1) throw new Error(`У ${p.site} несколько неоплаченных счетов — укажи invoice: ${open.map(i => `${i.id} ($${i.amount} ${i.description})`).join('; ')}`);
    }
    const pay = { id: 'p' + C.uid(), projectId: p.id, invoiceId: invId, amount: a.amount, receivedAt, month, note: a.note || '' };
    d.payments.push(pay);
    if (invId) autoCloseInvoice(d, invId);
    const pb = projectBrief(d, p);
    return { id: pay.id, paymentStatus: pb.paymentStatus, payment: pay, invoice: invId ? invoiceView(d, d.invoices.find(i => i.id === invId)) : null, project: pick(pb, ['site', 'invoiced', 'received', 'debt', 'paymentStatus']), warning: invId ? undefined : 'Поступление без счёта попадёт в data_issues' };
  }))));

  server.registerTool('delete_payment', {
    title: 'Удалить поступление',
    description: 'Удаляет ошибочно записанное поступление. Только после подтверждения пользователя; confirm: true.',
    inputSchema: { payment: z.string().describe('id поступления'), confirm: z.literal(true) },
    annotations: { destructiveHint: true },
  }, wrap(async ({ payment }) => ok(await mutate(d => {
    const x = d.payments.find(y => y.id === payment);
    if (!x) throw new Error(`Поступление ${payment} не найдено`);
    d.payments = d.payments.filter(y => y.id !== payment);
    if (x.invoiceId) C.syncInvoiceStatus(d, x.invoiceId);
    const p = d.projects.find(y => y.id === x.projectId);
    return { deleted: payment, amount: x.amount, month: x.month, paymentStatus: p ? projectBrief(d, p).paymentStatus : null };
  }, ['payments']))));

  server.registerTool('set_extra_income', {
    title: 'Доплата по месяцу',
    description: 'Доплата сверх основной цены за месяц: создаёт оплаченный счёт и поступление. mode=set заменяет доплаты проекта за этот месяц, add — добавляет.',
    inputSchema: { project: projectF, month: monthF, amount: z.number().min(0), mode: z.enum(['add', 'set']).default('set') },
  }, wrap(async a => ok(await mutate(d => {
    checkMonth(d, a.month, 'month');
    const p = findProject(d, a.project);
    const isExtra = x => x.projectId === p.id && x.source === 'extra' && (x.month === a.month || C.dateToMonth(x.issuedAt) === a.month);
    const was = d.payments.filter(isExtra).reduce((s, x) => s + n(x.amount), 0);
    if (a.mode === 'set') { d.payments = d.payments.filter(x => !isExtra(x)); d.invoices = d.invoices.filter(x => !isExtra(x)); }
    if (a.amount > 0) {
      const invId = 'i' + C.uid(), date = C.monthToDate(a.month);
      d.invoices.push({ id: invId, projectId: p.id, amount: a.amount, currency: 'USD', issuedAt: date, description: 'Доплата', status: 'paid', source: 'extra' });
      d.payments.push({ id: 'p' + C.uid(), projectId: p.id, invoiceId: invId, amount: a.amount, receivedAt: date, month: a.month, note: 'Доплата', source: 'extra' });
    }
    const now = d.payments.filter(isExtra).reduce((s, x) => s + n(x.amount), 0);
    return { site: p.site, month: a.month, extraIncome: { from: r2(was), to: r2(now) } };
  }, a.mode === 'set' ? ['payments', 'invoices'] : []))));

  server.registerTool('list_invoices', {
    title: 'Счета',
    description: 'Счета с фильтрами по статусу, заказчику, проекту и периоду (по месяцу выставления).',
    inputSchema: {
      status: z.enum(C.INVOICE_STATUSES).optional(), client: z.string().optional(), project: projectF.optional(),
      from: monthF.optional(), to: monthF.optional(),
    },
  }, wrap(async a => {
    const d = await load();
    const cl = a.client ? findClient(d, a.client).id : null;
    const pid = a.project ? findProject(d, a.project).id : null;
    const list = d.invoices.filter(i => {
      const p = d.projects.find(x => x.id === i.projectId);
      return (!a.status || i.status === a.status) && (!cl || (p && p.clientId === cl)) && (!pid || i.projectId === pid) && C.inPeriod(C.dateToMonth(i.issuedAt), a.from, a.to);
    }).sort((x, y) => String(y.issuedAt).localeCompare(String(x.issuedAt)));
    const v = list.map(i => ({ ...invoiceView(d, i), client: C.refName(d.clients, (d.projects.find(p => p.id === i.projectId) || {}).clientId) }));
    return ok({ count: v.length, totalUSD: r2(v.reduce((s, i) => s + i.amountUSD, 0)), outstanding: r2(v.reduce((s, i) => s + i.outstanding, 0)), invoices: v });
  }));

  // ── отчёты ──
  server.registerTool('client_summary', {
    title: 'Сводка по заказчикам',
    description: 'Строка на заказчика: проекты, часы (build/support), расход, выставлено, получено, долг, прибыль, маржа. Чужие (inherited) проекты — отдельной группой. Отвечает на «сколько должен X» одним вызовом.',
    inputSchema: { client: z.string().optional().describe('Только этот заказчик'), from: monthF.optional(), to: monthF.optional() },
  }, wrap(async a => {
    const d = await load();
    const s = C.clientSummary(d, { from: a.from, to: a.to });
    const cl = a.client ? findClient(d, a.client).id : null;
    const f = rows => rows.filter(r => !cl || r.clientId === cl);
    return ok({
      period: a.from || a.to ? `${a.from || '…'} — ${a.to || '…'}` : 'всё время',
      note: a.from || a.to ? 'За период допрасходы (dop) не учитываются — у них нет даты; долг — на сегодня.' : undefined,
      own: f(s.own), inherited: f(s.inherited),
      totals: cl ? undefined : { own: s.totalOwn, inherited: s.totalInherited, all: s.total },
    });
  }));

  server.registerTool('receivables', {
    title: 'Дебиторка',
    description: 'Кто и сколько должен: неоплаченные остатки по счетам в статусе sent, с возрастом долга в днях, старые — первыми.',
    inputSchema: { client: z.string().optional(), minAge: z.number().int().min(0).optional().describe('Только долги старше N дней') },
  }, wrap(async a => {
    const d = await load();
    const cl = a.client ? findClient(d, a.client).id : null;
    const list = C.receivables(d).filter(r => (!cl || r.clientId === cl) && (a.minAge === undefined || (r.ageDays || 0) >= a.minAge));
    const byClient = {};
    for (const r of list) byClient[r.client] = r2((byClient[r.client] || 0) + r.outstanding);
    return ok({ total: r2(list.reduce((s, r) => s + r.outstanding, 0)), byClient, items: list });
  }));

  server.registerTool('monthly_stats', {
    title: 'Помесячная аналитика',
    description: 'По месяцам: курс, выставлено (invoiced), получено (received), расход и часы с разбивкой build/support, прибыль по полученному и ожидаемая (по выставленному).',
    inputSchema: { from: monthF.optional(), to: monthF.optional() },
  }, wrap(async ({ from, to }) => {
    const d = await load();
    const rows = C.monthlyStats(d).filter(m => C.inPeriod(m.month, from, to)).map(({ projects, allProjects, ...m }) => ({
      ...m, projects: projects.map(id => (d.projects.find(p => p.id === id) || {}).site),
    }));
    const sum = k => r2(rows.reduce((s, r) => s + r[k], 0));
    return ok({ settings: d.settings, months: rows, totals: { invoiced: sum('invoiced'), received: sum('received'), expense: sum('expense'), hours: sum('hours'), profit: sum('profit') } });
  }));

  server.registerTool('data_issues', {
    title: 'Проблемы в данных',
    description: 'Проверки: часы без счетов, счета sent старше 30 дней, поступления без счёта, записи часов без описания, месяцы без своего курса, «Сдан» без месяца сдачи, support-часы без счёта в том же месяце, build-часы после сдачи, не указано происхождение.',
    inputSchema: { code: z.enum(ISSUE_CODES).optional().describe('Только проблемы с этим кодом') },
  }, wrap(async ({ code }) => {
    const d = await load();
    const all = C.dataIssues(d).filter(i => !code || i.type === code).map(({ type, title, site, projectId, ...rest }) => ({
      code: type, group: ISSUE_LABELS[type] || type, project: site || null, message: title, ...rest, projectId,
    }));
    const counts = all.reduce((a, i) => (a[i.code] = (a[i.code] || 0) + 1, a), {});
    return ok({ total: all.length, counts, issues: all });
  }));

  // ── настройки и месяцы ──
  server.registerTool('add_month', {
    title: 'Добавить месяц',
    description: 'Добавляет месяц в конец ("next") или начало ("prev") шкалы; until — до указанного включительно. Курс у нового месяца не задан (берётся общий) — задай через set_month_rate.',
    inputSchema: { direction: z.enum(['next', 'prev']).default('next'), until: monthF.optional() },
  }, wrap(async ({ direction, until }) => ok(await mutate(d => {
    if (until && !C.isMonth(until)) throw new Error('until: формат "Окт 26"');
    const added = [];
    for (let i = 0; i < 36; i++) {
      const edge = direction === 'next' ? d.months.at(-1).month : d.months[0].month;
      const m = C.shiftMonth(edge, direction === 'next' ? 1 : -1);
      if (d.months.some(x => x.month === m)) break;
      direction === 'next' ? d.months.push({ month: m }) : d.months.unshift({ month: m });
      added.push(m);
      if (!until || m === until) break;
    }
    return added.length ? `Добавлено: ${added.join(', ')}` : 'Ничего не добавлено';
  }))));

  server.registerTool('set_month_rate', {
    title: 'Курс месяца',
    description: 'Задаёт фактический курс $ за € для месяца — по нему считаются расходы по часам этого месяца и EUR-счета, выставленные в нём. eurRate: null — сбросить на общий курс.',
    inputSchema: { month: monthF, eurRate: z.number().positive().nullable() },
  }, wrap(async ({ month, eurRate }) => ok(await mutate(d => {
    checkMonth(d, month, 'month');
    const row = d.months.find(x => x.month === month);
    const from = C.monthRate(d, month);
    if (eurRate === null) delete row.eurRate; else row.eurRate = eurRate;
    const m = C.monthlyStats(d).find(x => x.month === month);
    return { month, eurRate: { from, to: C.monthRate(d, month) }, own: eurRate !== null, monthExpense: m.expense, monthInvoiced: m.invoiced };
  }))));

  server.registerTool('update_settings', {
    title: 'Настройки',
    description: 'Ставки по умолчанию (rate — разработка €/ч, costRate — себестоимость €/ч), общий курс $/€ (используется, если у месяца нет своего), сдвиг расходов, курсы отдельных месяцев (monthRates: {"Окт 26": 1.135}; null — сбросить на общий). Ставки меняют только новые записи часов.',
    inputSchema: {
      rate: z.number().positive().optional(), costRate: z.number().positive().optional(),
      eurRate: z.number().positive().optional(), expDelay: z.number().int().min(0).optional(),
      monthRates: z.record(z.string(), z.number().positive().nullable()).optional(),
    },
  }, wrap(async a => ok(await mutate(d => {
    for (const k of ['rate', 'costRate', 'eurRate', 'expDelay']) if (a[k] !== undefined) d.settings[k] = a[k];
    for (const [m, v] of Object.entries(a.monthRates || {})) {
      checkMonth(d, m, 'monthRates');
      const row = d.months.find(x => x.month === m);
      if (v === null) delete row.eurRate; else row.eurRate = v;
    }
    return { settings: d.settings, monthRates: Object.fromEntries(Object.keys(a.monthRates || {}).map(m => [m, C.monthRate(d, m)])) };
  }))));

  return server;
}

function pick(o, keys) { return Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]])); }
function diff(a, b) {
  return Object.fromEntries(Object.keys(b).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(k => [k, { from: a[k], to: b[k] }]));
}
