import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowUpRight, Banknote, CheckCheck, Clock3, CreditCard, Landmark, Play, Plus, Printer, Receipt, Scissors, Trash2, Wallet } from 'lucide-react';
import { api, openPrint } from '../../api.ts';
import { date, money, todayIso } from '../../lib/format.ts';
import { useApi, useAuth, useInvalidate, useList, useMeta, useRecord } from '../../lib/state.tsx';
import { Badge, Button, Card, EmptyState, FormRow, IconButton, Input, Loading, Modal, Select, Stat, Tabs, cx, useToast } from '../../ui/ui.tsx';
import { EntityList, FieldsPanel, Timeline } from '../../ui/data.tsx';
import { RecordForm, RefSelect } from '../../ui/fields.tsx';
import { FinHeader } from './Finance.tsx';
import { LinesEditor } from '../crm/Lines.tsx';

const ACC_ICON: Record<string, React.ReactNode> = { bank: <Landmark className="size-4" />, cash: <Banknote className="size-4" />, card: <CreditCard className="size-4" />, ewallet: <Wallet className="size-4" /> };

export function Money() {
  const { field } = useMeta();
  const { can } = useAuth();
  const [form, setForm] = useState<any>(null);
  const [hide, setHide] = useState(false);
  const [split, setSplit] = useState<any>(null);
  const balances = useApi<any[]>(['finance', 'balances'], '/api/finance/balances').data ?? [];
  const base = { date: todayIso(), status: 'fact' };
  const writable = can('finance', 'write');
  return (
    <div>
      <FinHeader title="Деньги" subtitle="Все поступления, расходы и переводы между счетами"
        actions={writable && <>
          <Button variant="primary" icon={<ArrowDownLeft className="size-4" />} onClick={() => setForm({ ...base, kind: 'income' })}>Поступление</Button>
          <Button variant="primary" icon={<ArrowUpRight className="size-4" />} onClick={() => setForm({ ...base, kind: 'expense' })}>Расход</Button>
          <Button variant="primary" icon={<ArrowLeftRight className="size-4" />} onClick={() => setForm({ ...base, kind: 'transfer' })}>Трансфер</Button>
        </>} />
      {!hide && (
        <div className="mb-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {balances.filter((a) => !a.is_archived).map((a) => (
            <div key={a.id} className="rounded-2xl border border-line bg-surface p-4">
              <p className="flex items-center gap-2 text-sm text-muted">{ACC_ICON[a.kind]}{a.name}</p>
              <p className={cx('mt-1 text-xl font-extrabold tabular', a.balance < 0 && 'text-danger')}>{money(a.balance, { cents: true, currency: a.currency })}</p>
              <p className="text-xs text-faint">{a.bank_name ?? 'Своя касса'}</p>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => setHide(!hide)} className="mb-4 text-xs font-semibold text-primary hover:underline">{hide ? 'Показать остатки по счетам' : 'Скрыть остатки по счетам'}</button>
      <EntityList entity="fin_operations" canImport createLabel="Операция" defaults={{ ...base, kind: 'expense' }} onCreate={() => setForm({ ...base, kind: 'expense' })}
        filters={[{ key: 'kind', label: 'Тип', options: field('fin_operations', 'kind')?.options }, { key: 'status', label: 'Статус', options: field('fin_operations', 'status')?.options }]}
        onRowClick={(r) => writable && setForm(r)}
        columns={['date',
          { key: 'status', label: 'Ст.', render: (r: any) => r.status === 'fact' ? <CheckCheck className="size-4 text-success" aria-label="Проведена" /> : <Clock3 className="size-4 text-warning" aria-label="План" /> },
          { key: 'amount', label: 'Сумма', align: 'right', render: (r: any) => <b className={cx('tabular', r.kind === 'income' ? 'text-success' : r.kind === 'expense' ? 'text-danger' : 'text-primary')}>{r.kind === 'income' ? '+ ' : r.kind === 'expense' ? '− ' : '→ '}{money(r.amount, { cents: true })}</b> },
          'company_id', 'legal_entity_id',
          { key: 'category_id', label: 'Статья учёта', render: (r: any) => <SplitCell r={r} onSplit={() => writable && setSplit(r)} /> },
          'project_id', 'direction_id', 'account_id', 'description']} />
      <RecordForm entity="fin_operations" open={!!form} onClose={() => setForm(null)} initial={form}
        title={form?.id ? 'Операция' : form?.kind === 'income' ? 'Новое поступление' : form?.kind === 'expense' ? 'Новый расход' : 'Перевод между счетами'}
        fields={form?.kind === 'transfer' ? ['date', 'amount', 'account_id', 'to_account_id', 'description', 'status'] : ['kind', 'date', 'amount', 'account_id', 'category_id', 'company_id', 'legal_entity_id', 'project_id', 'direction_id', 'deal_id', 'invoice_id', 'description', 'status']} />
      {split && <SplitDialog op={split} onClose={() => setSplit(null)} />}
    </div>
  );
}

function SplitCell({ r, onSplit }: { r: any; onSplit: () => void }) {
  const { data } = useList('fin_splits', { operation_id: r.id, limit: 20 }, { enabled: r.kind !== 'transfer' });
  const n = data?.items.length ?? 0;
  if (r.kind === 'transfer') return <span className="text-faint">—</span>;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onSplit(); }} className="group inline-flex max-w-56 items-center gap-1.5 truncate text-left hover:text-primary" title="Разбить по статьям">
      {n ? <span className="font-semibold">Статьи учёта ({n})</span> : <span className="truncate">{r._ref?.category_id?.title ?? <span className="text-faint">Без статьи</span>}</span>}
      <Scissors className="size-3.5 shrink-0 text-faint opacity-0 group-hover:opacity-100" />
    </button>
  );
}

function SplitDialog({ op, onClose }: { op: any; onClose: () => void }) {
  const { data } = useList('fin_splits', { operation_id: op.id, limit: 50 });
  const inv = useInvalidate();
  const toast = useToast();
  const [cat, setCat] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const items = data?.items ?? [];
  const used = items.reduce((s: number, x: any) => s + (x.amount || 0), 0);
  const left = Math.round((op.amount - used) * 100) / 100;
  const add = async () => {
    const a = Number(amount.replace(',', '.')) || left;
    if (!cat || a <= 0) return toast.error('Укажите статью и сумму');
    if (a - left > 0.009) return toast.error(`Можно распределить не больше ${money(left)}`);
    await api.post('/api/e/fin_splits', { operation_id: op.id, category_id: cat, amount: a });
    setCat(null); setAmount('');
    inv('fin_splits', 'finance');
  };
  return (
    <Modal open onClose={onClose} title="Разбивка по статьям" subtitle={`${op.description ?? ''} · ${money(op.amount, { cents: true })}`}>
      <p className="mb-3 text-sm text-muted">Одна операция может относиться к нескольким статьям: например, счёт поставщика за связь и канцтовары. Отчёты ДДС и ОПиУ учтут каждую часть.</p>
      <ul className="mb-3 divide-y divide-line rounded-xl border border-line">
        {items.map((s: any) => (
          <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="flex-1">{s._ref?.category_id?.title}</span><b className="tabular">{money(s.amount, { cents: true })}</b>
            <IconButton label="Убрать" className="size-7" onClick={async () => { await api.del(`/api/e/fin_splits/${s.id}`); inv('fin_splits', 'finance'); }}><Trash2 className="size-3.5" /></IconButton></li>
        ))}
        {!items.length && <li className="px-3 py-3 text-sm text-faint">Пока вся сумма относится к статье «{op._ref?.category_id?.title ?? 'без статьи'}»</li>}
      </ul>
      <p className="mb-2 text-sm">Нераспределено: <b className="tabular">{money(left, { cents: true })}</b></p>
      {left > 0 && (
        <div className="flex flex-wrap gap-2">
          <div className="min-w-52 flex-1"><RefSelect entity="fin_categories" value={cat} onChange={setCat} filter={{ kind: op.kind }} placeholder="Статья" /></div>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(left)} className="w-36" inputMode="decimal" />
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={add}>Добавить</Button>
        </div>
      )}
    </Modal>
  );
}

export function Balance() {
  const [d, setD] = useState(todayIso());
  const { data: b, isLoading } = useApi<any>(['finance', 'balance-sheet'], '/api/finance/balance-sheet', { date: d });
  return (
    <div>
      <FinHeader title="Баланс" subtitle="Что есть у компании и что она должна — на выбранную дату" />
      <div className="mb-4 flex items-end gap-3"><FormRow label="На дату"><Input type="date" value={d} onChange={(e) => setD(e.target.value)} /></FormRow></div>
      {isLoading || !b ? <Loading /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Активы" value={money(b.total_assets)} tone="primary" />
            <Stat label="Обязательства" value={money(b.total_liabilities)} tone="accent" />
            <Stat label="Собственный капитал" value={money(b.equity)} tone={b.equity < 0 ? 'danger' : 'success'} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Активы" padded={false}>
              <ul className="divide-y divide-line">{b.assets.map((a: any) => <li key={a.name} className="flex justify-between gap-3 px-4 py-3 text-sm"><span>{a.name}</span><b className="tabular">{money(a.amount)}</b></li>)}
                <li className="flex justify-between bg-primary-soft px-4 py-3 text-sm font-extrabold"><span>Итого активы</span><span className="tabular">{money(b.total_assets)}</span></li></ul>
            </Card>
            <Card title="Пассивы" padded={false}>
              <ul className="divide-y divide-line">{b.liabilities.map((a: any) => <li key={a.name} className="flex justify-between gap-3 px-4 py-3 text-sm"><span>{a.name}</span><b className="tabular">{money(a.amount)}</b></li>)}
                <li className="flex justify-between px-4 py-3 text-sm font-bold"><span>Итого обязательства</span><span className="tabular">{money(b.total_liabilities)}</span></li>
                <li className="flex justify-between bg-primary-soft px-4 py-3 text-sm font-extrabold"><span>Собственный капитал</span><span className="tabular">{money(b.equity)}</span></li></ul>
            </Card>
          </div>
          <p className="text-xs text-faint">Управленческий баланс: остатки денег, неоплаченные счета клиентов, займы, подотчёт, товары по закупочной цене и остаточная стоимость имущества (линейная амортизация) против долгов поставщикам, кредитов и невыплаченной зарплаты.</p>
        </div>
      )}
    </div>
  );
}

export function Recurring() {
  const { can } = useAuth();
  const toast = useToast();
  const inv = useInvalidate();
  const [edit, setEdit] = useState<any>(null);
  const runNow = async (r: any) => {
    try { const i = await api.post(`/api/finance/recurring/${r.id}/run`); inv('recurring_invoices', 'invoices'); toast.success(`Выставлен счёт № ${i.number}`); }
    catch (e) { toast.error(e); }
  };
  return (
    <div>
      <FinHeader title="Регулярные счета" subtitle="Абонентская плата, лицензии, аренда: счёт выставляется сам в нужный день"
        actions={can('finance', 'write') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ period: 'month', next_date: todayIso(), pay_days: 5, vat_mode: 'included', auto_send: 1, is_active: 1, items: [] })}>Регулярный счёт</Button>} />
      <EntityList entity="recurring_invoices" onRowClick={setEdit} onCreate={() => setEdit({ period: 'month', next_date: todayIso(), pay_days: 5, vat_mode: 'included', auto_send: 1, is_active: 1, items: [] })}
        columns={['name', 'company_id', 'period', 'next_date', 'total', 'is_active', 'last_invoice_id',
          { key: 'run', label: '', sortable: false, render: (r: any) => can('finance', 'write') && <Button size="xs" variant="soft" icon={<Play className="size-3" />} onClick={(e) => { e.stopPropagation(); runNow(r); }}>Выставить сейчас</Button> }]} />
      {edit && <RecurringEditor r={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RecurringEditor({ r, onClose }: { r: any; onClose: () => void }) {
  const [f, setF] = useState<any>(r);
  const toast = useToast();
  const inv = useInvalidate();
  const items: any[] = f.items ?? [];
  const setItem = (i: number, patch: any) => setF({ ...f, items: items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const save = async () => {
    try {
      const { id, _ref, created_at, updated_at, created_by, extra, total, last_invoice_id, ...data } = f;
      void _ref; void created_at; void updated_at; void created_by; void extra; void total; void last_invoice_id;
      if (id) await api.patch(`/api/e/recurring_invoices/${id}`, data); else await api.post('/api/e/recurring_invoices', data);
      inv('recurring_invoices');
      onClose();
    } catch (e) { toast.error(e); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={f.id ? 'Регулярный счёт' : 'Новый регулярный счёт'}
      footer={<>{f.id && <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { await api.del(`/api/e/recurring_invoices/${f.id}`); inv('recurring_invoices'); onClose(); }}>Удалить</Button>}<Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormRow label="Название" required className="sm:col-span-2"><Input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Например: Техподдержка, ежемесячно" /></FormRow>
        <FormRow label="Плательщик" required><RefSelect entity="companies" value={f.company_id} onChange={(v) => setF({ ...f, company_id: v })} display={f._ref?.company_id?.title} /></FormRow>
        <FormRow label="Наше юрлицо"><RefSelect entity="legal_entities" value={f.legal_entity_id} onChange={(v) => setF({ ...f, legal_entity_id: v })} /></FormRow>
        <FormRow label="Периодичность"><Select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}><option value="month">Каждый месяц</option><option value="quarter">Каждый квартал</option><option value="year">Каждый год</option></Select></FormRow>
        <FormRow label="Следующий счёт" required><Input type="date" value={f.next_date ?? ''} onChange={(e) => setF({ ...f, next_date: e.target.value })} /></FormRow>
        <FormRow label="Срок оплаты, дней"><Input type="number" value={f.pay_days ?? 5} onChange={(e) => setF({ ...f, pay_days: Number(e.target.value) })} /></FormRow>
        <FormRow label="После выставления"><Select value={f.auto_send ? '1' : '0'} onChange={(e) => setF({ ...f, auto_send: Number(e.target.value) })}><option value="1">Сразу «Выставлен»</option><option value="0">Оставить черновиком</option></Select></FormRow>
      </div>
      <p className="mb-2 mt-5 text-[13px] font-semibold text-muted">Позиции</p>
      {items.map((it, i) => (
        <div key={i} className="mb-2 grid grid-cols-[1fr_80px_120px_auto] gap-2">
          <Input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="Наименование" />
          <Input type="number" value={it.qty} onChange={(e) => setItem(i, { qty: Number(e.target.value) })} aria-label="Количество" />
          <Input type="number" value={it.price} onChange={(e) => setItem(i, { price: Number(e.target.value) })} aria-label="Цена" />
          <IconButton label="Убрать" onClick={() => setF({ ...f, items: items.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></IconButton>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-72"><RefSelect entity="products" value={null} onChange={(_v, p) => p && setF({ ...f, items: [...items, { product_id: p.id, name: p.title, qty: 1, price: 0, unit: 'усл', vat: '22' }] })} placeholder="Добавить из каталога" /></div>
        <Button size="sm" onClick={() => setF({ ...f, items: [...items, { name: 'Услуга', qty: 1, price: 0, unit: 'усл', vat: '22' }] })}>Своя позиция</Button>
        <span className="ml-auto text-sm">Итого: <b className="tabular">{money(items.reduce((s, x) => s + (x.qty || 0) * (x.price || 0), 0))}</b></span>
      </div>
    </Modal>
  );
}

export function Offers() {
  const nav = useNavigate();
  const { field } = useMeta();
  return (
    <div>
      <FinHeader title="Коммерческие предложения" subtitle="КП с позициями и печатной формой, принятое КП превращается в счёт" />
      <EntityList entity="offers" rowLink={(r) => `/finance/offers/${r.id}`} createLabel="Предложение" defaults={{ date: todayIso(), status: 'draft', vat_mode: 'included' }}
        formFields={['date', 'valid_until', 'company_id', 'contact_id', 'deal_id', 'legal_entity_id', 'vat_mode', 'intro', 'terms', 'responsible_id']}
        filters={[{ key: 'status', label: 'Статус', options: field('offers', 'status')?.options }]}
        columns={[{ key: 'number', label: '№', render: (r: any) => <b>№ {r.number}</b> }, 'date', 'company_id', 'deal_id', 'status', 'total', 'valid_until', 'responsible_id']}
        onRowClick={(r) => nav(`/finance/offers/${r.id}`)} />
    </div>
  );
}

export function OfferPage() {
  const { id } = useParams();
  const oid = Number(id);
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const { can } = useAuth();
  const { field } = useMeta();
  const { data: o, isLoading } = useRecord('offers', oid);
  const [tab, setTab] = useState('items');
  if (isLoading) return <Loading />;
  if (!o) return <EmptyState title="Предложение не найдено" action={<Button onClick={() => nav('/finance/offers')}>К списку</Button>} />;
  const st = field('offers', 'status')?.options?.find((x) => x.value === o.status);
  const writable = can('finance', 'write') || can('crm', 'write');
  const set = async (d: any, msg: string) => { try { await api.patch(`/api/e/offers/${oid}`, d); inv('offers'); toast.success(msg); } catch (e) { toast.error(e); } };
  return (
    <div>
      <Link to="/finance/offers" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" />Предложения</Link>
      <Card className="mb-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <Badge color={st?.color} dot>{st?.label}</Badge>
            <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight">Коммерческое предложение № {o.number}</h1>
            <p className="mt-1 text-sm text-muted">{o._ref?.company_id?.title} · от {date(o.date)} · действует до {date(o.valid_until)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Printer className="size-4" />} onClick={() => openPrint(`/api/print/offer/${oid}`)}>Печать / PDF</Button>
            {writable && o.status === 'draft' && <Button onClick={() => set({ status: 'sent' }, 'Отмечено как отправленное')}>Отправлено клиенту</Button>}
            {writable && <Button variant="primary" icon={<Receipt className="size-4" />} onClick={async () => { try { const i = await api.post(`/api/offers/${oid}/invoice`); inv('offers', 'invoices'); nav(`/crm/invoices/${i.id}`); } catch (e) { toast.error(e); } }}>{o.invoice_id ? 'Открыть счёт' : 'Выставить счёт'}</Button>}
          </div>
        </div>
        <p className="mt-4 text-2xl font-extrabold tabular text-primary">{money(o.total, { cents: true })}</p>
      </Card>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: 'items', label: 'Позиции' }, { value: 'feed', label: 'История' }]} />
          {tab === 'items' ? <Card><LinesEditor entity="offer_items" parentField="offer_id" parentId={oid} vatMode={o.vat_mode} readOnly={!writable} also={['offers']} /></Card> : <Timeline entity="offers" id={oid} />}
        </div>
        <Card title="Параметры"><FieldsPanel entity="offers" item={o} fields={['date', 'valid_until', 'company_id', 'contact_id', 'deal_id', 'legal_entity_id', 'status', 'vat_mode', 'responsible_id', 'intro', 'terms']} /></Card>
      </div>
    </div>
  );
}

export function Directions() {
  return (
    <div>
      <FinHeader title="Направления" subtitle="Направления бизнеса: отмечайте ими операции и смотрите отчёты по каждому" />
      <EntityList entity="directions" columns={['name', 'description', 'color']} canExport={false} />
    </div>
  );
}

export function AccountsOrgs() {
  const balances = useApi<any[]>(['finance', 'balances'], '/api/finance/balances').data ?? [];
  const bal = (id: number) => balances.find((b) => b.id === id);
  return (
    <div>
      <FinHeader title="Счета и организации" subtitle="Расчётные счета, кассы, карты и наши юрлица для документов" />
      <div className="space-y-5">
        <Card title="Счета и кассы" padded={false}>
          <EntityList entity="fin_accounts" createLabel="Счёт" defaults={{ kind: 'bank', currency: 'RUB', opening_balance: 0, opening_date: todayIso() }} canExport={false}
            columns={['name', 'kind', 'bank_name', 'legal_entity_id', 'currency', { key: 'balance', label: 'Остаток', align: 'right', render: (r: any) => <b className="tabular">{money(bal(r.id)?.balance ?? 0, { currency: r.currency })}</b> }, 'is_archived']} />
        </Card>
        <Card title="Наши организации" padded={false}>
          <EntityList entity="legal_entities" columns={['name', 'inn', 'kpp', 'tax_system', 'director', 'is_default']} canExport={false} />
        </Card>
      </div>
    </div>
  );
}

