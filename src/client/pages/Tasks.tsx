import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Kanban as KanbanIcon, List as ListIcon, Search } from 'lucide-react';
import { api } from '../api.ts';
import { PRIORITY, TASK_STATUS } from '../../core/schema.ts';
import { deadlineInfo, nowLocalDateTime } from '../lib/format.ts';
import { useAuth, useInvalidate, useList } from '../lib/state.tsx';
import { Avatar, Button, Card, Input, Loading, PageHeader, Segmented, Select, Tabs, cx, useToast } from '../ui/ui.tsx';
import { EntityList, Kanban } from '../ui/data.tsx';
import { RecordForm } from '../ui/fields.tsx';

type Role = 'mine' | 'author' | 'watch' | 'all';

export function TaskCard({ t, showProject = true }: { t: any; showProject?: boolean }) {
  const dl = deadlineInfo(t.deadline, t.status === 'done');
  const p = PRIORITY.find((x) => x.value === t.priority);
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: p?.color }} title={`Приоритет: ${p?.label}`} />
        <p className={cx('min-w-0 flex-1 text-sm font-semibold leading-snug', t.status === 'done' && 'text-muted line-through')}>{t.title}</p>
      </div>
      {showProject && t._ref?.project_id && <p className="truncate text-xs text-muted">{t._ref.project_id.title}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className={cx('text-xs font-semibold', dl.tone === 'danger' ? 'text-danger' : dl.tone === 'warning' ? 'text-warning' : 'text-faint')}>{dl.text}</span>
        {t._ref?.assignee_id && <Avatar name={t._ref.assignee_id.title} color={t._ref.assignee_id.color} size={22} />}
      </div>
    </div>
  );
}

export default function Tasks() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const toast = useToast();
  const inv = useInvalidate();
  const [view, setView] = useState<'list' | 'kanban'>(() => (localStorage.getItem('vela-tasks-view') as any) ?? 'list');
  const [role, setRole] = useState<Role>('mine');
  const [overdue, setOverdue] = useState(sp.get('filter') === 'overdue');
  const [q, setQ] = useState('');
  const [prio, setPrio] = useState('');
  const [create, setCreate] = useState<any>(null);
  const base = useMemo(() => {
    const p: Record<string, any> = {};
    if (role === 'mine') p.assignee_id = user!.id;
    if (role === 'author') p.author_id = user!.id;
    if (role === 'watch') p.watchers__has = user!.id;
    if (overdue) { p.deadline__lt = nowLocalDateTime(); p.status__ne = 'done'; }
    if (prio) p.priority = prio;
    return p;
  }, [role, overdue, prio, user]);
  const setV = (v: 'list' | 'kanban') => { setView(v); localStorage.setItem('vela-tasks-view', v); };
  const { data, isLoading } = useList('tasks', { ...base, q, limit: 400, sort: 'deadline', dir: 'asc' }, { enabled: view === 'kanban' });

  const move = async (t: any, status: string | number) => {
    try { await api.patch(`/api/e/tasks/${t.id}`, { status }); inv('tasks'); }
    catch (e) { toast.error(e); }
  };

  return (
    <div>
      <PageHeader title="Задачи" subtitle="Поручения, сроки и контроль исполнения"
        actions={<Segmented value={view} onChange={setV} options={[{ value: 'list', label: 'Список', icon: <ListIcon className="size-4" /> }, { value: 'kanban', label: 'Канбан', icon: <KanbanIcon className="size-4" /> }]} />} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={role} onChange={setRole} className="border-0" tabs={[{ value: 'mine', label: 'Делаю' }, { value: 'author', label: 'Поручил' }, { value: 'watch', label: 'Наблюдаю' }, { value: 'all', label: 'Все задачи' }]} />
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="size-4 accent-[var(--c-danger)]" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Только просроченные
        </label>
      </div>
      {view === 'list' ? (
        <EntityList entity="tasks" baseParams={base} rowLink={(r) => `/tasks/${r.id}`} createLabel="Задача"
          defaults={{ assignee_id: role === 'mine' ? user!.id : undefined, deadline: nowLocalDateTime(24).slice(0, 11) + '18:00' }}
          filters={[{ key: 'status', label: 'Статус', options: TASK_STATUS }, { key: 'priority', label: 'Приоритет', options: PRIORITY }, ...(role !== 'mine' ? [{ key: 'assignee_id', label: 'Исполнитель', type: 'user' as const }] : [])]}
          formFields={['title', 'description', 'assignee_id', 'deadline', 'priority', 'status', 'project_id', 'watchers', 'deal_id', 'parent_id', 'estimate_hours', 'repeat', 'tags']}
          columns={['title', 'status', 'priority', 'deadline', 'assignee_id', 'author_id', 'project_id']} />
      ) : (
        <Card padded={false}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск…" icon={<Search className="size-4" />} className="w-full sm:w-64" />
            <Select value={prio} onChange={(e) => setPrio(e.target.value)} className="w-auto"><option value="">Приоритет: все</option>{PRIORITY.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
            <Button variant="primary" className="ml-auto" onClick={() => setCreate({ status: 'new', assignee_id: user!.id })}>Новая задача</Button>
          </div>
          <div className="p-3">
            {isLoading ? <Loading /> : (
              <Kanban columns={TASK_STATUS.map((s) => ({ id: s.value, title: s.label, color: s.color }))} items={data?.items ?? []} groupOf={(t: any) => t.status}
                renderCard={(t) => <TaskCard t={t} />} onMove={move} onCardClick={(t) => nav(`/tasks/${t.id}`)} onAdd={(col) => setCreate({ status: col, assignee_id: user!.id })} />
            )}
          </div>
        </Card>
      )}
      <RecordForm entity="tasks" open={!!create} onClose={() => setCreate(null)} initial={create}
        fields={['title', 'description', 'assignee_id', 'deadline', 'priority', 'status', 'project_id', 'watchers', 'deal_id', 'tags']} />
    </div>
  );
}

