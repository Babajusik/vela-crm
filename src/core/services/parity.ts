// CRM activities, task templates and links, project stages and templates, balance sheet,
// recurring invoices, commercial offers, likes, per-user preferences.
import { create, getRaw, hook, logActivity, notify, requirePerm, update, type Ctx } from '../crud.ts';
import { addDays, addMonths, fail, localDateTime, nowIso, parseJson, round2, today } from '../util.ts';
import { balances } from './finance.ts';
import { docTotals, lineSum } from './crm.ts';
import { escapeHtml, amountInWords } from '../util.ts';

// ---------------- tasks ----------------
function recalcProgress(ctx: Ctx, taskId: number) {
  const r = ctx.db.get(`SELECT COUNT(*) AS total, SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END) AS done FROM checklist_items WHERE task_id = ?`, [taskId]);
  if (!r?.total) return;
  ctx.db.run(`UPDATE tasks SET progress = ? WHERE id = ?`, [Math.round(((r.done ?? 0) / r.total) * 100), taskId]);
}
hook('checklist_items', {
  afterCreate: (ctx, row) => recalcProgress(ctx, row.task_id),
  afterUpdate: (ctx, row) => recalcProgress(ctx, row.task_id),
  afterDelete: (ctx, row) => recalcProgress(ctx, row.task_id),
});

export function markTaskViewed(ctx: Ctx, task: Record<string, any>) {
  if (task.assignee_id === ctx.user.id && !task.viewed_at) {
    const ts = nowIso();
    ctx.db.run(`UPDATE tasks SET viewed_at = ? WHERE id = ?`, [ts, task.id]);
    task.viewed_at = ts;
    ctx.deps.onWrite?.();
  }
}

export function taskFromTemplate(ctx: Ctx, body: { template_id: number; [k: string]: unknown }) {
  const tpl = getRaw(ctx.db, 'task_templates', body.template_id);
  if (!tpl) fail(404, 'Шаблон не найден');
  const due = new Date(Date.now() + (Number(tpl!.duration_days) || 3) * 864e5);
  due.setHours(18, 0, 0, 0);
  const { template_id: _t, ...rest } = body;
  const task = create(ctx, 'tasks', {
    title: tpl!.title, description: tpl!.description, priority: tpl!.priority, assignee_id: tpl!.assignee_id ?? ctx.user.id, estimate_hours: tpl!.estimate_hours,
    tags: parseJson(tpl!.tags, []), deadline: localDateTime(due), template_id: tpl!.id, ...rest,
  });
  parseJson<string[]>(tpl!.checklist, []).forEach((text, i) => create({ ...ctx, system: true }, 'checklist_items', { task_id: task.id, text, sort: i }));
  return getRaw(ctx.db, 'tasks', task.id);
}

hook('tasks', {
  beforeSave(ctx, data) {
    if (data.status === 'done') data.progress = 100;
  },
});

// ---------------- CRM activities («Дела») ----------------
hook('crm_activities', {
  beforeSave(ctx, data, old) {
    if (!old && !data.responsible_id) data.responsible_id = ctx.user?.id ?? null;
    if (!old && data.deal_id && !data.company_id) data.company_id = getRaw(ctx.db, 'deals', data.deal_id)?.company_id ?? null;
    if ('is_done' in data) data.done_at = data.is_done ? nowIso() : null;
  },
  afterCreate(ctx, row) {
    const when = String(row.due_at ?? '').replace('T', ' ');
    if (row.deal_id) logActivity(ctx, 'deals', row.deal_id, 'system', `Запланировано: ${row.subject} — ${when}`);
    notify(ctx, row.responsible_id, `Новое дело: ${row.subject}`, row.deal_id ? `/crm/deals/${row.deal_id}` : '/crm/activities', 'deal');
  },
  afterUpdate(ctx, row, old) {
    if (row.is_done && !old.is_done) {
      const text = `Выполнено: ${row.subject}${row.result ? ` — ${row.result}` : ''}`;
      if (row.deal_id) logActivity(ctx, 'deals', row.deal_id, row.kind === 'call' ? 'call' : row.kind === 'meeting' ? 'meeting' : 'system', text);
      if (row.company_id) logActivity(ctx, 'companies', row.company_id, 'system', text);
    }
  },
});

/** For the deals board: which deals have overdue / today's / any open activities */
export function dealActivityFlags(ctx: Ctx) {
  requirePerm(ctx, 'crm', 'read');
  const now = new Date().toISOString().slice(0, 16);
  const t = today();
  const rows = ctx.db.all(`SELECT deal_id,
      SUM(CASE WHEN is_done = 0 AND due_at < ? THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN is_done = 0 AND substr(due_at,1,10) = ? THEN 1 ELSE 0 END) AS today,
      SUM(CASE WHEN is_done = 0 THEN 1 ELSE 0 END) AS open
    FROM crm_activities WHERE deal_id IS NOT NULL GROUP BY deal_id`, [now, t]);
  const comments = ctx.db.all(`SELECT entity_id AS deal_id, COUNT(*) AS c FROM activities WHERE entity_type = 'deals' AND kind IN ('comment','call','meeting') GROUP BY entity_id`);
  const out: Record<number, { overdue: number; today: number; open: number; comments: number }> = {};
  for (const r of rows) out[r.deal_id] = { overdue: r.overdue, today: r.today, open: r.open, comments: 0 };
  for (const c of comments) (out[c.deal_id] ??= { overdue: 0, today: 0, open: 0, comments: 0 }).comments = c.c;
  return out;
}

/** «Все контрагенты»: companies and contacts in one list */
export function counterparties(ctx: Ctx, q: { q?: string; limit?: string }) {
  requirePerm(ctx, 'crm', 'read');
  const like = `%${String(q.q ?? '').toLowerCase()}%`;
  const limit = Math.min(Number(q.limit) || 200, 1000);
  return ctx.db.all(`
    SELECT 'companies' AS entity, c.id AS id, c.name AS name, c.inn AS sub, c.phone AS phone, c.email AS email, u.name AS responsible, c.updated_at AS updated_at FROM companies c LEFT JOIN users u ON u.id = c.responsible_id
      WHERE lower(c.name) LIKE ? OR lower(COALESCE(c.inn,'')) LIKE ? OR lower(COALESCE(c.phone,'')) LIKE ?
    UNION ALL
    SELECT 'contacts', k.id, k.name, co.name, k.phone, k.email, u.name, k.updated_at FROM contacts k LEFT JOIN companies co ON co.id = k.company_id LEFT JOIN users u ON u.id = k.responsible_id
      WHERE lower(k.name) LIKE ? OR lower(COALESCE(k.phone,'')) LIKE ? OR lower(COALESCE(k.email,'')) LIKE ?
    ORDER BY updated_at DESC LIMIT ?`, [like, like, like, like, like, like, limit]);
}

/** Sales report: by manager, source, lost reasons, stage conversion */
export function crmReport(ctx: Ctx, q: { from?: string; to?: string; pipeline_id?: string }) {
  requirePerm(ctx, 'crm', 'read');
  const from = q.from ?? addMonths(today(), -6), to = q.to ?? today();
  const pipe = Number(q.pipeline_id) || ctx.db.get(`SELECT id FROM pipelines ORDER BY is_default DESC, sort, id LIMIT 1`)?.id;
  const base = `FROM deals d JOIN stages s ON s.id = d.stage_id WHERE d.pipeline_id = ? AND substr(d.created_at,1,10) BETWEEN ? AND ?`;
  const p = [pipe, from, to];
  const totals = ctx.db.get(`SELECT COUNT(*) AS created, SUM(CASE WHEN s.kind='won' THEN 1 ELSE 0 END) AS won, SUM(CASE WHEN s.kind='lost' THEN 1 ELSE 0 END) AS lost,
    COALESCE(SUM(CASE WHEN s.kind='won' THEN d.amount END),0) AS won_amount, COALESCE(AVG(CASE WHEN s.kind='won' THEN d.amount END),0) AS avg_check,
    AVG(CASE WHEN s.kind='won' THEN julianday(d.closed_at) - julianday(d.created_at) END) AS avg_days ${base}`, p);
  const managers = ctx.db.all(`SELECT u.id, u.name, u.color, COUNT(*) AS created, SUM(CASE WHEN s.kind='won' THEN 1 ELSE 0 END) AS won,
    SUM(CASE WHEN s.kind='lost' THEN 1 ELSE 0 END) AS lost, COALESCE(SUM(CASE WHEN s.kind='won' THEN d.amount END),0) AS amount
    ${base.replace('FROM deals d', 'FROM deals d LEFT JOIN users u ON u.id = d.responsible_id')} GROUP BY u.id ORDER BY amount DESC`, p);
  const sources = ctx.db.all(`SELECT COALESCE(d.source,'other') AS source, COUNT(*) AS created, SUM(CASE WHEN s.kind='won' THEN 1 ELSE 0 END) AS won,
    COALESCE(SUM(CASE WHEN s.kind='won' THEN d.amount END),0) AS amount ${base} GROUP BY source ORDER BY created DESC`, p);
  const lost = ctx.db.all(`SELECT COALESCE(d.lost_reason,'other') AS reason, COUNT(*) AS count, COALESCE(SUM(d.amount),0) AS amount ${base} AND s.kind='lost' GROUP BY reason ORDER BY count DESC`, p);
  const stages = ctx.db.all(`SELECT s.id, s.name, s.color, s.kind, s.sort, COUNT(d.id) AS now FROM stages s LEFT JOIN deals d ON d.stage_id = s.id AND COALESCE(d.is_archived,0) = 0 WHERE s.pipeline_id = ? GROUP BY s.id ORDER BY s.sort`, [pipe]);
  const created = Number(totals?.created ?? 0);
  return { from, to, pipeline_id: pipe, totals: { ...totals, conversion: created ? Math.round((Number(totals.won) / created) * 100) : null, avg_days: totals?.avg_days ? Math.round(totals.avg_days) : null }, managers, sources, lost, stages };
}

// ---------------- projects: stages & templates ----------------
hook('project_stages', {
  afterUpdate(ctx, row, old) {
    if (row.status === 'done' && old.status !== 'done') {
      const next = ctx.db.get(`SELECT id FROM project_stages WHERE project_id = ? AND status = 'pending' ORDER BY sort, id LIMIT 1`, [row.project_id]);
      if (next) ctx.db.run(`UPDATE project_stages SET status = 'active' WHERE id = ?`, [next.id]);
      logActivity(ctx, 'projects', row.project_id, 'system', `Этап «${row.name}» завершён`);
    }
  },
});

export function projectStagesSummary(ctx: Ctx, ids: number[]) {
  if (!ids.length) return {};
  const rows = ctx.db.all(`SELECT project_id, name, status, sort FROM project_stages WHERE project_id IN (${ids.map(() => '?').join(',')}) ORDER BY project_id, sort, id`, ids);
  const out: Record<number, { stages: { name: string; status: string }[]; current: string | null }> = {};
  for (const r of rows) {
    const e = (out[r.project_id] ??= { stages: [], current: null });
    e.stages.push({ name: r.name, status: r.status });
    if (!e.current && r.status !== 'done') e.current = r.name;
  }
  return out;
}

export function projectFromTemplate(ctx: Ctx, body: { template_id: number; name?: string; company_id?: number; manager_id?: number; start_date?: string; deal_id?: number }) {
  requirePerm(ctx, 'projects', 'write');
  const tpl = getRaw(ctx.db, 'project_templates', body.template_id);
  if (!tpl) fail(404, 'Шаблон проекта не найден');
  const start = body.start_date ?? today();
  const dur = Number(tpl!.duration_days) || 30;
  const p = create(ctx, 'projects', {
    name: body.name || tpl!.name, company_id: body.company_id ?? null, deal_id: body.deal_id ?? null, manager_id: body.manager_id ?? ctx.user.id,
    members: [body.manager_id ?? ctx.user.id], status: 'planning', start_date: start, end_date: addDays(start, dur), template_id: tpl!.id,
    description: tpl!.description,
  });
  const stages = parseJson<{ name: string; days?: number }[]>(tpl!.stages, []);
  let cursor = start;
  stages.forEach((s, i) => {
    const end = addDays(cursor, Math.max(1, s.days ?? Math.round(dur / Math.max(1, stages.length))) - 1);
    create({ ...ctx, system: true }, 'project_stages', { project_id: p.id, name: s.name, sort: i + 1, status: i === 0 ? 'active' : 'pending', date_from: cursor, date_to: end });
    cursor = addDays(end, 1);
  });
  for (const [i, t] of parseJson<{ title: string; offset_days?: number; duration_days?: number; stage?: number }[]>(tpl!.tasks, []).entries()) {
    const s = addDays(start, t.offset_days ?? i * 2);
    create({ ...ctx, system: true }, 'tasks', { title: t.title, project_id: p.id, start_date: s, deadline: `${addDays(s, t.duration_days ?? 3)}T18:00`, assignee_id: body.manager_id ?? ctx.user.id, author_id: ctx.user.id, status: 'new', priority: 'normal', sort: i });
  }
  return getRaw(ctx.db, 'projects', p.id);
}

// ---------------- finance: balance sheet ----------------
export function balanceSheet(ctx: Ctx, q: { date?: string }) {
  requirePerm(ctx, 'finance', 'read');
  const d = q.date ?? today();
  const cash = balances(ctx, d).filter((a) => !a.is_archived).reduce((s, a) => s + a.balance, 0);
  const receivableInvoices = Number(ctx.db.get(`SELECT COALESCE(SUM(total - COALESCE(paid_amount,0)),0) s FROM invoices WHERE status IN ('sent','partially_paid') AND date <= ?`, [d])?.s ?? 0);
  const receivableOther = Number(ctx.db.get(`SELECT COALESCE(SUM(amount - COALESCE(paid_amount,0)),0) s FROM obligations WHERE kind='receivable' AND status='open'`)?.s ?? 0);
  const loansIssued = Number(ctx.db.get(`SELECT COALESCE(SUM(amount - COALESCE(paid_amount,0)),0) s FROM loans WHERE kind='issued' AND status != 'closed'`)?.s ?? 0);
  const advances = Number(ctx.db.get(`SELECT COALESCE(SUM(amount - COALESCE(reported_amount,0)),0) s FROM advances WHERE status != 'closed'`)?.s ?? 0);
  const stock = Number(ctx.db.get(`SELECT COALESCE(SUM(COALESCE(stock,0) * COALESCE(purchase_price,0)),0) s FROM products WHERE kind = 'product'`)?.s ?? 0);
  let fixed = 0;
  for (const a of ctx.db.all(`SELECT cost, purchase_date, useful_life_months FROM assets WHERE status != 'written_off'`)) {
    const months = a.purchase_date ? Math.max(0, (new Date(d).getTime() - new Date(a.purchase_date).getTime()) / (30.44 * 864e5)) : 0;
    const life = Number(a.useful_life_months) || 36;
    fixed += Math.max(0, Number(a.cost || 0) * (1 - Math.min(1, months / life)));
  }
  const payables = Number(ctx.db.get(`SELECT COALESCE(SUM(amount - COALESCE(paid_amount,0)),0) s FROM obligations WHERE kind='payable' AND status='open'`)?.s ?? 0);
  const loansReceived = Number(ctx.db.get(`SELECT COALESCE(SUM(amount - COALESCE(paid_amount,0)),0) s FROM loans WHERE kind='received' AND status != 'closed'`)?.s ?? 0);
  const salaries = Number(ctx.db.get(`SELECT COALESCE(SUM(total),0) s FROM payroll WHERE status = 'accrued'`)?.s ?? 0);
  const assets = [
    { name: 'Деньги на счетах и в кассах', amount: round2(cash) }, { name: 'Дебиторская задолженность по счетам', amount: round2(receivableInvoices) },
    { name: 'Прочая дебиторская задолженность', amount: round2(receivableOther) }, { name: 'Выданные займы', amount: round2(loansIssued) },
    { name: 'Деньги у подотчётных лиц', amount: round2(advances) }, { name: 'Товарные запасы (по закупочной цене)', amount: round2(stock) },
    { name: 'Основные средства (остаточная стоимость)', amount: round2(fixed) },
  ];
  const liabilities = [
    { name: 'Кредиторская задолженность', amount: round2(payables) }, { name: 'Кредиты и займы полученные', amount: round2(loansReceived) },
    { name: 'Начисленная, но не выплаченная зарплата', amount: round2(salaries) },
  ];
  const ta = round2(assets.reduce((s, x) => s + x.amount, 0));
  const tl = round2(liabilities.reduce((s, x) => s + x.amount, 0));
  return { date: d, assets, liabilities, total_assets: ta, total_liabilities: tl, equity: round2(ta - tl) };
}

// ---------------- recurring invoices ----------------
function shiftPeriod(date: string, period: string) {
  return period === 'year' ? addMonths(date, 12) : period === 'quarter' ? addMonths(date, 3) : addMonths(date, 1);
}

hook('recurring_invoices', {
  beforeSave(ctx, data, old) {
    const items = parseJson<any[]>(data.items ?? old?.items, []);
    if ('items' in data || 'vat_mode' in data) data.total = docTotals(items, data.vat_mode ?? old?.vat_mode ?? 'included').total;
    if (!old && !data.responsible_id) data.responsible_id = ctx.user?.id ?? null;
  },
});

export function runRecurring(ctx: Ctx, id: number) {
  const r = getRaw(ctx.db, 'recurring_invoices', id);
  if (!r) fail(404, 'Регулярный счёт не найден');
  const sys: Ctx = { ...ctx, system: true };
  const date = r!.next_date <= today() ? r!.next_date : today();
  const inv = create(sys, 'invoices', {
    date, due_date: addDays(date, Number(r!.pay_days) || 5), company_id: r!.company_id, contact_id: r!.contact_id, legal_entity_id: r!.legal_entity_id,
    vat_mode: r!.vat_mode, status: r!.auto_send ? 'sent' : 'draft', responsible_id: r!.responsible_id, comment: `По регулярному счёту «${r!.name}»`,
  });
  for (const it of parseJson<any[]>(r!.items, [])) create(sys, 'invoice_items', { invoice_id: inv.id, product_id: it.product_id ?? null, name: it.name, qty: it.qty ?? 1, unit: it.unit ?? 'усл', price: it.price ?? 0, discount: it.discount ?? 0, vat: it.vat ?? '22' });
  ctx.db.run(`UPDATE recurring_invoices SET last_invoice_id = ?, next_date = ?, updated_at = ? WHERE id = ?`, [inv.id, shiftPeriod(r!.next_date, r!.period), nowIso(), id]);
  ctx.deps.onWrite?.();
  return getRaw(ctx.db, 'invoices', inv.id);
}

/** Issue every recurring invoice that is due. Safe to call often. */
export function processRecurring(ctx: Ctx) {
  const due = ctx.db.all(`SELECT id FROM recurring_invoices WHERE is_active = 1 AND next_date <= ?`, [today()]);
  let n = 0;
  for (const r of due) {
    for (let guard = 0; guard < 24; guard++) {
      const cur = getRaw(ctx.db, 'recurring_invoices', r.id);
      if (!cur || cur.next_date > today()) break;
      runRecurring({ ...ctx, system: true }, r.id);
      n++;
    }
  }
  return { created: n };
}

// ---------------- commercial offers ----------------
function recalcOffer(ctx: Ctx, offerId: number) {
  const o = getRaw(ctx.db, 'offers', offerId);
  if (!o) return;
  const items = ctx.db.all(`SELECT * FROM offer_items WHERE offer_id = ?`, [offerId]);
  ctx.db.run(`UPDATE offers SET total = ? WHERE id = ?`, [docTotals(items, o.vat_mode).total, offerId]);
}
hook('offers', {
  beforeSave(ctx, data, old) {
    if (!old) {
      if (!data.number) data.number = String((Number(ctx.db.get(`SELECT MAX(CAST(number AS INTEGER)) n FROM offers`)?.n) || 0) + 1);
      if (!data.valid_until) data.valid_until = addDays(data.date ?? today(), 14);
      if (!data.responsible_id) data.responsible_id = ctx.user?.id ?? null;
      if (!data.legal_entity_id) data.legal_entity_id = ctx.db.get(`SELECT id FROM legal_entities ORDER BY is_default DESC, id LIMIT 1`)?.id ?? null;
    }
  },
  afterUpdate(ctx, row, old) { if (row.vat_mode !== old.vat_mode) recalcOffer(ctx, row.id); },
});
hook('offer_items', {
  beforeSave(ctx, data) {
    if (data.product_id && !data.name) {
      const p = ctx.db.get(`SELECT * FROM products WHERE id = ?`, [data.product_id]);
      if (p) { data.name = p.name; data.price ??= p.price; data.unit ??= p.unit; data.vat ??= p.vat; }
    }
  },
  afterCreate: (ctx, row) => recalcOffer(ctx, row.offer_id),
  afterUpdate: (ctx, row) => recalcOffer(ctx, row.offer_id),
  afterDelete: (ctx, row) => recalcOffer(ctx, row.offer_id),
});

export function offerFromDeal(ctx: Ctx, dealId: number) {
  const d = getRaw(ctx.db, 'deals', dealId);
  if (!d) fail(404, 'Сделка не найдена');
  const offer = create(ctx, 'offers', { date: today(), company_id: d!.company_id, contact_id: d!.contact_id, deal_id: dealId, status: 'draft' });
  for (const it of ctx.db.all(`SELECT * FROM deal_products WHERE deal_id = ?`, [dealId])) {
    create({ ...ctx, system: true }, 'offer_items', { offer_id: offer.id, product_id: it.product_id, name: it.name, qty: it.qty, unit: it.unit, price: it.price, discount: it.discount, vat: it.vat });
  }
  logActivity(ctx, 'deals', dealId, 'system', `Подготовлено коммерческое предложение № ${offer.number}`);
  return getRaw(ctx.db, 'offers', offer.id);
}

export function invoiceFromOffer(ctx: Ctx, offerId: number) {
  const o = getRaw(ctx.db, 'offers', offerId);
  if (!o) fail(404, 'Предложение не найдено');
  if (o!.invoice_id && getRaw(ctx.db, 'invoices', o!.invoice_id)) return getRaw(ctx.db, 'invoices', o!.invoice_id);
  const inv = create(ctx, 'invoices', { date: today(), due_date: addDays(today(), 5), company_id: o!.company_id, contact_id: o!.contact_id, deal_id: o!.deal_id, legal_entity_id: o!.legal_entity_id, vat_mode: o!.vat_mode, status: 'draft' });
  for (const it of ctx.db.all(`SELECT * FROM offer_items WHERE offer_id = ?`, [offerId])) {
    create({ ...ctx, system: true }, 'invoice_items', { invoice_id: inv.id, product_id: it.product_id, name: it.name, qty: it.qty, unit: it.unit, price: it.price, discount: it.discount, vat: it.vat });
  }
  ctx.db.run(`UPDATE offers SET invoice_id = ?, status = 'accepted' WHERE id = ?`, [inv.id, offerId]);
  logActivity(ctx, 'offers', offerId, 'system', `Выставлен счёт № ${inv.number}`);
  ctx.deps.onWrite?.();
  return getRaw(ctx.db, 'invoices', inv.id);
}

export function printOffer(ctx: Ctx, id: number): string {
  requirePerm(ctx, 'finance', 'read');
  const o = getRaw(ctx.db, 'offers', id);
  if (!o) fail(404, 'Предложение не найдено');
  const items = ctx.db.all(`SELECT * FROM offer_items WHERE offer_id = ? ORDER BY id`, [id]);
  const le = (o!.legal_entity_id ? getRaw(ctx.db, 'legal_entities', o!.legal_entity_id) : null) ?? {};
  const c = getRaw(ctx.db, 'companies', o!.company_id) ?? {};
  const resp = o!.responsible_id ? getRaw(ctx.db, 'users', o!.responsible_id) : null;
  const t = docTotals(items, o!.vat_mode);
  const m = (n: unknown) => Number(n ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = (s: string) => s ? s.split('-').reverse().join('.') : '';
  const rows = items.map((it, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(it.name)}</td><td class="r">${it.qty}</td><td>${escapeHtml(it.unit ?? '')}</td><td class="r">${m(it.price)}</td><td class="r">${it.discount ? it.discount + '%' : ''}</td><td class="r">${m(lineSum(it))}</td></tr>`).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Коммерческое предложение № ${escapeHtml(o!.number)}</title><style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;margin:24px auto;max-width:780px;line-height:1.5}
  h1{font-size:22px;margin:4px 0 2px} .muted{color:#666} table{border-collapse:collapse;width:100%;margin:14px 0} th,td{border:1px solid #ccc;padding:6px 8px} th{background:#f3f5f8;text-align:left}
  .r{text-align:right} .head{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #0b8a7a;padding-bottom:12px;margin-bottom:16px}
  @media print{.noprint{display:none}}</style></head><body>
  <div class="noprint" style="text-align:right;margin-bottom:12px"><button onclick="window.print()" style="padding:8px 16px;font-size:14px;cursor:pointer">Печать / PDF</button></div>
  <div class="head"><div><b>${escapeHtml(le.name ?? '')}</b><br><span class="muted">ИНН ${escapeHtml(le.inn ?? '')} · ${escapeHtml(le.address ?? '')}</span></div>
  <div class="r muted">№ ${escapeHtml(o!.number)} от ${d(o!.date)}<br>Действует до ${d(o!.valid_until)}</div></div>
  <p class="muted">Для: <b style="color:#111">${escapeHtml(c.legal_name || c.name || '')}</b></p>
  <h1>Коммерческое предложение</h1>
  ${o!.intro ? `<p>${escapeHtml(o!.intro).replace(/\n/g, '<br>')}</p>` : ''}
  <table><thead><tr><th>№</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Скидка</th><th>Сумма</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="r"><b>Итого: ${m(t.total)} ₽</b>${o!.vat_mode === 'none' ? ' (без НДС)' : `, в т. ч. НДС ${m(t.vat)} ₽`}<br><span class="muted">${amountInWords(t.total)}</span></p>
  ${o!.terms ? `<h3>Условия</h3><p>${escapeHtml(o!.terms).replace(/\n/g, '<br>')}</p>` : ''}
  ${resp ? `<p class="muted">Ваш менеджер: <b style="color:#111">${escapeHtml(resp.name)}</b>${resp.phone ? ', ' + escapeHtml(resp.phone) : ''}, ${escapeHtml(resp.email ?? '')}</p>` : ''}
  </body></html>`;
}

// ---------------- likes ----------------
export function toggleLike(ctx: Ctx, activityId: number) {
  const a = getRaw(ctx.db, 'activities', activityId);
  if (!a) fail(404, 'Запись не найдена');
  const likes = parseJson<number[]>(a!.likes, []);
  const next = likes.includes(ctx.user.id) ? likes.filter((x) => x !== ctx.user.id) : [...likes, ctx.user.id];
  ctx.db.run(`UPDATE activities SET likes = ? WHERE id = ?`, [JSON.stringify(next), activityId]);
  ctx.deps.onWrite?.();
  return { likes: next };
}

// ---------------- per-user preferences ----------------
export function getPref(ctx: Ctx, key: string) {
  return parseJson(ctx.db.get(`SELECT value FROM settings WHERE key = ?`, [`pref:${ctx.user.id}:${key}`])?.value, null);
}
export function setPref(ctx: Ctx, key: string, value: unknown) {
  if (!/^[\w-]{1,40}$/.test(key)) fail(422, 'Некорректный ключ');
  ctx.db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [`pref:${ctx.user.id}:${key}`, JSON.stringify(value)]);
  ctx.deps.onWrite?.();
  return value;
}

export { update };
