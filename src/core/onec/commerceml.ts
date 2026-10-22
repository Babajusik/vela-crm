// CommerceML 2: стандартный «Обмен с сайтом» в 1С (УТ, УНФ, КА, ERP).
// 1С сама приходит на /api/1c/exchange: выгружает каталог (import.xml, offers.xml) и забирает заказы.
import { XMLParser } from 'fast-xml-parser';
import { create, logActivity, type Ctx } from '../crud.ts';
import { escapeHtml, fail, nowIso, round2 } from '../util.ts';
import { onecLog, onecSettings } from './odata.ts';

const ARRAYS = new Set(['Группа', 'Товар', 'Предложение', 'Цена', 'ТипЦены', 'Документ', 'Контрагент', 'ЗначениеРеквизита', 'СтавкаНалога', 'Склад', 'ЗначенияСвойства', 'Ид']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ARRAYS.has(name),
});

const txt = (v: unknown): string => {
  if (v == null) return '';
  if (Array.isArray(v)) return txt(v[0]);
  if (typeof v === 'object') return String((v as Record<string, unknown>)['#text'] ?? '');
  return String(v);
};

function root(xml: string) {
  const doc = parser.parse(xml);
  const r = doc['КоммерческаяИнформация'];
  if (!r) fail(422, 'Это не файл CommerceML (нет элемента КоммерческаяИнформация)');
  return r;
}

export function detectKind(xml: string): 'catalog' | 'offers' | 'orders' | 'unknown' {
  if (/<ПакетПредложений/.test(xml)) return 'offers';
  if (/<Каталог|<Классификатор/.test(xml)) return 'catalog';
  if (/<Документ/.test(xml)) return 'orders';
  return 'unknown';
}

function importGroups(ctx: Ctx, groups: any[] | undefined, parentId: number | null, map: Map<string, number>) {
  for (const gr of groups ?? []) {
    const id = txt(gr['Ид']);
    const name = txt(gr['Наименование']);
    if (!id || !name) continue;
    let row = ctx.db.get(`SELECT id FROM product_categories WHERE onec_guid = ?`, [id]);
    if (row) ctx.db.run(`UPDATE product_categories SET name = ?, parent_id = ? WHERE id = ?`, [name, parentId, row.id]);
    else row = create({ ...ctx, system: true }, 'product_categories', { name, parent_id: parentId, onec_guid: id });
    map.set(id, row.id);
    importGroups(ctx, gr['Группы']?.['Группа'], row.id, map);
  }
}

/** import.xml: классификатор (группы) и каталог (товары) */
export function importCatalog(ctx: Ctx, xml: string) {
  const r = root(xml);
  const groups = new Map<string, number>();
  let created = 0, updated = 0;
  ctx.db.tx(() => {
    importGroups(ctx, r['Классификатор']?.['Группы']?.['Группа'], null, groups);
    for (const p of r['Каталог']?.['Товары']?.['Товар'] ?? []) {
      const guid = txt(p['Ид']).split('#')[0];
      const name = txt(p['Наименование']);
      if (!guid || !name) continue;
      const reqs: any[] = p['ЗначенияРеквизитов']?.['ЗначениеРеквизита'] ?? [];
      const req = (n: string) => txt(reqs.find((x) => txt(x['Наименование']) === n)?.['Значение']);
      const kindText = (req('ВидНоменклатуры') + ' ' + req('ТипНоменклатуры')).toLowerCase();
      const vatRaw = txt(p['СтавкиНалогов']?.['СтавкаНалога']?.[0]?.['Ставка']);
      const vat = /без/i.test(vatRaw) ? '-1' : (/(\d+)/.exec(vatRaw)?.[1] ?? null);
      const groupGuid = txt(p['Группы']?.['Ид']);
      const data: Record<string, unknown> = {
        name, sku: txt(p['Артикул']) || null, description: txt(p['Описание']) || null, barcode: txt(p['Штрихкод']) || null,
        unit: normalizeUnit(txt(p['БазоваяЕдиница'])), kind: /услуг/.test(kindText) ? 'service' : 'product', category_id: groups.get(groupGuid) ?? null, is_active: 1,
      };
      if (vat) data.vat = vat;
      const ex = ctx.db.get(`SELECT id FROM products WHERE onec_guid = ?`, [guid]) ?? (data.sku ? ctx.db.get(`SELECT id FROM products WHERE sku = ? AND (onec_guid IS NULL OR onec_guid = '')`, [data.sku]) : null);
      if (ex) {
        const keys = Object.keys(data);
        ctx.db.run(`UPDATE products SET ${keys.map((k) => `"${k}" = ?`).join(', ')}, onec_guid = ?, updated_at = ? WHERE id = ?`, [...keys.map((k) => data[k]), guid, nowIso(), ex.id]);
        updated++;
      } else {
        create({ ...ctx, system: true }, 'products', { ...data, onec_guid: guid });
        created++;
      }
    }
  });
  onecLog(ctx, 'in', 'Каталог (CommerceML)', 'ok', `Товаров: новых ${created}, обновлено ${updated}, групп ${groups.size}`, created + updated);
  ctx.deps.onWrite?.();
  return { created, updated, groups: groups.size };
}

function normalizeUnit(u: string): string {
  const s = u.toLowerCase();
  if (/^шт/.test(s)) return 'шт';
  if (/^ч/.test(s)) return 'ч';
  if (/^кг/.test(s)) return 'кг';
  if (/^усл/.test(s)) return 'усл';
  if (/^м2|м²/.test(s)) return 'м2';
  if (/^м/.test(s)) return 'м';
  if (/^л/.test(s)) return 'л';
  if (/^уп/.test(s)) return 'упак';
  return u ? 'шт' : 'шт';
}

/** offers.xml: цены и остатки */
export function importOffers(ctx: Ctx, xml: string, priceTypeName?: string) {
  const r = root(xml);
  const pack = r['ПакетПредложений'];
  if (!pack) fail(422, 'В файле нет ПакетПредложений');
  const types: any[] = pack['ТипыЦен']?.['ТипЦены'] ?? [];
  const preferred = types.find((t) => priceTypeName && txt(t['Наименование']).toLowerCase() === priceTypeName.toLowerCase()) ?? types[0];
  const preferredId = preferred ? txt(preferred['Ид']) : '';
  let updated = 0, missing = 0;
  ctx.db.tx(() => {
    for (const o of pack['Предложения']?.['Предложение'] ?? []) {
      const guid = txt(o['Ид']).split('#')[0];
      const prices: any[] = o['Цены']?.['Цена'] ?? [];
      const price = prices.find((p) => txt(p['ИдТипаЦены']) === preferredId) ?? prices[0];
      const qtyRaw = o['Количество'] ?? (o['Остатки'] ? null : undefined);
      const row = ctx.db.get(`SELECT id FROM products WHERE onec_guid = ?`, [guid]);
      if (!row) { missing++; continue; }
      const sets: string[] = [], vals: unknown[] = [];
      if (price) { sets.push('price = ?'); vals.push(round2(Number(txt(price['ЦенаЗаЕдиницу']).replace(',', '.')) || 0)); }
      if (qtyRaw !== undefined && qtyRaw !== null) { sets.push('stock = ?'); vals.push(Number(txt(qtyRaw).replace(',', '.')) || 0); }
      if (!sets.length) continue;
      ctx.db.run(`UPDATE products SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...vals, nowIso(), row.id]);
      updated++;
    }
  });
  onecLog(ctx, 'in', 'Цены и остатки (CommerceML)', missing ? 'warning' : 'ok', `Обновлено товаров: ${updated}${missing ? `, не найдено в каталоге: ${missing}` : ''}`, updated);
  ctx.deps.onWrite?.();
  return { updated, missing, priceType: preferred ? txt(preferred['Наименование']) : null };
}

/** Заказы для 1С: сделки с товарами, изменённые после прошлого обмена */
export function exportOrders(ctx: Ctx): string {
  const s = onecSettings(ctx);
  const since = s.cml_last_query ?? '1970-01-01';
  const deals = ctx.db.all(`SELECT d.*, st.name AS stage_name, st.kind AS stage_kind FROM deals d JOIN stages st ON st.id = d.stage_id
    WHERE d.updated_at > ? AND st.kind != 'lost' AND EXISTS (SELECT 1 FROM deal_products dp WHERE dp.deal_id = d.id) ORDER BY d.id LIMIT 500`, [since]);
  const x = escapeHtml;
  const docs = deals.map((d) => {
    const c = d.company_id ? ctx.db.get(`SELECT * FROM companies WHERE id = ?`, [d.company_id]) : null;
    const contact = d.contact_id ? ctx.db.get(`SELECT * FROM contacts WHERE id = ?`, [d.contact_id]) : null;
    const items = ctx.db.all(`SELECT dp.*, p.onec_guid AS guid, p.kind AS pkind FROM deal_products dp LEFT JOIN products p ON p.id = dp.product_id WHERE dp.deal_id = ?`, [d.id]);
    const total = round2(items.reduce((sum, it) => sum + Number(it.qty) * Number(it.price) * (1 - (Number(it.discount) || 0) / 100), 0));
    const cpName = c?.name ?? contact?.name ?? 'Покупатель';
    const goods = items.map((it) => {
      const sum = round2(Number(it.qty) * Number(it.price) * (1 - (Number(it.discount) || 0) / 100));
      const kind = it.pkind === 'service' ? 'Услуга' : 'Товар';
      return `      <Товар>
        <Ид>${x(it.guid || 'vela-product-' + (it.product_id ?? it.id))}</Ид>
        <Наименование>${x(it.name)}</Наименование>
        <БазоваяЕдиница Код="796" НаименованиеПолное="Штука" МеждународноеСокращение="PCE">${x(it.unit || 'шт')}</БазоваяЕдиница>
        <ЦенаЗаЕдиницу>${Number(it.price).toFixed(2)}</ЦенаЗаЕдиницу>
        <Количество>${Number(it.qty)}</Количество>
        <Сумма>${sum.toFixed(2)}</Сумма>
        <ЗначенияРеквизитов>
          <ЗначениеРеквизита><Наименование>ВидНоменклатуры</Наименование><Значение>${kind}</Значение></ЗначениеРеквизита>
          <ЗначениеРеквизита><Наименование>ТипНоменклатуры</Наименование><Значение>${kind}</Значение></ЗначениеРеквизита>
        </ЗначенияРеквизитов>
      </Товар>`;
    }).join('\n');
    const created = String(d.created_at ?? nowIso());
    return `  <Документ>
    <Ид>vela-deal-${d.id}</Ид>
    <Номер>${d.id}</Номер>
    <Дата>${created.slice(0, 10)}</Дата>
    <ХозОперация>Заказ товара</ХозОперация>
    <Роль>Продавец</Роль>
    <Валюта>руб</Валюта>
    <Курс>1</Курс>
    <Сумма>${total.toFixed(2)}</Сумма>
    <Контрагенты>
      <Контрагент>
        <Ид>${x(c?.onec_guid || 'vela-company-' + (c?.id ?? 'c' + (contact?.id ?? 0)))}</Ид>
        <Наименование>${x(cpName)}</Наименование>
        <ПолноеНаименование>${x(c?.legal_name || cpName)}</ПолноеНаименование>
        <Роль>Покупатель</Роль>
        ${c?.inn ? `<ИНН>${x(c.inn)}</ИНН>` : ''}${c?.kpp ? `<КПП>${x(c.kpp)}</КПП>` : ''}
      </Контрагент>
    </Контрагенты>
    <Время>${created.slice(11, 19) || '12:00:00'}</Время>
    <Комментарий>${x(d.title)}</Комментарий>
    <Товары>
${goods}
    </Товары>
    <ЗначенияРеквизитов>
      <ЗначениеРеквизита><Наименование>Статус заказа</Наименование><Значение>${x(d.stage_name)}</Значение></ЗначениеРеквизита>
      <ЗначениеРеквизита><Наименование>Финальный статус</Наименование><Значение>${d.stage_kind === 'won' ? 'true' : 'false'}</Значение></ЗначениеРеквизита>
    </ЗначенияРеквизитов>
  </Документ>`;
  }).join('\n');
  onecLog(ctx, 'out', 'Заказы (CommerceML)', 'ok', `Передано в 1С заказов: ${deals.length}`, deals.length);
  return `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="${nowIso().slice(0, 19)}">
${docs}
</КоммерческаяИнформация>`;
}

export function markOrdersExported(ctx: Ctx) {
  const s = onecSettings(ctx);
  ctx.db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('onec', ?)`, [JSON.stringify({ ...s, cml_last_query: nowIso() })]);
  ctx.deps.onWrite?.();
}

/** Изменения заказов из 1С (статусы, оплата, отгрузка) пишем в ленту сделки */
export function importOrders(ctx: Ctx, xml: string) {
  const r = root(xml);
  let matched = 0;
  for (const d of r['Документ'] ?? []) {
    const id = /vela-deal-(\d+)/.exec(txt(d['Ид']))?.[1] ?? txt(d['Номер']);
    const deal = id ? ctx.db.get(`SELECT id FROM deals WHERE id = ?`, [Number(id)]) : null;
    if (!deal) continue;
    const reqs: any[] = d['ЗначенияРеквизитов']?.['ЗначениеРеквизита'] ?? [];
    const info = reqs.map((x) => `${txt(x['Наименование'])}: ${txt(x['Значение'])}`).join('; ');
    logActivity({ ...ctx, system: true }, 'deals', deal.id, 'system', `1С: заказ № ${txt(d['Номер'])} обновлён${info ? ' — ' + info : ''}`);
    matched++;
  }
  onecLog(ctx, 'in', 'Заказы (CommerceML)', 'ok', `Получено изменений заказов: ${matched}`, matched);
  ctx.deps.onWrite?.();
  return { matched };
}

export function importAny(ctx: Ctx, xml: string) {
  const kind = detectKind(xml);
  if (kind === 'catalog') return { kind, ...importCatalog(ctx, xml) };
  if (kind === 'offers') return { kind, ...importOffers(ctx, xml) };
  if (kind === 'orders') return { kind, ...importOrders(ctx, xml) };
  return fail(422, 'Не удалось определить тип файла CommerceML');
}
