import { create, getRaw, hook, logActivity, notify, update, emit, requirePerm, type Ctx } from '../crud.ts';
import { addDays, fail, localDateTime, nowIso, parseJson, round2, today } from '../util.ts';

// ---------------- money helpers ----------------
export interface Line { qty: number; price: number; discount?: number; vat?: string | number }

export function lineSum(l: Line | Record<string, any>): number {
  return round2((Number(l.qty) || 0) * (Number(l.price) || 0) * (1 - (Number(l.discount) || 0) / 100));
}

export function docTotals(lines: (Line | Record<string, any>)[], vatMode: string = 'included'): { subtotal: number; vat: number; total: number } {
  let subtotal = 0, vat = 0;
  for (const l of lines) {
    const s = lineSum(l);
    const rate = Number(l.vat ?? -1);
    subtotal += s;
    if (vatMode === 'none' || rate <= 0) continue;
    vat += vatMode === 'on_top' ? s * rate / 100 : s * rate / (100 + rate);
  }
  subtotal = round2(subtotal);
  vat = round2(vat);
  return { subtotal, vat, total: vatMode === 'on_top' ? round2(subtotal + vat) : subtotal };
}

function nextNumber(ctx: Ctx, table: string): string {
  const r = ctx.db.get(`SELECT MAX(CAST(number AS INTEGER)) AS n FROM "${table}"`);
  return String((Number(r?.n) || 0) + 1);
}

// ---------------- deals ----------------
export function recalcDealAmount(ctx: Ctx, dealId: number) {
  const items = ctx.db.all(`SELECT qty, price, discount FROM deal_products WHERE deal_id = ?`, [dealId]);
  if (!items.length) return;
  const sum = round2(items.reduce((s, l) => s + lineSum(l), 0));
  ctx.db.run(`UPDATE deals SET amount = ?, updated_at = ? WHERE id = ?`, [sum, nowIso(), dealId]);
}

hook('deals', {
  beforeSave(ctx, data, old) {
    if (data.stage_id && (!old || Number(old.stage_id) !== Number(data.stage_id))) {
      const st = ctx.db.get(`SELECT * FROM stages WHERE id = ?`, [data.stage_id]);
      if (!st) fail(422, 'Стадия не найдена');
      data.pipeline_id = st.pipeline_id;
      data.closed_at = st.kind === 'open' ? null : nowIso();
    }
    if (!old && !data.stage_id) {
      const pid = data.pipeline_id ?? ctx.db.get(`SELECT id FROM pipelines ORDER BY is_default DESC, sort, id LIMIT 1`)?.id;
      const st = ctx.db.get(`SELECT * FROM stages WHERE pipeline_id = ? ORDER BY sort, id LIMIT 1`, [pid]);
      if (!st) fail(422, 'В воронке нет стадий');
      data.pipeline_id = pid;
      data.stage_id = st.id;
    }
    if (!old && !data.responsible_id) data.responsible_id = ctx.user?.id ?? null;
  },
  afterCreate(ctx, row) {
    notify(ctx, row.responsible_id, `Новая сделка: ${row.title}`, `/crm/deals/${row.id}`, 'deal');
    runAutomations(ctx, row);
  },
  afterUpdate(ctx, row, old) {
    if (Number(old.stage_id) !== Number(row.stage_id)) {
      const a = ctx.db.get(`SELECT name FROM stages WHERE id = ?`, [old.stage_id]);
      const b = ctx.db.get(`SELECT name, kind FROM stages WHERE id = ?`, [row.stage_id]);
      let text = `Стадия: ${a?.name ?? '—'} → ${b?.name ?? '—'}`;
      if (b?.kind === 'lost' && row.lost_reason) text += ` (причина: ${lostReasonLabel(row.lost_reason)})`;
      logActivity(ctx, 'deals', row.id, 'stage', text, { from: old.stage_id, to: row.stage_id });
      emit(ctx, 'deals.stage_changed', row);
      runAutomations(ctx, row);
    }
    if (old.responsible_id !== row.responsible_id) notify(ctx, row.responsible_id, `Вам передана сделка: ${row.title}`, `/crm/deals/${row.id}`, 'deal');
  },
});

function lostReasonLabel(v: string) {
  return ({ price: 'дорого', competitor: 'выбрали конкурента', no_need: 'нет потребности', no_answer: 'не отвечает', budget: 'нет бюджета', timing: 'сроки', other: 'другое' } as Record<string, string>)[v] ?? v;
}

for (const key of ['deal_products']) {
  hook(key, {
    beforeSave(ctx, data) {
      if (data.product_id && !data.name) {
        const p = ctx.db.get(`SELECT * FROM products WHERE id = ?`, [data.product_id]);
        if (p) { data.name = p.name; data.price ??= p.price; data.unit ??= p.unit; data.vat ??= p.vat; }
      }
    },
    afterCreate: (ctx, row) => recalcDealAmount(ctx, row.deal_id),
    afterUpdate: (ctx, row) => recalcDealAmount(ctx, row.deal_id),
    afterDelete: (ctx, row) => recalcDealAmount(ctx, row.deal_id),
  });
}

export function moveDeal(ctx: Ctx, id: number, stageId: number, lostReason?: string) {
  const patch: Record<string, unknown> = { stage_id: stageId };
  if (lostReason) patch.lost_reason = lostReason;
  return update(ctx, 'deals', id, patch);
}

// ---------------- automations ----------------
function runAutomations(ctx: Ctx, deal: Record<string, any>) {
  const rules = ctx.db.all(`SELECT * FROM automations WHERE stage_id = ? AND is_active = 1`, [deal.stage_id]);
  for (const r of rules) {
    const p = parseJson<Record<string, any>>(r.params, {});
    const sys: Ctx = { ...ctx, system: true };
    const who = (v: unknown) => (v === 'responsible' || !v ? deal.responsible_id : Number(v));
    try {
      switch (r.action) {
        case 'create_task': {
          const due = new Date(Date.now() + (Number(p.due_days ?? 1)) * 864e5);
          due.setHours(18, 0, 0, 0);
          create(sys, 'tasks', {
            title: (p.title || 'Задача по сделке') + `: ${deal.title}`, assignee_id: who(p.assignee), author_id: ctx.user?.id,
            deal_id: deal.id, company_id: deal.company_id, deadline: localDateTime(due), priority: p.priority ?? 'normal',
            description: p.description ?? `Создано автодействием «${r.name}»`,
          });
          break;
        }
        case 'notify':
          notify(sys, who(p.user_id), `${p.text || 'Сделка перешла на новую стадию'}: ${deal.title}`, `/crm/deals/${deal.id}`, 'deal');
          break;
        case 'set_responsible':
          if (p.user_id) ctx.db.run(`UPDATE deals SET responsible_id = ? WHERE id = ?`, [Number(p.user_id), deal.id]);
          break;
        case 'create_invoice':
          if (!ctx.db.get(`SELECT id FROM invoices WHERE deal_id = ?`, [deal.id])) invoiceFromDeal(sys, deal.id);
          break;
        case 'start_bp':
          if (p.template_id) emit(sys, 'bp.start', { template_id: p.template_id, entity_type: 'deals', entity_id: deal.id });
          break;
        case 'webhook':
          if (p.url) emit(sys, 'webhook.direct', { url: p.url, event: 'deals.stage_changed', data: deal });
          break;
      }
      logActivity(sys, 'deals', deal.id, 'system', `Автодействие «${r.name}» выполнено`);
    } catch (e) {
      logActivity(sys, 'deals', deal.id, 'system', `Автодействие «${r.name}» не выполнено: ${(e as Error).message}`);
    }
  }
}

// ---------------- deal -> project / invoice ----------------
export function projectFromDeal(ctx: Ctx, dealId: number) {
  requirePerm(ctx, 'projects', 'write');
  const d = getRaw(ctx.db, 'deals', dealId);
  if (!d) fail(404, 'Сделка не найдена');
  if (d!.project_id && getRaw(ctx.db, 'projects', d!.project_id)) return getRaw(ctx.db, 'projects', d!.project_id);
  const p = create(ctx, 'projects', {
    name: d!.title, company_id: d!.company_id, deal_id: d!.id, budget: d!.amount, manager_id: d!.responsible_id ?? ctx.user.id,
    members: [d!.responsible_id ?? ctx.user.id], status: 'planning', start_date: today(), end_date: addDays(today(), 30),
    description: `Создан из сделки «${d!.title}»`,
  });
  ctx.db.run(`UPDATE deals SET project_id = ? WHERE id = ?`, [p.id, dealId]);
  logActivity(ctx, 'deals', dealId, 'system', `Создан проект «${p.name}»`);
  return p;
}

export function invoiceFromDeal(ctx: Ctx, dealId: number) {
  const d = getRaw(ctx.db, 'deals', dealId);
  if (!d) fail(404, 'Сделка не найдена');
  const legal = ctx.db.get(`SELECT id FROM legal_entities ORDER BY is_default DESC, id LIMIT 1`);
  const inv = create(ctx, 'invoices', {
    date: today(), due_date: addDays(today(), 5), company_id: d!.company_id, contact_id: d!.contact_id, deal_id: d!.id,
    legal_entity_id: legal?.id, status: 'draft', responsible_id: d!.responsible_id, vat_mode: 'included',
  });
  const items = ctx.db.all(`SELECT * FROM deal_products WHERE deal_id = ?`, [dealId]);
  if (items.length) {
    for (const it of items) {
      create({ ...ctx, system: true }, 'invoice_items', { invoice_id: inv.id, product_id: it.product_id, name: it.name, qty: it.qty, unit: it.unit, price: it.price, discount: it.discount, vat: it.vat });
    }
  } else {
    create({ ...ctx, system: true }, 'invoice_items', { invoice_id: inv.id, name: d!.title, qty: 1, unit: 'усл', price: d!.amount ?? 0, vat: '22' });
  }
  logActivity(ctx, 'deals', dealId, 'system', `Выставлен счёт № ${inv.number}`);
  return getRaw(ctx.db, 'invoices', inv.id);
}

// ---------------- invoices & acts ----------------
export function recalcInvoice(ctx: Ctx, invoiceId: number) {
  const inv = getRaw(ctx.db, 'invoices', invoiceId);
  if (!inv) return;
  const items = ctx.db.all(`SELECT * FROM invoice_items WHERE invoice_id = ?`, [invoiceId]);
  const { total } = docTotals(items, inv.vat_mode);
  const paid = Number(ctx.db.get(`SELECT COALESCE(SUM(amount),0) AS s FROM fin_operations WHERE invoice_id = ? AND kind = 'income' AND status = 'fact'`, [invoiceId])?.s ?? 0);
  let status = inv.status;
  if (status !== 'cancelled') {
    if (paid > 0 && paid + 0.009 >= total && total > 0) status = 'paid';
    else if (paid > 0) status = 'partially_paid';
    else if (status === 'paid' || status === 'partially_paid') status = 'sent';
  }
  ctx.db.run(`UPDATE invoices SET total = ?, paid_amount = ?, status = ? WHERE id = ?`, [total, round2(paid), status, invoiceId]);
  if (status === 'paid' && inv.status !== 'paid') {
    logActivity(ctx, 'invoices', invoiceId, 'system', 'Счёт оплачен полностью');
    if (inv.deal_id) logActivity(ctx, 'deals', inv.deal_id, 'system', `Счёт № ${inv.number} оплачен`);
    notify(ctx, inv.responsible_id, `Счёт № ${inv.number} оплачен`, `/crm/invoices/${invoiceId}`, 'deal');
  }
}

hook('invoices', {
  beforeSave(ctx, data, old) {
    if (!old) {
      if (!data.number) data.number = nextNumber(ctx, 'invoices');
      if (!data.responsible_id) data.responsible_id = ctx.user?.id;
      if (!data.legal_entity_id) data.legal_entity_id = ctx.db.get(`SELECT id FROM legal_entities ORDER BY is_default DESC, id LIMIT 1`)?.id ?? null;
    }
  },
  afterUpdate(ctx, row, old) { if (old.vat_mode !== row.vat_mode) recalcInvoice(ctx, row.id); },
});

for (const key of ['invoice_items']) {
  hook(key, {
    beforeSave(ctx, data) {
      if (data.product_id && !data.name) {
        const p = ctx.db.get(`SELECT * FROM products WHERE id = ?`, [data.product_id]);
        if (p) { data.name = p.name; data.price ??= p.price; data.unit ??= p.unit; data.vat ??= p.vat; }
      }
    },
    afterCreate: (ctx, row) => recalcInvoice(ctx, row.invoice_id),
    afterUpdate: (ctx, row) => recalcInvoice(ctx, row.invoice_id),
    afterDelete: (ctx, row) => recalcInvoice(ctx, row.invoice_id),
  });
}

export function payInvoice(ctx: Ctx, invoiceId: number, body: { amount?: number; account_id?: number; date?: string; category_id?: number }) {
  requirePerm(ctx, 'crm', 'write');
  const inv = getRaw(ctx.db, 'invoices', invoiceId);
  if (!inv) fail(404, 'Счёт не найден');
  const amount = Number(body.amount ?? (Number(inv!.total) - Number(inv!.paid_amount || 0)));
  if (!(amount > 0)) fail(422, 'Укажите сумму оплаты');
  const account = body.account_id ?? ctx.db.get(`SELECT id FROM fin_accounts WHERE kind = 'bank' AND (is_archived IS NULL OR is_archived = 0) ORDER BY id LIMIT 1`)?.id;
  if (!account) fail(422, 'Создайте счёт в разделе «Финансы → Счета и кассы»');
  const cat = body.category_id ?? ctx.db.get(`SELECT id FROM fin_categories WHERE kind = 'income' AND name LIKE 'Выручка%' ORDER BY id LIMIT 1`)?.id;
  const deal = inv!.deal_id ? getRaw(ctx.db, 'deals', inv!.deal_id) : null;
  create({ ...ctx, system: true }, 'fin_operations', {
    kind: 'income', date: body.date ?? today(), amount, account_id: account, category_id: cat, company_id: inv!.company_id,
    deal_id: inv!.deal_id, project_id: deal?.project_id ?? null, invoice_id: invoiceId, status: 'fact', source: 'invoice',
    description: `Оплата по счёту № ${inv!.number} от ${inv!.date}`,
  });
  logActivity(ctx, 'invoices', invoiceId, 'system', `Зарегистрирована оплата ${amount.toLocaleString('ru-RU')} ₽`);
  return getRaw(ctx.db, 'invoices', invoiceId);
}

export function actFromInvoice(ctx: Ctx, invoiceId: number) {
  const inv = getRaw(ctx.db, 'invoices', invoiceId);
  if (!inv) fail(404, 'Счёт не найден');
  const existing = ctx.db.get(`SELECT * FROM acts WHERE invoice_id = ?`, [invoiceId]);
  if (existing) return existing;
  const act = create(ctx, 'acts', { date: today(), company_id: inv!.company_id, invoice_id: invoiceId, deal_id: inv!.deal_id, legal_entity_id: inv!.legal_entity_id, status: 'draft' });
  for (const it of ctx.db.all(`SELECT * FROM invoice_items WHERE invoice_id = ?`, [invoiceId])) {
    create({ ...ctx, system: true }, 'act_items', { act_id: act.id, product_id: it.product_id, name: it.name, qty: it.qty, unit: it.unit, price: round2(lineSum(it) / (Number(it.qty) || 1)), vat: it.vat });
  }
  logActivity(ctx, 'invoices', invoiceId, 'system', `Создан акт № ${act.number}`);
  return getRaw(ctx.db, 'acts', act.id);
}

function recalcAct(ctx: Ctx, actId: number) {
  const act = getRaw(ctx.db, 'acts', actId);
  if (!act) return;
  const inv = act.invoice_id ? getRaw(ctx.db, 'invoices', act.invoice_id) : null;
  const items = ctx.db.all(`SELECT * FROM act_items WHERE act_id = ?`, [actId]);
  ctx.db.run(`UPDATE acts SET total = ? WHERE id = ?`, [docTotals(items, inv?.vat_mode ?? 'included').total, actId]);
}

hook('acts', { beforeSave(ctx, data, old) { if (!old && !data.number) data.number = nextNumber(ctx, 'acts'); } });
hook('act_items', {
  afterCreate: (ctx, row) => recalcAct(ctx, row.act_id),
  afterUpdate: (ctx, row) => recalcAct(ctx, row.act_id),
  afterDelete: (ctx, row) => recalcAct(ctx, row.act_id),
});

// ---------------- duplicates ----------------
export function findDuplicates(ctx: Ctx, q: { inn?: string; phone?: string; email?: string; name?: string; exclude?: string }) {
  const out: { entity: string; id: number; title: string; reason: string }[] = [];
  const ex = Number(q.exclude) || 0;
  const digits = (s?: string) => (s ?? '').replace(/\D/g, '');
  if (q.inn && q.inn.length >= 10) {
    for (const r of ctx.db.all(`SELECT id, name FROM companies WHERE inn = ? AND id != ?`, [q.inn, ex])) out.push({ entity: 'companies', id: r.id, title: r.name, reason: 'ИНН совпадает' });
  }
  const ph = digits(q.phone).slice(-10);
  if (ph.length === 10) {
    for (const t of ['companies', 'contacts']) {
      for (const r of ctx.db.all(`SELECT id, name, phone FROM ${t} WHERE phone IS NOT NULL AND id != ?`, [ex])) {
        if (digits(r.phone).slice(-10) === ph) out.push({ entity: t, id: r.id, title: r.name, reason: 'Телефон совпадает' });
      }
    }
  }
  if (q.email) {
    for (const t of ['companies', 'contacts']) {
      for (const r of ctx.db.all(`SELECT id, name FROM ${t} WHERE lower(email) = lower(?) AND id != ?`, [q.email.trim(), ex])) out.push({ entity: t, id: r.id, title: r.name, reason: 'Email совпадает' });
    }
  }
  if (q.name && q.name.trim().length >= 3) {
    for (const r of ctx.db.all(`SELECT id, name FROM companies WHERE lower(name) = lower(?) AND id != ?`, [q.name.trim(), ex])) out.push({ entity: 'companies', id: r.id, title: r.name, reason: 'Название совпадает' });
  }
  const seen = new Set<string>();
  return out.filter((x) => { const k = x.entity + x.id; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------------- web forms ----------------
export function publicForm(ctx: Ctx, id: number) {
  const f = getRaw(ctx.db, 'web_forms', id);
  if (!f || !f.is_active) fail(404, 'Форма не найдена или отключена');
  const company = ctx.db.get(`SELECT value FROM settings WHERE key = 'company'`);
  return { id: f!.id, title: f!.title || f!.name, subtitle: f!.subtitle, fields: parseJson(f!.fields, []), company: parseJson(company?.value, {}) };
}

export function submitForm(ctx: Ctx, id: number, values: Record<string, string>) {
  const f = getRaw(ctx.db, 'web_forms', id);
  if (!f || !f.is_active) fail(404, 'Форма не найдена или отключена');
  const fields = parseJson<{ key: string; label: string; required?: boolean }[]>(f!.fields, []);
  for (const fl of fields) if (fl.required && !String(values[fl.key] ?? '').trim()) fail(422, `Заполните поле «${fl.label}»`);
  const sys: Ctx = { ...ctx, system: true };
  const name = values.name || values.fio || 'Без имени';
  let companyId: number | null = null;
  if (values.company) {
    const ex = ctx.db.get(`SELECT id FROM companies WHERE lower(name) = lower(?)`, [values.company.trim()]);
    companyId = ex?.id ?? create(sys, 'companies', { name: values.company.trim(), kind: 'prospect', source: 'form', responsible_id: f!.responsible_id, phone: values.phone, email: values.email }).id;
  }
  let contactId: number | null = null;
  const dup = values.email ? ctx.db.get(`SELECT id FROM contacts WHERE lower(email) = lower(?)`, [values.email.trim()]) : null;
  contactId = dup?.id ?? create(sys, 'contacts', { name, phone: values.phone, email: values.email, company_id: companyId, source: 'form', responsible_id: f!.responsible_id }).id;
  const deal = create(sys, 'deals', {
    title: `Заявка с формы «${f!.name}»: ${name}`, pipeline_id: f!.pipeline_id, stage_id: f!.stage_id, company_id: companyId, contact_id: contactId,
    responsible_id: f!.responsible_id, source: 'form', amount: 0,
  });
  const text = fields.map((fl) => `${fl.label}: ${values[fl.key] ?? ''}`).join('\n');
  logActivity(sys, 'deals', deal.id, 'system', `Заявка с веб-формы\n${text}`);
  ctx.db.run(`UPDATE web_forms SET submissions = COALESCE(submissions,0) + 1 WHERE id = ?`, [id]);
  ctx.deps.onWrite?.();
  return { ok: true, message: f!.success_message || 'Спасибо! Мы свяжемся с вами.' };
}
