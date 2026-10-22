import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, Check, FileText, FolderKanban, GitBranch, Mail, Phone, Plus, Receipt, Trash2, Trophy, XCircle } from 'lucide-react';
import { api, openPrint } from '../../api.ts';
import { date, money } from '../../lib/format.ts';
import { useAuth, useInvalidate, useList, useRecord } from '../../lib/state.tsx';
import { Badge, Button, Card, EmptyState, FormRow, IconButton, Loading, Modal, Select, Tabs, cx, useToast } from '../../ui/ui.tsx';
import { DataTable, FieldsPanel, Timeline } from '../../ui/data.tsx';
import { RecordForm } from '../../ui/fields.tsx';
import { LinesEditor } from './Lines.tsx';
import { LostDialog, LOST_REASONS } from './Deals.tsx';
import { TaskCard } from '../Tasks.tsx';
import { FilesBlock } from '../Files.tsx';

type Tab = 'feed' | 'products' | 'tasks' | 'invoices' | 'docs' | 'files';

export default function DealPage() {
  const { id } = useParams();
  const did = Number(id);
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const { can, user } = useAuth();
  const { data: d, isLoading } = useRecord('deals', did);
  const stages = useList('stages', { pipeline_id: d?.pipeline_id, limit: 50, sort: 'sort', dir: 'asc' }, { enabled: !!d }).data?.items ?? [];
  const tasks = useList('tasks', { deal_id: did, limit: 100 }).data?.items ?? [];
  const invoices = useList('invoices', { deal_id: did, limit: 100 }).data?.items ?? [];
  const docs = useList('documents', { deal_id: did, limit: 100 }).data?.items ?? [];
  const [tab, setTab] = useState<Tab>('feed');
  const [lost, setLost] = useState<number | null>(null);
  const [taskForm, setTaskForm] = useState<any>(null);
  const [docOpen, setDocOpen] = useState(false);
  const [bpOpen, setBpOpen] = useState(false);
  if (isLoading) return <Loading />;
  if (!d) return <EmptyState title="Сделка не найдена" action={<Button onClick={() => nav('/crm/deals')}>К сделкам</Button>} />;
  const writable = can('crm', 'write');
  const cur = stages.find((s: any) => s.id === d.stage_id);
  const curIdx = stages.findIndex((s: any) => s.id === d.stage_id);
  const open = stages.filter((s: any) => s.kind === 'open');
  const won = stages.find((s: any) => s.kind === 'won');
  const lostStage = stages.find((s: any) => s.kind === 'lost');
  const move = async (stageId: number, reason?: string) => {
    try { await api.post(`/api/deals/${did}/move`, { stage_id: stageId, lost_reason: reason }); inv('deals', 'invoices', 'tasks'); }
    catch (e) { toast.error(e); }
  };
  const action = async (path: string, ok: string, go?: (r: any) => string) => {
    try { const r = await api.post(path); inv('deals', 'invoices', 'projects'); toast.success(ok); if (go) nav(go(r)); }
    catch (e) { toast.error(e); }
  };
  const remove = async () => {
    if (!(await toast.confirm({ title: 'Удалить сделку?', text: 'Удалятся товары и история сделки. Счета останутся.', danger: true, ok: 'Удалить' }))) return;
    await api.del(`/api/e/deals/${did}`);
    inv('deals');
    nav('/crm/deals');
  };
  return (
    <div>
      <Link to="/crm/deals" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" />Сделки</Link>
      <Card className="mb-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              {cur && <Badge color={cur.color} dot>{cur.name}</Badge>}
              {d.lost_reason && cur?.kind === 'lost' && <Badge color="#ef4444">{LOST_REASONS.find((r) => r.value === d.lost_reason)?.label}</Badge>}
              {d._ref?.company_id && <Link to={`/crm/companies/${d.company_id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-primary"><Building2 className="size-4" />{d._ref.company_id.title}</Link>}
            </div>
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">{d.title}</h1>
            <p className="mt-1 text-2xl font-extrabold tabular text-primary">{money(d.amount)}</p>
          </div>
          {writable && (
            <div className="flex flex-wrap gap-2">
              {cur?.kind === 'open' && won && <Button variant="primary" icon={<Trophy className="size-4" />} onClick={() => move(won.id)}>Сделка успешна</Button>}
              {cur?.kind === 'open' && lostStage && <Button icon={<XCircle className="size-4" />} onClick={() => setLost(lostStage.id)}>Провал</Button>}
              <Button icon={<Receipt className="size-4" />} onClick={() => action(`/api/deals/${did}/invoice`, 'Счёт создан', (r) => `/crm/invoices/${r.id}`)}>Выставить счёт</Button>
              {can('projects', 'write') && (d.project_id
                ? <Button icon={<FolderKanban className="size-4" />} onClick={() => nav(`/projects/${d.project_id}`)}>Проект</Button>
                : <Button icon={<FolderKanban className="size-4" />} onClick={() => action(`/api/deals/${did}/project`, 'Проект создан', (r) => `/projects/${r.id}`)}>Запустить проект</Button>)}
              <IconButton label="Удалить сделку" onClick={remove}><Trash2 className="size-4" /></IconButton>
            </div>
          )}
        </div>
        {stages.length > 0 && (
          <div className="mt-5 flex gap-1 overflow-x-auto pb-1">
            {open.map((s: any, i: number) => {
              const passed = cur?.kind === 'won' || (curIdx >= 0 && i <= curIdx && cur?.kind === 'open');
              return (
                <button key={s.id} type="button" disabled={!writable} onClick={() => move(s.id)} title={`Перевести на стадию «${s.name}»`}
                  className={cx('group relative flex h-9 min-w-28 flex-1 items-center justify-center px-3 text-xs font-bold transition-colors first:rounded-l-lg last:rounded-r-lg',
                    passed ? 'text-white' : 'bg-surface-2 text-muted hover:bg-line')}
                  style={passed ? { background: s.color } : undefined}>
                  {s.id === d.stage_id && <Check className="mr-1 size-3.5" />}<span className="truncate">{s.name}</span>
                </button>
              );
            })}
            {cur && cur.kind !== 'open' && <span className="flex h-9 items-center rounded-lg px-3 text-xs font-bold text-white" style={{ background: cur.color }}>{cur.name}</span>}
          </div>
        )}
      </Card>
      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-5">
          <Card title="О сделке"><FieldsPanel entity="deals" item={d} fields={['amount', 'company_id', 'contact_id', 'responsible_id', 'close_date', 'source', 'tags', 'description']} /></Card>
          {d.contact_id && <ContactMini id={d.contact_id} />}
          <Card title="Ещё">
            <div className="flex flex-col gap-2">
              {can('documents', 'write') && <Button icon={<FileText className="size-4" />} onClick={() => setDocOpen(true)}>Сформировать документ</Button>}
              {can('bp') && <Button icon={<GitBranch className="size-4" />} onClick={() => setBpOpen(true)}>Запустить согласование</Button>}
            </div>
          </Card>
        </aside>
        <div className="min-w-0">
          <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[
            { value: 'feed', label: 'Лента' }, { value: 'products', label: 'Товары и услуги' }, { value: 'tasks', label: 'Задачи', count: tasks.filter((t: any) => t.status !== 'done').length },
            { value: 'invoices', label: 'Счета', count: invoices.length }, { value: 'docs', label: 'Документы', count: docs.length }, { value: 'files', label: 'Файлы' },
          ]} />
          {tab === 'feed' && <Timeline entity="deals" id={did} />}
          {tab === 'products' && <Card><LinesEditor entity="deal_products" parentField="deal_id" parentId={did} readOnly={!writable} also={['deals']} /></Card>}
          {tab === 'tasks' && (
            <Card title="Задачи по сделке" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setTaskForm({ deal_id: did, company_id: d.company_id, assignee_id: d.responsible_id ?? user!.id, title: '' })}>Задача</Button>}>
              {tasks.length ? <div className="grid gap-2 sm:grid-cols-2">{tasks.map((t: any) => <Link key={t.id} to={`/tasks/${t.id}`} className="rounded-lg border border-line p-3 hover:border-line-strong"><TaskCard t={t} /></Link>)}</div>
                : <EmptyState compact title="Задач нет" text="У каждой сделки должен быть следующий шаг." />}
            </Card>
          )}
          {tab === 'invoices' && (
            <Card padded={false}>
              <DataTable entity="invoices" rows={invoices} onRowClick={(r) => nav(`/crm/invoices/${r.id}`)} columns={['number', 'date', 'status', 'total', 'paid_amount']}
                empty={<EmptyState compact title="Счетов нет" action={writable && <Button size="sm" onClick={() => action(`/api/deals/${did}/invoice`, 'Счёт создан', (r) => `/crm/invoices/${r.id}`)}>Выставить счёт</Button>} />} />
            </Card>
          )}
          {tab === 'docs' && (
            <Card padded={false}>
              <DataTable entity="documents" rows={docs} onRowClick={(r) => openPrint(`/api/print/document/${r.id}`)} columns={['name', 'status', { key: 'created_at', label: 'Создан', render: (r: any) => date(r.created_at) }]}
                empty={<EmptyState compact title="Документов нет" action={<Button size="sm" onClick={() => setDocOpen(true)}>Сформировать</Button>} />} />
            </Card>
          )}
          {tab === 'files' && <FilesBlock entityType="deals" entityId={did} />}
        </div>
      </div>
      <LostDialog open={!!lost} onClose={() => setLost(null)} onConfirm={(r) => { if (lost) move(lost, r); setLost(null); }} />
      <RecordForm entity="tasks" open={!!taskForm} onClose={() => setTaskForm(null)} initial={taskForm} title="Задача по сделке" fields={['title', 'assignee_id', 'deadline', 'priority', 'description']} />
      <GenerateDoc open={docOpen} onClose={() => setDocOpen(false)} entityType="deals" entityId={did} />
      <StartBp open={bpOpen} onClose={() => setBpOpen(false)} entityType="deals" entityId={did} />
    </div>
  );
}

function ContactMini({ id }: { id: number }) {
  const { data: c } = useRecord('contacts', id);
  if (!c) return null;
  return (
    <Card title="Контакт">
      <Link to={`/crm/contacts/${c.id}`} className="font-bold hover:text-primary">{c.name}</Link>
      {c.position && <p className="text-sm text-muted">{c.position}</p>}
      <div className="mt-2 space-y-1 text-sm">
        {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-2 hover:text-primary"><Phone className="size-4 text-faint" />{c.phone}</a>}
        {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-2 hover:text-primary"><Mail className="size-4 text-faint" />{c.email}</a>}
      </div>
    </Card>
  );
}

export function GenerateDoc({ open, onClose, entityType, entityId }: { open: boolean; onClose: () => void; entityType: string; entityId: number }) {
  const { data } = useList('doc_templates', { entity_type: entityType, limit: 100 });
  const [tpl, setTpl] = useState('');
  const toast = useToast();
  const inv = useInvalidate();
  const run = async () => {
    try {
      const doc = await api.post('/api/documents/generate', { template_id: Number(tpl || data?.items[0]?.id), entity_type: entityType, entity_id: entityId });
      inv('documents');
      onClose();
      openPrint(`/api/print/document/${doc.id}`);
    } catch (e) { toast.error(e); }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Сформировать документ" footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={run} disabled={!data?.items.length}>Сформировать</Button></>}>
      {data?.items.length ? (
        <FormRow label="Шаблон" hint="Поля подставятся из карточки автоматически">
          <Select value={tpl} onChange={(e) => setTpl(e.target.value)}>{data.items.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        </FormRow>
      ) : <p className="text-sm text-muted">Шаблонов для этого объекта нет. Создайте их в разделе «Документы».</p>}
    </Modal>
  );
}

export function StartBp({ open, onClose, entityType, entityId }: { open: boolean; onClose: () => void; entityType: string; entityId: number }) {
  const { data } = useList('bp_templates', { is_active: 1, limit: 100 });
  const items = (data?.items ?? []).filter((t: any) => t.entity_type === entityType || t.entity_type === 'none');
  const [tpl, setTpl] = useState('');
  const toast = useToast();
  const inv = useInvalidate();
  const run = async () => {
    try {
      await api.post('/api/bp/start', { template_id: Number(tpl || items[0]?.id), entity_type: entityType, entity_id: entityId });
      inv('bp_instances', 'tasks');
      toast.success('Процесс запущен');
      onClose();
    } catch (e) { toast.error(e); }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Запустить бизнес-процесс" footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={run} disabled={!items.length}>Запустить</Button></>}>
      {items.length ? (
        <FormRow label="Процесс"><Select value={tpl} onChange={(e) => setTpl(e.target.value)}>{items.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FormRow>
      ) : <p className="text-sm text-muted">Подходящих процессов нет. Настройте их в разделе «Бизнес-процессы».</p>}
    </Modal>
  );
}
