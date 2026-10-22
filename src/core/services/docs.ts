// Document templates and print forms
import { create, getRaw, logActivity, requirePerm, type Ctx } from '../crud.ts';
import { ENTITIES, optionLabel } from '../schema.ts';
import { amountInWords, escapeHtml, fail, parseJson, today } from '../util.ts';
import { docTotals, lineSum } from './crm.ts';

const money = (n: unknown) => Number(n ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ruDate = (iso: unknown) => {
  const s = String(iso ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : s;
};
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const longDate = (iso: unknown) => {
  const s = String(iso ?? '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  return `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)} г.`;
};

function companyProfile(ctx: Ctx) {
  return parseJson<Record<string, string>>(ctx.db.get(`SELECT value FROM settings WHERE key = 'company'`)?.value, {});
}

/** Builds the data context used by {{placeholders}} */
export function templateContext(ctx: Ctx, entityType: string, entityId: number): Record<string, any> {
  const ent = ENTITIES[entityType];
  if (!ent) fail(404, 'Неизвестный объект');
  const row = getRaw(ctx.db, entityType, entityId);
  if (!row) fail(404, 'Объект не найден');
  const data: Record<string, any> = { today: longDate(today()), today_short: ruDate(today()) };
  const add = (prefix: string, type: string, r: Record<string, any> | undefined) => {
    if (!r) return;
    const e = ENTITIES[type];
    const o: Record<string, any> = { id: r.id };
    for (const f of e.fields) {
      if (f.internal) continue;
      const v = r[f.key];
      o[f.key] = f.type === 'money' ? money(v) : f.type === 'date' ? ruDate(v) : f.type === 'select' ? optionLabel(type, f.key, v) : v ?? '';
    }
    data[prefix] = o;
  };
  add(entityType.replace(/s$/, ''), entityType, row);
  data.self = data[entityType.replace(/s$/, '')];
  const companyId = entityType === 'companies' ? row!.id : row!.company_id;
  if (companyId) add('company', 'companies', getRaw(ctx.db, 'companies', companyId));
  const contactId = entityType === 'contacts' ? row!.id : row!.contact_id;
  if (contactId) add('contact', 'contacts', getRaw(ctx.db, 'contacts', contactId));
  const dealId = entityType === 'deals' ? row!.id : row!.deal_id;
  if (dealId) {
    const deal = getRaw(ctx.db, 'deals', dealId);
    add('deal', 'deals', deal);
    if (deal) {
      data.deal.amount_words = amountInWords(Number(deal.amount ?? 0));
      const items = ctx.db.all(`SELECT * FROM deal_products WHERE deal_id = ?`, [dealId]);
      data.products_table = itemsTable(items);
    }
  }
  const respId = row!.responsible_id ?? row!.manager_id;
  if (respId) add('responsible', 'users', getRaw(ctx.db, 'users', respId));
  const le = ctx.db.get(`SELECT * FROM legal_entities ORDER BY is_default DESC, id LIMIT 1`);
  add('our', 'legal_entities', le);
  data.company_profile = companyProfile(ctx);
  return data;
}

function itemsTable(items: Record<string, any>[]): string {
  if (!items.length) return '';
  const rows = items.map((it, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(it.name)}</td><td class="r">${it.qty}</td><td>${escapeHtml(it.unit ?? '')}</td><td class="r">${money(it.price)}</td><td class="r">${money(lineSum(it))}</td></tr>`).join('');
  const total = items.reduce((s, it) => s + lineSum(it), 0);
  return `<table class="items"><thead><tr><th>№</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="5" class="r"><b>Итого:</b></td><td class="r"><b>${money(total)}</b></td></tr></tfoot></table>`;
}

export function renderTemplate(body: string, data: Record<string, any>): string {
  return String(body ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const v = path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), data);
    if (v == null) return '';
    // tables are pre-rendered HTML, everything else is escaped
    return path.endsWith('_table') ? String(v) : escapeHtml(v);
  });
}

export function generateDocument(ctx: Ctx, body: { template_id: number; entity_type: string; entity_id: number }) {
  requirePerm(ctx, 'documents', 'write');
  const tpl = getRaw(ctx.db, 'doc_templates', body.template_id);
  if (!tpl) fail(404, 'Шаблон не найден');
  const data = templateContext(ctx, body.entity_type, body.entity_id);
  const row = getRaw(ctx.db, body.entity_type, body.entity_id)!;
  const html = renderTemplate(tpl!.body, data);
  const title = String(row[ENTITIES[body.entity_type].titleField] ?? '');
  const doc = create(ctx, 'documents', {
    name: `${tpl!.name} — ${title}`, template_id: tpl!.id, entity_type: body.entity_type, entity_id: body.entity_id,
    company_id: body.entity_type === 'companies' ? row.id : row.company_id ?? null, deal_id: body.entity_type === 'deals' ? row.id : row.deal_id ?? null,
    status: 'draft', body: html,
  });
  logActivity(ctx, body.entity_type, body.entity_id, 'system', `Сформирован документ «${tpl!.name}»`);
  return doc;
}

// ---------------- print forms ----------------
const PRINT_CSS = `
  body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:24px auto;max-width:780px}
  h1{font-size:18px;margin:18px 0 10px} table{border-collapse:collapse;width:100%}
  .bank td{border:1px solid #000;padding:4px 6px;vertical-align:top} .items th,.items td{border:1px solid #000;padding:4px 6px}
  .items th{background:#f2f2f2} .r{text-align:right} .muted{color:#555} .sign{margin-top:36px;display:flex;justify-content:space-between;gap:24px}
  .sign div{flex:1;border-top:1px solid #000;padding-top:4px} .totals td{padding:2px 6px} hr{border:0;border-top:2px solid #000;margin:8px 0}
  .doc-body{font-size:13px;line-height:1.5}
  @media print{.noprint{display:none}}`;

function page(title: string, inner: string) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head>
<body><div class="noprint" style="text-align:right;margin-bottom:12px"><button onclick="window.print()" style="padding:8px 16px;font-size:14px;cursor:pointer">Печать / PDF</button></div>${inner}</body></html>`;
}

export function printInvoice(ctx: Ctx, id: number): string {
  requirePerm(ctx, 'crm', 'read');
  const inv = getRaw(ctx.db, 'invoices', id);
  if (!inv) fail(404, 'Счёт не найден');
  const items = ctx.db.all(`SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id`, [id]);
  const le = (inv!.legal_entity_id ? getRaw(ctx.db, 'legal_entities', inv!.legal_entity_id) : ctx.db.get(`SELECT * FROM legal_entities ORDER BY is_default DESC, id LIMIT 1`)) ?? {};
  const c = getRaw(ctx.db, 'companies', inv!.company_id) ?? {};
  const t = docTotals(items, inv!.vat_mode);
  const vatLabel = inv!.vat_mode === 'none' ? 'Без налога (НДС)' : inv!.vat_mode === 'on_top' ? 'Сумма НДС' : 'В том числе НДС';
  const rows = items.map((it, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(it.name)}</td><td class="r">${it.qty}</td><td>${escapeHtml(it.unit ?? '')}</td><td class="r">${money(Number(it.price) * (1 - (Number(it.discount) || 0) / 100))}</td><td class="r">${money(lineSum(it))}</td></tr>`).join('');
  const inner = `
  <table class="bank">
    <tr><td colspan="2" rowspan="2" style="width:58%">${escapeHtml(le.bank_name ?? '')}<br><span class="muted">Банк получателя</span></td><td>БИК</td><td>${escapeHtml(le.bik ?? '')}</td></tr>
    <tr><td>Сч. №</td><td>${escapeHtml(le.corr_account ?? '')}</td></tr>
    <tr><td>ИНН ${escapeHtml(le.inn ?? '')}</td><td>КПП ${escapeHtml(le.kpp ?? '')}</td><td rowspan="2">Сч. №</td><td rowspan="2">${escapeHtml(le.account_number ?? '')}</td></tr>
    <tr><td colspan="2">${escapeHtml(le.name ?? '')}<br><span class="muted">Получатель</span></td></tr>
  </table>
  <h1>Счёт на оплату № ${escapeHtml(inv!.number)} от ${longDate(inv!.date)}</h1><hr>
  <table class="totals"><tr><td style="width:110px">Поставщик:</td><td><b>${escapeHtml(le.name ?? '')}, ИНН ${escapeHtml(le.inn ?? '')}${le.kpp ? ', КПП ' + escapeHtml(le.kpp) : ''}, ${escapeHtml(le.address ?? '')}</b></td></tr>
  <tr><td>Покупатель:</td><td><b>${escapeHtml(c.legal_name || c.name || '')}${c.inn ? ', ИНН ' + escapeHtml(c.inn) : ''}${c.kpp ? ', КПП ' + escapeHtml(c.kpp) : ''}${c.legal_address ? ', ' + escapeHtml(c.legal_address) : ''}</b></td></tr></table>
  <br><table class="items"><thead><tr><th>№</th><th>Товары (работы, услуги)</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="totals" style="margin-top:6px"><tr><td class="r"><b>Итого:</b></td><td class="r" style="width:120px"><b>${money(t.subtotal)}</b></td></tr>
  <tr><td class="r"><b>${vatLabel}:</b></td><td class="r"><b>${inv!.vat_mode === 'none' ? '—' : money(t.vat)}</b></td></tr>
  <tr><td class="r"><b>Всего к оплате:</b></td><td class="r"><b>${money(t.total)}</b></td></tr></table>
  <p>Всего наименований ${items.length}, на сумму ${money(t.total)} руб.<br><b>${amountInWords(t.total)}</b></p>
  ${inv!.due_date ? `<p class="muted">Оплатить до ${ruDate(inv!.due_date)}. Оплата данного счёта означает согласие с условиями поставки товара.</p>` : ''}
  <hr><div class="sign"><div>Руководитель ${le.director ? '/ ' + escapeHtml(le.director) + ' /' : ''}</div><div>Бухгалтер ${le.accountant ? '/ ' + escapeHtml(le.accountant) + ' /' : ''}</div></div>`;
  return page(`Счёт № ${inv!.number}`, inner);
}

export function printAct(ctx: Ctx, id: number): string {
  requirePerm(ctx, 'crm', 'read');
  const act = getRaw(ctx.db, 'acts', id);
  if (!act) fail(404, 'Акт не найден');
  const items = ctx.db.all(`SELECT * FROM act_items WHERE act_id = ? ORDER BY id`, [id]);
  const le = (act!.legal_entity_id ? getRaw(ctx.db, 'legal_entities', act!.legal_entity_id) : ctx.db.get(`SELECT * FROM legal_entities ORDER BY is_default DESC, id LIMIT 1`)) ?? {};
  const c = getRaw(ctx.db, 'companies', act!.company_id) ?? {};
  const inv = act!.invoice_id ? getRaw(ctx.db, 'invoices', act!.invoice_id) : null;
  const t = docTotals(items, inv?.vat_mode ?? 'included');
  const rows = items.map((it, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(it.name)}</td><td class="r">${it.qty}</td><td>${escapeHtml(it.unit ?? '')}</td><td class="r">${money(it.price)}</td><td class="r">${money(lineSum(it))}</td></tr>`).join('');
  const inner = `
  <h1>Акт № ${escapeHtml(act!.number)} от ${longDate(act!.date)}</h1><hr>
  <table class="totals"><tr><td style="width:110px">Исполнитель:</td><td><b>${escapeHtml(le.name ?? '')}, ИНН ${escapeHtml(le.inn ?? '')}, ${escapeHtml(le.address ?? '')}</b></td></tr>
  <tr><td>Заказчик:</td><td><b>${escapeHtml(c.legal_name || c.name || '')}${c.inn ? ', ИНН ' + escapeHtml(c.inn) : ''}${c.legal_address ? ', ' + escapeHtml(c.legal_address) : ''}</b></td></tr>
  ${inv ? `<tr><td>Основание:</td><td>Счёт № ${escapeHtml(inv.number)} от ${ruDate(inv.date)}</td></tr>` : ''}</table>
  <br><table class="items"><thead><tr><th>№</th><th>Наименование работ, услуг</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="totals" style="margin-top:6px"><tr><td class="r"><b>Итого:</b></td><td class="r" style="width:120px"><b>${money(t.subtotal)}</b></td></tr>
  <tr><td class="r"><b>В том числе НДС:</b></td><td class="r"><b>${money(t.vat)}</b></td></tr></table>
  <p>Всего оказано услуг ${items.length}, на сумму ${money(t.total)} руб.<br><b>${amountInWords(t.total)}</b></p>
  <p>Вышеперечисленные услуги выполнены полностью и в срок. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет.</p>
  <hr><div class="sign"><div>Исполнитель<br><br>${escapeHtml(le.director ?? '')}</div><div>Заказчик<br><br>${escapeHtml(c.name ?? '')}</div></div>`;
  return page(`Акт № ${act!.number}`, inner);
}

export function printDocument(ctx: Ctx, id: number): string {
  requirePerm(ctx, 'documents', 'read');
  const d = getRaw(ctx.db, 'documents', id);
  if (!d) fail(404, 'Документ не найден');
  return page(d!.name, `<div class="doc-body">${d!.body ?? ''}</div>`);
}
