// Обмен с 1С:Предприятие через стандартный интерфейс OData (standard.odata)
import { create, logActivity, requirePerm, type Ctx } from '../crud.ts';
import { fail, nowIso, parseJson, round2 } from '../util.ts';
import { demoFetch } from './mock.ts';

export interface SetMap {
  set: string;
  /** CRM field -> 1C property */
  fields: Record<string, string>;
  filter?: string;
}

export interface Preset {
  id: string;
  name: string;
  organizations: string;
  companies: SetMap;
  products: SetMap & { serviceFlag?: string; serviceValue?: string };
  invoices: SetMap & { company: string; organization: string; lines: string; lineProduct: string; lineQty: string; linePrice: string; lineSum: string; lineVat?: string; lineVatSum?: string };
  payments: SetMap & { company: string; invoiceLines?: string; invoiceRef?: string };
}

export const PRESETS: Preset[] = [
  {
    id: 'bp30', name: '1С:Бухгалтерия предприятия 3.0', organizations: 'Catalog_Организации',
    companies: { set: 'Catalog_Контрагенты', fields: { name: 'Description', legal_name: 'НаименованиеПолное', inn: 'ИНН', kpp: 'КПП' }, filter: 'IsFolder eq false and DeletionMark eq false' },
    products: { set: 'Catalog_Номенклатура', fields: { name: 'Description', sku: 'Артикул' }, filter: 'IsFolder eq false and DeletionMark eq false', serviceFlag: 'Услуга', serviceValue: 'true' },
    invoices: { set: 'Document_СчетНаОплатуПокупателю', fields: { number: 'Number', date: 'Date', total: 'СуммаДокумента' }, company: 'Контрагент_Key', organization: 'Организация_Key',
      lines: 'Товары', lineProduct: 'Номенклатура_Key', lineQty: 'Количество', linePrice: 'Цена', lineSum: 'Сумма', lineVat: 'СтавкаНДС', lineVatSum: 'СуммаНДС' },
    payments: { set: 'Document_ПоступлениеНаРасчетныйСчет', fields: { number: 'Number', date: 'Date', amount: 'СуммаДокумента', description: 'НазначениеПлатежа' }, company: 'Контрагент_Key',
      filter: 'Posted eq true', invoiceLines: 'РасшифровкаПлатежа', invoiceRef: 'СчетНаОплату_Key' },
  },
  {
    id: 'ut11', name: '1С:Управление торговлей 11', organizations: 'Catalog_Организации',
    companies: { set: 'Catalog_Контрагенты', fields: { name: 'Description', legal_name: 'НаименованиеПолное', inn: 'ИНН', kpp: 'КПП' }, filter: 'DeletionMark eq false' },
    products: { set: 'Catalog_Номенклатура', fields: { name: 'Description', sku: 'Артикул' }, filter: 'IsFolder eq false and DeletionMark eq false', serviceFlag: 'ТипНоменклатуры', serviceValue: 'Услуга' },
    invoices: { set: 'Document_ЗаказКлиента', fields: { number: 'Number', date: 'Date', total: 'СуммаДокумента' }, company: 'Контрагент_Key', organization: 'Организация_Key',
      lines: 'Товары', lineProduct: 'Номенклатура_Key', lineQty: 'Количество', linePrice: 'Цена', lineSum: 'Сумма', lineVat: 'СтавкаНДС', lineVatSum: 'СуммаНДС' },
    payments: { set: 'Document_ПоступлениеБезналичныхДенежныхСредств', fields: { number: 'Number', date: 'Date', amount: 'СуммаДокумента', description: 'НазначениеПлатежа' }, company: 'Контрагент_Key', filter: 'Posted eq true' },
  },
  {
    id: 'unf', name: '1С:Управление нашей фирмой', organizations: 'Catalog_Организации',
    companies: { set: 'Catalog_Контрагенты', fields: { name: 'Description', legal_name: 'НаименованиеПолное', inn: 'ИНН', kpp: 'КПП' }, filter: 'IsFolder eq false and DeletionMark eq false' },
    products: { set: 'Catalog_Номенклатура', fields: { name: 'Description', sku: 'Артикул' }, filter: 'IsFolder eq false and DeletionMark eq false', serviceFlag: 'ТипНоменклатуры', serviceValue: 'Услуга' },
    invoices: { set: 'Document_СчетНаОплату', fields: { number: 'Number', date: 'Date', total: 'СуммаДокумента' }, company: 'Контрагент_Key', organization: 'Организация_Key',
      lines: 'Запасы', lineProduct: 'Номенклатура_Key', lineQty: 'Количество', linePrice: 'Цена', lineSum: 'Сумма', lineVat: 'СтавкаНДС', lineVatSum: 'СуммаНДС' },
    payments: { set: 'Document_ПоступлениеНаСчет', fields: { number: 'Number', date: 'Date', amount: 'СуммаДокумента', description: 'НазначениеПлатежа' }, company: 'Контрагент_Key', filter: 'Posted eq true' },
  },
];

export interface OnecSettings {
  url: string;
  login: string;
  password: string;
  preset: string;
  organization_key?: string;
  account_id?: number;
  pull_companies: boolean;
  pull_products: boolean;
  pull_payments: boolean;
  push_companies: boolean;
  push_invoices: boolean;
  payments_from?: string;
  interval_min: number;
  overrides?: Partial<Preset>;
  last_sync?: string;
  cml_enabled: boolean;
  cml_login: string;
  cml_password: string;
  cml_last_query?: string;
}

export const DEFAULT_ONEC: OnecSettings = {
  url: '', login: '', password: '', preset: 'bp30', pull_companies: true, pull_products: true, pull_payments: true, push_companies: true, push_invoices: false,
  interval_min: 0, cml_enabled: false, cml_login: 'exchange', cml_password: '',
};

export function onecSettings(ctx: Ctx): OnecSettings {
  const raw = parseJson<Partial<OnecSettings>>(ctx.db.get(`SELECT value FROM settings WHERE key = 'onec'`)?.value, {});
  return { ...DEFAULT_ONEC, ...raw };
}

const MASK = '••••••';

export function publicOnecSettings(ctx: Ctx) {
  requirePerm(ctx, 'settings', 'read');
  const s = onecSettings(ctx);
  return { ...s, password: s.password ? MASK : '', cml_password: s.cml_password ? MASK : '', presets: PRESETS.map((p) => ({ id: p.id, name: p.name })), preset_full: preset(s) };
}

export function saveOnecSettings(ctx: Ctx, body: Partial<OnecSettings>) {
  requirePerm(ctx, 'settings', 'admin');
  const cur = onecSettings(ctx);
  const next: OnecSettings = { ...cur, ...body };
  if (body.password === MASK) next.password = cur.password;
  if (body.cml_password === MASK) next.cml_password = cur.cml_password;
  next.url = String(next.url ?? '').trim().replace(/\/+$/, '');
  ctx.db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('onec', ?)`, [JSON.stringify(next)]);
  ctx.deps.onWrite?.();
  return publicOnecSettings(ctx);
}

export function preset(s: OnecSettings): Preset {
  const base = PRESETS.find((p) => p.id === s.preset) ?? PRESETS[0];
  const o = s.overrides ?? {};
  return {
    ...base,
    organizations: o.organizations ?? base.organizations,
    companies: { ...base.companies, ...(o.companies ?? {}) },
    products: { ...base.products, ...(o.products ?? {}) },
    invoices: { ...base.invoices, ...(o.invoices ?? {}) },
    payments: { ...base.payments, ...(o.payments ?? {}) },
  };
}

export function onecLog(ctx: Ctx, direction: 'in' | 'out', entity: string, status: 'ok' | 'error' | 'warning', message: string, count = 0, details?: unknown) {
  ctx.db.run(`INSERT INTO onec_log (direction, entity, status, message, count, details, created_at, updated_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    [direction, entity, status, message, count, details ? JSON.stringify(details) : null, nowIso(), nowIso(), ctx.user?.id ?? null]);
}

// ---------------- HTTP client ----------------
function isDemo(s: OnecSettings) {
  return s.url.startsWith('demo://');
}

function client(ctx: Ctx, s: OnecSettings) {
  if (!s.url) fail(422, 'Укажите адрес базы 1С');
  const f: typeof fetch = isDemo(s) ? (demoFetch as typeof fetch) : (ctx.deps.fetch ?? globalThis.fetch);
  if (!isDemo(s) && ctx.deps.mode === 'demo') {
    fail(422, 'В демо-версии, которая работает в браузере, подключение к реальной 1С недоступно: браузер блокирует такие запросы. Укажите адрес demo://1c или установите серверную версию.');
  }
  const root = `${s.url}/odata/standard.odata`;
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8' };
  if (s.login) headers.Authorization = 'Basic ' + b64(`${s.login}:${s.password}`);
  const call = async (method: string, path: string, body?: unknown) => {
    const url = `${root}/${path}${path.includes('?') ? '&' : '?'}$format=json`;
    let res: Response;
    try {
      res = await f(encodeURI(url).replace(/'/g, '%27'), { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      fail(502, `1С недоступна: ${(e as Error).message}. Проверьте адрес и что база опубликована на веб-сервере.`);
    }
    const text = await res!.text();
    if (!res!.ok) {
      const msg = parseJson<any>(text, null)?.['odata.error']?.message?.value ?? text.slice(0, 300);
      if (res!.status === 401) fail(502, '1С отклонила логин или пароль (401)');
      if (res!.status === 404) fail(502, `В 1С не найден объект ${path.split('?')[0]} (404). Проверьте, что он включён в состав OData (обработка «Настройка автоматического REST-сервиса»).`);
      fail(502, `1С вернула ошибку ${res!.status}: ${msg}`);
    }
    return parseJson<any>(text, {});
  };
  return { call };
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return globalThis.btoa(bin);
}

async function fetchAll(c: ReturnType<typeof client>, set: string, filter?: string, select?: string[]): Promise<any[]> {
  const out: any[] = [];
  const page = 500;
  for (let skip = 0; skip < 50000; skip += page) {
    const q = [`$top=${page}`, `$skip=${skip}`];
    if (filter) q.push(`$filter=${filter}`);
    if (select?.length) q.push(`$select=${select.join(',')}`);
    const data = await c.call('GET', `${set}?${q.join('&')}`);
    const rows: any[] = data.value ?? [];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

// ---------------- operations ----------------
export async function onecTest(ctx: Ctx) {
  requirePerm(ctx, 'settings', 'admin');
  const s = onecSettings(ctx);
  const p = preset(s);
  const c = client(ctx, s);
  const orgs = await fetchAll(c, p.organizations, 'DeletionMark eq false', ['Ref_Key', 'Description', 'ИНН']);
  const checks: { set: string; ok: boolean; error?: string }[] = [];
  for (const set of [p.companies.set, p.products.set, p.invoices.set, p.payments.set]) {
    try { await c.call('GET', `${set}?$top=1`); checks.push({ set, ok: true }); }
    catch (e) { checks.push({ set, ok: false, error: (e as Error).message }); }
  }
  onecLog(ctx, 'in', 'connection', checks.every((x) => x.ok) ? 'ok' : 'warning', `Проверка подключения: организаций ${orgs.length}`, orgs.length, checks);
  ctx.deps.onWrite?.();
  return { ok: true, organizations: orgs.map((o) => ({ key: o.Ref_Key, name: o.Description, inn: o['ИНН'] })), checks };
}


export async function onecSync(ctx: Ctx, only?: string[]) {
  requirePerm(ctx, 'settings', 'write');
  const s = onecSettings(ctx);
  const p = preset(s);
  const c = client(ctx, s);
  const want = (k: keyof OnecSettings) => (only?.length ? only.includes(String(k)) : Boolean(s[k]));
  const sys: Ctx = { ...ctx, system: true };
  const result: Record<string, { created: number; updated: number; errors: number }> = {};

  if (want('pull_companies')) {
    const r = { created: 0, updated: 0, errors: 0 };
    try {
      const rows = await fetchAll(c, p.companies.set, p.companies.filter, ['Ref_Key', ...Object.values(p.companies.fields)]);
      ctx.db.tx(() => {
        for (const row of rows) {
          const data: Record<string, unknown> = {};
          for (const [crm, one] of Object.entries(p.companies.fields)) if (row[one] != null && row[one] !== '') data[crm] = String(row[one]).trim();
          if (!data.name) continue;
          const ex = ctx.db.get(`SELECT id FROM companies WHERE onec_guid = ?`, [row.Ref_Key])
            ?? (data.inn ? ctx.db.get(`SELECT id FROM companies WHERE inn = ? AND (onec_guid IS NULL OR onec_guid = '')`, [data.inn]) : null);
          if (ex) {
            const sets = Object.keys(data).map((k) => `"${k}" = ?`).join(', ');
            ctx.db.run(`UPDATE companies SET ${sets}, onec_guid = ?, updated_at = ? WHERE id = ?`, [...Object.values(data), row.Ref_Key, nowIso(), ex.id]);
            r.updated++;
          } else {
            create(sys, 'companies', { ...data, kind: 'client', onec_guid: row.Ref_Key, source: 'other' });
            r.created++;
          }
        }
      });
      onecLog(ctx, 'in', 'Контрагенты', 'ok', `Загружено из 1С: новых ${r.created}, обновлено ${r.updated}`, r.created + r.updated);
    } catch (e) { r.errors++; onecLog(ctx, 'in', 'Контрагенты', 'error', (e as Error).message); }
    result.companies = r;
  }

  if (want('pull_products')) {
    const r = { created: 0, updated: 0, errors: 0 };
    try {
      const sel = ['Ref_Key', ...Object.values(p.products.fields)];
      if (p.products.serviceFlag) sel.push(p.products.serviceFlag);
      const rows = await fetchAll(c, p.products.set, p.products.filter, sel);
      ctx.db.tx(() => {
        for (const row of rows) {
          const data: Record<string, unknown> = {};
          for (const [crm, one] of Object.entries(p.products.fields)) if (row[one] != null && row[one] !== '') data[crm] = String(row[one]).trim();
          if (!data.name) continue;
          if (p.products.serviceFlag) data.kind = String(row[p.products.serviceFlag]) === p.products.serviceValue ? 'service' : 'product';
          const ex = ctx.db.get(`SELECT id FROM products WHERE onec_guid = ?`, [row.Ref_Key])
            ?? (data.sku ? ctx.db.get(`SELECT id FROM products WHERE sku = ? AND (onec_guid IS NULL OR onec_guid = '')`, [data.sku]) : null);
          if (ex) {
            const sets = Object.keys(data).map((k) => `"${k}" = ?`).join(', ');
            ctx.db.run(`UPDATE products SET ${sets}, onec_guid = ?, updated_at = ? WHERE id = ?`, [...Object.values(data), row.Ref_Key, nowIso(), ex.id]);
            r.updated++;
          } else {
            create(sys, 'products', { ...data, onec_guid: row.Ref_Key, unit: data.kind === 'service' ? 'усл' : 'шт', is_active: 1 });
            r.created++;
          }
        }
      });
      onecLog(ctx, 'in', 'Номенклатура', 'ok', `Загружено из 1С: новых ${r.created}, обновлено ${r.updated}`, r.created + r.updated);
    } catch (e) { r.errors++; onecLog(ctx, 'in', 'Номенклатура', 'error', (e as Error).message); }
    result.products = r;
  }

  if (want('push_companies')) {
    const r = { created: 0, updated: 0, errors: 0 };
    const rows = ctx.db.all(`SELECT * FROM companies WHERE (onec_guid IS NULL OR onec_guid = '') AND kind IN ('client','supplier','partner') ORDER BY id LIMIT 200`);
    for (const co of rows) {
      const body: Record<string, unknown> = {};
      for (const [crm, one] of Object.entries(p.companies.fields)) if (co[crm]) body[one] = co[crm];
      if (!body.Description) body.Description = co.name;
      if (p.id === 'bp30') body['ЮридическоеФизическоеЛицо'] = String(co.inn ?? '').length === 12 ? 'ФизическоеЛицо' : 'ЮридическоеЛицо';
      try {
        const created = await c.call('POST', p.companies.set, body);
        if (created?.Ref_Key) ctx.db.run(`UPDATE companies SET onec_guid = ? WHERE id = ?`, [created.Ref_Key, co.id]);
        r.created++;
      } catch (e) {
        r.errors++;
        onecLog(ctx, 'out', 'Контрагенты', 'error', `${co.name}: ${(e as Error).message}`);
      }
    }
    if (rows.length) onecLog(ctx, 'out', 'Контрагенты', r.errors ? 'warning' : 'ok', `Выгружено в 1С: ${r.created}, ошибок ${r.errors}`, r.created);
    result.push_companies = r;
  }

  if (want('push_invoices')) {
    const r = { created: 0, updated: 0, errors: 0 };
    const inv = p.invoices;
    const rows = ctx.db.all(`SELECT i.*, c.onec_guid AS company_guid, c.name AS company_name FROM invoices i JOIN companies c ON c.id = i.company_id
      WHERE (i.onec_guid IS NULL OR i.onec_guid = '') AND i.status != 'draft' AND i.status != 'cancelled' ORDER BY i.id LIMIT 100`);
    for (const i of rows) {
      if (!i.company_guid) { r.errors++; onecLog(ctx, 'out', 'Счета', 'warning', `Счёт № ${i.number}: контрагент «${i.company_name}» ещё не выгружен в 1С`); continue; }
      const items = ctx.db.all(`SELECT ii.*, p.onec_guid AS product_guid FROM invoice_items ii LEFT JOIN products p ON p.id = ii.product_id WHERE ii.invoice_id = ?`, [i.id]);
      const lines = items.filter((it) => it.product_guid).map((it, n) => {
        const sum = round2(Number(it.qty) * Number(it.price) * (1 - (Number(it.discount) || 0) / 100));
        const rate = Number(it.vat);
        const line: Record<string, unknown> = { LineNumber: String(n + 1), [inv.lineProduct]: it.product_guid, [inv.lineQty]: Number(it.qty), [inv.linePrice]: Number(it.price), [inv.lineSum]: sum };
        if (inv.lineVat) line[inv.lineVat] = rate > 0 ? `НДС${rate}` : 'БезНДС';
        if (inv.lineVatSum) line[inv.lineVatSum] = rate > 0 ? round2(sum * rate / (100 + rate)) : 0;
        return line;
      });
      if (!lines.length) { r.errors++; onecLog(ctx, 'out', 'Счета', 'warning', `Счёт № ${i.number}: в позициях нет товаров, связанных с 1С`); continue; }
      const body: Record<string, unknown> = { Date: `${i.date}T12:00:00`, [inv.company]: i.company_guid, [inv.lines]: lines, Комментарий: `Vela CRM, счёт № ${i.number}` };
      if (s.organization_key) body[inv.organization] = s.organization_key;
      try {
        const created = await c.call('POST', inv.set, body);
        if (created?.Ref_Key) ctx.db.run(`UPDATE invoices SET onec_guid = ? WHERE id = ?`, [created.Ref_Key, i.id]);
        logActivity(sys, 'invoices', i.id, 'system', `Выгружен в 1С${created?.Number ? ' под номером ' + created.Number : ''}`);
        r.created++;
      } catch (e) { r.errors++; onecLog(ctx, 'out', 'Счета', 'error', `Счёт № ${i.number}: ${(e as Error).message}`); }
    }
    if (rows.length) onecLog(ctx, 'out', 'Счета', r.errors ? 'warning' : 'ok', `Выгружено счетов: ${r.created}, ошибок ${r.errors}`, r.created);
    result.push_invoices = r;
  }

  if (want('pull_payments')) {
    const r = { created: 0, updated: 0, errors: 0 };
    try {
      const pm = p.payments;
      const from = s.payments_from || new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
      const filter = [pm.filter, `Date ge datetime'${from}T00:00:00'`].filter(Boolean).join(' and ');
      const rows = await fetchAll(c, pm.set, filter);
      const account = s.account_id ?? ctx.db.get(`SELECT id FROM fin_accounts WHERE kind = 'bank' ORDER BY id LIMIT 1`)?.id;
      const cat = ctx.db.get(`SELECT id FROM fin_categories WHERE kind='income' AND name LIKE 'Выручка%' ORDER BY id LIMIT 1`)?.id;
      if (!account) fail(422, 'Создайте банковский счёт в Финансах');
      ctx.db.tx(() => {
        for (const row of rows) {
          if (ctx.db.get(`SELECT id FROM fin_operations WHERE onec_guid = ?`, [row.Ref_Key])) continue;
          const company = row[pm.company] ? ctx.db.get(`SELECT id FROM companies WHERE onec_guid = ?`, [row[pm.company]]) : null;
          let invoiceId: number | null = null;
          if (pm.invoiceLines && pm.invoiceRef && Array.isArray(row[pm.invoiceLines])) {
            for (const l of row[pm.invoiceLines]) {
              const inv = l[pm.invoiceRef] ? ctx.db.get(`SELECT id FROM invoices WHERE onec_guid = ?`, [l[pm.invoiceRef]]) : null;
              if (inv) { invoiceId = inv.id; break; }
            }
          }
          create(sys, 'fin_operations', {
            kind: 'income', date: String(row[pm.fields.date] ?? '').slice(0, 10), amount: Number(row[pm.fields.amount] ?? 0), account_id: account, category_id: cat,
            company_id: company?.id ?? null, invoice_id: invoiceId, status: 'fact', source: 'onec', onec_guid: row.Ref_Key,
            description: row[pm.fields.description] || `Поступление № ${row[pm.fields.number] ?? ''} из 1С`,
          });
          r.created++;
        }
      });
      onecLog(ctx, 'in', 'Поступления', 'ok', `Загружено оплат из 1С: ${r.created}`, r.created);
    } catch (e) { r.errors++; onecLog(ctx, 'in', 'Поступления', 'error', (e as Error).message); }
    result.payments = r;
  }

  const next = { ...onecSettings(ctx), last_sync: nowIso() };
  ctx.db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('onec', ?)`, [JSON.stringify(next)]);
  ctx.deps.onWrite?.();
  return { ok: true, result, at: next.last_sync };
}
