import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.ts';
import { init, handle, type Deps } from '../src/core/index.ts';

const db = openDb(':memory:');
const deps: Deps = { db, mode: 'server', log: (...a) => console.error(...a) };
await init(db, { demo: true });

let token = '';
const call = async (method: string, path: string, body?: unknown, query: Record<string, string> = {}) => {
  const res = await handle(deps, { method, path, query, body, token });
  if (res.status !== 200) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
};

test('login with demo credentials', async () => {
  const bad = await handle(deps, { method: 'POST', path: '/api/auth/login', query: {}, body: { email: 'admin@vela.demo', password: 'wrong' } });
  assert.equal(bad.status, 401);
  const r = await call('POST', '/api/auth/login', { email: 'admin@vela.demo', password: 'demo1234' });
  token = r.token;
  assert.ok(token);
  const me = await call('GET', '/api/auth/me');
  assert.equal(me.user.email, 'admin@vela.demo');
});

test('unauthenticated request is rejected', async () => {
  const r = await handle(deps, { method: 'GET', path: '/api/e/deals', query: {} });
  assert.equal(r.status, 401);
});

test('lists, search and dashboard work', async () => {
  const deals = await call('GET', '/api/e/deals', undefined, { limit: '5' });
  assert.ok(deals.total > 50);
  assert.ok(deals.items[0]._ref.stage_id.title);
  const s = await call('GET', '/api/search', undefined, { q: 'вектор' });
  assert.ok(s.length > 0);
  const d = await call('GET', '/api/dashboard');
  assert.ok(d.sales.funnel.length >= 6);
  assert.ok(d.finance.balance !== undefined);
});

test('deal flow: products, automation creates invoice, payment, act', async () => {
  const stages = (await call('GET', '/api/e/stages', undefined, { limit: '100' })).items;
  const pipe = stages[0].pipeline_id;
  const invoiceStage = stages.find((s: any) => s.pipeline_id === pipe && s.name === 'Счёт выставлен');
  const companies = await call('GET', '/api/e/companies', undefined, { limit: '1' });
  const deal = await call('POST', '/api/e/deals', { title: 'Тестовая сделка', company_id: companies.items[0].id });
  assert.ok(deal.stage_id);
  const products = await call('GET', '/api/e/products', undefined, { limit: '2' });
  await call('POST', '/api/e/deal_products', { deal_id: deal.id, product_id: products.items[0].id, qty: 2 });
  const after = await call('GET', `/api/e/deals/${deal.id}`);
  assert.equal(after.amount, products.items[0].price * 2);
  await call('POST', `/api/deals/${deal.id}/move`, { stage_id: invoiceStage.id });
  const inv = (await call('GET', '/api/e/invoices', undefined, { deal_id: String(deal.id) })).items[0];
  assert.ok(inv, 'automation should create an invoice');
  assert.equal(inv.total, after.amount);
  await call('PATCH', `/api/e/invoices/${inv.id}`, { status: 'sent' });
  const paid = await call('POST', `/api/invoices/${inv.id}/pay`, {});
  assert.equal(paid.status, 'paid');
  const act = await call('POST', `/api/invoices/${inv.id}/act`);
  assert.equal(act.total, inv.total);
  const html = await call('GET', `/api/print/invoice/${inv.id}`);
  assert.match(html.html, /Счёт на оплату/);
  const timeline = await call('GET', `/api/e/deals/${deal.id}/timeline`);
  assert.ok(timeline.some((a: any) => a.kind === 'stage'));
});

test('finance reports', async () => {
  const s = await call('GET', '/api/finance/summary');
  assert.ok(s.series.length >= 6);
  const cf = await call('GET', '/api/finance/cashflow');
  assert.ok(cf.sections.length > 0);
  const pnl = await call('GET', '/api/finance/pnl');
  assert.ok(pnl.total.revenue > 0);
  const cal = await call('GET', '/api/finance/calendar');
  assert.ok(cal.days.length > 20);
  const pr = await call('GET', '/api/finance/projects');
  assert.ok(pr.length >= 5);
});

test('bank statement import (1CClientBankExchange)', async () => {
  const text = ['1CClientBankExchange', 'ВерсияФормата=1.03', 'РасчСчет=40702810900000012345',
    'СекцияДокумент=Платежное поручение', 'Номер=501', 'Дата=10.10.2026', 'Сумма=12500.00', 'ПлательщикСчет=40702810111111111111', 'ПлательщикИНН=7714567890',
    'Плательщик1=ООО «Вектор»', 'ПолучательСчет=40702810900000012345', 'ПолучательИНН=7725112233', 'НазначениеПлатежа=Оплата по счету № 2 за услуги', 'ДатаПоступило=10.10.2026', 'КонецДокумента',
    'СекцияДокумент=Платежное поручение', 'Номер=77', 'Дата=11.10.2026', 'Сумма=4300.00', 'ПлательщикСчет=40702810900000012345', 'ПлательщикИНН=7725112233',
    'ПолучательСчет=40702810222222222222', 'ПолучательИНН=7700000001', 'Получатель1=ООО «Связь Онлайн»', 'НазначениеПлатежа=Оплата за интернет и телефонию', 'ДатаСписано=11.10.2026', 'КонецДокумента',
    'КонецФайла'].join('\n');
  const dry = await call('POST', '/api/finance/import-statement', { text, dry_run: true });
  assert.equal(dry.total, 2);
  assert.equal(dry.preview[0].kind, 'income');
  assert.equal(dry.preview[1].kind, 'expense');
  const res = await call('POST', '/api/finance/import-statement', { text });
  assert.equal(res.created, 2);
  const again = await call('POST', '/api/finance/import-statement', { text });
  assert.equal(again.skipped, 2, 'duplicates are skipped');
});

test('1C: OData sync against demo base', async () => {
  const t = await call('POST', '/api/onec/test');
  assert.equal(t.organizations.length, 1);
  const r = await call('POST', '/api/onec/sync', {});
  assert.ok(r.result.companies.created + r.result.companies.updated >= 6);
  assert.ok(r.result.products.created + r.result.products.updated >= 6);
  assert.ok(r.result.payments.created >= 3);
  const vector = (await call('GET', '/api/e/companies', undefined, { inn: '7714567890' })).items;
  assert.equal(vector.length, 1, 'matched by INN, not duplicated');
  assert.ok(vector[0].onec_guid);
});

test('1C: CommerceML catalog, offers and orders', async () => {
  const importXml = `<?xml version="1.0" encoding="UTF-8"?><КоммерческаяИнформация ВерсияСхемы="2.10">
  <Классификатор><Ид>cls</Ид><Наименование>Классификатор</Наименование><Группы><Группа><Ид>grp-1</Ид><Наименование>Кофе</Наименование></Группа></Группы></Классификатор>
  <Каталог><Ид>cat</Ид><Наименование>Каталог</Наименование><Товары>
    <Товар><Ид>prod-guid-1</Ид><Артикул>CF-01</Артикул><Наименование>Кофе в зёрнах 1 кг</Наименование><БазоваяЕдиница Код="796">шт</БазоваяЕдиница><Группы><Ид>grp-1</Ид></Группы>
      <СтавкиНалогов><СтавкаНалога><Наименование>НДС</Наименование><Ставка>22</Ставка></СтавкаНалога></СтавкиНалогов></Товар>
    <Товар><Ид>prod-guid-2</Ид><Артикул>CF-02</Артикул><Наименование>Дегустация</Наименование><ЗначенияРеквизитов><ЗначениеРеквизита><Наименование>ВидНоменклатуры</Наименование><Значение>Услуга</Значение></ЗначениеРеквизита></ЗначенияРеквизитов></Товар>
  </Товары></Каталог></КоммерческаяИнформация>`;
  const r1 = await call('POST', '/api/onec/cml-import', { xml: importXml });
  assert.equal(r1.kind, 'catalog');
  assert.equal(r1.created, 2);
  const offers = `<КоммерческаяИнформация><ПакетПредложений><ТипыЦен><ТипЦены><Ид>p1</Ид><Наименование>Розничная</Наименование></ТипЦены></ТипыЦен><Предложения>
    <Предложение><Ид>prod-guid-1</Ид><Цены><Цена><ИдТипаЦены>p1</ИдТипаЦены><ЦенаЗаЕдиницу>1890,50</ЦенаЗаЕдиницу></Цена></Цены><Количество>14</Количество></Предложение>
  </Предложения></ПакетПредложений></КоммерческаяИнформация>`;
  const r2 = await call('POST', '/api/onec/cml-import', { xml: offers });
  assert.equal(r2.updated, 1);
  const p = (await call('GET', '/api/e/products', undefined, { sku: 'CF-01' })).items[0];
  assert.equal(p.price, 1890.5);
  assert.equal(p.stock, 14);
  const orders = await call('GET', '/api/onec/cml-orders');
  assert.match(orders.xml, /<КоммерческаяИнформация/);
  assert.match(orders.xml, /<Документ>/);
});

test('business process: approve pending discount', async () => {
  const my = await call('GET', '/api/bp/my');
  assert.ok(my.length >= 1);
  const r = await call('POST', `/api/bp/${my[0].id}/decide`, { decision: 'approve', comment: 'Ок' });
  assert.equal(r.status, 'completed');
});

test('vacation request starts approval automatically', async () => {
  const users = (await call('GET', '/api/e/users', undefined, { limit: '20' })).items;
  const kim = users.find((u: any) => u.email === 'kim@vela.demo');
  await call('POST', '/api/e/absences', { user_id: kim.id, type: 'vacation', date_from: '2026-12-01', date_to: '2026-12-10' });
  const inst = (await call('GET', '/api/e/bp_instances', undefined, { limit: '1' })).items[0];
  assert.equal(inst.status, 'running');
  assert.match(inst.name, /отпуска/);
});

test('documents from template', async () => {
  const tpl = (await call('GET', '/api/e/doc_templates')).items[0];
  const deal = (await call('GET', '/api/e/deals', undefined, { limit: '1' })).items[0];
  const doc = await call('POST', '/api/documents/generate', { template_id: tpl.id, entity_type: 'deals', entity_id: deal.id });
  assert.match(doc.body, /ДОГОВОР/);
  assert.doesNotMatch(doc.body, /\{\{/);
});

test('permissions: sales manager cannot read finance', async () => {
  const r = await call('POST', '/api/auth/login', { email: 'orlov@vela.demo', password: 'demo1234' });
  const res = await handle(deps, { method: 'GET', path: '/api/finance/summary', query: {}, token: r.token });
  assert.equal(res.status, 403);
  const users = await handle(deps, { method: 'GET', path: '/api/e/users', query: {}, token: r.token });
  assert.equal(users.status, 200);
  assert.equal((users.body as any).items[0].salary, undefined, 'salaries hidden');
});

test('web form submission creates a deal', async () => {
  const form = await handle(deps, { method: 'GET', path: '/api/public/forms/1', query: {} });
  assert.equal(form.status, 200);
  const sub = await handle(deps, { method: 'POST', path: '/api/public/forms/1', query: {}, body: { name: 'Тест Тестов', phone: '+79990000000', company: 'ООО «Тест»' } });
  assert.equal(sub.status, 200);
  const deals = await call('GET', '/api/e/deals', undefined, { q: 'Тест Тестов' });
  assert.equal(deals.total, 1);
});

test('rich text is sanitized', async () => {
  const sec = (await call('GET', '/api/e/kb_sections')).items[0];
  const a = await call('POST', '/api/e/kb_articles', { section_id: sec.id, title: 'XSS', body: '<p onclick="alert(1)">hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>' });
  assert.doesNotMatch(a.body, /script|onclick|javascript:/);
});
