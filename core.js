// HexaCore — модель данных v2 и весь расчётный слой дашборда.
// Один файл для браузера (<script src="core.js">) и MCP-сервера (import '../../core.js'),
// чтобы формулы не расходились. Регистрирует себя в globalThis.HexaCore.
(function (root) {
  'use strict';

  const SCHEMA_VERSION = 2;
  const RU_M = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const STATUSES = ['Сдан', 'В работе', 'Холд', 'На проверке', 'Обсуждение'];
  const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'cancelled'];
  const PAY_STATUSES = ['not_invoiced', 'awaiting', 'partial', 'paid'];
  const PAY_STATUS_LABEL = { not_invoiced: 'Без счёта', awaiting: 'Ждём оплату', partial: 'Частично', paid: 'Оплачен' };
  const KINDS = ['dev', 'cost'];
  const PHASES = ['build', 'support'];
  const ORIGINS = ['own', 'inherited'];
  const OVERDUE_DAYS = 30;

  const n = v => (v === null || v === undefined || v === '' || isNaN(+v) ? 0 : +v);
  const r2 = v => Math.round((+v + Number.EPSILON) * 100) / 100;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ─── Месяцы ("Окт 26") ──────────────────────────────────────
  function parseMonth(s) {
    if (typeof s !== 'string') return null;
    const [mon, yr] = s.trim().split(/\s+/);
    const mi = RU_M.indexOf(mon);
    const y = parseInt(yr, 10);
    if (mi < 0 || isNaN(y)) return null;
    return { y: 2000 + (y % 100), m: mi };
  }
  const isMonth = s => parseMonth(s) !== null;
  function monthIdx(s) { const p = parseMonth(s); return p ? p.y * 12 + p.m : null; }
  function idxToMonth(i) { const y = Math.floor(i / 12), m = ((i % 12) + 12) % 12; return `${RU_M[m]} ${String(y % 100).padStart(2, '0')}`; }
  function shiftMonth(s, d) { const i = monthIdx(s); return i === null ? s : idxToMonth(i + d); }
  function cmpMonth(a, b) { return monthIdx(a) - monthIdx(b); }
  function monthToDate(s) { const p = parseMonth(s); return p ? `${p.y}-${String(p.m + 1).padStart(2, '0')}-01` : ''; }
  function dateToMonth(d) {
    const m = /^(\d{4})-(\d{2})/.exec(String(d || ''));
    return m ? `${RU_M[+m[2] - 1]} ${m[1].slice(2)}` : '';
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function daysBetween(fromISO, toISO) {
    const a = Date.parse(fromISO), b = Date.parse(toISO || todayISO());
    return isNaN(a) || isNaN(b) ? null : Math.floor((b - a) / 86400000);
  }
  function inPeriod(month, from, to) {
    const i = monthIdx(month);
    if (i === null) return !from && !to;
    if (from && i < monthIdx(from)) return false;
    if (to && i > monthIdx(to)) return false;
    return true;
  }

  // ─── Справочники с нормализацией ─────────────────────────────
  // "Game keys" == "game key" == "Game Keys " — сравниваем без регистра, пробелов и конечной s.
  const normKey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/s$/, '');
  function findRef(list, nameOrId) {
    if (!nameOrId) return null;
    const k = normKey(nameOrId);
    return list.find(x => x.id === nameOrId) || list.find(x => normKey(x.name) === k) || null;
  }
  // Возвращает id существующей записи или создаёт новую.
  function ensureRef(list, name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean) return '';
    const hit = findRef(list, clean);
    if (hit) return hit.id;
    const id = 'r' + uid();
    list.push({ id, name: clean });
    return id;
  }
  const refName = (list, id) => (list.find(x => x.id === id) || {}).name || '';

  // ─── Курс и ставки ───────────────────────────────────────────
  function monthRate(data, month) {
    const m = (data.months || []).find(x => x.month === month);
    return m && n(m.eurRate) > 0 ? n(m.eurRate) : n(data.settings.eurRate) || 1;
  }
  function defaultRate(data, kind) {
    return kind === 'cost' ? n(data.settings.costRate) || 15 : n(data.settings.rate) || 20;
  }
  // Фаза по умолчанию: чужой проект — всегда support; свой — build до месяца сдачи включительно.
  function autoPhase(project, month) {
    if (project && project.origin === 'inherited') return 'support';
    if (!project || !project.deliveryMonth || !isMonth(project.deliveryMonth)) return 'build';
    return cmpMonth(month, project.deliveryMonth) <= 0 ? 'build' : 'support';
  }
  // Пересчитать авто-фазы проекта (после смены deliveryMonth/origin). Ручные не трогаем.
  function refreshPhases(data, projectId) {
    const p = data.projects.find(x => x.id === projectId);
    for (const h of data.hours) if (h.projectId === projectId && !h.phaseManual) h.phase = autoPhase(p, h.month);
  }

  const entryCostEUR = h => n(h.hours) * n(h.rate);
  const entryCostUSD = (data, h) => entryCostEUR(h) * monthRate(data, h.month);
  function invoiceUSD(data, inv) {
    return inv.currency === 'EUR' ? n(inv.amount) * monthRate(data, dateToMonth(inv.issuedAt)) : n(inv.amount);
  }
  const isActiveInvoice = inv => inv.status === 'sent' || inv.status === 'paid';

  // Счёт sent, полностью покрытый поступлениями → paid; paid, переставший быть покрытым → sent.
  function syncInvoiceStatus(data, invId) {
    const inv = data.invoices.find(i => i.id === invId);
    if (!inv || (inv.status !== 'sent' && inv.status !== 'paid')) return;
    const paid = data.payments.filter(x => x.invoiceId === invId).reduce((s, x) => s + n(x.amount), 0);
    const covered = paid >= invoiceUSD(data, inv) - 0.005;
    if (inv.status === 'sent' && covered) inv.status = 'paid';
    else if (inv.status === 'paid' && !covered && !inv.migrated) inv.status = 'sent';
  }

  // ─── Нормализация документа ─────────────────────────────────
  function normalize(doc) {
    const d = doc || {};
    d.schemaVersion = d.schemaVersion || 0;
    d.settings = Object.assign({ rate: 20, costRate: 15, eurRate: 1.154, expDelay: 0 }, d.settings || {});
    for (const k of ['months', 'clients', 'types', 'projects', 'hours', 'invoices', 'payments']) if (!Array.isArray(d[k])) d[k] = [];
    d.months.sort((a, b) => cmpMonth(a.month, b.month));
    return d;
  }

  // ─── Расчёт по проекту ───────────────────────────────────────
  function blankSplit() { return { hours: 0, expense: 0 }; }
  function projectStats(data, p, opt) {
    const from = opt && opt.from, to = opt && opt.to;
    const hours = data.hours.filter(h => h.projectId === p.id && inPeriod(h.month, from, to));
    const invoices = data.invoices.filter(i => i.projectId === p.id);
    const payments = data.payments.filter(x => x.projectId === p.id);
    const periodInv = invoices.filter(i => inPeriod(dateToMonth(i.issuedAt), from, to));
    const periodPay = payments.filter(x => inPeriod(x.month, from, to));

    const byPhase = { build: blankSplit(), support: blankSplit() };
    const byKind = { dev: blankSplit(), cost: blankSplit() };
    let h = 0, exp = 0, expEUR = 0;
    for (const e of hours) {
      const c = entryCostUSD(data, e);
      h += n(e.hours); exp += c; expEUR += entryCostEUR(e);
      const ph = byPhase[e.phase] || byPhase.build; ph.hours += n(e.hours); ph.expense += c;
      const kd = byKind[e.kind] || byKind.dev; kd.hours += n(e.hours); kd.expense += c;
    }
    const invoiced = periodInv.filter(isActiveInvoice).reduce((s, i) => s + invoiceUSD(data, i), 0);
    const received = periodPay.reduce((s, x) => s + n(x.amount), 0);

    // Долг — всегда на текущий момент: счета sent минус поступления по ним
    let debt = 0, sentPaid = 0, hasSent = false;
    for (const inv of invoices) {
      if (inv.status !== 'sent') continue;
      hasSent = true;
      const paid = payments.filter(x => x.invoiceId === inv.id).reduce((s, x) => s + n(x.amount), 0);
      sentPaid += paid;
      debt += Math.max(0, invoiceUSD(data, inv) - paid);
    }
    let paymentStatus;
    if (!invoices.some(isActiveInvoice)) paymentStatus = 'not_invoiced';
    else if (debt <= 0.005) paymentStatus = 'paid';
    else if (hasSent && sentPaid <= 0) paymentStatus = 'awaiting';
    else paymentStatus = 'partial';

    const refPct = n(p.refPct) / 100;
    const dop = from || to ? 0 : n(p.dop); // допрасходы без даты — только в расчёте за всё время
    const referral = received * refPct;
    const profit = received - exp - dop - referral;
    const expectedIncome = received + (from || to ? 0 : debt);
    const expectedProfit = expectedIncome - exp - dop - expectedIncome * refPct;
    const fin = x => ({ hours: r2(x.hours), expense: r2(x.expense) });
    return {
      hours: r2(h), expense: r2(exp), expenseEUR: r2(expEUR),
      byPhase: { build: fin(byPhase.build), support: fin(byPhase.support) },
      byKind: { dev: fin(byKind.dev), cost: fin(byKind.cost) },
      invoiced: r2(invoiced), received: r2(received), debt: r2(debt), paymentStatus,
      dop: r2(dop), referral: r2(referral), profit: r2(profit),
      margin: received > 0 ? r2(profit / received * 100) : 0,
      expectedIncome: r2(expectedIncome), expectedProfit: r2(expectedProfit),
    };
  }

  // ─── Помесячно ───────────────────────────────────────────────
  // Расход — по месяцу работы (со сдвигом expDelay), курс — месяца работы.
  // Получено — по месяцу поступления. Выставлено — по месяцу issuedAt.
  function monthlyStats(data, opt) {
    const exclude = (opt && opt.exclude) || new Set();
    const delay = parseInt(data.settings.expDelay, 10) || 0;
    const rows = {};
    for (const m of data.months) rows[m.month] = {
      month: m.month, eurRate: monthRate(data, m.month), ownRate: n(m.eurRate) > 0,
      invoiced: 0, received: 0, expense: 0, hours: 0,
      build: blankSplit(), support: blankSplit(), projects: [], allProjects: [],
    };
    const tag = (row, p, counted) => {
      if (!row.allProjects.includes(p.id)) row.allProjects.push(p.id);
      if (counted && !row.projects.includes(p.id)) row.projects.push(p.id);
    };
    const proj = id => data.projects.find(p => p.id === id);
    for (const e of data.hours) {
      const p = proj(e.projectId); if (!p) continue;
      const tgt = rows[delay ? shiftMonth(e.month, delay) : e.month];
      if (!tgt || !n(e.hours)) continue;
      const on = !exclude.has(p.id);
      tag(tgt, p, on);
      if (!on) continue;
      const c = entryCostUSD(data, e);
      tgt.expense += c; tgt.hours += n(e.hours);
      const ph = tgt[e.phase] || tgt.build; ph.hours += n(e.hours); ph.expense += c;
    }
    for (const x of data.payments) {
      const p = proj(x.projectId); const row = rows[x.month]; if (!p || !row) continue;
      const on = !exclude.has(p.id); tag(row, p, on);
      if (on) row.received += n(x.amount);
    }
    for (const inv of data.invoices) {
      if (!isActiveInvoice(inv)) continue;
      const p = proj(inv.projectId); const row = rows[dateToMonth(inv.issuedAt)]; if (!p || !row) continue;
      const on = !exclude.has(p.id); tag(row, p, on);
      if (on) row.invoiced += invoiceUSD(data, inv);
    }
    return data.months.map(m => {
      const r = rows[m.month];
      const profit = r.received - r.expense;
      return {
        month: r.month, eurRate: r.eurRate, ownRate: r.ownRate,
        invoiced: r2(r.invoiced), received: r2(r.received), expense: r2(r.expense), hours: r2(r.hours),
        profit: r2(profit), expectedProfit: r2(r.invoiced - r.expense),
        margin: r.received > 0 ? r2(profit / r.received * 100) : 0,
        build: { hours: r2(r.build.hours), expense: r2(r.build.expense) },
        support: { hours: r2(r.support.hours), expense: r2(r.support.expense) },
        projects: r.projects, allProjects: r.allProjects,
      };
    });
  }

  // ─── Сводка по заказчикам ───────────────────────────────────
  // inherited-проекты — отдельной группой: у них нет стартового дохода.
  function clientSummary(data, opt) {
    const from = opt && opt.from, to = opt && opt.to;
    const groups = { own: {}, inherited: {} };
    for (const p of data.projects) {
      const g = p.origin === 'inherited' ? 'inherited' : 'own';
      const cid = p.clientId || '';
      const row = groups[g][cid] || (groups[g][cid] = {
        clientId: cid, client: refName(data.clients, cid) || '—', group: g, projects: 0,
        hours: 0, expense: 0, invoiced: 0, received: 0, debt: 0, profit: 0, expectedProfit: 0,
        build: blankSplit(), support: blankSplit(),
      });
      const s = projectStats(data, p, { from, to });
      const active = !(from || to) || s.hours || s.invoiced || s.received;
      if (!active) continue;
      row.projects++;
      for (const k of ['hours', 'expense', 'invoiced', 'received', 'debt', 'profit', 'expectedProfit']) row[k] += s[k];
      for (const ph of ['build', 'support']) { row[ph].hours += s.byPhase[ph].hours; row[ph].expense += s.byPhase[ph].expense; }
    }
    const fin = row => {
      for (const k of ['hours', 'expense', 'invoiced', 'received', 'debt', 'profit', 'expectedProfit']) row[k] = r2(row[k]);
      for (const ph of ['build', 'support']) { row[ph].hours = r2(row[ph].hours); row[ph].expense = r2(row[ph].expense); }
      row.margin = row.received > 0 ? r2(row.profit / row.received * 100) : 0;
      return row;
    };
    const list = g => Object.values(groups[g]).filter(r => r.projects > 0).map(fin).sort((a, b) => b.received - a.received);
    const own = list('own'), inherited = list('inherited');
    const total = rows => fin(rows.reduce((t, r) => {
      t.projects += r.projects;
      for (const k of ['hours', 'expense', 'invoiced', 'received', 'debt', 'profit', 'expectedProfit']) t[k] += r[k];
      for (const ph of ['build', 'support']) { t[ph].hours += r[ph].hours; t[ph].expense += r[ph].expense; }
      return t;
    }, { client: 'Итого', projects: 0, hours: 0, expense: 0, invoiced: 0, received: 0, debt: 0, profit: 0, expectedProfit: 0, build: blankSplit(), support: blankSplit() }));
    return { own, inherited, totalOwn: total(own), totalInherited: total(inherited), total: total(own.concat(inherited)) };
  }

  // ─── Дебиторка ───────────────────────────────────────────────
  function receivables(data, opt) {
    const today = (opt && opt.today) || todayISO();
    const out = [];
    for (const inv of data.invoices) {
      if (inv.status !== 'sent') continue;
      const p = data.projects.find(x => x.id === inv.projectId);
      const paid = data.payments.filter(x => x.invoiceId === inv.id).reduce((s, x) => s + n(x.amount), 0);
      const amountUSD = invoiceUSD(data, inv);
      const outstanding = amountUSD - paid;
      if (outstanding <= 0.005) continue;
      out.push({
        invoiceId: inv.id, projectId: inv.projectId, site: p ? p.site : '?',
        clientId: p ? p.clientId : '', client: p ? refName(data.clients, p.clientId) : '',
        description: inv.description || '', currency: inv.currency, amount: n(inv.amount),
        amountUSD: r2(amountUSD), paid: r2(paid), outstanding: r2(outstanding),
        issuedAt: inv.issuedAt, ageDays: daysBetween(inv.issuedAt, today),
      });
    }
    return out.sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0));
  }

  // ─── Контроль качества данных ───────────────────────────────
  function dataIssues(data, opt) {
    const today = (opt && opt.today) || todayISO();
    const issues = [];
    const add = (type, title, extra) => issues.push(Object.assign({ type, title }, extra));
    const site = id => (data.projects.find(p => p.id === id) || {}).site || '?';

    for (const p of data.projects) {
      const hrs = data.hours.filter(h => h.projectId === p.id && n(h.hours) > 0);
      const invs = data.invoices.filter(i => i.projectId === p.id && isActiveInvoice(i));
      if (hrs.length && !invs.length) {
        const s = projectStats(data, p);
        add('hours_no_invoices', `${p.site}: есть часы, нет счетов`, { projectId: p.id, site: p.site, hours: s.hours, amount: s.profit });
      }
      if (p.status === 'Сдан' && !p.deliveryMonth) add('delivered_no_month', `${p.site}: статус «Сдан», но не указан месяц сдачи`, { projectId: p.id, site: p.site });
      if (!p.origin) add('origin_unknown', `${p.site}: не указано происхождение (свой / чужой)`, { projectId: p.id, site: p.site });
      if (p.needsFullInvoice) add('needs_full_invoice', `${p.site}: частично оплачен — выставь счёт на полную сумму`, { projectId: p.id, site: p.site });
      // support-часы без счёта, выставленного в тот же месяц
      const invMonths = new Set(invs.map(i => dateToMonth(i.issuedAt)));
      const supMonths = [...new Set(hrs.filter(h => h.phase === 'support').map(h => h.month))].filter(m => !invMonths.has(m)).sort(cmpMonth);
      if (supMonths.length && invs.length) {
        const h = hrs.filter(x => x.phase === 'support' && supMonths.includes(x.month)).reduce((s, x) => s + n(x.hours), 0);
        add('support_not_invoiced', `${p.site}: часы поддержки без счёта в том же месяце (${supMonths.join(', ')})`, { projectId: p.id, site: p.site, months: supMonths, hours: r2(h) });
      }
      if (p.deliveryMonth && isMonth(p.deliveryMonth) && p.origin !== 'inherited') {
        const late = hrs.filter(h => h.phase === 'build' && cmpMonth(h.month, p.deliveryMonth) > 0);
        if (late.length) add('build_after_delivery', `${p.site}: часы «разработки» после сдачи (${p.deliveryMonth})`, { projectId: p.id, site: p.site, months: [...new Set(late.map(h => h.month))], entryIds: late.map(h => h.id) });
      }
    }
    for (const inv of data.invoices) {
      if (inv.status !== 'sent') continue;
      const age = daysBetween(inv.issuedAt, today);
      if (age !== null && age > OVERDUE_DAYS) add('invoice_overdue', `${site(inv.projectId)}: счёт висит ${age} дн.`, { projectId: inv.projectId, site: site(inv.projectId), invoiceId: inv.id, ageDays: age });
    }
    for (const x of data.payments) if (!x.invoiceId) add('payment_unlinked', `${site(x.projectId)}: поступление $${r2(x.amount)} (${x.month}) без счёта`, { projectId: x.projectId, site: site(x.projectId), paymentId: x.id });
    for (const x of data.payments) if (!isMonth(x.month)) add('payment_no_month', `${site(x.projectId)}: поступление без месяца`, { projectId: x.projectId, site: site(x.projectId), paymentId: x.id });
    // Записи из миграции без описания не считаем — их сотни, описание к ним уже не восстановить
    const noNote = data.hours.filter(h => !h.migrated && n(h.hours) > 0 && !String(h.note || '').trim());
    for (const h of noNote) add('hours_no_note', `${site(h.projectId)}: ${h.hours} ч за ${h.month} без описания`, { projectId: h.projectId, site: site(h.projectId), entryId: h.id });
    for (const m of data.months) if (!(n(m.eurRate) > 0)) add('month_no_rate', `${m.month}: не задан курс €→$ (используется общий ${data.settings.eurRate})`, { month: m.month });
    return issues;
  }

  // ─── Миграция v1 → v2 ────────────────────────────────────────
  // overrides: { fullInvoice: {site: amountUSD}, hoursSplit: {site: [{hours, rate, kind}]},
  //              inherited: [site], originUnknown: [site], typeAliases: {from: to}, issueDate?: 'YYYY-MM-DD' }
  function migrateV1(old, overrides) {
    const ov = Object.assign({ fullInvoice: {}, hoursSplit: {}, inherited: [], originUnknown: [], typeAliases: {} }, overrides || {});
    const d = normalize({
      schemaVersion: SCHEMA_VERSION,
      settings: { rate: n(old.rate) || 20, costRate: 15, eurRate: n(old.eurRate) || 1.154, expDelay: parseInt(old.expDelay, 10) || 0 },
    });
    d.months = (old.months || []).map(m => ({ month: m, eurRate: n(old.eurRate) || 1.154 }));
    const log = [];
    const alias = t => { for (const [a, b] of Object.entries(ov.typeAliases)) if (normKey(a) === normKey(t)) return b; return t; };
    // Канонические имена — первыми, чтобы дубли склеивались в них
    for (const to of Object.values(ov.typeAliases)) ensureRef(d.types, to);

    for (const op of old.projects || []) {
      const origin = ov.inherited.includes(op.site) ? 'inherited' : ov.originUnknown.includes(op.site) ? '' : 'own';
      const p = {
        id: op.id, site: op.site,
        clientId: ensureRef(d.clients, op.client), typeId: ensureRef(d.types, alias(op.type || '')),
        status: op.status || '', origin, deliveryMonth: op.deliveryMonth || '',
        dop: n(op.dop), refPct: n(op.refPct), warn: !!op.warn, profitShared: op.profitShared || '',
        note: op.note || '',
      };
      d.projects.push(p);

      // 1. Часы → записи (rate из настроек, kind dev), либо реальная разбивка из overrides
      const split = ov.hoursSplit[op.site];
      for (const m of op.months || []) {
        if (!(n(m.hours) > 0)) continue;
        const parts = split && split.month === m.month ? split.parts : [{ hours: n(m.hours), rate: d.settings.rate, kind: 'dev' }];
        if (split && split.month === m.month) {
          const eur = parts.reduce((s, x) => s + x.hours * x.rate, 0);
          const was = n(m.hours) * d.settings.rate;
          // допускаем только расхождение от округления часов в старых данных (68,13 вместо 68,125)
          if (Math.abs(eur - was) > 0.5) throw new Error(`${op.site}: разбивка часов ${eur}€ ≠ ${was}€`);
          log.push(`${op.site} ${m.month}: ${m.hours} экв.ч → ${parts.map(x => `${x.hours}ч×€${x.rate}`).join(' + ')} = ${parts.reduce((s, x) => s + x.hours, 0)} ч, €${r2(eur)}${Math.abs(eur - was) > 0.001 ? ` (было €${r2(was)} — округление часов)` : ''}`);
        }
        for (const x of parts) d.hours.push({
          id: 'h' + uid(), projectId: p.id, month: m.month, hours: x.hours, rate: x.rate, kind: x.kind,
          phase: autoPhase(p, m.month), phaseManual: false, note: '', migrated: true,
        });
      }

      // 2–4. Деньги. income — всё полученное; prepaymentAmt — его часть, пришедшая раньше.
      const income = n(op.income);
      if (income > 0) {
        const prep = Math.min(Math.max(0, n(op.prepaymentAmt)), income);
        const incomeMonth = op.paymentMonth || op.deliveryMonth || '';
        const prepMonth = op.prepaymentMonth || incomeMonth;
        const rest = r2(income - prep);
        const full = ov.fullInvoice[op.site];
        const partial = op.paymentStatus === 'partially paid';
        const invId = 'i' + uid();
        const issueMonth = prep > 0 ? prepMonth : incomeMonth;
        if (partial && !full) p.needsFullInvoice = true;
        d.invoices.push({
          id: invId, projectId: p.id,
          amount: partial && full ? full : income, currency: 'USD',
          issuedAt: monthToDate(issueMonth) || '', description: partial && full ? 'Разработка — полная стоимость' : 'Разработка',
          status: partial && full ? 'sent' : 'paid', migrated: true,
        });
        if (prep > 0) d.payments.push({ id: 'p' + uid(), projectId: p.id, invoiceId: invId, amount: prep, receivedAt: monthToDate(prepMonth), month: prepMonth, note: 'Предоплата (миграция)', migrated: true });
        if (rest > 0) d.payments.push({ id: 'p' + uid(), projectId: p.id, invoiceId: invId, amount: rest, receivedAt: monthToDate(incomeMonth), month: incomeMonth, note: prep > 0 ? 'Остаток (миграция)' : 'Оплата (миграция)', migrated: true });
        if (partial && full) log.push(`${op.site}: счёт $${full} (sent), получено $${income}, долг $${r2(full - income)}`);
      }
      // доплаты по месяцам (extraIncome) → оплаченный счёт + поступление
      for (const m of op.months || []) {
        if (!(n(m.extraIncome) > 0)) continue;
        const invId = 'i' + uid();
        d.invoices.push({ id: invId, projectId: p.id, amount: n(m.extraIncome), currency: 'USD', issuedAt: monthToDate(m.month), description: 'Доплата', status: 'paid', source: 'extra', migrated: true });
        d.payments.push({ id: 'p' + uid(), projectId: p.id, invoiceId: invId, amount: n(m.extraIncome), receivedAt: monthToDate(m.month), month: m.month, note: 'Доплата (миграция)', source: 'extra', migrated: true });
      }
    }
    return { data: d, log };
  }

  root.HexaCore = {
    SCHEMA_VERSION, RU_M, STATUSES, INVOICE_STATUSES, PAY_STATUSES, PAY_STATUS_LABEL, KINDS, PHASES, ORIGINS, OVERDUE_DAYS,
    n, r2, uid, parseMonth, isMonth, monthIdx, idxToMonth, shiftMonth, cmpMonth, monthToDate, dateToMonth, todayISO, daysBetween, inPeriod,
    normKey, findRef, ensureRef, refName,
    monthRate, defaultRate, autoPhase, refreshPhases, syncInvoiceStatus, entryCostEUR, entryCostUSD, invoiceUSD, isActiveInvoice,
    normalize, projectStats, monthlyStats, clientSummary, receivables, dataIssues, migrateV1,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
