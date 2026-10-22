import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, Building2, CalendarRange, ChevronDown, Copy, ExternalLink, FileText, FolderKanban, Mail, Phone, Plus, Trash2, UserRound, Wallet } from 'lucide-react';
import { api, openPrint } from '../../api.ts';
import { date, money } from '../../lib/format.ts';
import { useAuth, useInvalidate, useList, useRecord } from '../../lib/state.tsx';
import { Avatar, Badge, Button, Card, EmptyState, FormRow, IconButton, Loading, MenuItem, Modal, Popover, Select, Tabs, cx, useToast } from '../../ui/ui.tsx';
import { DataTable, FieldsPanel, Timeline } from '../../ui/data.tsx';
import { RecordForm, RefSelect } from '../../ui/fields.tsx';
import { LinesEditor } from './Lines.tsx';
import { LostDialog, LOST_REASONS } from './Deals.tsx';
import { TaskCard } from '../Tasks.tsx';
import { FilesBlock } from '../Files.tsx';

type Tab = 'general' | 'products' | 'docs' | 'finance' | 'activities' | 'tasks' | 'mail' | 'files';

/** Deal card shown in a slide-over panel over the pipeline */
export function DealCard({ id: did }: { id: number }) {
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const { can, user } = useAuth();
  const { data: d, isLoading } = useRecord('deals', did);
  const stages = useList('stages', { pipeline_id: d?.pipeline_id, limit: 50, sort: 'sort', dir: 'asc' }, { enabled: !!d }).data?.items ?? [];
  const tasks = useList('tasks', { deal_id: did, limit: 100 }).data?.items ?? [];
  const invoices = useList('invoices', { deal_id: did, limit: 100 }).data?.items ?? [];
  const offers = useList('offers', { deal_id: did, limit: 100 }).data?.items ?? [];
  const docs = useList('documents', { deal_id: did, limit: 100 }).data?.items ?? [];
  const acts = useList('crm_activities', { deal_id: did, limit: 200 }).data?.items ?? [];
  const mails = useList('mails', { deal_id: did, limit: 100 }).data?.items ?? [];
  const contacts = useList('contacts', { company_id: d?.company_id ?? -1, limit: 50 }, { enabled: !!d?.company_id }).data?.items ?? [];
  const [tab, setTab] = useState<Tab>('general');
  const [lost, setLost] = useState<number | null>(null);
  const [form, setForm] = useState<{ entity: string; initial: any; fields?: string[]; title?: string } | null>(null);
  const [docOpen, setDocOpen] = useState(false);
  const [bpOpen, setBpOpen] = useState(false);
  const [pickContact, setPickContact] = useState(false);
  if (isLoading) return <div className="p-6"><Loading /></div>;
  if (!d) return <div className="p-6"><EmptyState title="Сделка не найдена" /></div>;
  const writable = can('crm', 'write');
  const cur = stages.find((s: any) => s.id === d.stage_id);
  const curIdx = stages.findIndex((s: any) => s.id === d.stage_id);
  const openStages = stages.filter((s: any) => s.kind === 'open');
  const won = stages.find((s: any) => s.kind === 'won');
  const lostStage = stages.find((s: any) => s.kind === 'lost');
  const move = async (stageId: number, reason?: string) => {
    if (stages.find((s: any) => s.id === stageId)?.kind === 'lost' && !reason) { setLost(stageId); return; }
    try { await api.post(`/api/deals/${did}/move`, { stage_id: stageId, lost_reason: reason }); inv('deals', 'invoices', 'tasks'); }
    catch (e) { toast.error(e); }
  };
  const action = async (path: string, ok: string, go?: (r: any) => string) => {
    try { const r = await api.post(path); inv('deals', 'invoices', 'projects', 'offers'); toast.success(ok); if (go) nav(go(r)); }
    catch (e) { toast.error(e); }
  };
  const patch = async (data: any, ok?: string) => { try { await api.patch(`/api/e/deals/${did}`, data); inv('deals'); if (ok) toast.success(ok); } catch (e) { toast.error(e); } };
  const remove = async () => {
    if (!(await toast.confirm({ title: 'Удалить сделку?', text: 'Удалятся товары и история сделки. Счета останутся.', danger: true, ok: 'Удалить' }))) return;
    await api.del(`/api/e/deals/${did}`);
    inv('deals');
    nav('/crm/deals');
  };
  const company = d._ref?.company_id;
  const openActs = acts.filter((a: any) => !a.is_done).length;
  return (
    <div className="min-h-full">
      <div className="border-b border-line bg-surface px-5 pt-4 sm:px-6">
        <div className="flex flex-wrap items-start gap-3 pr-12 2xl:pr-0">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold leading-snug tracking-tight sm:text-2xl">{d.title}</h1>
            {d.is_archived ? <Badge color="#64748b" className="mt-1">в архиве</Badge> : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <IconButton label="Открыть отдельно" onClick={() => window.open(location.href, '_blank')}><ExternalLink className="size-4" /></IconButton>
            <IconButton label="Скопировать ссылку" onClick={() => { navigator.clipboard?.writeText(location.href); toast.success('Ссылка скопирована'); }}><Copy className="size-4" /></IconButton>
            {writable && (
              <Popover align="right" trigger={({ toggle }) => <Button variant="primary" onClick={toggle}>Создать<ChevronDown className="size-4" /></Button>}>
                {(close) => (
                  <div className="w-60">
                    <MenuItem onClick={() => { setForm({ entity: 'tasks', initial: { deal_id: did, company_id: d.company_id, assignee_id: d.responsible_id ?? user!.id }, fields: ['title', 'assignee_id', 'deadline', 'priority', 'description'], title: 'Задача по сделке' }); close(); }}>Задачу</MenuItem>
                    <MenuItem onClick={() => { setForm({ entity: 'crm_activities', initial: { deal_id: did, company_id: d.company_id, contact_id: d.contact_id, responsible_id: d.responsible_id ?? user!.id, kind: 'call' }, fields: ['kind', 'subject', 'due_at', 'responsible_id'], title: 'Новое дело' }); close(); }}>Дело</MenuItem>
                    <MenuItem onClick={() => { action(`/api/deals/${did}/invoice`, 'Счёт создан', (r) => `/crm/invoices/${r.id}`); close(); }}>Счёт на оплату</MenuItem>
                    <MenuItem onClick={() => { action(`/api/deals/${did}/offer`, 'Коммерческое предложение создано', (r) => `/finance/offers/${r.id}`); close(); }}>Коммерческое предложение</MenuItem>
                    {can('projects', 'write') && <MenuItem onClick={() => { d.project_id ? nav(`/projects/${d.project_id}`) : action(`/api/deals/${did}/project`, 'Проект создан', (r) => `/projects/${r.id}`); close(); }}>{d.project_id ? 'Открыть проект' : 'Проект из сделки'}</MenuItem>}
                    {can('bp') && <MenuItem onClick={() => { setBpOpen(true); close(); }}>Запустить согласование</MenuItem>}
                  </div>
                )}
              </Popover>
            )}
            {can('documents', 'write') && <Button icon={<FileText className="size-4" />} onClick={() => setDocOpen(true)}>Документ</Button>}
            {writable && (
              <Popover align="right" trigger={({ toggle }) => <IconButton label="Ещё" onClick={toggle}><span className="text-lg leading-none">⋮</span></IconButton>}>
                {(close) => (
                  <div className="w-52">
                    <MenuItem icon={d.is_archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} onClick={() => { patch({ is_archived: d.is_archived ? 0 : 1 }, d.is_archived ? 'Сделка возвращена из архива' : 'Сделка в архиве'); close(); }}>{d.is_archived ? 'Вернуть из архива' : 'В архив'}</MenuItem>
                    <MenuItem icon={<Trash2 className="size-4" />} danger onClick={() => { close(); remove(); }}>Удалить</MenuItem>
                  </div>
                )}
              </Popover>
            )}
          </div>
        </div>
        <Tabs value={tab} onChange={setTab} className="mt-3 border-0" tabs={[
          { value: 'general', label: 'Общие' }, { value: 'products', label: 'Товары' }, { value: 'docs', label: 'Документы', count: docs.length + offers.length || undefined },
          { value: 'finance', label: 'Финансы', count: invoices.length || undefined }, { value: 'activities', label: 'Дела', count: openActs || undefined },
          { value: 'tasks', label: 'Задачи', count: tasks.filter((t: any) => t.status !== 'done').length || undefined }, { value: 'mail', label: 'Почта', count: mails.length || undefined },
          { value: 'files', label: 'Файлы' },
        ]} />
      </div>

      <div className="space-y-5 p-4 sm:p-6">
        {tab === 'general' && (
          <>
            <Card padded={false}>
              <div className="p-4">
                {stages.length > 0 && (
                  <>
                    <p className="mb-2 text-xs font-semibold text-muted">{d._ref?.pipeline_id?.title ?? ''}</p>
                    <div className="flex overflow-x-auto pb-1">
                      {openStages.map((s: any, i: number) => {
                        const passed = cur?.kind === 'won' || (curIdx >= 0 && i <= curIdx && cur?.kind === 'open');
                        return (
                          <button key={s.id} type="button" disabled={!writable} onClick={() => move(s.id)} title={`Перевести на стадию «${s.name}»`}
                            className={cx('relative -ml-2 flex h-8 min-w-28 flex-1 items-center justify-center px-5 text-[12px] font-semibold transition-colors first:ml-0', passed ? 'text-white' : 'bg-surface-2 text-muted hover:bg-line')}
                            style={{ clipPath: i === 0 ? 'polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%)' : 'polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%)', ...(passed ? { background: s.color } : {}) }}>
                            <span className="truncate">{s.name}</span>
                          </button>
                        );
                      })}
                      {cur?.kind === 'open' && won && (
                        <Popover align="right" trigger={({ toggle }) => (
                          <button type="button" disabled={!writable} onClick={toggle} className="-ml-2 flex h-8 min-w-32 items-center justify-center bg-surface-2 px-5 text-[12px] font-semibold text-muted hover:bg-line"
                            style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 10px 50%)' }}>Завершить сделку</button>
                        )}>
                          {(close) => <div className="w-48"><MenuItem onClick={() => { move(won.id); close(); }}>✓ {won.name}</MenuItem>{lostStage && <MenuItem danger onClick={() => { move(lostStage.id); close(); }}>✕ {lostStage.name}</MenuItem>}</div>}
                        </Popover>
                      )}
                      {cur && cur.kind !== 'open' && <span className="-ml-2 flex h-8 items-center px-5 text-[12px] font-semibold text-white" style={{ background: cur.color, clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 10px 50%)' }}>{cur.name}</span>}
                    </div>
                    {cur?.kind === 'lost' && d.lost_reason && <p className="mt-2 text-sm text-danger">Причина: {LOST_REASONS.find((r) => r.value === d.lost_reason)?.label}</p>}
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-line p-4 lg:grid-cols-4">
                <Summary icon={<Wallet className="size-5" />} label="Сумма" value={<span className="tabular">{money(d.amount, { cents: true })}</span>} />
                <Summary icon={<CalendarRange className="size-5" />} label="Сроки сделки" value={`${d.start_date ? date(d.start_date) : '—'} – ${d.close_date ? date(d.close_date) : '—'}`} />
                <Summary icon={<FolderKanban className="size-5" />} label="Источник сделки" value={({ site: 'Сайт', form: 'Веб-форма', call: 'Входящий звонок', referral: 'Рекомендация', exhibition: 'Выставка', ads: 'Реклама', cold: 'Холодный контакт', messenger: 'Мессенджер', other: 'Другое' } as any)[d.source] ?? '—'} />
                <Summary icon={<Avatar name={d._ref?.responsible_id?.title} color={d._ref?.responsible_id?.color} size={30} />} label="Ответственный" value={d._ref?.responsible_id?.title ?? '—'} />
              </div>
            </Card>
            <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
              <div className="space-y-5">
                <Card title="Клиент">
                  <p className="mb-2 text-xs font-semibold text-muted">Компания</p>
                  {company ? (
                    <div className="rounded-xl border border-line p-3">
                      <div className="flex items-start gap-3">
                        <span className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-muted"><Building2 className="size-4" /></span>
                        <div className="min-w-0 flex-1">
                          <Link to={`/crm/companies/${d.company_id}`} className="block truncate font-semibold hover:text-primary">{company.title}</Link>
                          <CompanyContacts id={d.company_id} />
                        </div>
                      </div>
                    </div>
                  ) : writable ? <RefSelect entity="companies" value={null} onChange={(v) => v && patch({ company_id: v })} placeholder="Выбрать компанию" /> : <p className="text-sm text-faint">Не указана</p>}
                  <div className="mb-2 mt-4 flex items-center justify-between"><p className="text-xs font-semibold text-muted">Контакты</p></div>
                  {d.contact_id && <ContactBox id={d.contact_id} />}
                  {contacts.filter((c: any) => c.id !== d.contact_id).slice(0, 3).map((c: any) => <ContactBox key={c.id} id={c.id} />)}
                  {writable && (pickContact
                    ? <RefSelect entity="contacts" value={null} filter={d.company_id ? { company_id: d.company_id } : undefined} onChange={(v) => { if (v) patch({ contact_id: v }); setPickContact(false); }} placeholder="Выберите контакт" />
                    : <button type="button" onClick={() => setPickContact(true)} className="mt-1 text-sm font-semibold text-primary hover:underline">Выбрать контакт</button>)}
                </Card>
                <Card title="О сделке"><FieldsPanel entity="deals" item={d} fields={['amount', 'start_date', 'close_date', 'source', 'responsible_id', 'project_id', 'tags', 'description']} /></Card>
              </div>
              <Timeline entity="deals" id={did} schedule={{ deal_id: did, company_id: d.company_id ?? undefined, contact_id: d.contact_id ?? undefined }} />
            </div>
          </>
        )}
        {tab === 'products' && <Card title="Товары и услуги"><LinesEditor entity="deal_products" parentField="deal_id" parentId={did} readOnly={!writable} also={['deals']} /></Card>}
        {tab === 'docs' && (
          <div className="space-y-5">
            <Card title="Коммерческие предложения" padded={false} actions={writable && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => action(`/api/deals/${did}/offer`, 'КП создано', (r) => `/finance/offers/${r.id}`)}>КП</Button>}>
              <DataTable entity="offers" rows={offers} onRowClick={(r) => nav(`/finance/offers/${r.id}`)} columns={['number', 'date', 'status', 'total']} empty={<EmptyState compact title="Предложений нет" />} />
            </Card>
            <Card title="Документы" padded={false} actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setDocOpen(true)}>Сформировать</Button>}>
              <DataTable entity="documents" rows={docs} onRowClick={(r) => openPrint(`/api/print/document/${r.id}`)} columns={['name', 'status', { key: 'created_at', label: 'Создан', render: (r: any) => date(r.created_at) }]} empty={<EmptyState compact title="Документов нет" />} />
            </Card>
          </div>
        )}
        {tab === 'finance' && (
          <Card title="Счета на оплату" padded={false} actions={writable && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => action(`/api/deals/${did}/invoice`, 'Счёт создан', (r) => `/crm/invoices/${r.id}`)}>Счёт</Button>}>
            <DataTable entity="invoices" rows={invoices} onRowClick={(r) => nav(`/crm/invoices/${r.id}`)} columns={['number', 'date', 'status', 'total', 'paid_amount']} empty={<EmptyState compact title="Счетов нет" />} />
          </Card>
        )}
        {tab === 'activities' && (
          <Card title="Дела по сделке" padded={false} actions={writable && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setForm({ entity: 'crm_activities', initial: { deal_id: did, company_id: d.company_id, responsible_id: d.responsible_id ?? user!.id, kind: 'call' }, fields: ['kind', 'subject', 'due_at', 'responsible_id'] })}>Дело</Button>}>
            <DataTable entity="crm_activities" rows={acts} onRowClick={(r) => setForm({ entity: 'crm_activities', initial: r })} columns={['kind', 'subject', 'due_at', 'responsible_id', 'is_done', 'result']} empty={<EmptyState compact title="Дел нет" text="Запланируйте следующий шаг по сделке." />} />
          </Card>
        )}
        {tab === 'tasks' && (
          <Card title="Задачи по сделке" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setForm({ entity: 'tasks', initial: { deal_id: did, company_id: d.company_id, assignee_id: d.responsible_id ?? user!.id }, fields: ['title', 'assignee_id', 'deadline', 'priority', 'description'] })}>Задача</Button>}>
            {tasks.length ? <div className="grid gap-2 sm:grid-cols-2">{tasks.map((t: any) => <Link key={t.id} to={`/tasks/${t.id}`} className="rounded-lg border border-line p-3 hover:border-line-strong"><TaskCard t={t} /></Link>)}</div>
              : <EmptyState compact title="Задач нет" />}
          </Card>
        )}
        {tab === 'mail' && (
          <Card title="Переписка" padded={false} actions={<Button size="sm" icon={<Mail className="size-4" />} onClick={() => nav('/mail')}>Почта</Button>}>
            <DataTable entity="mails" rows={mails} columns={['subject', 'from_name', 'folder', 'date']} empty={<EmptyState compact title="Писем по сделке нет" text="Письма, отправленные из CRM с привязкой к сделке, появятся здесь." />} />
          </Card>
        )}
        {tab === 'files' && <FilesBlock entityType="deals" entityId={did} />}
      </div>

      <LostDialog open={!!lost} onClose={() => setLost(null)} onConfirm={(r) => { if (lost) move(lost, r); setLost(null); }} />
      {form && <RecordForm entity={form.entity} open onClose={() => setForm(null)} initial={form.initial} fields={form.fields} title={form.title} />}
      <GenerateDoc open={docOpen} onClose={() => setDocOpen(false)} entityType="deals" entityId={did} />
      <StartBp open={bpOpen} onClose={() => setBpOpen(false)} entityType="deals" entityId={did} />
    </div>
  );
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">{icon}</span>
      <span className="min-w-0"><span className="block text-xs text-muted">{label}</span><span className="block truncate text-sm font-semibold">{value}</span></span>
    </div>
  );
}

function CompanyContacts({ id }: { id: number }) {
  const { data: c } = useRecord('companies', id);
  if (!c) return null;
  return (
    <div className="mt-1 flex items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 space-y-0.5">
        {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="block truncate text-primary hover:underline">{c.phone}</a>}
        {c.email && <a href={`mailto:${c.email}`} className="block truncate text-primary hover:underline">{c.email}</a>}
      </span>
      {c.email && <a aria-label="Написать" href={`mailto:${c.email}`} className="rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-primary"><Mail className="size-4" /></a>}
      {c.phone && <a aria-label="Позвонить" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-primary"><Phone className="size-4" /></a>}
    </div>
  );
}

function ContactBox({ id }: { id: number }) {
  const { data: c } = useRecord('contacts', id);
  if (!c) return null;
  return (
    <div className="mb-2 flex items-start gap-3 rounded-xl border border-line p-3">
      <span className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-muted"><UserRound className="size-4" /></span>
      <div className="min-w-0 flex-1 text-sm">
        <Link to={`/crm/contacts/${c.id}`} className="block truncate font-semibold hover:text-primary">{c.name}</Link>
        {c.position && <p className="truncate text-xs text-muted">{c.position}</p>}
        {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="block truncate text-primary hover:underline">{c.phone}</a>}
        {c.email && <a href={`mailto:${c.email}`} className="block truncate text-primary hover:underline">{c.email}</a>}
      </div>
      <div className="flex">
        {c.email && <a aria-label="Написать" href={`mailto:${c.email}`} className="rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-primary"><Mail className="size-4" /></a>}
        {c.phone && <a aria-label="Позвонить" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-primary"><Phone className="size-4" /></a>}
      </div>
    </div>
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

export default function DealPage() {
  return null;
}
