// Демо-база 1С (адрес demo://1c): имитирует ответы standard.odata, чтобы обмен можно было попробовать без настоящей 1С.

const g = (n: number) => `0a1b2c3d-0000-4000-8000-${String(n).padStart(12, '0')}`;
const day = (shift: number) => new Date(Date.now() + shift * 864e5).toISOString().slice(0, 10) + 'T10:00:00';

const DATA: Record<string, Record<string, unknown>[]> = {
  'Catalog_Организации': [{ Ref_Key: g(1), Description: 'ООО «Вела Технологии»', ИНН: '7701234567', DeletionMark: false }],
  'Catalog_Контрагенты': [
    { Ref_Key: g(101), Description: 'ООО «Северсталь-Трейд»', НаименованиеПолное: 'Общество с ограниченной ответственностью «Северсталь-Трейд»', ИНН: '7810123456', КПП: '781001001' },
    { Ref_Key: g(102), Description: 'АО «Глобус Логистик»', НаименованиеПолное: 'Акционерное общество «Глобус Логистик»', ИНН: '5029876543', КПП: '502901001' },
    { Ref_Key: g(103), Description: 'ИП Кравцов А. Н.', НаименованиеПолное: 'Индивидуальный предприниматель Кравцов Алексей Николаевич', ИНН: '771234567890', КПП: '' },
    { Ref_Key: g(104), Description: 'ООО «Вектор»', НаименованиеПолное: 'Общество с ограниченной ответственностью «Вектор»', ИНН: '7714567890', КПП: '771401001' },
    { Ref_Key: g(105), Description: 'ООО «Стройресурс»', НаименованиеПолное: 'Общество с ограниченной ответственностью «Стройресурс»', ИНН: '6658123498', КПП: '665801001' },
    { Ref_Key: g(106), Description: 'ООО «Альфа-Медиа»', НаименованиеПолное: 'Общество с ограниченной ответственностью «Альфа-Медиа»', ИНН: '7730987123', КПП: '773001001' },
  ],
  'Catalog_Номенклатура': [
    { Ref_Key: g(201), Description: 'Внедрение CRM (пакет «Старт»)', Артикул: 'SRV-START', Услуга: true, ТипНоменклатуры: 'Услуга' },
    { Ref_Key: g(202), Description: 'Настройка обмена с 1С', Артикул: 'SRV-1C', Услуга: true, ТипНоменклатуры: 'Услуга' },
    { Ref_Key: g(203), Description: 'Лицензия на 1 пользователя, 12 мес.', Артикул: 'LIC-12', Услуга: true, ТипНоменклатуры: 'Услуга' },
    { Ref_Key: g(204), Description: 'Ноутбук рабочий 15"', Артикул: 'HW-NB15', Услуга: false, ТипНоменклатуры: 'Запас' },
    { Ref_Key: g(205), Description: 'IP-телефон настольный', Артикул: 'HW-IPPH', Услуга: false, ТипНоменклатуры: 'Запас' },
    { Ref_Key: g(206), Description: 'Обучение сотрудников (группа до 10 чел.)', Артикул: 'SRV-EDU', Услуга: true, ТипНоменклатуры: 'Услуга' },
  ],
  'Document_ПоступлениеНаРасчетныйСчет': [
    { Ref_Key: g(301), Number: 'БП-000101', Date: day(-12), СуммаДокумента: 185000, Контрагент_Key: g(101), НазначениеПлатежа: 'Оплата по счёту 101 за внедрение CRM', Posted: true },
    { Ref_Key: g(302), Number: 'БП-000102', Date: day(-6), СуммаДокумента: 64000, Контрагент_Key: g(104), НазначениеПлатежа: 'Оплата лицензий, НДС не облагается', Posted: true },
    { Ref_Key: g(303), Number: 'БП-000103', Date: day(-2), СуммаДокумента: 42500, Контрагент_Key: g(103), НазначениеПлатежа: 'Оплата за обучение сотрудников', Posted: true },
  ],
};
DATA['Document_ПоступлениеБезналичныхДенежныхСредств'] = DATA['Document_ПоступлениеНаРасчетныйСчет'];
DATA['Document_ПоступлениеНаСчет'] = DATA['Document_ПоступлениеНаРасчетныйСчет'];
for (const k of ['Document_СчетНаОплатуПокупателю', 'Document_ЗаказКлиента', 'Document_СчетНаОплату']) DATA[k] = [];

let counter = 900;

export async function demoFetch(input: string, init?: { method?: string; body?: string }): Promise<Response> {
  const url = decodeURI(String(input));
  const m = /standard\.odata\/([^?]*)/.exec(url);
  const set = m?.[1] ?? '';
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (!set) return json(200, { value: Object.keys(DATA).map((name) => ({ name, url: name })) });
  if (!DATA[set]) return json(404, { 'odata.error': { code: '', message: { lang: 'ru', value: `Не найден объект ${set}` } } });
  if ((init?.method ?? 'GET') === 'POST') {
    const body = JSON.parse(init?.body ?? '{}');
    const row = { Ref_Key: g(++counter), Number: `ДМ-${counter}`, ...body };
    DATA[set].push(row);
    return json(201, row);
  }
  const top = Number(/\$top=(\d+)/.exec(url)?.[1] ?? 1000);
  const skip = Number(/\$skip=(\d+)/.exec(url)?.[1] ?? 0);
  return json(200, { 'odata.metadata': `demo://1c/odata/standard.odata/$metadata#${set}`, value: DATA[set].slice(skip, skip + top) });
}
