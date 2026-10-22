import { useState } from 'react';
import { ArrowDown, Bell, CheckCircle2, ClipboardCheck, Edit3, ListTodo, Play, Plus, Trash2, XCircle } from 'lucide-react';
import { api } from '../api.ts';
import { relative } from '../lib/format.ts';
import { useApi, useAuth, useInvalidate, useList, useMeta, useUsers } from '../lib/state.tsx';
import { Badge, Button, Card, EmptyState, FormRow, IconButton, Input, Loading, Modal, PageHeader, Select, Switch, Tabs, Textarea, useToast } from '../ui/ui.tsx';
import { DataTable } from '../ui/data.tsx';

const STEP: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  approval: { label: 'Согласование', icon: <ClipboardCheck className="size-4" />, color: '#F59E0B' },
  task: { label: 'Поставить задачу', icon: <ListTodo className="size-4" />, color: '#0EA5E9' },
  notify: { label: 'Уведомить', icon: <Bell className="size-4" />, color: '#A855F7' },
  set_field: { label: 'Изменить поле объекта', icon: <Edit3 className="size-4" />, color: '#10B981' },
};

export default function Bp() {
  const [tab, setTab] = useState<'my' | 'running' | 'templates'>('my');
  const my = useApi<any[]>(['bp', 'my'], '/api/bp/my').data ?? [];
  return (
    <div>
      <PageHeader title="Бизнес-процессы" subtitle="Согласования и автоматические цепочки действий: отпуск, скидка, закупка" />
      <Tabs value={tab} onChange={setTab} className="mb-5" tabs={[{ value: 'my', label: 'Мои согласования', count: my.length }, { value: 'running', label: 'Запущенные процессы' }, { value: 'templates', label: 'Шаблоны' }]} />
      {tab === 'my' && <MyApprovals items={my} />}
      {tab === 'running' && <Running />}
      {tab === 'templates' && <Templates />}
    </div>
  );
}

function MyApprovals({ items }: { items: any[] }) {
  const toast = useToast();
  const inv = useInvalidate();
  const [comment, setComment] = useState<Record<number, string>>({});
  const decide = async (id: number, decision: 'approve' | 'reject') => {
    try { await api.post(`/api/bp/${id}/decide`, { decision, comment: comment[id] }); inv('bp', 'bp_instances', 'tasks', 'absences'); toast.success(decision === 'approve' ? 'Согласовано' : 'Отклонено'); }
    catch (e) { toast.error(e); }
  };
  if (!items.length) return <EmptyState icon={<CheckCircle2 />} title="Нет задач на согласование" text="Когда коллега запросит ваше решение, оно появится здесь." />;
  return (
    <div className="space-y-3">
      {items.map((i) => (
        <Card key={i.id}>
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-bold">{i.name}</p>
              <p className="text-sm text-muted">Шаг: {i.data.pending?.title}{i.data.comment && ` · «${i.data.comment}»`}</p>
              <ul className="mt-2 space-y-0.5 text-xs text-faint">{(i.log ?? []).slice(-3).map((l: any, k: number) => <li key={k}>{relative(l.at)} — {l.text}{l.user ? ` (${l.user})` : ''}</li>)}</ul>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-80">
              <Input value={comment[i.id] ?? ''} onChange={(e) => setComment({ ...comment, [i.id]: e.target.value })} placeholder="Комментарий (необязательно)" />
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" icon={<CheckCircle2 className="size-4" />} onClick={() => decide(i.id, 'approve')}>Согласовать</Button>
                <Button variant="danger" className="flex-1" icon={<XCircle className="size-4" />} onClick={() => decide(i.id, 'reject')}>Отклонить</Button>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Running() {
  const { field } = useMeta();
  const { data } = useList('bp_instances', { limit: 200 });
  const [open, setOpen] = useState<any>(null);
  const toast = useToast();
  const inv = useInvalidate();
  return (
    <Card padded={false}>
      <DataTable entity="bp_instances" rows={data?.items ?? []} onRowClick={setOpen} columns={['name', 'template_id', 'status', 'started_by', { key: 'created_at', label: 'Запущен', render: (r: any) => relative(r.created_at) }]}
        empty={<EmptyState compact title="Процессов ещё не запускали" />} />
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} subtitle={field('bp_instances', 'status')?.options?.find((o) => o.value === open?.status)?.label}
        footer={open?.status === 'running' && <Button variant="danger" onClick={async () => { try { await api.post(`/api/bp/${open.id}/cancel`); inv('bp_instances', 'bp'); setOpen(null); } catch (e) { toast.error(e); } }}>Отменить процесс</Button>}>
        <ol className="relative space-y-3 border-l border-line pl-5">
          {(open?.log ?? []).map((l: any, k: number) => <li key={k} className="text-sm"><span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-primary" /><b>{l.text}</b>{l.user && <span className="text-muted"> — {l.user}</span>}<div className="text-xs text-faint">{relative(l.at)}</div></li>)}
        </ol>
      </Modal>
    </Card>
  );
}

function Templates() {
  const { data, isLoading } = useList('bp_templates', { limit: 100 });
  const { can } = useAuth();
  const { field } = useMeta();
  const toast = useToast();
  const inv = useInvalidate();
  const [edit, setEdit] = useState<any>(null);
  const start = async (t: any) => {
    try { await api.post('/api/bp/start', { template_id: t.id }); inv('bp', 'bp_instances', 'tasks'); toast.success('Процесс запущен'); }
    catch (e) { toast.error(e); }
  };
  return (
    <div>
      {can('bp', 'admin') && <div className="mb-4 flex justify-end"><Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ name: '', entity_type: 'none', trigger: 'manual', is_active: 1, steps: [{ type: 'approval', title: 'Согласование', user: 'manager', days: 2 }] })}>Шаблон процесса</Button></div>}
      {isLoading ? <Loading /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(data?.items ?? []).map((t: any) => (
            <Card key={t.id} title={t.name} subtitle={t.description}
              actions={<>{!t.is_active && <Badge color="#94a3b8">выключен</Badge>}{can('bp', 'admin') && <Button size="sm" variant="ghost" onClick={() => setEdit(t)}>Изменить</Button>}</>}>
              <p className="mb-3 text-xs text-muted">Объект: {field('bp_templates', 'entity_type')?.options?.find((o) => o.value === t.entity_type)?.label} · запуск: {t.trigger === 'on_create' ? 'автоматически при создании' : 'вручную'}</p>
              <ol className="space-y-1.5">
                {(t.steps ?? []).map((s: any, i: number) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="flex size-7 items-center justify-center rounded-lg text-white" style={{ background: STEP[s.type]?.color }}>{STEP[s.type]?.icon}</span>
                    <span className="font-semibold">{STEP[s.type]?.label}</span><span className="truncate text-muted">{s.title || s.text || (s.field ? `${s.field} = ${s.value}` : '')}</span>
                  </li>
                ))}
              </ol>
              {t.trigger === 'manual' && t.entity_type === 'none' && t.is_active ? <Button size="sm" className="mt-4" icon={<Play className="size-4" />} onClick={() => start(t)}>Запустить</Button> : null}
            </Card>
          ))}
        </div>
      )}
      {edit && <TemplateEditor tpl={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TemplateEditor({ tpl, onClose }: { tpl: any; onClose: () => void }) {
  const [t, setT] = useState<any>(tpl);
  const { field } = useMeta();
  const { users } = useUsers();
  const toast = useToast();
  const inv = useInvalidate();
  const steps: any[] = t.steps ?? [];
  const set = (i: number, patch: any) => setT({ ...t, steps: steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const save = async () => {
    try {
      const payload = { name: t.name, description: t.description, entity_type: t.entity_type, trigger: t.trigger, is_active: t.is_active, steps };
      if (t.id) await api.patch(`/api/e/bp_templates/${t.id}`, payload); else await api.post('/api/e/bp_templates', payload);
      inv('bp_templates');
      onClose();
    } catch (e) { toast.error(e); }
  };
  const whoSelect = (s: any, i: number) => (
    <Select value={String(s.user ?? 'starter')} onChange={(e) => set(i, { user: /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value })} className="w-auto">
      <option value="starter">Инициатор</option><option value="manager">Руководитель инициатора</option><option value="responsible">Ответственный за объект</option>
      {users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
    </Select>
  );
  return (
    <Modal open onClose={onClose} size="lg" title={t.id ? 'Шаблон процесса' : 'Новый шаблон процесса'}
      footer={<>{t.id && <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { await api.del(`/api/e/bp_templates/${t.id}`); inv('bp_templates'); onClose(); }}>Удалить</Button>}<Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormRow label="Название" className="sm:col-span-2"><Input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></FormRow>
          <FormRow label="Для объекта"><Select value={t.entity_type} onChange={(e) => setT({ ...t, entity_type: e.target.value })}>{field('bp_templates', 'entity_type')?.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormRow>
          <FormRow label="Запуск"><Select value={t.trigger} onChange={(e) => setT({ ...t, trigger: e.target.value })}><option value="manual">Вручную</option><option value="on_create">Автоматически при создании объекта</option></Select></FormRow>
          <FormRow label="Описание" className="sm:col-span-2"><Textarea rows={2} value={t.description ?? ''} onChange={(e) => setT({ ...t, description: e.target.value })} /></FormRow>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-semibold text-muted">Шаги выполняются по порядку</p>
          <div className="space-y-1">
            {steps.map((s, i) => (
              <div key={i}>
                {i > 0 && <ArrowDown className="mx-auto my-1 size-4 text-faint" />}
                <div className="rounded-xl border border-line p-3" style={{ borderLeft: `4px solid ${STEP[s.type]?.color}` }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={s.type} onChange={(e) => set(i, { type: e.target.value })} className="w-auto font-semibold">{Object.entries(STEP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
                    {s.type !== 'set_field' && whoSelect(s, i)}
                    <IconButton label="Удалить шаг" className="ml-auto" onClick={() => setT({ ...t, steps: steps.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></IconButton>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {(s.type === 'approval' || s.type === 'task') && <Input value={s.title ?? ''} onChange={(e) => set(i, { title: e.target.value })} placeholder="Что согласовать / сделать" />}
                    {(s.type === 'approval' || s.type === 'task') && <Input type="number" value={s.days ?? 2} onChange={(e) => set(i, { days: Number(e.target.value) })} placeholder="Срок, дней" />}
                    {s.type === 'notify' && <Input className="sm:col-span-2" value={s.text ?? ''} onChange={(e) => set(i, { text: e.target.value })} placeholder="Текст уведомления" />}
                    {s.type === 'set_field' && <><Input value={s.field ?? ''} onChange={(e) => set(i, { field: e.target.value })} placeholder="Поле, например status" /><Input value={s.value ?? ''} onChange={(e) => set(i, { value: e.target.value })} placeholder="Значение, например approved" /></>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Button size="sm" className="mt-3" icon={<Plus className="size-4" />} onClick={() => setT({ ...t, steps: [...steps, { type: 'notify', user: 'starter', text: '' }] })}>Шаг</Button>
        </div>
        <Switch checked={!!t.is_active} onChange={(v) => setT({ ...t, is_active: v ? 1 : 0 })} label="Шаблон активен" />
      </div>
    </Modal>
  );
}
