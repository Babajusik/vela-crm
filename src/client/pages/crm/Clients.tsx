import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Building2, FileText, Mail, Phone, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api.ts';
import { SOURCES } from '../../../core/schema.ts';
import { compactMoney, date, money } from '../../lib/format.ts';
import { useAuth, useInvalidate, useList, useMeta, useRecord } from '../../lib/state.tsx';
import { Badge, Button, Card, EmptyState, IconButton, Loading, Stat, Tabs, useToast } from '../../ui/ui.tsx';
import { DataTable, EntityList, FieldsPanel, Timeline } from '../../ui/data.tsx';
import { RecordForm } from '../../ui/fields.tsx';
import { CrmHeader } from './Crm.tsx';
import { GenerateDoc } from './DealPage.tsx';
import { FilesBlock } from '../Files.tsx';

export function Companies() {
  const { field } = useMeta();
  const [form, setForm] = useState(false);
  return (
    <div>
      <CrmHeader title="Компании" subtitle="Клиенты, поставщики и партнёры" />
      <EntityList entity="companies" rowLink={(r) => `/crm/companies/${r.id}`} createLabel="Компания" canImport onCreate={() => setForm(true)}
        filters={[{ key: 'kind', label: 'Тип', options: field('companies', 'kind')?.options }, { key: 'responsible_id', label: 'Ответственный', type: 'user' },
          { key: 'industry', label: 'Отрасль', options: field('companies', 'industry')?.options }]}
        columns={['name', 'kind', 'inn', 'industry', 'phone', 'responsible_id', { key: 'updated_at', label: 'Обновлена', render: (r: any) => date(r.updated_at) }]} />
      <CompanyCreate open={form} onClose={() => setForm(false)} />
    </div>
  );
}

/** Creation with a duplicate check by INN, phone, email and name */
function CompanyCreate({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  return <RecordForm entity="companies" open={open} onClose={onClose} initial={null} onSaved={(r) => nav(`/crm/companies/${r.id}`)}
    fields={['name', 'kind', 'inn', 'kpp', 'phone', 'email', 'website', 'industry', 'responsible_id', 'source', 'address', 'description']} />;
}

export function Duplicates({ entity, item }: { entity: string; item: any }) {
  const [dups, setDups] = useState<any[]>([]);
  useEffect(() => {
    api.get('/api/crm/duplicates', { inn: item.inn, phone: item.phone, email: item.email, name: entity === 'companies' ? item.name : undefined, exclude: item.id })
      .then((r) => setDups(r.filter((x: any) => !(x.entity === entity && x.id === item.id)))).catch(() => {});
  }, [entity, item.id, item.inn, item.phone, item.email, item.name]);
  if (!dups.length) return null;
  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <div>
        <p className="font-semibold">Возможные дубли</p>
        <ul className="mt-1 space-y-0.5">
          {dups.map((x) => <li key={x.entity + x.id}><Link className="text-primary hover:underline" to={`/crm/${x.entity}/${x.id}`}>{x.title}</Link> <span className="text-muted">— {x.reason.toLowerCase()}</span></li>)}
        </ul>
      </div>
    </div>
  );
}

export function CompanyPage() {
  const { id } = useParams();
  const cid = Number(id);
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const { can, user } = useAuth();
  const { data: c, isLoading } = useRecord('companies', cid);
  const deals = useList('deals', { company_id: cid, limit: 200 }).data?.items ?? [];
  const contacts = useList('contacts', { company_id: cid, limit: 200 }).data?.items ?? [];
  const invoices = useList('invoices', { company_id: cid, limit: 200 }).data?.items ?? [];
  const tasks = useList('tasks', { company_id: cid, limit: 200 }).data?.items ?? [];
  const [tab, setTab] = useState('feed');
  const [form, setForm] = useState<{ entity: string; initial: any } | null>(null);
  const [doc, setDoc] = useState(false);
  if (isLoading) return <Loading />;
  if (!c) return <EmptyState title="Компания не найдена" action={<Button onClick={() => nav('/crm/companies')}>К компаниям</Button>} />;
  const won = deals.filter((d: any) => d._ref?.stage_id?.kind === 'won');
  const paid = invoices.reduce((s: number, i: any) => s + (i.paid_amount || 0), 0);
  const debt = invoices.filter((i: any) => ['sent', 'partially_paid'].includes(i.status)).reduce((s: number, i: any) => s + (i.total - (i.paid_amount || 0)), 0);
  const remove = async () => {
    if (!(await toast.confirm({ title: `Удалить «${c.name}»?`, danger: true, ok: 'Удалить' }))) return;
    await api.del(`/api/e/companies/${cid}`);
    inv('companies');
    nav('/crm/companies');
  };
  return (
    <div>
      <Link to="/crm/companies" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" />Компании</Link>
      <Duplicates entity="companies" item={c} />
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary"><Building2 className="size-7" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight">{c.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
            {c.inn && <span>ИНН {c.inn}</span>}
            {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1 hover:text-primary"><Phone className="size-3.5" />{c.phone}</a>}
            {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-1 hover:text-primary"><Mail className="size-3.5" />{c.email}</a>}
            {c.onec_guid && <Badge color="#F59E0B">связана с 1С</Badge>}
          </div>
        </div>
        {can('crm', 'write') && (
          <div className="flex gap-2">
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ entity: 'deals', initial: { company_id: cid, responsible_id: c.responsible_id ?? user!.id, title: '' } })}>Сделка</Button>
            {can('documents', 'write') && <Button icon={<FileText className="size-4" />} onClick={() => setDoc(true)}>Документ</Button>}
            <IconButton label="Удалить компанию" onClick={remove}><Trash2 className="size-4" /></IconButton>
          </div>
        )}
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Сделок" value={deals.length} sub={`${won.length} выиграно`} />
        <Stat label="Выручка от клиента" value={compactMoney(paid)} tone="success" />
        <Stat label="Долг по счетам" value={compactMoney(debt)} tone={debt ? 'danger' : 'default'} />
        <Stat label="Контактов" value={contacts.length} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <aside className="space-y-5">
          <Card title="Информация"><FieldsPanel entity="companies" item={c} fields={['kind', 'responsible_id', 'industry', 'phone', 'email', 'website', 'address', 'source', 'tags', 'description']} /></Card>
          <Card title="Реквизиты"><FieldsPanel entity="companies" item={c} fields={['legal_name', 'inn', 'kpp', 'ogrn', 'legal_address', 'bank_name', 'bik', 'account_number']} /></Card>
        </aside>
        <div className="min-w-0">
          <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: 'feed', label: 'Лента' }, { value: 'deals', label: 'Сделки', count: deals.length },
            { value: 'contacts', label: 'Контакты', count: contacts.length }, { value: 'invoices', label: 'Счета', count: invoices.length }, { value: 'tasks', label: 'Задачи', count: tasks.length }, { value: 'files', label: 'Файлы' }]} />
          {tab === 'feed' && <Timeline entity="companies" id={cid} />}
          {tab === 'deals' && <Card padded={false}><DataTable entity="deals" rows={deals} onRowClick={(r) => nav(`/crm/deals/${r.id}`)} columns={['title', 'stage_id', 'amount', 'responsible_id', 'close_date']} /></Card>}
          {tab === 'contacts' && (
            <Card padded={false} title="Контактные лица" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setForm({ entity: 'contacts', initial: { company_id: cid, responsible_id: c.responsible_id } })}>Контакт</Button>}>
              <DataTable entity="contacts" rows={contacts} onRowClick={(r) => nav(`/crm/contacts/${r.id}`)} columns={['name', 'position', 'phone', 'email']} />
            </Card>
          )}
          {tab === 'invoices' && <Card padded={false}><DataTable entity="invoices" rows={invoices} onRowClick={(r) => nav(`/crm/invoices/${r.id}`)} columns={['number', 'date', 'due_date', 'status', 'total', 'paid_amount']} /></Card>}
          {tab === 'tasks' && <Card padded={false}><DataTable entity="tasks" rows={tasks} onRowClick={(r) => nav(`/tasks/${r.id}`)} columns={['title', 'status', 'deadline', 'assignee_id']} /></Card>}
          {tab === 'files' && <FilesBlock entityType="companies" entityId={cid} />}
        </div>
      </div>
      {form && <RecordForm entity={form.entity} open onClose={() => setForm(null)} initial={form.initial} onSaved={(r) => form.entity === 'deals' && nav(`/crm/deals/${r.id}`)} />}
      <GenerateDoc open={doc} onClose={() => setDoc(false)} entityType="companies" entityId={cid} />
    </div>
  );
}

export function Contacts() {
  return (
    <div>
      <CrmHeader title="Контакты" subtitle="Люди, с которыми вы работаете" />
      <EntityList entity="contacts" rowLink={(r) => `/crm/contacts/${r.id}`} createLabel="Контакт" canImport
        filters={[{ key: 'responsible_id', label: 'Ответственный', type: 'user' }, { key: 'source', label: 'Источник', options: SOURCES }]}
        formFields={['name', 'company_id', 'position', 'phone', 'email', 'telegram', 'birthday', 'responsible_id', 'source', 'tags', 'description']}
        columns={['name', 'company_id', 'position', 'phone', 'email', 'responsible_id']} />
    </div>
  );
}

export function ContactPage() {
  const { id } = useParams();
  const cid = Number(id);
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const { can } = useAuth();
  const { data: c, isLoading } = useRecord('contacts', cid);
  const deals = useList('deals', { contact_id: cid, limit: 100 }).data?.items ?? [];
  const [tab, setTab] = useState('feed');
  if (isLoading) return <Loading />;
  if (!c) return <EmptyState title="Контакт не найден" action={<Button onClick={() => nav('/crm/contacts')}>К контактам</Button>} />;
  return (
    <div>
      <Link to="/crm/contacts" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" />Контакты</Link>
      <Duplicates entity="contacts" item={c} />
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight">{c.name}</h1>
          <p className="mt-1 text-sm text-muted">{[c.position, c._ref?.company_id?.title].filter(Boolean).join(' · ')}</p>
        </div>
        {can('crm', 'write') && <IconButton label="Удалить контакт" onClick={async () => {
          if (!(await toast.confirm({ title: 'Удалить контакт?', danger: true, ok: 'Удалить' }))) return;
          await api.del(`/api/e/contacts/${cid}`); inv('contacts'); nav('/crm/contacts');
        }}><Trash2 className="size-4" /></IconButton>}
      </div>
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <Card title="Информация"><FieldsPanel entity="contacts" item={c} /></Card>
        <div className="min-w-0">
          <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: 'feed', label: 'Лента' }, { value: 'deals', label: 'Сделки', count: deals.length }]} />
          {tab === 'feed' && <Timeline entity="contacts" id={cid} />}
          {tab === 'deals' && <Card padded={false}><DataTable entity="deals" rows={deals} onRowClick={(r) => nav(`/crm/deals/${r.id}`)} columns={['title', 'stage_id', 'amount', 'responsible_id']} /></Card>}
        </div>
      </div>
      <p className="mt-4 text-xs text-faint">Сумма сделок: {money(deals.reduce((s: number, d: any) => s + (d.amount || 0), 0))}</p>
    </div>
  );
}
