// Демо-данные: вымышленная IT-компания, полгода истории.
import type { DB } from './types.ts';
import { addDays, hashPassword, localDate, localDateTime, nowIso, rng, round2, today } from './util.ts';
import { recalcInvoice } from './services/crm.ts';
import type { Ctx } from './crud.ts';

export const DEMO_PASSWORD = 'demo1234';

const FULL_ACCESS = { '*': 'admin' };
const ROLE_PERMS: Record<string, Record<string, string>> = {
  'Руководитель': { dashboard: 'admin', tasks: 'admin', crm: 'admin', projects: 'admin', finance: 'write', team: 'write', kb: 'admin', calendar: 'write', messenger: 'write',
    communications: 'write', mail: 'write', files: 'write', catalog: 'write', lists: 'write', time: 'write', bp: 'admin', documents: 'write', notes: 'write', portal: 'write', settings: 'read' },
  'Менеджер по продажам': { dashboard: 'read', tasks: 'write', crm: 'write', projects: 'read', team: 'read', kb: 'read', calendar: 'write', messenger: 'write', communications: 'write',
    mail: 'write', files: 'write', catalog: 'read', lists: 'read', time: 'write', bp: 'read', documents: 'write', notes: 'write', portal: 'read' },
  'Сотрудник': { dashboard: 'read', tasks: 'write', crm: 'read', projects: 'write', team: 'read', kb: 'write', calendar: 'write', messenger: 'write', files: 'write', catalog: 'read',
    lists: 'write', time: 'write', bp: 'read', documents: 'read', notes: 'write' },
  'Бухгалтер': { dashboard: 'read', tasks: 'write', crm: 'read', projects: 'read', finance: 'admin', team: 'read', kb: 'read', calendar: 'write', messenger: 'write', files: 'write',
    catalog: 'write', lists: 'read', time: 'write', bp: 'read', documents: 'write', notes: 'write', mail: 'write' },
};

/** Minimal working setup for a real company: roles, pipeline, finance directories and the first admin. */
export async function bootstrap(db: DB, admin: { name: string; email: string; password: string; company: string }): Promise<void> {
  if (db.get(`SELECT id FROM users LIMIT 1`)) return;
  const pw = await hashPassword(admin.password);
  db.tx(() => {
    const now = nowIso();
    const ins = (table: string, d: Record<string, unknown>) => {
      const row: Record<string, unknown> = { created_at: now, updated_at: now, ...d };
      const keys = Object.keys(row);
      return db.run(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
        keys.map((k) => (row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]))).lastId;
    };
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('company', ?)`, [JSON.stringify({ name: admin.company, currency: 'RUB', timezone: 'Europe/Moscow' })]);
    const roleAdmin = ins('roles', { name: 'Администратор', description: 'Полный доступ', permissions: FULL_ACCESS, is_system: 1 });
    for (const [name, perms] of Object.entries(ROLE_PERMS)) ins('roles', { name, description: '', permissions: perms, is_system: 0 });
    const dep = ins('departments', { name: 'Руководство', sort: 1 });
    const uid = ins('users', { name: admin.name, email: admin.email, password_hash: pw, role_id: roleAdmin, department_id: dep, position: 'Руководитель', is_active: 1, color: '#0FA596' });
    db.run(`UPDATE departments SET head_id = ? WHERE id = ?`, [uid, dep]);
    ins('legal_entities', { name: admin.company, is_default: 1, tax_system: 'osno' });
    ins('fin_accounts', { name: 'Расчётный счёт', kind: 'bank', currency: 'RUB', opening_balance: 0 });
    ins('fin_accounts', { name: 'Касса', kind: 'cash', currency: 'RUB', opening_balance: 0 });
    const cats: [string, string, string, number][] = [['Выручка от услуг', 'income', 'operating', 1], ['Выручка от продажи товаров', 'income', 'operating', 1], ['Прочие поступления', 'income', 'operating', 1],
      ['Получение кредитов и займов', 'income', 'financing', 0], ['Зарплата', 'expense', 'operating', 1], ['Налоги и взносы', 'expense', 'operating', 1], ['Аренда', 'expense', 'operating', 1],
      ['Реклама и маркетинг', 'expense', 'operating', 1], ['Закупка товаров', 'expense', 'operating', 1], ['Подрядчики', 'expense', 'operating', 1], ['ПО и сервисы', 'expense', 'operating', 1],
      ['Связь и интернет', 'expense', 'operating', 1], ['Офисные расходы', 'expense', 'operating', 1], ['Банковские комиссии', 'expense', 'operating', 1],
      ['Погашение кредитов и займов', 'expense', 'financing', 0], ['Покупка оборудования', 'expense', 'investing', 0], ['Прочие расходы', 'expense', 'operating', 1]];
    cats.forEach(([name, kind, activity, in_pnl], i) => ins('fin_categories', { name, kind, activity, in_pnl, sort: i }));
    const pipe = ins('pipelines', { name: 'Продажи', sort: 1, is_default: 1 });
    ([['Новая заявка', '#94A3B8', 'open', 10], ['Квалификация', '#38BDF8', 'open', 25], ['Встреча / демо', '#0EA5E9', 'open', 40], ['КП отправлено', '#A855F7', 'open', 55],
      ['Переговоры', '#F59E0B', 'open', 70], ['Счёт выставлен', '#14B8A6', 'open', 85], ['Успешно', '#10B981', 'won', 100], ['Провал', '#EF4444', 'lost', 0]] as [string, string, string, number][])
      .forEach(([name, color, kind, probability], i) => ins('stages', { pipeline_id: pipe, name, color, kind, probability, sort: i + 1 }));
    ins('chats', { name: 'Общий чат', kind: 'group', members: [uid], last_message_at: now });
    const kbBase = ins('kb_bases', { name: 'База знаний компании', icon: '📚', access: 'all', sort: 1 });
    ins('kb_sections', { name: 'Общее', icon: '📘', sort: 1, base_id: kbBase });
    ins('folders', { name: 'Общие файлы' });
  });
}

export async function seed(db: DB): Promise<void> {
  if (db.get(`SELECT id FROM users LIMIT 1`)) return;
  const R = rng(20261022);
  const T = today();
  const pw = await hashPassword(DEMO_PASSWORD, 'vela-demo-salt', 60_000);
  const enc = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
  const ins = (table: string, d: Record<string, unknown>): number => {
    const row = { created_at: nowIso(), ...d };
    if (!('updated_at' in row)) (row as any).updated_at = row.created_at;
    const keys = Object.keys(row);
    return db.run(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map((k) => enc((row as any)[k]))).lastId;
  };
  const ts = (dateIso: string, h = R.int(9, 18), m = R.int(0, 59)) => new Date(`${dateIso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString();
  const dayAgo = (n: number) => addDays(T, -n);

  db.tx(() => {
    // ---------- settings ----------
    const set = (k: string, v: unknown) => db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [k, JSON.stringify(v)]);
    set('company', { name: 'ООО «Вела Демо»', phone: '+7 495 000-00-00', email: 'hello@vela.demo', site: 'vela.demo', timezone: 'Europe/Moscow', currency: 'RUB' });
    set('appearance', { theme: 'light', accent: 'teal' });
    set('onec', { url: 'demo://1c', login: 'Администратор', password: '', preset: 'bp30', pull_companies: true, pull_products: true, pull_payments: true,
      push_companies: true, push_invoices: false, interval_min: 0, cml_enabled: true, cml_login: 'exchange', cml_password: 'exchange-demo' });

    // ---------- roles, departments, users ----------
    const roleAdmin = ins('roles', { name: 'Администратор', description: 'Полный доступ ко всем модулям и настройкам', permissions: FULL_ACCESS, is_system: 1 });
    const roleIds: Record<string, number> = { 'Администратор': roleAdmin };
    for (const [name, perms] of Object.entries(ROLE_PERMS)) roleIds[name] = ins('roles', { name, description: '', permissions: perms, is_system: 0 });

    const dep = (name: string, parent: number | null, sort: number) => ins('departments', { name, parent_id: parent, sort });
    const dHead = dep('Руководство', null, 1);
    const dSales = dep('Отдел продаж', dHead, 2);
    const dProj = dep('Проектный офис', dHead, 3);
    const dDev = dep('Разработка', dProj, 4);
    const dAcc = dep('Бухгалтерия', dHead, 5);
    const dSup = dep('Служба поддержки', dHead, 6);

    const people: [string, string, string, number, string, number, string, number][] = [
      ['Алексей Морозов', 'admin@vela.demo', 'Генеральный директор', dHead, 'Администратор', 250000, '#0FA596', 1800],
      ['Екатерина Лебедева', 'lebedeva@vela.demo', 'Руководитель отдела продаж', dSales, 'Руководитель', 160000, '#F97362', 1100],
      ['Дмитрий Орлов', 'orlov@vela.demo', 'Менеджер по продажам', dSales, 'Менеджер по продажам', 90000, '#6366F1', 650],
      ['Ольга Ветрова', 'vetrova@vela.demo', 'Менеджер по продажам', dSales, 'Менеджер по продажам', 90000, '#EC4899', 650],
      ['Иван Никитин', 'nikitin@vela.demo', 'Руководитель проектов', dProj, 'Руководитель', 150000, '#F59E0B', 1000],
      ['Сергей Ким', 'kim@vela.demo', 'Ведущий разработчик', dDev, 'Сотрудник', 180000, '#0EA5E9', 1200],
      ['Михаил Тарасов', 'tarasov@vela.demo', 'Разработчик', dDev, 'Сотрудник', 130000, '#8B5CF6', 900],
      ['Анна Зайцева', 'zaitseva@vela.demo', 'Бизнес-аналитик', dProj, 'Сотрудник', 120000, '#14B8A6', 850],
      ['Наталья Павлова', 'pavlova@vela.demo', 'Главный бухгалтер', dAcc, 'Бухгалтер', 120000, '#84CC16', 800],
      ['Павел Громов', 'gromov@vela.demo', 'Специалист поддержки', dSup, 'Сотрудник', 80000, '#64748B', 550],
    ];
    const U: number[] = [];
    people.forEach(([name, email, position, depId, role, salary, color, rate], i) => {
      U.push(ins('users', { name, email, position, department_id: depId, role_id: roleIds[role], salary, hour_rate: rate, color, is_active: 1, password_hash: pw,
        phone: `+7 9${R.int(10, 99)} ${R.int(100, 999)}-${R.int(10, 99)}-${R.int(10, 99)}`, birthday: `19${R.int(78, 99)}-${String(R.int(1, 12)).padStart(2, '0')}-${String(R.int(1, 28)).padStart(2, '0')}`,
        hired_at: addDays(T, -R.int(120, 1500)), created_at: ts(dayAgo(400 - i)) }));
    });
    const [uAdmin, uSalesHead, uOrlov, uVetrova, uNikitin, uKim, uTarasov, uZaitseva, uPavlova, uGromov] = U;
    db.run(`UPDATE users SET birthday = ? WHERE id = ?`, [`1991-${addDays(T, 3).slice(5)}`, uVetrova]);
    db.run(`UPDATE departments SET head_id = ? WHERE id = ?`, [uAdmin, dHead]);
    db.run(`UPDATE departments SET head_id = ? WHERE id = ?`, [uSalesHead, dSales]);
    db.run(`UPDATE departments SET head_id = ? WHERE id = ?`, [uNikitin, dProj]);
    db.run(`UPDATE departments SET head_id = ? WHERE id = ?`, [uKim, dDev]);
    db.run(`UPDATE departments SET head_id = ? WHERE id = ?`, [uPavlova, dAcc]);
    db.run(`UPDATE departments SET head_id = ? WHERE id = ?`, [uGromov, dSup]);
    const sales = [uSalesHead, uOrlov, uVetrova];
    const devs = [uKim, uTarasov, uZaitseva, uNikitin];

    ins('groups', { name: 'Внедрение 1С', description: 'Всё про интеграции с 1С и обмен данными', owner_id: uKim, members: [uKim, uTarasov, uZaitseva, uPavlova], kind: 'open' });
    ins('groups', { name: 'Ключевые клиенты', description: 'Работа с клиентами с оборотом от 1 млн ₽', owner_id: uSalesHead, members: [uSalesHead, uOrlov, uVetrova, uNikitin], kind: 'closed' });

    // ---------- finance directories ----------
    const le = ins('legal_entities', { name: 'ООО «Вела Демо»', inn: '7725112233', kpp: '772501001', ogrn: '1237700000000', address: '115054, г. Москва, ул. Примерная, д. 1, офис 10',
      bank_name: 'АО «Банк Пример»', bik: '044525999', account_number: '40702810900000012345', corr_account: '30101810400000000999', director: 'Морозов А. В.', accountant: 'Павлова Н. С.',
      tax_system: 'osno', is_default: 1 });
    const accBank = ins('fin_accounts', { name: 'Расчётный счёт', kind: 'bank', currency: 'RUB', bank_name: 'АО «Банк Пример»', number: '40702810900000012345', legal_entity_id: le, opening_balance: 3900000, opening_date: dayAgo(200) });
    const accCash = ins('fin_accounts', { name: 'Касса офиса', kind: 'cash', currency: 'RUB', legal_entity_id: le, opening_balance: 45000, opening_date: dayAgo(200) });
    const accCard = ins('fin_accounts', { name: 'Корпоративная карта', kind: 'card', currency: 'RUB', bank_name: 'АО «Банк Пример»', legal_entity_id: le, opening_balance: 120000, opening_date: dayAgo(200) });

    const cat: Record<string, number> = {};
    const addCat = (name: string, kind: string, activity = 'operating', in_pnl = 1) => (cat[name] = ins('fin_categories', { name, kind, activity, in_pnl, sort: Object.keys(cat).length }));
    addCat('Выручка от услуг', 'income'); addCat('Выручка от продажи товаров', 'income'); addCat('Прочие поступления', 'income');
    addCat('Получение кредитов и займов', 'income', 'financing', 0); addCat('Взносы учредителей', 'income', 'financing', 0);
    addCat('Зарплата', 'expense'); addCat('Налоги и взносы', 'expense'); addCat('Аренда', 'expense'); addCat('Реклама и маркетинг', 'expense');
    addCat('Закупка товаров', 'expense'); addCat('Подрядчики', 'expense'); addCat('ПО и сервисы', 'expense'); addCat('Связь и интернет', 'expense');
    addCat('Офисные расходы', 'expense'); addCat('Банковские комиссии', 'expense'); addCat('Командировки', 'expense');
    addCat('Погашение кредитов и займов', 'expense', 'financing', 0); addCat('Покупка оборудования', 'expense', 'investing', 0); addCat('Дивиденды', 'expense', 'financing', 0);
    addCat('Прочие расходы', 'expense');

    // ---------- catalog ----------
    const pc = (name: string, sort: number) => ins('product_categories', { name, sort });
    const cImpl = pc('Внедрение и настройка', 1), cLic = pc('Лицензии и подписки', 2), cHw = pc('Оборудование', 3), cEdu = pc('Обучение', 4), cSup = pc('Поддержка', 5);
    const prodDefs: [string, string, string, number, string, number, number, number][] = [
      ['Внедрение CRM, пакет «Старт»', 'SRV-START', 'service', cImpl, 'усл', 120000, 0, 0],
      ['Внедрение CRM, пакет «Бизнес»', 'SRV-BIZ', 'service', cImpl, 'усл', 290000, 0, 0],
      ['Настройка обмена с 1С', 'SRV-1C', 'service', cImpl, 'усл', 65000, 0, 0],
      ['Доработка под процессы клиента', 'SRV-DEV', 'service', cImpl, 'ч', 3500, 0, 0],
      ['Аудит бизнес-процессов', 'SRV-AUDIT', 'service', cImpl, 'усл', 45000, 0, 0],
      ['Лицензия на 1 пользователя, 12 мес.', 'LIC-12', 'service', cLic, 'шт', 9600, 0, 0],
      ['Лицензия на 1 пользователя, 1 мес.', 'LIC-1', 'service', cLic, 'шт', 990, 0, 0],
      ['Облачное хранилище +100 ГБ, 12 мес.', 'LIC-STOR', 'service', cLic, 'шт', 6000, 0, 0],
      ['Ноутбук рабочий 15"', 'HW-NB15', 'product', cHw, 'шт', 78000, 61000, 6],
      ['Монитор 27"', 'HW-MON27', 'product', cHw, 'шт', 24500, 18200, 11],
      ['IP-телефон настольный', 'HW-IPPH', 'product', cHw, 'шт', 8900, 6100, 2],
      ['Гарнитура для колл-центра', 'HW-HSET', 'product', cHw, 'шт', 5400, 3300, 24],
      ['Обучение сотрудников (группа до 10 чел.)', 'SRV-EDU', 'service', cEdu, 'усл', 42500, 0, 0],
      ['Обучение администратора системы', 'SRV-EDU-ADM', 'service', cEdu, 'усл', 18000, 0, 0],
      ['Техподдержка «Стандарт», 1 мес.', 'SUP-STD', 'service', cSup, 'мес', 15000, 0, 0],
      ['Техподдержка «Премиум», 1 мес.', 'SUP-PRM', 'service', cSup, 'мес', 35000, 0, 0],
    ];
    const P = prodDefs.map(([name, sku, kind, category_id, unit, price, purchase_price, stock]) =>
      ({ id: ins('products', { name, sku, kind, category_id, unit: unit === 'мес' ? 'усл' : unit, price, purchase_price, stock, min_stock: kind === 'product' ? 3 : 0, vat: '22', is_active: 1 }), name, price, unit: unit === 'мес' ? 'усл' : unit }));
    for (const p of P.filter((_, i) => i >= 8 && i <= 11)) {
      ins('stock_moves', { product_id: p.id, kind: 'in', qty: R.int(5, 20), date: dayAgo(R.int(20, 90)), reason: 'Поступление от поставщика' });
      ins('stock_moves', { product_id: p.id, kind: 'out', qty: R.int(1, 4), date: dayAgo(R.int(1, 19)), reason: 'Отгрузка клиенту' });
    }

    // ---------- CRM directories ----------
    const pipe = ins('pipelines', { name: 'Продажи', sort: 1, is_default: 1 });
    const stageDefs: [string, string, string, number][] = [
      ['Новая заявка', '#94A3B8', 'open', 10], ['Квалификация', '#38BDF8', 'open', 20], ['Встреча / демо', '#0EA5E9', 'open', 35],
      ['КП отправлено', '#A855F7', 'open', 50], ['Переговоры', '#F59E0B', 'open', 65], ['Счёт выставлен', '#14B8A6', 'open', 85],
      ['Успешно', '#10B981', 'won', 100], ['Провал', '#EF4444', 'lost', 0],
    ];
    const S = stageDefs.map(([name, color, kind, probability], i) => ins('stages', { pipeline_id: pipe, name, color, kind, probability, sort: i + 1 }));
    const pipe2 = ins('pipelines', { name: 'Продление и допродажи', sort: 2, is_default: 0 });
    const S2 = ([['Новая', '#94A3B8', 'open', 20], ['Предложение', '#A855F7', 'open', 50], ['Согласование', '#F59E0B', 'open', 75], ['Продлено', '#10B981', 'won', 100], ['Отказ', '#EF4444', 'lost', 0]] as [string, string, string, number][])
      .map(([name, color, kind, probability], i) => ins('stages', { pipeline_id: pipe2, name, color, kind, probability, sort: i + 1 }));

    // ---------- companies & contacts ----------
    const companyNames = ['ООО «Ромашка Логистик»', 'АО «ТехноПарк Восток»', 'ООО «Гранит Строй»', 'ООО «Медиагрупп Альфа»', 'ИП Кравцов А. Н.', 'ООО «Вектор»',
      'ООО «Северный ветер»', 'ООО «Лайм Ритейл»', 'ООО «АгроПром Юг»', 'ООО «Кедр Мебель»', 'ООО «ДатаЛаб»', 'ООО «Город Кофе»', 'ООО «ТеплоЭнергоСервис»',
      'ООО «Мастер Окон»', 'ООО «Белый парус»', 'ООО «Фреш Маркет»', 'ООО «Сибирский тракт»', 'ООО «НеоКлиник»', 'ООО «Стройресурс»', 'ООО «Аквамарин»',
      'ООО «Технокомплект»', 'ООО «Пиксель Студио»', 'ООО «Уральский металл»', 'ООО «Добрый доктор»', 'ООО «Энергия Фитнес»', 'ООО «Школа Знаний»',
      'ООО «Транзит Авто»', 'ООО «Облако Софт»', 'ООО «Чистый город»', 'ООО «Поставщик Офис»'];
    const fixedInn: Record<string, string> = { 'ООО «Вектор»': '7714567890', 'ООО «Стройресурс»': '6658123498', 'ИП Кравцов А. Н.': '771234567890' };
    const industries = ['retail', 'wholesale', 'manufacturing', 'it', 'construction', 'services', 'logistics', 'horeca', 'other'];
    const cities = ['г. Москва', 'г. Санкт-Петербург', 'г. Екатеринбург', 'г. Казань', 'г. Новосибирск', 'г. Краснодар', 'г. Нижний Новгород', 'г. Самара'];
    const streets = ['ул. Ленина', 'пр-т Мира', 'ул. Садовая', 'ул. Заводская', 'Невский пр-т', 'ул. Гагарина', 'ул. Советская', 'наб. Речная'];
    const C = companyNames.map((name, i) => {
      const isIp = name.startsWith('ИП');
      const inn = fixedInn[name] ?? (isIp ? String(R.int(100000, 999999)) + String(R.int(100000, 999999)) : String(R.int(10, 99)) + String(R.int(10000000, 99999999)));
      const city = R.pick(cities);
      const created = dayAgo(R.int(30, 330));
      const kind = name === 'ООО «Поставщик Офис»' || name === 'ООО «Технокомплект»' ? 'supplier' : i < 18 ? 'client' : R.pick(['prospect', 'prospect', 'client', 'partner']);
      return {
        id: ins('companies', {
          name, kind, inn, kpp: isIp ? null : inn.slice(0, 4) + '01001', ogrn: isIp ? null : '1' + String(R.int(10, 99)) + String(R.int(1000000000, 9999999999)),
          legal_name: name.replace('ООО', 'Общество с ограниченной ответственностью').replace('АО', 'Акционерное общество').replace('ИП Кравцов А. Н.', 'Индивидуальный предприниматель Кравцов Алексей Николаевич'),
          legal_address: `${city}, ${R.pick(streets)}, д. ${R.int(1, 120)}`, industry: R.pick(industries),
          phone: `+7 ${R.pick(['495', '812', '343', '843', '383', '861'])} ${R.int(100, 999)}-${R.int(10, 99)}-${R.int(10, 99)}`,
          email: `info@${['romashka-log', 'technopark-v', 'granit-stroy', 'mg-alfa', 'kravtsov', 'vector-co', 'sev-veter', 'lime-retail', 'agroprom-yug', 'kedr-mebel', 'datalab', 'gorod-coffee',
            'tes-energo', 'master-okon', 'beliy-parus', 'fresh-mkt', 'sib-trakt', 'neoclinic', 'stroyresurs', 'aquamarin', 'technokomplekt', 'pixel-studio', 'ural-metal', 'dobriy-doc',
            'energy-fit', 'school-zn', 'tranzit-auto', 'oblako-soft', 'chisty-gorod', 'postavshik-office'][i]}.ru`,
          website: '', address: `${city}, ${R.pick(streets)}, д. ${R.int(1, 120)}`, responsible_id: R.pick(sales), source: R.pick(['site', 'form', 'call', 'referral', 'exhibition', 'ads', 'cold']),
          tags: R.chance(0.3) ? ['VIP'] : [], bank_name: 'ПАО «Банк Клиента»', bik: '0445' + String(R.int(10000, 99999)), account_number: '40702810' + String(R.int(100000000000, 999999999999)),
          created_at: ts(created), updated_at: ts(dayAgo(R.int(0, 25))),
        }), name, created,
      };
    });
    const first = ['Андрей', 'Мария', 'Сергей', 'Елена', 'Николай', 'Татьяна', 'Артём', 'Юлия', 'Виктор', 'Светлана', 'Роман', 'Ксения', 'Георгий', 'Дарья', 'Илья', 'Виктория'];
    const lastM = ['Смирнов', 'Кузнецов', 'Попов', 'Васильев', 'Соколов', 'Михайлов', 'Новиков', 'Фёдоров', 'Волков', 'Алексеев', 'Яковлев', 'Белов', 'Козлов', 'Степанов'];
    const positions = ['Генеральный директор', 'Коммерческий директор', 'Руководитель отдела продаж', 'IT-директор', 'Главный бухгалтер', 'Офис-менеджер', 'Финансовый директор', 'Руководитель направления'];
    const K: { id: number; company: number; name: string }[] = [];
    for (const co of C) {
      const n = co.name.startsWith('ИП') ? 1 : R.int(1, 3);
      for (let j = 0; j < n; j++) {
        const fn = R.pick(first);
        const female = /[ая]$/.test(fn);
        const ln = R.pick(lastM) + (female ? 'а' : '');
        const name = `${ln} ${fn}`;
        K.push({ id: ins('contacts', { name, company_id: co.id, position: j === 0 ? R.pick(positions.slice(0, 4)) : R.pick(positions), phone: `+7 9${R.int(10, 99)} ${R.int(100, 999)}-${R.int(10, 99)}-${R.int(10, 99)}`,
          email: `${['a', 'm', 's', 'e', 'n', 't', 'k', 'y', 'v'][R.int(0, 8)]}.${['smirnov', 'kuznetsov', 'popov', 'vasiliev', 'sokolov', 'novikov', 'volkov', 'belov'][R.int(0, 7)]}${R.int(1, 99)}@mail.example`,
          telegram: R.chance(0.4) ? `@${['andrey', 'maria', 'sergey', 'lena', 'nik', 'tanya', 'artem', 'yulia'][R.int(0, 7)]}_${R.int(10, 999)}` : null,
          responsible_id: R.pick(sales), source: R.pick(['site', 'call', 'referral', 'exhibition']), created_at: ts(co.created), updated_at: ts(co.created) }), company: co.id, name });
      }
    }

    // ---------- deals ----------
    const dealTitles = ['Внедрение CRM для отдела продаж', 'Автоматизация склада', 'Интеграция с 1С:УНФ', 'Лицензии на 25 пользователей', 'Обучение сотрудников',
      'Поставка оборудования для колл-центра', 'Аудит процессов продаж', 'Расширение лицензий', 'Внедрение модуля «Проекты»', 'Перенос данных из Excel', 'Настройка воронки для филиала',
      'Внедрение финансового учёта', 'Техподдержка на год', 'Доработка отчётов', 'Пилотный проект на 10 пользователей'];
    const D: { id: number; company: number; stage: number; kind: string; amount: number; resp: number; created: string; closed: string | null; title: string; contact: number | null }[] = [];
    for (let i = 0; i < 72; i++) {
      const co = R.pick(C.filter((c) => !['ООО «Поставщик Офис»', 'ООО «Технокомплект»'].includes(c.name)));
      const ageDays = R.int(0, 175);
      const created = dayAgo(ageDays);
      let si: number;
      if (ageDays > 60) si = R.chance(0.62) ? 6 : R.chance(0.7) ? 7 : R.int(3, 5);
      else if (ageDays > 20) si = R.chance(0.35) ? 6 : R.chance(0.15) ? 7 : R.int(1, 5);
      else si = R.int(0, 4);
      const kind = si === 6 ? 'won' : si === 7 ? 'lost' : 'open';
      const closed = kind === 'open' ? null : addDays(created, R.int(7, Math.max(8, Math.min(ageDays, 60))));
      const lines = R.int(1, 3);
      const items: { p: (typeof P)[number]; qty: number; discount: number }[] = [];
      for (let k = 0; k < lines; k++) {
        const p = R.pick(P);
        if (items.some((x) => x.p.id === p.id)) continue;
        items.push({ p, qty: p.unit === 'ч' ? R.int(10, 60) : p.price < 10000 ? R.int(5, 30) : R.int(1, 3), discount: R.chance(0.25) ? R.pick([5, 10, 15]) : 0 });
      }
      const amount = round2(items.reduce((s, x) => s + x.qty * x.p.price * (1 - x.discount / 100), 0));
      const resp = R.pick(sales);
      const contact = K.find((k) => k.company === co.id)?.id ?? null;
      const title = R.pick(dealTitles);
      const id = ins('deals', {
        title: `${title} — ${co.name.replace(/^(ООО|АО|ИП) /, '').replace(/[«»]/g, '')}`, pipeline_id: pipe, stage_id: S[si], amount, company_id: co.id, contact_id: contact, responsible_id: resp,
        close_date: kind === 'open' ? addDays(T, R.int(3, 45)) : closed, closed_at: closed ? ts(closed) : null, source: R.pick(['site', 'form', 'call', 'referral', 'exhibition', 'ads']),
        lost_reason: kind === 'lost' ? R.pick(['price', 'competitor', 'no_need', 'no_answer', 'budget']) : null, tags: R.chance(0.2) ? ['приоритет'] : [],
        description: 'Клиент хочет навести порядок в продажах и видеть деньги в одном окне.', created_at: ts(created), updated_at: ts(closed ?? addDays(created, Math.min(ageDays, R.int(0, 10)))),
      });
      for (const x of items) ins('deal_products', { deal_id: id, product_id: x.p.id, name: x.p.name, qty: x.qty, unit: x.p.unit, price: x.p.price, discount: x.discount, vat: '22', created_at: ts(created) });
      D.push({ id, company: co.id, stage: S[si], kind, amount, resp, created, closed, title, contact });
    }
    // a few renewals in the second pipeline
    for (let i = 0; i < 6; i++) {
      const co = C[i];
      const si = R.int(0, 3);
      ins('deals', { title: `Продление лицензий — ${co.name.replace(/^(ООО|АО|ИП) /, '').replace(/[«»]/g, '')}`, pipeline_id: pipe2, stage_id: S2[si], amount: R.int(8, 40) * 9600,
        company_id: co.id, responsible_id: R.pick(sales), close_date: addDays(T, R.int(5, 60)), source: 'other', created_at: ts(dayAgo(R.int(2, 40))), updated_at: ts(dayAgo(R.int(0, 2))),
        closed_at: si === 3 ? ts(dayAgo(R.int(1, 10))) : null });
    }

    // ---------- invoices, payments, acts ----------
    let invNo = 0, actNo = 0;
    const ctxStub = { db, user: { id: uAdmin, name: 'Seed', email: '', role_id: roleAdmin, is_active: 1, perms: { '*': 'admin' } }, deps: { db, mode: 'demo' }, system: true } as unknown as Ctx;
    const invoiceDeals = D.filter((d) => d.kind === 'won' || d.stage === S[5] || (d.stage === S[4] && R.chance(0.3)));
    for (const d of invoiceDeals.sort((a, b) => a.created.localeCompare(b.created))) {
      const date = d.kind === 'won' ? addDays(d.closed!, -R.int(2, 6)) : addDays(T, -R.int(0, 12));
      const inv = ins('invoices', { number: String(++invNo), date, due_date: addDays(date, 5), company_id: d.company, contact_id: d.contact, deal_id: d.id, legal_entity_id: le,
        status: 'sent', vat_mode: 'included', responsible_id: d.resp, total: 0, paid_amount: 0, created_at: ts(date) });
      for (const it of db.all(`SELECT * FROM deal_products WHERE deal_id = ?`, [d.id])) {
        ins('invoice_items', { invoice_id: inv, product_id: it.product_id, name: it.name, qty: it.qty, unit: it.unit, price: it.price, discount: it.discount, vat: '22', created_at: ts(date) });
      }
      const total = round2(db.all(`SELECT qty, price, discount FROM invoice_items WHERE invoice_id = ?`, [inv]).reduce((s, l) => s + l.qty * l.price * (1 - (l.discount || 0) / 100), 0));
      if (d.kind === 'won') {
        const partial = R.chance(0.12);
        const payDate = addDays(date, R.int(1, 6)) > T ? T : addDays(date, R.int(1, 6));
        ins('fin_operations', { kind: 'income', date: payDate, amount: partial ? round2(total / 2) : total, account_id: accBank, category_id: cat[R.chance(0.85) ? 'Выручка от услуг' : 'Выручка от продажи товаров'],
          company_id: d.company, deal_id: d.id, invoice_id: inv, status: 'fact', source: 'invoice', description: `Оплата по счёту № ${invNo} от ${date.split('-').reverse().join('.')}`, created_at: ts(payDate) });
        if (!partial && R.chance(0.75)) {
          const act = ins('acts', { number: String(++actNo), date: payDate, company_id: d.company, invoice_id: inv, deal_id: d.id, legal_entity_id: le, status: R.chance(0.7) ? 'signed' : 'sent', total, created_at: ts(payDate) });
          for (const it of db.all(`SELECT * FROM invoice_items WHERE invoice_id = ?`, [inv])) {
            ins('act_items', { act_id: act, product_id: it.product_id, name: it.name, qty: it.qty, unit: it.unit, price: round2(it.price * (1 - (it.discount || 0) / 100)), vat: '22', created_at: ts(payDate) });
          }
        }
      }
      recalcInvoice(ctxStub, inv);
    }
    // one draft invoice
    const dDraft = D.find((d) => d.stage === S[4]);
    if (dDraft) {
      const inv = ins('invoices', { number: String(++invNo), date: T, due_date: addDays(T, 5), company_id: dDraft.company, deal_id: dDraft.id, legal_entity_id: le, status: 'draft', vat_mode: 'included', responsible_id: dDraft.resp });
      ins('invoice_items', { invoice_id: inv, product_id: P[0].id, name: P[0].name, qty: 1, unit: 'усл', price: P[0].price, discount: 0, vat: '22' });
      recalcInvoice(ctxStub, inv);
    }

    // ---------- regular expenses for 6 months ----------
    const monthStarts: string[] = [];
    for (let m = 5; m >= 0; m--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - m);
      monthStarts.push(localDate(d));
    }
    const payroll = people.reduce((s, p) => s + p[5], 0);
    const supplier = C.find((c) => c.name === 'ООО «Поставщик Офис»')!.id;
    const supplier2 = C.find((c) => c.name === 'ООО «Технокомплект»')!.id;
    const op = (kind: string, date: string, amount: number, account: number, category: string, description: string, extra: Record<string, unknown> = {}) => {
      if (date > T) return;
      ins('fin_operations', { kind, date, amount: round2(amount), account_id: account, category_id: cat[category], status: 'fact', source: 'manual', description, created_at: ts(date), ...extra });
    };
    monthStarts.forEach((ms, i) => {
      const prev = new Date(ms + 'T12:00:00'); prev.setMonth(prev.getMonth() - 1);
      const prevName = prev.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
      op('expense', addDays(ms, 4), payroll * 0.6 * 0.87, accBank, 'Зарплата', `Зарплата за вторую половину: ${prevName}`);
      op('expense', addDays(ms, 19), payroll * 0.4 * 0.87, accBank, 'Зарплата', `Аванс за ${new Date(ms + 'T12:00:00').toLocaleDateString('ru-RU', { month: 'long' })}`);
      op('expense', addDays(ms, 27), payroll * 0.13 + payroll * 0.3, accBank, 'Налоги и взносы', 'ЕНП: НДФЛ и страховые взносы');
      op('expense', addDays(ms, 2), 185000, accBank, 'Аренда', 'Аренда офиса', { company_id: supplier });
      op('expense', addDays(ms, 9), R.int(60, 140) * 1000, accCard, 'Реклама и маркетинг', 'Контекстная реклама');
      op('expense', addDays(ms, 11), R.int(18, 32) * 1000, accCard, 'ПО и сервисы', 'Облачные серверы и подписки');
      op('expense', addDays(ms, 14), R.int(6, 9) * 1000, accBank, 'Связь и интернет', 'Интернет и телефония');
      op('expense', addDays(ms, 16), R.int(8, 25) * 1000, accCash, 'Офисные расходы', 'Канцтовары, вода, хозтовары');
      op('expense', addDays(ms, 26), R.int(2, 4) * 1000 + 490, accBank, 'Банковские комиссии', 'Комиссия за обслуживание счёта');
      if (i % 2 === 0) op('expense', addDays(ms, 18), R.int(80, 220) * 1000, accBank, 'Подрядчики', 'Оплата подрядчику по разработке', { company_id: supplier2 });
      if (i === 2) op('expense', addDays(ms, 7), 312000, accBank, 'Покупка оборудования', 'Ноутбуки для новых сотрудников', { company_id: supplier2 });
      if (i === 1) op('income', addDays(ms, 3), 1500000, accBank, 'Получение кредитов и займов', 'Кредит на пополнение оборотных средств');
      if (i >= 2) op('expense', addDays(ms, 21), 132000, accBank, 'Погашение кредитов и займов', 'Платёж по кредиту');
      if (i % 3 === 0) op('expense', addDays(ms, 12), R.int(25, 60) * 1000, accCard, 'Командировки', 'Командировка к клиенту');
      // recurring revenue: support contracts and licence renewals
      for (let k = 0; k < 6; k++) {
        const co = C[k * 2];
        op('income', addDays(ms, 3 + k), R.pick([35000, 35000, 15000, 70000]) * (k < 2 ? 2 : 1), accBank, 'Выручка от услуг', `Техподдержка по договору, ${co.name}`, { company_id: co.id });
      }
      op('income', addDays(ms, 15), R.int(28, 46) * 9600, accBank, 'Выручка от услуг', 'Продление лицензий клиентов', { company_id: C[1].id });
      op('income', addDays(ms, 22), R.int(6, 14) * 42500, accBank, 'Выручка от услуг', 'Обучение пользователей по договорам', { company_id: C[3].id });
      op('transfer', addDays(ms, 1), 30000, accBank, 'Прочие расходы', 'Пополнение кассы', { to_account_id: accCash, category_id: null });
    });
    // planned operations next 30 days
    const nextMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return localDate(d); })();
    const plan = (date: string, kind: string, amount: number, category: string, description: string) =>
      ins('fin_operations', { kind, date, amount, account_id: accBank, category_id: cat[category], status: 'planned', source: 'manual', description });
    plan(addDays(nextMonth, 1), 'expense', 185000, 'Аренда', 'Аренда офиса (план)');
    plan(addDays(nextMonth, 4), 'expense', round2(payroll * 0.6 * 0.87), 'Зарплата', 'Зарплата (план)');
    plan(addDays(T, 6), 'expense', 96000, 'Подрядчики', 'Оплата подрядчику (план)');
    plan(addDays(T, 9), 'income', 240000, 'Выручка от услуг', 'Ожидаемая оплата по договору поддержки');
    plan(addDays(nextMonth, 20), 'expense', 132000, 'Погашение кредитов и займов', 'Платёж по кредиту (план)');

    // ---------- projects ----------
    const wonDeals = D.filter((d) => d.kind === 'won').slice(0, 5);
    const projDefs: [string, string, string, number, string][] = [
      ['Внедрение CRM в «Ромашка Логистик»', 'RL-CRM', 'active', uNikitin, 'classic'],
      ['Интеграция с 1С для «ТехноПарк Восток»', 'TPV-1C', 'active', uKim, 'classic'],
      ['Личный кабинет клиента «НеоКлиник»', 'NEO-LK', 'active', uNikitin, 'agile'],
      ['Перенос данных «Гранит Строй»', 'GS-MIG', 'done', uZaitseva, 'classic'],
      ['Обучение команды «Лайм Ритейл»', 'LIME-EDU', 'planning', uZaitseva, 'classic'],
      ['Внутренний проект: новый сайт', 'SITE', 'paused', uAdmin, 'classic'],
    ];
    const colors = ['#0FA596', '#6366F1', '#F97362', '#F59E0B', '#0EA5E9', '#8B5CF6'];
    const PR: { id: number; status: string; start: string; end: string; kind: string; manager: number }[] = [];
    projDefs.forEach(([name, code, status, manager, kind], i) => {
      const start = status === 'done' ? dayAgo(120) : status === 'planning' ? addDays(T, 10) : dayAgo(R.int(20, 60));
      const end = status === 'done' ? dayAgo(30) : addDays(start, R.int(60, 110));
      const deal = wonDeals[i];
      const company = i === 5 ? null : (deal?.company ?? C[i].id);
      const id = ins('projects', { name, code, status, kind, manager_id: manager, members: [...new Set([manager, ...R.pick([[uKim, uTarasov], [uZaitseva, uTarasov], [uKim, uZaitseva, uGromov]])])],
        company_id: company, deal_id: i < 5 ? deal?.id ?? null : null, start_date: start, end_date: end, budget: i === 5 ? 0 : (deal?.amount ?? R.int(300, 900) * 1000),
        cost_budget: R.int(150, 500) * 1000, color: colors[i], description: 'Цель проекта — запустить систему в работу и обучить команду клиента.', created_at: ts(start) });
      if (deal) db.run(`UPDATE deals SET project_id = ? WHERE id = ?`, [id, deal.id]);
      PR.push({ id, status, start, end, kind, manager });
      db.run(`UPDATE fin_operations SET project_id = ? WHERE deal_id = ?`, [id, deal?.id ?? -1]);
    });
    const phaseTasks = ['Сбор требований', 'Согласование ТЗ', 'Настройка воронки продаж', 'Настройка ролей и прав', 'Импорт контрагентов', 'Настройка обмена с 1С',
      'Разработка отчётов', 'Тестирование', 'Обучение пользователей', 'Запуск в эксплуатацию', 'Сдача проекта, подписание акта', 'Настройка уведомлений', 'Миграция истории сделок'];
    const TK: number[] = [];
    for (const p of PR) {
      const ms1 = ins('milestones', { project_id: p.id, name: 'Техническое задание утверждено', date: addDays(p.start, 14), done: p.status === 'done' || addDays(p.start, 14) < T ? 1 : 0 });
      const ms2 = ins('milestones', { project_id: p.id, name: 'Запуск в работу', date: addDays(p.end, -10), done: p.status === 'done' ? 1 : 0 });
      ins('milestones', { project_id: p.id, name: 'Проект закрыт', date: p.end, done: p.status === 'done' ? 1 : 0 });
      let sprints: number[] = [];
      if (p.kind === 'agile') {
        sprints = [0, 1, 2].map((k) => ins('sprints', { project_id: p.id, name: `Спринт ${k + 1}`, start_date: addDays(p.start, k * 14), end_date: addDays(p.start, k * 14 + 13),
          status: addDays(p.start, k * 14 + 13) < T ? 'done' : addDays(p.start, k * 14) <= T ? 'active' : 'planned', goal: ['Авторизация и профиль', 'Счета и оплаты', 'Обращения и уведомления'][k] }));
      }
      const n = R.int(8, 13);
      for (let k = 0; k < n; k++) {
        const start = addDays(p.start, Math.floor((k * (Number(new Date(p.end).getTime() - new Date(p.start).getTime()) / 864e5)) / n));
        const dl = addDays(start, R.int(3, 10));
        const progressDay = p.status === 'done' ? 1 : dl < T ? (R.chance(0.8) ? 1 : 0) : 0;
        const status = p.status === 'planning' ? 'new' : progressDay ? 'done' : start <= T ? R.pick(['in_progress', 'in_progress', 'review', 'new']) : 'new';
        const id = ins('tasks', {
          title: phaseTasks[k % phaseTasks.length], description: 'Сделать по согласованному плану, результат приложить в комментарии.', status, priority: R.pick(['normal', 'normal', 'high', 'low', 'critical']),
          assignee_id: R.pick(devs), author_id: p.manager, watchers: [p.manager], deadline: `${dl}T18:00`, start_date: start, project_id: p.id,
          milestone_id: k < n / 2 ? ms1 : ms2, sprint_id: sprints.length ? sprints[Math.min(2, Math.floor((k / n) * 3))] : null, story_points: sprints.length ? R.pick([1, 2, 3, 5, 8]) : null,
          estimate_hours: R.int(2, 24), repeat: 'none', completed_at: status === 'done' ? ts(dl) : null, sort: k, created_at: ts(p.start),
        });
        TK.push(id);
        if (R.chance(0.4)) ['Подготовить материалы', 'Согласовать с клиентом', 'Проверить результат'].forEach((text, s) =>
          ins('checklist_items', { task_id: id, text, done: status === 'done' || s === 0 ? 1 : 0, sort: s }));
      }
      if (p.status !== 'planning') {
        for (let k = 0; k < R.int(1, 4); k++) {
          ins('project_issues', { project_id: p.id, title: R.pick(['Не приходят уведомления о новых сделках', 'Отчёт по менеджерам считает возвраты как продажи', 'Медленно открывается карточка компании',
            'Неверная кодировка при выгрузке в 1С', 'Нет поля «Филиал» в карточке клиента']), description: 'Замечание от заказчика на приёмке.', severity: R.pick(['low', 'medium', 'high']),
            status: p.status === 'done' ? 'closed' : R.pick(['open', 'in_work', 'fixed']), assignee_id: R.pick(devs), created_at: ts(addDays(p.start, R.int(5, 30))) });
        }
      }
    }
    // general tasks
    const generalTasks = ['Позвонить клиенту по продлению', 'Подготовить коммерческое предложение', 'Отправить счёт и закрывающие документы', 'Провести демо системы', 'Согласовать договор с юристом',
      'Обновить прайс-лист', 'Подготовить отчёт по продажам за месяц', 'Сверить взаиморасчёты с поставщиком', 'Проверить оплату по счёту', 'Назначить встречу с ЛПР', 'Ответить на вопросы по интеграции',
      'Собрать обратную связь после внедрения', 'Подготовить презентацию для выставки', 'Обновить статью в базе знаний', 'Провести планёрку отдела'];
    for (let i = 0; i < 46; i++) {
      const assignee = i < 14 ? uAdmin : R.pick(U);
      const d = D[R.int(0, D.length - 1)];
      const dlShift = R.int(-6, 14);
      const status = dlShift < -2 ? R.pick(['done', 'done', 'in_progress']) : R.pick(['new', 'new', 'in_progress', 'review', 'done']);
      const dl = new Date(); dl.setDate(dl.getDate() + dlShift); dl.setHours(R.int(10, 18), 0, 0, 0);
      const linkDeal = R.chance(0.5) && sales.includes(assignee);
      ins('tasks', { title: R.pick(generalTasks), description: '', status, priority: R.pick(['normal', 'normal', 'high', 'low', 'critical']), assignee_id: assignee,
        author_id: assignee === uAdmin ? R.pick([uSalesHead, uNikitin, uAdmin]) : R.pick([uAdmin, uSalesHead, uNikitin]), watchers: [], deadline: localDateTime(dl),
        deal_id: linkDeal ? d.id : null, company_id: linkDeal ? d.company : null, repeat: i === 3 ? 'weekly' : 'none', completed_at: status === 'done' ? ts(addDays(T, Math.min(0, dlShift))) : null,
        sort: i, created_at: ts(dayAgo(R.int(1, 20))), tags: R.chance(0.2) ? ['срочно'] : [] });
    }

    // ---------- time tracking ----------
    for (let i = 0; i < 90; i++) {
      const task = R.pick(TK);
      const t = db.get(`SELECT project_id, assignee_id, title FROM tasks WHERE id = ?`, [task]);
      const date = dayAgo(R.int(0, 30));
      ins('time_entries', { user_id: t.assignee_id, date, task_id: task, project_id: t.project_id, minutes: R.pick([30, 45, 60, 90, 120, 180, 240]), comment: t.title, billable: R.chance(0.85) ? 1 : 0, is_running: 0, created_at: ts(date) });
    }

    // ---------- calendar ----------
    const evTitles = ['Демо для клиента', 'Планёрка отдела продаж', 'Созвон по проекту', 'Встреча с поставщиком', 'Обучение пользователей', 'Ретроспектива спринта', 'Звонок по продлению'];
    for (let i = 0; i < 34; i++) {
      const d = new Date(); d.setDate(d.getDate() + R.int(-14, 21)); d.setHours(R.int(9, 17), R.pick([0, 30]), 0, 0);
      const end = new Date(d.getTime() + R.pick([30, 60, 90]) * 60000);
      const owner = i < 12 ? uAdmin : R.pick(U);
      const title = R.pick(evTitles);
      ins('events', { title, kind: title.startsWith('Звонок') || title.startsWith('Созвон') ? 'call' : title.startsWith('Демо') || title.startsWith('Встреча') ? 'meeting' : 'event',
        start: localDateTime(d), end: localDateTime(end), all_day: 0, location: R.pick(['Переговорная «Бриз»', 'Онлайн', 'Офис клиента', '']), owner_id: owner,
        attendees: [owner, R.pick(U)], company_id: R.chance(0.4) ? R.pick(C).id : null, description: '' });
    }
    { const d = new Date(); d.setHours(11, 0, 0, 0); const e = new Date(d.getTime() + 3600000);
      ins('events', { title: 'Демо Vela CRM для «Белый парус»', kind: 'meeting', start: localDateTime(d), end: localDateTime(e), owner_id: uAdmin, attendees: [uAdmin, uOrlov], location: 'Онлайн', company_id: C[14].id }); }
    { const d = new Date(); d.setHours(15, 30, 0, 0); const e = new Date(d.getTime() + 1800000);
      ins('events', { title: 'Планёрка по проектам', kind: 'event', start: localDateTime(d), end: localDateTime(e), owner_id: uNikitin, attendees: [uAdmin, uNikitin, uKim, uZaitseva], location: 'Переговорная «Бриз»' }); }

    // ---------- team: absences, onboarding ----------
    ins('absences', { user_id: uTarasov, type: 'vacation', date_from: addDays(T, 5), date_to: addDays(T, 18), status: 'approved', comment: 'Ежегодный отпуск' });
    ins('absences', { user_id: uGromov, type: 'sick', date_from: addDays(T, -1), date_to: addDays(T, 2), status: 'approved', comment: '' });
    ins('absences', { user_id: uOrlov, type: 'trip', date_from: addDays(T, 8), date_to: addDays(T, 10), status: 'approved', comment: 'Выставка в Казани' });
    ins('absences', { user_id: uZaitseva, type: 'remote', date_from: T, date_to: T, status: 'approved', comment: '' });
    ins('absences', { user_id: uVetrova, type: 'vacation', date_from: addDays(T, 25), date_to: addDays(T, 38), status: 'requested', comment: 'Прошу согласовать' });
    ins('onboarding', { title: 'Адаптация: менеджер по продажам', user_id: uVetrova, mentor_id: uSalesHead, start_date: dayAgo(10), due_date: addDays(T, 20), status: 'active',
      steps: [{ text: 'Получить доступы к CRM и почте', done: true }, { text: 'Изучить статью «Как мы продаём»', done: true }, { text: 'Пройти обучение по продукту', done: false },
        { text: 'Провести первое демо с наставником', done: false }, { text: 'Закрыть первую сделку', done: false }] });

    // ---------- knowledge base ----------
    const kb1 = ins('kb_sections', { name: 'О компании', icon: '🏢', sort: 1, description: 'Миссия, структура, правила' });
    const kb2 = ins('kb_sections', { name: 'Продажи', icon: '📈', sort: 2, description: 'Скрипты, регламенты, работа с возражениями' });
    const kb3 = ins('kb_sections', { name: 'Внедрение и 1С', icon: '⚙️', sort: 3, description: 'Как настраивать обмен с 1С' });
    const kb4 = ins('kb_sections', { name: 'Новичкам', icon: '🌱', sort: 4, description: 'С чего начать в первую неделю' });
    const art = (section: number, title: string, body: string, author: number) => ins('kb_articles', { section_id: section, title, body, author_id: author, is_published: 1, views: R.int(3, 120), tags: [] });
    art(kb1, 'Как устроена наша компания', '<h2>Кто мы</h2><p>Мы внедряем CRM и автоматизируем продажи для малого и среднего бизнеса.</p><h2>Отделы</h2><ul><li><b>Продажи</b> — находят клиентов и ведут сделки.</li><li><b>Проектный офис</b> — внедряет систему у клиента.</li><li><b>Бухгалтерия</b> — счета, акты, зарплата.</li><li><b>Поддержка</b> — отвечает клиентам в течение часа.</li></ul>', uAdmin);
    art(kb1, 'Правила работы в CRM', '<p>Каждый звонок, встреча и договорённость фиксируются в карточке сделки. Если этого нет в CRM — этого не было.</p><ol><li>У каждой сделки есть следующий шаг — задача со сроком.</li><li>Стадия сделки отражает реальное состояние, а не надежды.</li><li>Причина провала указывается всегда.</li></ol>', uAdmin);
    art(kb2, 'Скрипт первого звонка', '<h2>Цель звонка</h2><p>Выяснить, есть ли у клиента задача, и назначить демо.</p><h2>Вопросы</h2><ul><li>Как сейчас ведёте клиентов и сделки?</li><li>Что больше всего мешает?</li><li>Кто принимает решение о покупке?</li></ul><p>Итог звонка — встреча в календаре и задача в CRM.</p>', uSalesHead);
    art(kb2, 'Работа с возражением «Дорого»', '<p>Переведите разговор с цены на стоимость проблемы: сколько сделок теряется без системы? Покажите расчёт окупаемости на цифрах клиента.</p>', uSalesHead);
    art(kb3, 'Подключение 1С через OData', '<h2>Что нужно от клиента</h2><ol><li>Опубликовать базу 1С на веб-сервере (Apache или IIS) с включённым OData.</li><li>В 1С открыть «Настройка автоматического REST-сервиса» и отметить справочники «Контрагенты», «Номенклатура», документы счетов и поступлений.</li><li>Создать в 1С пользователя для обмена с правами на чтение и запись.</li></ol><h2>Что делаем мы</h2><p>В Vela CRM: <b>Настройки → Интеграция с 1С</b>, указываем адрес вида <code>https://1c.company.ru/base</code>, логин и пароль, нажимаем «Проверить подключение».</p>', uKim);
    art(kb3, 'Обмен с 1С через CommerceML', '<p>В УТ, УНФ и КА есть стандартный «Обмен с сайтом». В поле адреса указываем <code>https://ваш-сервер/api/1c/exchange</code>, логин и пароль из настроек CRM. 1С сама выгружает товары, цены и остатки и забирает заказы.</p>', uKim);
    art(kb4, 'Чек-лист первой недели', '<ul><li>Заполнить профиль и фото.</li><li>Прочитать «Правила работы в CRM».</li><li>Познакомиться с наставником.</li><li>Пройти демо продукта.</li></ul>', uSalesHead);
    art(kb4, 'Где что лежит', '<p>Шаблоны договоров — в разделе «Документы». Логотипы и презентации — в «Файлах», папка «Маркетинг». Вопросы — в общий чат.</p>', uAdmin);

    // ---------- files ----------
    const fMk = ins('folders', { name: 'Маркетинг' });
    const fDoc = ins('folders', { name: 'Договоры' });
    ins('folders', { name: 'Презентации', parent_id: fMk });
    const txt = (s: string) => 'data:text/plain;charset=utf-8,' + encodeURIComponent(s);
    ins('files', { name: 'Прайс-лист 2026.txt', folder_id: fMk, size: 240, mime: 'text/plain', path: txt('Прайс-лист Vela Demo 2026\nВнедрение «Старт» — 120 000 ₽\nВнедрение «Бизнес» — 290 000 ₽'), description: 'Актуальный прайс' });
    ins('files', { name: 'Типовой договор.txt', folder_id: fDoc, size: 180, mime: 'text/plain', path: txt('Договор оказания услуг № ___\nСтороны договорились о следующем...'), description: 'Шаблон для юристов' });

    // ---------- messenger ----------
    const chGen = ins('chats', { name: 'Общий чат', kind: 'group', members: U, last_message_at: nowIso() });
    const chSales = ins('chats', { name: 'Отдел продаж', kind: 'group', members: [uAdmin, ...sales], last_message_at: nowIso() });
    const chProj = ins('chats', { name: 'Проект: 1С для «ТехноПарк Восток»', kind: 'group', members: [uAdmin, uKim, uTarasov, uZaitseva], last_message_at: nowIso(), project_id: PR[1].id });
    const msg = (chat: number, user: number, text: string, minutesAgo: number) => ins('messages', { chat_id: chat, user_id: user, text, created_at: new Date(Date.now() - minutesAgo * 60000).toISOString() });
    msg(chGen, uAdmin, 'Коллеги, доброе утро! В пятницу в 17:00 общая встреча — подведём итоги месяца.', 300);
    msg(chGen, uNikitin, 'Принято 👍', 290);
    msg(chGen, uPavlova, 'Напоминаю: авансовые отчёты сдаём до 25-го числа.', 120);
    msg(chGen, uGromov, 'Обновил статью про подключение почты в базе знаний.', 45);
    msg(chSales, uSalesHead, 'Кто берёт заявку с сайта от «Белый парус»? Хотят демо на этой неделе.', 200);
    msg(chSales, uOrlov, 'Я возьму, созвонюсь сегодня.', 190);
    msg(chSales, uVetrova, 'По «Лайм Ритейл» счёт оплачен, передаю в проекты.', 60);
    msg(chProj, uKim, 'Обмен справочниками настроен, тестируем документы.', 150);
    msg(chProj, uZaitseva, 'Клиент просит добавить выгрузку счетов в 1С, заведу задачу.', 90);
    msg(chProj, uAdmin, 'Отлично, держите меня в курсе сроков.', 20);

    // ---------- communications ----------
    const tg = ins('channels', { name: 'Telegram-бот компании', kind: 'telegram', responsible_id: uOrlov, is_active: 1, settings: { bot_token: '' } });
    const wa = ins('channels', { name: 'WhatsApp отдела продаж', kind: 'whatsapp', responsible_id: uVetrova, is_active: 1, settings: {} });
    const web = ins('channels', { name: 'Чат на сайте', kind: 'webchat', responsible_id: uGromov, is_active: 1, settings: {} });
    const conv = (channel: number, name: string, handle: string, status: string, assignee: number | null, msgs: [string, string, number][]) => {
      const last = msgs[msgs.length - 1];
      const cid = ins('conversations', { channel_id: channel, client_name: name, client_handle: handle, status, assignee_id: assignee, unread: status === 'new' ? 1 : 0,
        last_message_at: new Date(Date.now() - last[2] * 60000).toISOString(), last_text: last[1] });
      for (const [dir, text, ago] of msgs) ins('conv_messages', { conversation_id: cid, direction: dir, text, user_id: dir === 'out' ? assignee : null, created_at: new Date(Date.now() - ago * 60000).toISOString() });
    };
    conv(tg, 'Игорь Семёнов', '@igor_sem', 'new', uOrlov, [['in', 'Здравствуйте! Сколько стоит подключить 20 пользователей?', 12]]);
    conv(wa, 'Светлана Рябова', '+7 921 555-44-33', 'open', uVetrova, [['in', 'Добрый день, нам нужен счёт на продление', 180], ['out', 'Добрый день! Подготовлю сегодня и пришлю сюда.', 170], ['in', 'Спасибо!', 165]]);
    conv(web, 'Посетитель сайта', 'visitor-8841', 'open', uGromov, [['in', 'Есть ли у вас интеграция с 1С:Бухгалтерией?', 60], ['out', 'Да, обмен через OData и CommerceML. Могу показать на демо.', 55]]);
    conv(tg, 'Кирилл Жуков', '@k_zhukov', 'closed', uOrlov, [['in', 'Пришлите презентацию, пожалуйста', 2000], ['out', 'Отправил на почту 👍', 1990]]);

    // ---------- mail ----------
    const box = ins('mailboxes', { email: 'sales@vela.demo', name: 'Отдел продаж Vela', imap_host: 'imap.example.com', imap_port: 993, smtp_host: 'smtp.example.com', smtp_port: 465, login: 'sales@vela.demo', user_id: null, is_active: 1 });
    const mail = (folder: string, fromName: string, fromAddr: string, to: string, subject: string, body: string, hoursAgo: number, read: boolean, company?: number) =>
      ins('mails', { mailbox_id: box, folder, from_name: fromName, from_addr: fromAddr, to_addr: to, subject, body, date: new Date(Date.now() - hoursAgo * 3600000).toISOString(), is_read: read ? 1 : 0, is_starred: 0, company_id: company ?? null });
    mail('inbox', 'Смирнова Елена', 'e.smirnova@mail.example', 'sales@vela.demo', 'Запрос коммерческого предложения', 'Добрый день!\n\nПрошу направить КП на внедрение CRM для 30 сотрудников с интеграцией с 1С:УНФ.\n\nС уважением,\nЕлена Смирнова', 2, false, C[1].id);
    mail('inbox', 'Бухгалтерия «Вектор»', 'buh@vector-co.ru', 'sales@vela.demo', 'Акт сверки за 3 квартал', 'Здравствуйте! Направляем акт сверки. Просим подписать и вернуть скан.', 20, false, C[5].id);
    mail('inbox', 'Кузнецов Андрей', 'a.kuznetsov@mail.example', 'sales@vela.demo', 'Re: Демо системы', 'Спасибо за демонстрацию! Обсудим с директором и вернёмся с ответом до пятницы.', 30, true, C[2].id);
    mail('inbox', 'Сервис рассылок', 'noreply@service.example', 'sales@vela.demo', 'Ваш отчёт за неделю готов', 'Открытий: 412, кликов: 37.', 50, true);
    mail('sent', 'Отдел продаж Vela', 'sales@vela.demo', 'e.smirnova@mail.example', 'Коммерческое предложение', 'Елена, добрый день! Во вложении КП. Готовы провести демо в удобное время.', 1, true, C[1].id);

    // ---------- custom lists ----------
    const l1 = ins('custom_lists', { name: 'Реестр договоров', icon: '📄', description: 'Договоры с клиентами и сроки действия',
      fields: [{ key: 'number', label: 'Номер', type: 'text' }, { key: 'client', label: 'Клиент', type: 'text' }, { key: 'date', label: 'Дата', type: 'date' }, { key: 'until', label: 'Действует до', type: 'date' },
        { key: 'amount', label: 'Сумма', type: 'money' }, { key: 'status', label: 'Статус', type: 'select', options: ['Действует', 'Истёк', 'На подписании'] }] });
    for (let i = 0; i < 6; i++) ins('custom_list_items', { list_id: l1, data: { number: `Д-${2026}-${String(i + 11).padStart(3, '0')}`, client: C[i].name, date: dayAgo(R.int(30, 200)), until: addDays(T, R.int(-20, 300)), amount: R.int(100, 900) * 1000, status: R.pick(['Действует', 'Действует', 'На подписании', 'Истёк']) } });
    const l2 = ins('custom_lists', { name: 'Подрядчики', icon: '🧰', description: 'Внешние специалисты и студии',
      fields: [{ key: 'name', label: 'Название', type: 'text' }, { key: 'skill', label: 'Специализация', type: 'text' }, { key: 'rate', label: 'Ставка, ₽/ч', type: 'number' }, { key: 'phone', label: 'Телефон', type: 'text' }] });
    ins('custom_list_items', { list_id: l2, data: { name: 'Студия «Пиксель»', skill: 'Дизайн интерфейсов', rate: 2500, phone: '+7 900 000-11-22' } });
    ins('custom_list_items', { list_id: l2, data: { name: 'Иванов И. И.', skill: 'Программист 1С', rate: 3000, phone: '+7 900 000-33-44' } });

    // ---------- business processes ----------
    const bpVac = ins('bp_templates', { name: 'Согласование отпуска', description: 'Руководитель согласует заявку на отсутствие', entity_type: 'absences', trigger: 'on_create', is_active: 1,
      steps: [{ type: 'approval', title: 'Отпуск сотрудника', user: 'manager', days: 2, on_reject: { field: 'status', value: 'rejected' } }, { type: 'set_field', field: 'status', value: 'approved' }, { type: 'notify', user: 'starter', text: 'Ваше отсутствие согласовано' }] });
    const bpDisc = ins('bp_templates', { name: 'Согласование скидки больше 10%', description: 'Скидку согласует руководитель отдела продаж, затем — директор', entity_type: 'deals', trigger: 'manual', is_active: 1,
      steps: [{ type: 'approval', title: 'Скидка руководителем продаж', user: uSalesHead, days: 1 }, { type: 'approval', title: 'Скидка директором', user: uAdmin, days: 1 }, { type: 'notify', user: 'responsible', text: 'Скидка согласована, можно отправлять КП' }] });
    ins('bp_templates', { name: 'Заявка на закупку', description: 'Согласование расхода и поручение бухгалтерии', entity_type: 'none', trigger: 'manual', is_active: 1,
      steps: [{ type: 'approval', title: 'Закупка', user: uAdmin, days: 2 }, { type: 'task', title: 'Оплатить счёт поставщика', user: uPavlova, days: 3 }, { type: 'notify', user: 'starter', text: 'Закупка согласована и передана в оплату' }] });
    const dealForBp = D.find((d) => d.kind === 'open')!;
    const inst = ins('bp_instances', { template_id: bpDisc, name: `Согласование скидки больше 10%: ${db.get('SELECT title FROM deals WHERE id = ?', [dealForBp.id]).title}`, entity_type: 'deals', entity_id: dealForBp.id,
      status: 'running', current_step: 1, started_by: uOrlov,
      log: [{ at: nowIso(), text: 'Запущен: клиент просит 15%', user: 'Дмитрий Орлов' }, { at: nowIso(), text: 'Согласовано', user: 'Екатерина Лебедева' }, { at: nowIso(), text: 'Отправлено на согласование: Алексей Морозов' }],
      data: { comment: 'Клиент просит 15%', pending: { step: 1, user_id: uAdmin, title: 'Скидка директором' } } });
    const absReq = db.get(`SELECT id FROM absences WHERE status = 'requested' LIMIT 1`);
    ins('bp_instances', { template_id: bpVac, name: 'Согласование отпуска: Ольга Ветрова', entity_type: 'absences', entity_id: absReq?.id, status: 'running', current_step: 0, started_by: uVetrova,
      log: [{ at: nowIso(), text: 'Запущен', user: 'Ольга Ветрова' }, { at: nowIso(), text: 'Отправлено на согласование: Екатерина Лебедева' }], data: { pending: { step: 0, user_id: uSalesHead, title: 'Отпуск сотрудника' } } });
    void inst;

    // ---------- documents ----------
    ins('doc_templates', { name: 'Договор оказания услуг', entity_type: 'deals', kind: 'contract', body:
      '<h2 style="text-align:center">ДОГОВОР ОКАЗАНИЯ УСЛУГ № {{deal.id}}</h2><p style="text-align:right">{{today}}</p>' +
      '<p><b>{{our.name}}</b>, в лице руководителя {{our.director}}, именуемое «Исполнитель», и <b>{{company.legal_name}}</b>, именуемое «Заказчик», заключили настоящий договор:</p>' +
      '<h3>1. Предмет договора</h3><p>Исполнитель оказывает услуги по проекту «{{deal.title}}», а Заказчик принимает и оплачивает их.</p>{{products_table}}' +
      '<h3>2. Стоимость</h3><p>Стоимость услуг — {{deal.amount}} руб. ({{deal.amount_words}}), включая НДС.</p>' +
      '<h3>3. Реквизиты сторон</h3><p>Исполнитель: {{our.name}}, ИНН {{our.inn}}, р/с {{our.account_number}} в {{our.bank_name}}.<br>Заказчик: {{company.name}}, ИНН {{company.inn}}.</p>' });
    ins('doc_templates', { name: 'Коммерческое предложение', entity_type: 'deals', kind: 'offer', body:
      '<h2>Коммерческое предложение</h2><p>Для: <b>{{company.name}}</b><br>Контакт: {{contact.name}}</p><p>Предлагаем решение «{{deal.title}}».</p>{{products_table}}' +
      '<p>Итого: <b>{{deal.amount}} ₽</b>. Предложение действует 14 дней.</p><p>Ваш менеджер: {{responsible.name}}, {{responsible.phone}}, {{responsible.email}}</p>' });
    ins('doc_templates', { name: 'Письмо-благодарность клиенту', entity_type: 'companies', kind: 'letter', body:
      '<p>{{today}}</p><p>Уважаемые коллеги из {{company.name}}!</p><p>Благодарим за сотрудничество и доверие. Будем рады продолжить совместную работу.</p><p>С уважением,<br>{{our.director}}<br>{{our.name}}</p>' });

    // ---------- web forms & automations ----------
    ins('web_forms', { name: 'Заявка на демо', title: 'Запишитесь на демонстрацию', subtitle: 'Покажем CRM на ваших задачах за 30 минут', pipeline_id: pipe, stage_id: S[0], responsible_id: uOrlov,
      success_message: 'Спасибо! Менеджер свяжется с вами в течение часа.', is_active: 1, submissions: 14,
      fields: [{ key: 'name', label: 'Ваше имя', type: 'text', required: true }, { key: 'phone', label: 'Телефон', type: 'phone', required: true }, { key: 'email', label: 'Email', type: 'email' },
        { key: 'company', label: 'Компания', type: 'text' }, { key: 'comment', label: 'Что хотите автоматизировать?', type: 'textarea' }] });
    ins('automations', { name: 'Задача «Подготовить демо»', pipeline_id: pipe, stage_id: S[2], action: 'create_task', params: { title: 'Подготовить демо', assignee: 'responsible', due_days: 1, priority: 'high' }, is_active: 1 });
    ins('automations', { name: 'Выставить счёт автоматически', pipeline_id: pipe, stage_id: S[5], action: 'create_invoice', params: {}, is_active: 1 });
    ins('automations', { name: 'Уведомить директора о победе', pipeline_id: pipe, stage_id: S[6], action: 'notify', params: { user_id: uAdmin, text: 'Сделка выиграна' }, is_active: 1 });

    // ---------- finance extras ----------
    ins('advances', { user_id: uOrlov, date: dayAgo(8), amount: 25000, purpose: 'Командировка на выставку', account_id: accCash, reported_amount: 0, status: 'issued' });
    ins('advances', { user_id: uGromov, date: dayAgo(20), amount: 6000, purpose: 'Хозтовары для офиса', account_id: accCash, reported_amount: 5740, report_date: dayAgo(15), status: 'closed' });
    ins('loans', { name: 'Кредит на пополнение оборотных средств', kind: 'received', company_id: null, amount: 1500000, rate: 18.5, date_from: addDays(monthStarts[1], 3), date_to: addDays(monthStarts[1], 365), paid_amount: 132000 * 4, account_id: accBank, status: 'active' });
    ins('loans', { name: 'Заём сотруднику', kind: 'issued', amount: 100000, rate: 0, date_from: dayAgo(60), date_to: addDays(T, 120), paid_amount: 20000, account_id: accBank, status: 'active' });
    ins('obligations', { kind: 'payable', company_id: supplier2, amount: 96000, paid_amount: 0, due_date: addDays(T, 6), description: 'Оплата подрядчику за доработку отчётов', status: 'open' });
    ins('obligations', { kind: 'receivable', company_id: C[3].id, amount: 75000, paid_amount: 25000, due_date: addDays(T, -3), description: 'Остаток по договору на обучение', status: 'open' });
    ins('obligations', { kind: 'payable', company_id: supplier, amount: 185000, paid_amount: 0, due_date: addDays(nextMonth, 1), description: 'Аренда за следующий месяц', status: 'open' });
    const assetDefs: [string, string, string, number, number][] = [['Ноутбук Lenovo ThinkPad', 'ИНВ-0001', 'it', 92000, uKim], ['Ноутбук Lenovo ThinkPad', 'ИНВ-0002', 'it', 92000, uTarasov],
      ['МФУ лазерное', 'ИНВ-0010', 'it', 38000, uGromov], ['Переговорный стол', 'ИНВ-0101', 'furniture', 64000, uAdmin], ['Кресла офисные (12 шт.)', 'ИНВ-0102', 'furniture', 108000, uAdmin],
      ['Сервер NAS для резервных копий', 'ИНВ-0020', 'it', 145000, uKim], ['Кофемашина', 'ИНВ-0201', 'equipment', 54000, uGromov], ['Автомобиль Lada Vesta', 'ИНВ-0301', 'transport', 1350000, uAdmin]];
    for (const [name, inv, category, cost, resp] of assetDefs) ins('assets', { name, inventory_number: inv, category, cost, responsible_id: resp, purchase_date: dayAgo(R.int(60, 700)), useful_life_months: category === 'transport' ? 60 : 36, location: 'Офис, Москва', status: name.startsWith('МФУ') ? 'repair' : 'in_use' });
    for (const m of [monthStarts[4], monthStarts[3]]) {
      for (const [i, p] of people.entries()) {
        const bonus = i < 4 ? R.int(0, 4) * 10000 : 0;
        ins('payroll', { user_id: U[i], period: m.slice(0, 7), base: p[5], bonus, deductions: round2((p[5] + bonus) * 0.13), total: round2((p[5] + bonus) * 0.87), status: m === monthStarts[4] ? 'accrued' : 'paid', paid_date: m === monthStarts[4] ? null : addDays(m, 34) });
      }
    }
    const budget = ins('budgets', { name: `Бюджет компании на ${T.slice(0, 4)}`, year: Number(T.slice(0, 4)), status: 'approved', description: 'Плановые доходы и расходы по месяцам' });
    for (let m = 1; m <= 12; m++) {
      ins('budget_lines', { budget_id: budget, category_id: cat['Выручка от услуг'], month: m, amount: 1600000 + m * 40000 });
      ins('budget_lines', { budget_id: budget, category_id: cat['Зарплата'], month: m, amount: round2(payroll * 0.87) });
      ins('budget_lines', { budget_id: budget, category_id: cat['Аренда'], month: m, amount: 185000 });
      ins('budget_lines', { budget_id: budget, category_id: cat['Реклама и маркетинг'], month: m, amount: 100000 });
      ins('budget_lines', { budget_id: budget, category_id: cat['Налоги и взносы'], month: m, amount: round2(payroll * 0.43) });
    }
    ins('bank_imports', { file_name: 'kl_to_1c_september.txt', account_id: accBank, rows: 38, created_ops: 35, skipped: 3, created_at: ts(dayAgo(32)) });

    // ---------- notes, portal ----------
    ins('notes', { title: 'Идеи на квартал', body: '— Запустить вебинар про интеграцию с 1С\n— Пакет «Старт» для команд до 5 человек\n— Партнёрка для бухгалтерских фирм', color: '#FEF3C7', pinned: 1, user_id: uAdmin });
    ins('notes', { title: 'Позвонить', body: 'Кравцову — по продлению поддержки\nБелый парус — после демо', color: '#DCFCE7', pinned: 0, user_id: uAdmin });
    ins('notes', { title: 'Пароли не храним здесь 🙂', body: 'Для доступов используем менеджер паролей компании.', color: '#E0F2FE', pinned: 0, user_id: uAdmin });
    ins('portal_requests', { company_id: C[0].id, contact_id: K.find((k) => k.company === C[0].id)?.id, subject: 'Не приходят уведомления на почту', text: 'С понедельника перестали приходить письма о новых задачах.', status: 'in_work' });
    ins('portal_requests', { company_id: C[1].id, contact_id: K.find((k) => k.company === C[1].id)?.id, subject: 'Добавить ещё 5 пользователей', text: 'Нужны лицензии для нового отдела.', status: 'new' });
    ins('portal_requests', { company_id: C[5].id, subject: 'Акт за сентябрь', text: 'Пришлите, пожалуйста, оригинал акта.', status: 'done', answer: 'Отправили курьером 12-го числа.' });

    // ---------- custom fields ----------
    ins('custom_fields', { entity: 'deals', key: 'cf_users_count', label: 'Количество пользователей', type: 'number', options: [], required: 0, sort: 1 });
    ins('custom_fields', { entity: 'companies', key: 'cf_branch', label: 'Филиал', type: 'select', options: ['Москва', 'Санкт-Петербург', 'Екатеринбург', 'Казань'], required: 0, sort: 1 });

    // ---------- timeline ----------
    for (const d of D) {
      ins('activities', { entity_type: 'deals', entity_id: d.id, kind: 'system', text: 'Сделка создана', user_id: d.resp, created_at: ts(d.created) });
      if (R.chance(0.6)) ins('activities', { entity_type: 'deals', entity_id: d.id, kind: R.pick(['call', 'comment', 'meeting']), text: R.pick(['Созвонились, клиент ждёт КП до конца недели.',
        'Провели демо, клиенту понравились отчёты и интеграция с 1С.', 'Отправил КП, перезвонить через 2 дня.', 'ЛПР — финансовый директор, бюджет согласован на квартал.']), user_id: d.resp, created_at: ts(addDays(d.created, R.int(1, 5)) > T ? T : addDays(d.created, R.int(1, 5))) });
      if (d.closed) ins('activities', { entity_type: 'deals', entity_id: d.id, kind: 'stage', text: `Стадия: Переговоры → ${d.kind === 'won' ? 'Успешно' : 'Провал'}`, user_id: d.resp, created_at: ts(d.closed) });
    }
    for (const co of C.slice(0, 12)) ins('activities', { entity_type: 'companies', entity_id: co.id, kind: 'comment', text: 'Клиент лоялен, рассматривают расширение на филиалы.', user_id: R.pick(sales), created_at: ts(dayAgo(R.int(1, 30))) });

    // ---------- 1C log ----------
    const olog = (direction: string, entity: string, status: string, message: string, count: number, daysAgo: number) =>
      ins('onec_log', { direction, entity, status, message, count, created_at: ts(dayAgo(daysAgo)) });
    olog('in', 'connection', 'ok', 'Проверка подключения: организаций 1', 1, 3);
    olog('in', 'Каталог (CommerceML)', 'ok', 'Товаров: новых 0, обновлено 16, групп 5', 16, 2);
    olog('out', 'Заказы (CommerceML)', 'ok', 'Передано в 1С заказов: 4', 4, 1);

    // ---------- parity data: activities, stages, portfolios, templates, lists, directions, offers ----------
    db.run(`UPDATE deals SET start_date = substr(created_at, 1, 10)`);
    const actSubjects: [string, string][] = [['call', 'Позвонить и уточнить требования'], ['meeting', 'Провести демонстрацию'], ['task', 'Подготовить расчёт стоимости'],
      ['email', 'Отправить КП и презентацию'], ['call', 'Узнать решение по договору'], ['letter', 'Отправить договор на подпись']];
    for (const d of D.filter((x) => x.kind === 'open')) {
      const n = R.int(0, 2);
      for (let k = 0; k < n; k++) {
        const [kind, subject] = R.pick(actSubjects);
        const shift = R.pick([-3, -1, 0, 0, 1, 2, 5]);
        const due = new Date(); due.setDate(due.getDate() + shift); due.setHours(R.int(10, 17), R.pick([0, 30]), 0, 0);
        ins('crm_activities', { kind, subject, due_at: localDateTime(due), responsible_id: d.resp, deal_id: d.id, company_id: d.company, contact_id: d.contact, is_done: 0, created_at: ts(dayAgo(R.int(1, 10))) });
      }
    }
    for (const d of D.filter((x) => x.kind !== 'open').slice(0, 25)) {
      ins('crm_activities', { kind: 'call', subject: 'Первичный звонок', due_at: `${addDays(d.created, 1)}T11:00`, responsible_id: d.resp, deal_id: d.id, company_id: d.company, is_done: 1, done_at: ts(addDays(d.created, 1)), result: 'Договорились о встрече' });
    }
    for (const d of D.filter((x) => x.kind === 'lost').slice(0, 4)) db.run(`UPDATE deals SET is_archived = 1 WHERE id = ?`, [d.id]);

    const pf1 = ins('portfolios', { name: 'Внедрения для клиентов', description: 'Коммерческие проекты внедрения CRM', manager_id: uNikitin, color: '#0FA596' });
    const pf2 = ins('portfolios', { name: 'Развитие компании', description: 'Внутренние проекты', manager_id: uAdmin, color: '#6366F1' });
    const stageSets = [['Подготовка', 'Настройка', 'Обучение', 'Запуск'], ['Аналитика', 'Разработка', 'Тестирование', 'Сдача']];
    PR.forEach((p, i) => {
      db.run(`UPDATE projects SET portfolio_id = ? WHERE id = ?`, [i === 5 ? pf2 : pf1, p.id]);
      const names = stageSets[i % 2];
      const span = Math.max(4, Math.round((new Date(p.end).getTime() - new Date(p.start).getTime()) / 864e5));
      const doneUntil = p.status === 'done' ? names.length : p.status === 'planning' ? 0 : Math.min(names.length - 1, Math.floor(((Date.now() - new Date(p.start).getTime()) / 864e5 / span) * names.length));
      names.forEach((name, k) => {
        const from = addDays(p.start, Math.round((span / names.length) * k));
        ins('project_stages', { project_id: p.id, name, sort: k + 1, status: k < doneUntil ? 'done' : k === doneUntil ? 'active' : 'pending', date_from: from, date_to: addDays(from, Math.round(span / names.length) - 1) });
      });
    });
    ins('project_templates', { name: 'Внедрение CRM «под ключ»', description: 'Типовой проект внедрения на 30 дней', duration_days: 30,
      stages: [{ name: 'Подготовка', days: 7 }, { name: 'Настройка', days: 12 }, { name: 'Обучение', days: 6 }, { name: 'Запуск', days: 5 }],
      tasks: [{ title: 'Собрать требования', offset_days: 0, duration_days: 3 }, { title: 'Настроить воронку и роли', offset_days: 7, duration_days: 5 }, { title: 'Импортировать клиентов', offset_days: 10, duration_days: 2 },
        { title: 'Настроить обмен с 1С', offset_days: 12, duration_days: 5 }, { title: 'Обучить пользователей', offset_days: 19, duration_days: 4 }, { title: 'Подписать акт', offset_days: 28, duration_days: 2 }] });
    ins('project_templates', { name: 'Интеграция с 1С', description: 'Подключение обмена с 1С: справочники, счета, оплаты', duration_days: 14,
      stages: [{ name: 'Аудит базы 1С', days: 3 }, { name: 'Настройка обмена', days: 6 }, { name: 'Проверка на копии', days: 3 }, { name: 'Перевод в работу', days: 2 }],
      tasks: [{ title: 'Получить доступ к копии базы', offset_days: 0, duration_days: 1 }, { title: 'Опубликовать OData', offset_days: 1, duration_days: 2 }, { title: 'Сопоставить справочники', offset_days: 3, duration_days: 4 }, { title: 'Проверить обмен на копии', offset_days: 9, duration_days: 3 }] });

    ins('task_templates', { name: 'Подготовить КП', title: 'Подготовить коммерческое предложение', description: 'Собрать требования, посчитать стоимость, оформить КП по шаблону.', priority: 'high', estimate_hours: 2, duration_days: 1, checklist: ['Уточнить состав работ', 'Посчитать стоимость', 'Согласовать скидку', 'Отправить клиенту'], tags: ['продажи'] });
    ins('task_templates', { name: 'Онбординг клиента', title: 'Провести онбординг нового клиента', priority: 'normal', estimate_hours: 4, duration_days: 5, checklist: ['Приветственное письмо', 'Созвон-знакомство', 'Доступы в систему', 'Обучение администратора'], tags: ['внедрение'] });
    ins('task_templates', { name: 'Закрыть месяц', title: 'Закрыть месяц в бухгалтерии', priority: 'high', estimate_hours: 6, duration_days: 3, assignee_id: uPavlova, checklist: ['Сверить выписки', 'Выставить акты', 'Начислить зарплату', 'Сформировать отчёт ОПиУ'], tags: ['финансы'] });
    const tl1 = ins('task_lists', { name: 'Личное', user_id: uAdmin, color: '#EC4899', sort: 1 });
    const tl2 = ins('task_lists', { name: 'Стратегия', user_id: uAdmin, color: '#6366F1', sort: 2 });
    const myTasks = db.all(`SELECT id FROM tasks WHERE assignee_id = ? ORDER BY id LIMIT 6`, [uAdmin]);
    myTasks.forEach((t, i) => { if (i < 2) db.run(`UPDATE tasks SET list_id = ? WHERE id = ?`, [i ? tl2 : tl1, t.id]); });
    db.run(`UPDATE tasks SET viewed_at = created_at WHERE assignee_id != ? OR id % 3 != 0`, [uAdmin]);
    db.run(`UPDATE tasks SET helpers = ? WHERE id IN (SELECT id FROM tasks WHERE project_id IS NOT NULL ORDER BY id LIMIT 6)`, [JSON.stringify([uZaitseva])]);
    db.run(`UPDATE tasks SET helpers = ? WHERE id IN (SELECT id FROM tasks WHERE project_id IS NULL AND assignee_id != ? ORDER BY id LIMIT 3)`, [JSON.stringify([uAdmin]), uAdmin]);
    db.run(`UPDATE tasks SET progress = 100 WHERE status = 'done'`);
    db.run(`UPDATE tasks SET progress = 40 + (id % 5) * 10 WHERE status IN ('in_progress','review')`);
    db.run(`UPDATE tasks SET bill_customer = 1, bill_by = 'fact', hour_price = 3500 WHERE project_id IS NOT NULL AND id % 2 = 0`);
    for (const p of PR) {
      const ts2 = db.all(`SELECT id FROM tasks WHERE project_id = ? ORDER BY sort, id LIMIT 4`, [p.id]);
      for (let k = 1; k < ts2.length; k++) ins('task_links', { task_id: ts2[k].id, depends_on_id: ts2[k - 1].id, kind: 'fs', lag_days: k === 2 ? 2 : 0 });
    }

    const kbMain = ins('kb_bases', { name: 'Регламенты компании', description: 'Правила, продажи и внедрение', icon: '📚', access: 'all', sort: 1 });
    const kbNew = ins('kb_bases', { name: 'Курс для новичков', description: 'Всё для первой недели в компании', icon: '🎓', access: 'all', sort: 2 });
    db.run(`UPDATE kb_sections SET base_id = ? WHERE id IN (?, ?, ?)`, [kbMain, kb1, kb2, kb3]);
    db.run(`UPDATE kb_sections SET base_id = ? WHERE id = ?`, [kbNew, kb4]);

    const dirImpl = ins('directions', { name: 'Внедрение', color: '#0FA596', description: 'Проекты внедрения и настройки' });
    const dirLic = ins('directions', { name: 'Лицензии и поддержка', color: '#6366F1', description: 'Подписки и техподдержка' });
    const dirHw = ins('directions', { name: 'Оборудование', color: '#F59E0B', description: 'Продажа техники' });
    db.run(`UPDATE fin_operations SET direction_id = ? WHERE kind = 'income' AND description LIKE '%оддержк%'`, [dirLic]);
    db.run(`UPDATE fin_operations SET direction_id = ? WHERE kind = 'income' AND description LIKE '%лицензи%'`, [dirLic]);
    db.run(`UPDATE fin_operations SET direction_id = ? WHERE kind = 'income' AND direction_id IS NULL AND category_id = ?`, [dirHw, cat['Выручка от продажи товаров']]);
    db.run(`UPDATE fin_operations SET direction_id = ? WHERE kind = 'income' AND direction_id IS NULL`, [dirImpl]);
    db.run(`UPDATE fin_operations SET legal_entity_id = ?`, [le]);
    const splitOp = db.get(`SELECT id, amount FROM fin_operations WHERE kind = 'expense' AND category_id = ? ORDER BY date DESC LIMIT 1`, [cat['Офисные расходы']]);
    if (splitOp) {
      ins('fin_splits', { operation_id: splitOp.id, category_id: cat['Офисные расходы'], amount: round2(splitOp.amount * 0.6) });
      ins('fin_splits', { operation_id: splitOp.id, category_id: cat['Связь и интернет'], amount: round2(splitOp.amount - round2(splitOp.amount * 0.6)) });
    }

    const recItems = (pid: number, qty: number) => { const p = P.find((x) => x.id === pid)!; return [{ product_id: p.id, name: p.name, qty, unit: p.unit, price: p.price, vat: '22' }]; };
    const nextMonth1 = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return localDate(d); })();
    ins('recurring_invoices', { name: 'Техподдержка «Премиум»', company_id: C[0].id, legal_entity_id: le, period: 'month', next_date: nextMonth1, pay_days: 5, vat_mode: 'included', items: recItems(P[15].id, 1), total: P[15].price, auto_send: 1, is_active: 1, responsible_id: uSalesHead });
    ins('recurring_invoices', { name: 'Лицензии на 25 пользователей', company_id: C[1].id, legal_entity_id: le, period: 'month', next_date: addDays(T, 9), pay_days: 5, vat_mode: 'included', items: recItems(P[6].id, 25), total: P[6].price * 25, auto_send: 1, is_active: 1, responsible_id: uOrlov });
    ins('recurring_invoices', { name: 'Облачное хранилище, годовая подписка', company_id: C[5].id, legal_entity_id: le, period: 'year', next_date: addDays(T, 40), pay_days: 10, vat_mode: 'included', items: recItems(P[7].id, 1), total: P[7].price, auto_send: 0, is_active: 1, responsible_id: uVetrova });

    const offerDeals = D.filter((d) => d.stage === S[3] || d.stage === S[4]).slice(0, 4);
    offerDeals.forEach((d, i) => {
      const date = addDays(d.created, 3) > T ? T : addDays(d.created, 3);
      const off = ins('offers', { number: String(i + 1), date, valid_until: addDays(date, 14), company_id: d.company, contact_id: d.contact, deal_id: d.id, legal_entity_id: le,
        status: i === 0 ? 'accepted' : i === 3 ? 'draft' : 'sent', vat_mode: 'included', total: d.amount, responsible_id: d.resp,
        intro: 'Благодарим за интерес к нашим услугам. Предлагаем решение под ваши задачи.', terms: 'Срок внедрения — 30 рабочих дней. Оплата: 50% предоплата, 50% после запуска.' });
      for (const it of db.all(`SELECT * FROM deal_products WHERE deal_id = ?`, [d.id])) {
        ins('offer_items', { offer_id: off, product_id: it.product_id, name: it.name, qty: it.qty, unit: it.unit, price: it.price, discount: it.discount, vat: it.vat });
      }
    });
    ins('invitations', { email: 'new.manager@vela.demo', name: 'Новый менеджер', role_id: roleIds['Менеджер по продажам'], status: 'pending', invited_by: uSalesHead });
    ins('invitations', { email: 'designer@vela.demo', name: 'Дизайнер', role_id: roleIds['Сотрудник'], status: 'pending', invited_by: uAdmin });
    for (const a of db.all(`SELECT id FROM activities WHERE kind IN ('comment','call','meeting') ORDER BY id LIMIT 30`)) {
      if (R.chance(0.4)) db.run(`UPDATE activities SET likes = ? WHERE id = ?`, [JSON.stringify([R.pick(U), R.pick(U)].filter((v, i, arr) => arr.indexOf(v) === i)), a.id]);
    }
    void dirHw;

    // ---------- notifications ----------
    const note = (user: number, text: string, link: string, kind: string, minutesAgo: number, read = false) =>
      ins('notifications', { user_id: user, text, link, kind, is_read: read ? 1 : 0, created_at: new Date(Date.now() - minutesAgo * 60000).toISOString() });
    note(uAdmin, 'Требуется согласование: скидка директором', '/bp', 'bp', 15);
    note(uAdmin, 'Дмитрий Орлов упомянул(а) вас в сделке', `/crm/deals/${dealForBp.id}`, 'mention', 70);
    note(uAdmin, 'Новая заявка с веб-формы «Заявка на демо»', '/crm/deals', 'deal', 140);
    note(uAdmin, 'Счёт № 3 оплачен', '/crm/invoices/3', 'deal', 600, true);
  });
}
