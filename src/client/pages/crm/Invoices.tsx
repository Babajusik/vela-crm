import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Banknote, FileCheck2, Printer, Send, Trash2 } from 'lucide-react';
import { api, openPrint } from '../../api.ts';
import { money, todayIso } from '../../lib/format.ts';
import { useAuth, useInvalidate, useList, useMeta, useRecord } from '../../lib/state.tsx';
import { Badge, Button, Card, EmptyState, FormRow, IconButton, Input, Loading, Modal, Progress, Select, Tabs, useToast } from '../../ui/ui.tsx';
import { EntityList, FieldsPanel, Timeline, DataTable } from '../../ui/data.tsx';
import { CrmHeader } from './Crm.tsx';
import { LinesEditor } from './Lines.tsx';

export function Invoices() {
  const { field } = useMeta();
  const nav = useNavigate();
  const today = todayIso();
  return (
    <div>
      <CrmHeader title="Счета" subtitle="Выставленные клиентам счета и их оплата" />
      <EntityList entity="invoices" rowLink={(r) => `/crm/invoices/${r.id}`} createLabel="Счёт"
        formFields={['date', 'due_date', 'company_id', 'contact_id', 'deal_id', 'legal_entity_id', 'vat_mode', 'responsible_id', 'comment']}
        defaults={{ date: today, status: 'draft', vat_mode: 'included' }}
        filters={[{ key: 'status', label: 'Статус', options: field('invoices', 'status')?.options }, { key: 'responsible_id', label: 'Ответственный', type: 'user' }]}
        columns={[{ key: 'number', label: '№', render: (r: any) => <span className="font-semibold">№ {r.number}</span> }, 'date', 'company_id', 'status',
          { key: 'due_date', label: 'Оплатить до', render: (r: any) => <span className={r.due_date < today && ['sent', 'partially_paid'].includes(r.status) ? 'font-semibold text-danger' : ''}>{r.due_date ? new Date(r.due_date + 'T12:00').toLocaleDateString('ru-RU') : '—'}</span> },
          'total', 'paid_amount', 'deal_id']}
        onRowClick={(r) => nav(`/crm/invoices/${r.id}`)} />
    </div>
  );
}

function PayDialog({ inv: invoice, open, onClose }: { inv: any; open: boolean; onClose: () => void }) {
  const accounts = useList('fin_accounts', { is_archived: 0, limit: 50 }).data?.items ?? [];
  const [amount, setAmount] = useState('');
  const [acc, setAcc] = useState('');
  const [dt, setDt] = useState(todayIso());
  const toast = useToast();
  const inv = useInvalidate();
  const left = Math.max(0, (invoice.total || 0) - (invoice.paid_amount || 0));
  const run = async () => {
    try {
      await api.post(`/api/invoices/${invoice.id}/pay`, { amount: amount ? Number(amount.replace(',', '.')) : left, account_id: acc ? Number(acc) : undefined, date: dt });
      inv('invoices', 'fin_operations', 'deals');
      toast.success('Оплата зарегистрирована и попала в Финансы');
      onClose();
    } catch (e) { toast.error(e); }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Регистрация оплаты" subtitle={`Остаток к оплате: ${money(left)}`}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={run}>Провести оплату</Button></>}>
      <div className="space-y-3">
        <FormRow label="Сумма"><Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(left)} inputMode="decimal" /></FormRow>
        <FormRow label="Куда поступили деньги">
          <Select value={acc} onChange={(e) => setAcc(e.target.value)}>{accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </FormRow>
        <FormRow label="Дата"><Input type="date" value={dt} onChange={(e) => setDt(e.target.value)} /></FormRow>
      </div>
    </Modal>
  );
}

export function InvoicePage() {
  const { id } = useParams();
  const iid = Number(id);
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const { can } = useAuth();
  const { field } = useMeta();
  const { data: i, isLoading } = useRecord('invoices', iid);
  const payments = useList('fin_operations', { invoice_id: iid, limit: 100 }).data?.items ?? [];
  const [pay, setPay] = useState(false);
  const [tab, setTab] = useState('items');
  if (isLoading) return <Loading />;
  if (!i) return <EmptyState title="Счёт не найден" action={<Button onClick={() => nav('/crm/invoices')}>К счетам</Button>} />;
  const st = field('invoices', 'status')?.options?.find((o) => o.value === i.status);
  const writable = can('crm', 'write');
  const locked = i.status === 'paid' || i.status === 'cancelled';
  const pct = i.total ? Math.min(100, Math.round(((i.paid_amount || 0) / i.total) * 100)) : 0;
  const overdue = i.due_date && i.due_date < todayIso() && ['sent', 'partially_paid'].includes(i.status);
  const set = async (d: any, msg: string) => { try { await api.patch(`/api/e/invoices/${iid}`, d); inv('invoices'); toast.success(msg); } catch (e) { toast.error(e); } };
  const makeAct = async () => {
    try { const a = await api.post(`/api/invoices/${iid}/act`); inv('acts'); nav(`/crm/acts/${a.id}`); } catch (e) { toast.error(e); }
  };
  return (
    <div>
      <Link to="/crm/invoices" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" />Счета</Link>
      <Card className="mb-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Badge color={st?.color} dot>{st?.label}</Badge>
              {overdue && <Badge color="#ef4444">Просрочен</Badge>}
              {i.onec_guid && <Badge color="#F59E0B">в 1С</Badge>}
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">Счёт № {i.number} от {new Date(i.date + 'T12:00').toLocaleDateString('ru-RU')}</h1>
            <p className="mt-1 text-sm text-muted">{i._ref?.company_id && <Link className="font-semibold hover:text-primary" to={`/crm/companies/${i.company_id}`}>{i._ref.company_id.title}</Link>}
              {i._ref?.deal_id && <> · сделка <Link className="hover:text-primary" to={`/crm/deals/${i.deal_id}`}>{i._ref.deal_id.title}</Link></>}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Printer className="size-4" />} onClick={() => openPrint(`/api/print/invoice/${iid}`)}>Печать / PDF</Button>
            {writable && i.status === 'draft' && <Button variant="primary" icon={<Send className="size-4" />} onClick={() => set({ status: 'sent' }, 'Счёт отмечен как выставленный')}>Выставлен клиенту</Button>}
            {writable && ['sent', 'partially_paid'].includes(i.status) && <Button variant="primary" icon={<Banknote className="size-4" />} onClick={() => setPay(true)}>Оплата</Button>}
            {writable && <Button icon={<FileCheck2 className="size-4" />} onClick={makeAct}>Акт</Button>}
            {writable && !locked && <IconButton label="Удалить счёт" onClick={async () => {
              if (!(await toast.confirm({ title: 'Удалить счёт?', danger: true, ok: 'Удалить' }))) return;
              await api.del(`/api/e/invoices/${iid}`); inv('invoices'); nav('/crm/invoices');
            }}><Trash2 className="size-4" /></IconButton>}
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <div><p className="text-xs text-muted">Сумма счёта</p><p className="text-xl font-extrabold tabular">{money(i.total, { cents: true })}</p></div>
          <div><p className="text-xs text-muted">Оплачено</p><p className="text-xl font-extrabold tabular text-success">{money(i.paid_amount || 0, { cents: true })}</p></div>
          <div><p className="text-xs text-muted">Оплачено на {pct}%</p><Progress value={pct} className="mt-3 h-2" /></div>
        </div>
      </Card>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: 'items', label: 'Позиции' }, { value: 'payments', label: 'Оплаты', count: payments.length }, { value: 'feed', label: 'История' }]} />
          {tab === 'items' && <Card><LinesEditor entity="invoice_items" parentField="invoice_id" parentId={iid} vatMode={i.vat_mode} readOnly={!writable || locked} also={['invoices']} /></Card>}
          {tab === 'payments' && <Card padded={false}><DataTable entity="fin_operations" rows={payments} columns={['date', 'amount', 'account_id', 'description']} empty={<EmptyState compact title="Оплат пока нет" />} /></Card>}
          {tab === 'feed' && <Timeline entity="invoices" id={iid} />}
        </div>
        <Card title="Реквизиты счёта"><FieldsPanel entity="invoices" item={i} fields={['date', 'due_date', 'company_id', 'contact_id', 'deal_id', 'legal_entity_id', 'vat_mode', 'status', 'responsible_id', 'comment']} readOnly={locked} /></Card>
      </div>
      <PayDialog inv={i} open={pay} onClose={() => setPay(false)} />
    </div>
  );
}

export function Acts() {
  const { field } = useMeta();
  return (
    <div>
      <CrmHeader title="Акты" subtitle="Закрывающие документы по оказанным услугам" />
      <EntityList entity="acts" rowLink={(r) => `/crm/acts/${r.id}`} createLabel="Акт" defaults={{ date: todayIso(), status: 'draft' }}
        formFields={['date', 'company_id', 'invoice_id', 'deal_id', 'legal_entity_id', 'comment']}
        filters={[{ key: 'status', label: 'Статус', options: field('acts', 'status')?.options }]}
        columns={[{ key: 'number', label: '№', render: (r: any) => <span className="font-semibold">№ {r.number}</span> }, 'date', 'company_id', 'invoice_id', 'status', 'total']} />
    </div>
  );
}

export function ActPage() {
  const { id } = useParams();
  const aid = Number(id);
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const { can } = useAuth();
  const { field } = useMeta();
  const { data: a, isLoading } = useRecord('acts', aid);
  if (isLoading) return <Loading />;
  if (!a) return <EmptyState title="Акт не найден" action={<Button onClick={() => nav('/crm/acts')}>К актам</Button>} />;
  const st = field('acts', 'status')?.options?.find((o) => o.value === a.status);
  const writable = can('crm', 'write');
  return (
    <div>
      <Link to="/crm/acts" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" />Акты</Link>
      <Card className="mb-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <Badge color={st?.color} dot>{st?.label}</Badge>
            <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight">Акт № {a.number} от {new Date(a.date + 'T12:00').toLocaleDateString('ru-RU')}</h1>
            <p className="mt-1 text-sm text-muted">{a._ref?.company_id?.title} · {money(a.total, { cents: true })}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Printer className="size-4" />} onClick={() => openPrint(`/api/print/act/${aid}`)}>Печать / PDF</Button>
            {writable && a.status !== 'signed' && <Button variant="primary" onClick={async () => { await api.patch(`/api/e/acts/${aid}`, { status: 'signed' }); inv('acts'); toast.success('Акт подписан'); }}>Подписан клиентом</Button>}
          </div>
        </div>
      </Card>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card title="Работы и услуги"><LinesEditor entity="act_items" parentField="act_id" parentId={aid} readOnly={!writable || a.status === 'signed'} withDiscount={false} also={['acts']} /></Card>
        <Card title="Реквизиты"><FieldsPanel entity="acts" item={a} fields={['date', 'company_id', 'invoice_id', 'deal_id', 'legal_entity_id', 'status', 'comment']} /></Card>
      </div>
    </div>
  );
}
