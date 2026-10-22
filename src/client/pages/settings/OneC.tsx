import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Copy, Download, FileUp, PlugZap, RefreshCw, XCircle } from 'lucide-react';
import { api, IS_DEMO, saveText } from '../../api.ts';
import { relative } from '../../lib/format.ts';
import { useApi, useInvalidate, useList } from '../../lib/state.tsx';
import { Badge, Button, Card, Checkbox, FormRow, Input, Loading, Select, Switch, Tabs, Textarea, cx, useToast } from '../../ui/ui.tsx';
import { DataTable, readTextFile } from '../../ui/data.tsx';
import { SettingsHeader } from './Settings.tsx';

const BSL = (base: string) => `// Пример для своей доработки 1С: передать контрагента в Vela CRM по REST API
// Ключ создаётся в Vela CRM: Настройки → API и вебхуки
Функция ОтправитьКонтрагентаВCRM(Контрагент) Экспорт
    Соединение = Новый HTTPСоединение("${base.replace(/^https?:\/\//, '')}", , , , , 30, Новый ЗащищенноеСоединениеOpenSSL);
    Запрос = Новый HTTPЗапрос("/api/e/companies");
    Запрос.Заголовки.Вставить("Content-Type", "application/json; charset=utf-8");
    Запрос.Заголовки.Вставить("Authorization", "Bearer vk_ВАШ_КЛЮЧ");

    Данные = Новый Структура;
    Данные.Вставить("name", Контрагент.Наименование);
    Данные.Вставить("legal_name", Контрагент.НаименованиеПолное);
    Данные.Вставить("inn", Контрагент.ИНН);
    Данные.Вставить("kpp", Контрагент.КПП);
    Данные.Вставить("onec_guid", Строка(Контрагент.УникальныйИдентификатор()));

    Запись = Новый ЗаписьJSON;
    Запись.УстановитьСтроку();
    ЗаписатьJSON(Запись, Данные);
    Запрос.УстановитьТелоИзСтроки(Запись.Закрыть(), КодировкаТекста.UTF8);

    Ответ = Соединение.ОтправитьДляОбработки(Запрос);
    Возврат Ответ.КодСостояния = 200;
КонецФункции`;

export default function OneC() {
  const [tab, setTab] = useState<'odata' | 'cml' | 'api' | 'log'>('odata');
  const { data: s, isLoading } = useApi<any>(['onec', 'settings'], '/api/onec/settings');
  return (
    <div>
      <SettingsHeader title="Интеграция с 1С" subtitle="Обмен контрагентами, номенклатурой, счетами и оплатами с 1С:Бухгалтерией, УТ, УНФ, КА и ERP" />
      {IS_DEMO && (
        <div className="mb-5 rounded-xl border border-primary/30 bg-primary-soft px-4 py-3 text-sm">
          <b>Демо-режим.</b> Подключена учебная база 1С (<code>demo://1c</code>): нажмите «Проверить подключение», затем «Синхронизировать». Данные из «1С» появятся в Компаниях, Каталоге и Финансах.
          Подключение к настоящей 1С работает в серверной версии: браузер не пускает запросы к чужим серверам.
        </div>
      )}
      <Tabs value={tab} onChange={setTab} className="mb-5" tabs={[{ value: 'odata', label: 'Прямое подключение (OData)' }, { value: 'cml', label: 'Обмен с сайтом (CommerceML)' }, { value: 'api', label: 'REST API для доработок' }, { value: 'log', label: 'Журнал обмена' }]} />
      {isLoading || !s ? <Loading /> : (
        <>
          {tab === 'odata' && <OData s={s} />}
          {tab === 'cml' && <Cml s={s} />}
          {tab === 'api' && <ApiTab />}
          {tab === 'log' && <Log />}
        </>
      )}
    </div>
  );
}

function OData({ s: initial }: { s: any }) {
  const [s, setS] = useState<any>(initial);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [checks, setChecks] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const toast = useToast();
  const inv = useInvalidate();
  const accounts = useList('fin_accounts', { kind: 'bank', limit: 50 }).data?.items ?? [];
  useEffect(() => setS(initial), [initial]);
  const save = async (quiet = false) => {
    const { presets: _p, preset_full: _pf, ...rest } = s;
    try { await api.put('/api/onec/settings', rest); inv('onec'); if (!quiet) toast.success('Настройки сохранены'); return true; }
    catch (e) { toast.error(e); return false; }
  };
  const test = async () => {
    setBusy('test');
    try {
      if (!(await save(true))) return;
      const r = await api.post('/api/onec/test');
      setOrgs(r.organizations);
      setChecks(r.checks);
      if (r.organizations[0] && !s.organization_key) setS((x: any) => ({ ...x, organization_key: r.organizations[0].key }));
      toast.success(`Подключение есть. Организаций в базе: ${r.organizations.length}`);
    } catch (e) { toast.error(e); } finally { setBusy(null); inv('onec_log'); }
  };
  const sync = async () => {
    setBusy('sync');
    try {
      if (!(await save(true))) return;
      const r = await api.post('/api/onec/sync', {});
      setResult(r.result);
      inv('companies', 'products', 'fin_operations', 'invoices', 'onec_log', 'onec');
      toast.success('Обмен завершён');
    } catch (e) { toast.error(e); } finally { setBusy(null); }
  };
  const pf = s.preset_full;
  const LABELS: Record<string, string> = { companies: 'Контрагенты', products: 'Номенклатура', payments: 'Поступления', push_companies: 'Контрагенты → 1С', push_invoices: 'Счета → 1С' };
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <Card title="Подключение к базе 1С" subtitle="База публикуется на веб-сервере (Apache или IIS) с включённым OData">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormRow label="Конфигурация"><Select value={s.preset} onChange={(e) => setS({ ...s, preset: e.target.value, overrides: undefined })}>{s.presets.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FormRow>
            <FormRow label="Адрес публикации" hint="Например https://1c.company.ru/buh — без /odata в конце"><Input value={s.url} onChange={(e) => setS({ ...s, url: e.target.value })} placeholder="https://1c.company.ru/buh" /></FormRow>
            <FormRow label="Пользователь 1С"><Input value={s.login} onChange={(e) => setS({ ...s, login: e.target.value })} autoComplete="off" /></FormRow>
            <FormRow label="Пароль"><Input type="password" value={s.password} onChange={(e) => setS({ ...s, password: e.target.value })} autoComplete="new-password" /></FormRow>
            {orgs.length > 0 && <FormRow label="Организация для документов"><Select value={s.organization_key ?? ''} onChange={(e) => setS({ ...s, organization_key: e.target.value })}>{orgs.map((o) => <option key={o.key} value={o.key}>{o.name}{o.inn ? `, ИНН ${o.inn}` : ''}</option>)}</Select></FormRow>}
            <FormRow label="Счёт для поступлений из 1С"><Select value={s.account_id ?? ''} onChange={(e) => setS({ ...s, account_id: e.target.value ? Number(e.target.value) : undefined })}><option value="">Первый расчётный</option>{accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></FormRow>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button icon={<PlugZap className="size-4" />} loading={busy === 'test'} onClick={test}>Проверить подключение</Button>
            <Button variant="ghost" onClick={() => save()}>Сохранить</Button>
          </div>
          {checks && (
            <ul className="mt-4 space-y-1 text-sm">
              {checks.map((c) => <li key={c.set} className="flex items-start gap-2">{c.ok ? <CheckCircle2 className="mt-0.5 size-4 text-success" /> : <XCircle className="mt-0.5 size-4 text-danger" />}<code>{c.set}</code>{c.error && <span className="text-xs text-danger">{c.error}</span>}</li>)}
            </ul>
          )}
        </Card>
        <Card title="Что синхронизировать">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Checkbox checked={!!s.pull_companies} onChange={(v) => setS({ ...s, pull_companies: v })} label="Контрагенты из 1С → CRM (по ИНН)" />
            <Checkbox checked={!!s.push_companies} onChange={(v) => setS({ ...s, push_companies: v })} label="Новые клиенты из CRM → 1С" />
            <Checkbox checked={!!s.pull_products} onChange={(v) => setS({ ...s, pull_products: v })} label="Номенклатура из 1С → Каталог" />
            <Checkbox checked={!!s.push_invoices} onChange={(v) => setS({ ...s, push_invoices: v })} label="Выставленные счета CRM → 1С" />
            <Checkbox checked={!!s.pull_payments} onChange={(v) => setS({ ...s, pull_payments: v })} label="Поступления оплат из 1С → Финансы" />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <FormRow label="Загружать оплаты начиная с"><Input type="date" value={s.payments_from ?? ''} onChange={(e) => setS({ ...s, payments_from: e.target.value })} /></FormRow>
            <FormRow label="Автоматический обмен" hint="Работает в серверной версии"><Select value={String(s.interval_min ?? 0)} onChange={(e) => setS({ ...s, interval_min: Number(e.target.value) })}>
              <option value="0">Только вручную</option><option value="15">Каждые 15 минут</option><option value="60">Каждый час</option><option value="240">Каждые 4 часа</option><option value="1440">Раз в сутки</option>
            </Select></FormRow>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary" icon={<RefreshCw className={cx('size-4', busy === 'sync' && 'animate-spin')} />} disabled={busy === 'sync'} onClick={sync}>Синхронизировать сейчас</Button>
            {s.last_sync && <span className="text-sm text-muted">Последний обмен: {relative(s.last_sync)}</span>}
          </div>
          {result && (
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {Object.entries(result).map(([k, v]: [string, any]) => (
                <div key={k} className="rounded-lg border border-line p-3 text-sm">
                  <p className="font-semibold">{LABELS[k] ?? k}</p>
                  <p className="text-muted">новых {v.created}, обновлено {v.updated}{v.errors ? <span className="text-danger">, ошибок {v.errors}</span> : ''}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Сопоставление объектов" subtitle="Имена объектов OData для выбранной конфигурации. Меняйте, только если у вас доработанная 1С.">
          <div className="grid gap-3 sm:grid-cols-2">
            {(['companies', 'products', 'invoices', 'payments'] as const).map((k) => (
              <FormRow key={k} label={({ companies: 'Контрагенты', products: 'Номенклатура', invoices: 'Счета', payments: 'Поступления' })[k]}>
                <Input value={s.overrides?.[k]?.set ?? pf?.[k]?.set ?? ''} onChange={(e) => setS({ ...s, overrides: { ...(s.overrides ?? {}), [k]: { ...(s.overrides?.[k] ?? {}), set: e.target.value } } })} className="font-mono text-xs" />
              </FormRow>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Как подключить 1С" className="h-fit">
        <ol className="list-decimal space-y-2.5 pl-4 text-sm text-muted">
          <li>Опубликуйте базу 1С на веб-сервере: Конфигуратор → Администрирование → Публикация на веб-сервере, галочка «Публиковать стандартный интерфейс OData».</li>
          <li>В режиме 1С:Предприятие откройте обработку «Настройка автоматического REST-сервиса» (Все функции → Обработки) и отметьте справочники «Контрагенты», «Номенклатура», «Организации» и документы счетов и поступлений.</li>
          <li>Создайте в 1С отдельного пользователя для обмена с правами на чтение и запись этих объектов.</li>
          <li>Укажите здесь адрес публикации, логин и пароль, нажмите «Проверить подключение».</li>
          <li>Нажмите «Синхронизировать». Клиенты сопоставляются по ИНН, товары — по артикулу. Дублей не будет.</li>
        </ol>
        <p className="mt-4 text-xs text-faint">Нужна 1С:Предприятие 8.3 и лицензия на веб-публикацию (клиентские лицензии расходуются на сеанс обмена).</p>
      </Card>
    </div>
  );
}

function Cml({ s: initial }: { s: any }) {
  const [s, setS] = useState<any>(initial);
  const toast = useToast();
  const inv = useInvalidate();
  const [busy, setBusy] = useState(false);
  const base = IS_DEMO ? 'https://crm.ваша-компания.ru' : location.origin;
  const url = `${base}/api/1c/exchange`;
  const save = async () => {
    const { presets: _p, preset_full: _pf, ...rest } = s;
    try { await api.put('/api/onec/settings', rest); inv('onec'); toast.success('Сохранено'); } catch (e) { toast.error(e); }
  };
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const r = await api.post('/api/onec/cml-import', { xml: await readTextFile(file) });
      inv('products', 'product_categories', 'onec_log', 'deals');
      toast.success(r.kind === 'catalog' ? `Каталог: новых ${r.created}, обновлено ${r.updated}` : r.kind === 'offers' ? `Цены и остатки обновлены у ${r.updated} товаров` : `Заказов обновлено: ${r.matched}`);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const orders = async () => {
    try { const r = await api.get('/api/onec/cml-orders'); saveText(r.xml, 'orders.xml', 'application/xml'); } catch (e) { toast.error(e); }
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <Card title="Обмен по протоколу CommerceML 2" subtitle="Стандартный «Обмен с сайтом» из 1С:УТ, УНФ, КА и ERP — без программиста">
          <Switch checked={!!s.cml_enabled} onChange={(v) => setS({ ...s, cml_enabled: v })} label="Разрешить 1С подключаться к CRM" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <FormRow label="Адрес для 1С" className="sm:col-span-2">
              <div className="flex gap-2"><Input readOnly value={url} className="font-mono text-xs" /><Button icon={<Copy className="size-4" />} onClick={() => { navigator.clipboard?.writeText(url); toast.success('Скопировано'); }}>Копировать</Button></div>
            </FormRow>
            <FormRow label="Логин"><Input value={s.cml_login} onChange={(e) => setS({ ...s, cml_login: e.target.value })} /></FormRow>
            <FormRow label="Пароль"><Input type="password" value={s.cml_password} onChange={(e) => setS({ ...s, cml_password: e.target.value })} autoComplete="new-password" /></FormRow>
          </div>
          <Button variant="primary" className="mt-4" onClick={save}>Сохранить</Button>
        </Card>
        <Card title="Загрузить файлы обмена вручную" subtitle="import.xml (каталог), offers.xml (цены и остатки) или файл заказов из 1С">
          <label className={cx('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line py-8 text-center hover:border-primary', busy && 'opacity-50')}>
            <FileUp className="size-7 text-faint" /><span className="font-semibold">Выберите XML-файл</span>
            <input type="file" accept=".xml" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          <Button className="mt-3" icon={<Download className="size-4" />} onClick={orders}>Скачать заказы для 1С (orders.xml)</Button>
        </Card>
      </div>
      <Card title="Настройка в 1С" className="h-fit">
        <ol className="list-decimal space-y-2.5 pl-4 text-sm text-muted">
          <li>В 1С откройте: Администрирование → Интеграция с другими программами → Обмен с сайтами (в УНФ: Настройки → Интеграции → Сайт).</li>
          <li>Создайте узел обмена, тип — «Обмен через веб-сервис / CommerceML».</li>
          <li>Адрес сайта — <code className="break-all">{url}</code>, логин и пароль — как здесь.</li>
          <li>Отметьте выгрузку товаров, цен, остатков и загрузку заказов. Запустите обмен.</li>
        </ol>
        <p className="mt-4 text-xs text-faint">Сделки с товарами передаются в 1С как заказы покупателей, а статусы заказов возвращаются в ленту сделки.</p>
      </Card>
    </div>
  );
}

function ApiTab() {
  const base = IS_DEMO ? 'https://crm.ваша-компания.ru' : location.origin;
  const toast = useToast();
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <Card title="Код для 1С (встроенный язык)" subtitle="Если в вашей 1С есть свои справочники или документы — передавайте их в CRM напрямую"
        actions={<Button size="sm" icon={<Copy className="size-4" />} onClick={() => { navigator.clipboard?.writeText(BSL(base)); toast.success('Код скопирован'); }}>Копировать</Button>}>
        <Textarea readOnly rows={22} value={BSL(base)} className="font-mono text-xs" />
      </Card>
      <Card title="Что ещё можно" className="h-fit">
        <ul className="list-disc space-y-2 pl-4 text-sm text-muted">
          <li>Создайте API-ключ в разделе <Link className="text-primary hover:underline" to="/settings/api">API и вебхуки</Link>.</li>
          <li>Подпишите 1С на вебхуки CRM: при выигрыше сделки 1С может сама создать заказ или реализацию.</li>
          <li>Банковские выписки в формате 1С загружаются в <Link className="text-primary hover:underline" to="/finance/import">Финансах</Link>, а платёжки выгружаются обратно для клиент-банка.</li>
        </ul>
      </Card>
    </div>
  );
}

function Log() {
  const { data } = useList('onec_log', { limit: 200 });
  return (
    <Card padded={false}>
      <DataTable entity="onec_log" rows={data?.items ?? []} columns={[{ key: 'created_at', label: 'Когда', render: (r: any) => relative(r.created_at) }, 'direction', 'entity', 'status', 'message', 'count']}
        empty={<p className="px-4 py-10 text-center text-sm text-faint">Обменов ещё не было</p>} />
      <p className="border-t border-line px-4 py-2 text-xs text-faint"><Badge color="#10b981">Успешно</Badge> — данные переданы; <Badge color="#f59e0b">Предупреждение</Badge> — часть записей пропущена, причина в сообщении.</p>
    </Card>
  );
}
