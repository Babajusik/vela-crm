import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Diamond, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.ts';
import { TASK_STATUS } from '../../core/schema.ts';
import { addDaysIso, compactMoney, date, minutes, money, parseDate, todayIso } from '../lib/format.ts';
import { useApi, useAuth, useInvalidate, useList, useRecord } from '../lib/state.tsx';
import { Avatar, Badge, Button, Card, EmptyState, IconButton, Loading, Progress, Segmented, Stat, Tabs, cx, useToast } from '../ui/ui.tsx';
import { DataTable, EntityList, FieldsPanel, Kanban, Timeline } from '../ui/data.tsx';
import { RecordForm } from '../ui/fields.tsx';
import { TaskCard } from './Tasks.tsx';
import { FilesBlock } from './Files.tsx';

type Tab = 'overview' | 'tasks' | 'gantt' | 'milestones' | 'sprints' | 'issues' | 'finance' | 'feed' | 'files';

export default function ProjectPage() {
  const { id } = useParams();
  const pid = Number(id);
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const { can, user } = useAuth();
  const { data: p, isLoading } = useRecord('projects', pid);
  const [tab, setTab] = useState<Tab>('overview');
  if (isLoading) return <Loading />;
  if (!p) return <EmptyState title="Проект не найден" action={<Button onClick={() => nav('/projects')}>К проектам</Button>} />;
  const agile = p.kind === 'agile';
  const remove = async () => {
    if (!(await toast.confirm({ title: 'Удалить проект?', text: 'Вехи, спринты и замечания удалятся. Задачи останутся без проекта.', danger: true, ok: 'Удалить' }))) return;
    await api.del(`/api/e/projects/${pid}`);
    inv('projects');
    nav('/projects');
  };
  return (
    <div>
      <Link to="/projects" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" />Проекты</Link>
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <span className="mt-2 size-4 rounded-full" style={{ background: p.color }} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight">{p.name}</h1>
          <p className="mt-0.5 text-sm text-muted">{[p.code, p._ref?.company_id?.title, `${date(p.start_date)} — ${date(p.end_date)}`].filter(Boolean).join(' · ')}</p>
        </div>
        {can('projects', 'write') && <IconButton label="Удалить проект" onClick={remove}><Trash2 className="size-4" /></IconButton>}
      </div>
      <Tabs value={tab} onChange={setTab} className="mb-5" tabs={[
        { value: 'overview', label: 'Обзор' }, { value: 'tasks', label: 'Задачи' }, { value: 'gantt', label: 'Гант' }, { value: 'milestones', label: 'Вехи' },
        ...(agile ? [{ value: 'sprints' as Tab, label: 'Спринты' }] : []), { value: 'issues', label: 'Замечания' }, { value: 'finance', label: 'Финансы' },
        { value: 'feed', label: 'Обсуждение' }, { value: 'files', label: 'Файлы' },
      ]} />
      {tab === 'overview' && <Overview p={p} />}
      {tab === 'tasks' && <ProjectTasks p={p} userId={user!.id} />}
      {tab === 'gantt' && <Gantt projectId={pid} />}
      {tab === 'milestones' && <EntityList entity="milestones" baseParams={{ project_id: pid }} defaults={{ project_id: pid, date: todayIso() }} createLabel="Веха" columns={['name', 'date', 'done', 'description']} formFields={['name', 'date', 'done', 'description']} canExport={false} />}
      {tab === 'sprints' && <Sprints p={p} />}
      {tab === 'issues' && <EntityList entity="project_issues" baseParams={{ project_id: pid }} defaults={{ project_id: pid }} createLabel="Замечание" columns={['title', 'severity', 'status', 'assignee_id', { key: 'created_at', label: 'Создано', render: (r: any) => date(r.created_at) }]} formFields={['title', 'description', 'severity', 'status', 'assignee_id']} />}
      {tab === 'finance' && <ProjectFinance p={p} />}
      {tab === 'feed' && <Timeline entity="projects" id={pid} />}
      {tab === 'files' && <FilesBlock entityType="projects" entityId={pid} />}
    </div>
  );
}

function Overview({ p }: { p: any }) {
  const { data: o } = useApi<any>(['overview', p.id], `/api/projects/${p.id}/overview`);
  if (!o) return <Loading />;
  const s = o.stats;
  const daysLeft = p.end_date ? Math.ceil(((parseDate(p.end_date)?.getTime() ?? 0) - Date.now()) / 864e5) : null;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Прогресс" value={`${s.progress}%`} sub={`${s.tasks_done} из ${s.tasks_total} задач`} tone="primary" />
        <Stat label="До окончания" value={daysLeft == null ? '—' : daysLeft >= 0 ? `${daysLeft} дн.` : `просрочен на ${-daysLeft} дн.`} tone={daysLeft != null && daysLeft < 0 ? 'danger' : 'default'} sub={`Просроченных задач: ${s.tasks_overdue}`} />
        <Stat label="Затрачено времени" value={minutes(s.minutes)} sub={`Себестоимость ${compactMoney(s.labor_cost)}`} />
        <Stat label="Прибыль проекта" value={money(s.profit)} tone={s.profit < 0 ? 'danger' : 'success'} sub={s.margin != null ? `Рентабельность ${s.margin}%` : 'Оплат пока нет'} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card title="Задачи по исполнителям" padded={false}>
            <ul className="divide-y divide-line">
              {o.byUser.map((u: any) => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Avatar name={u.name} color={u.color} size={26} />
                  <span className="w-40 truncate font-semibold">{u.name}</span>
                  <Progress value={u.total ? (u.done / u.total) * 100 : 0} className="flex-1" />
                  <span className="w-16 text-right text-xs tabular text-muted">{u.done}/{u.total}</span>
                </li>
              ))}
              {!o.byUser.length && <li className="px-4 py-6 text-sm text-faint">Задач пока нет</li>}
            </ul>
          </Card>
          <Card title="Вехи">
            <ol className="relative space-y-3 border-l border-line pl-5">
              {o.milestones.map((m: any) => (
                <li key={m.id} className="relative text-sm">
                  <Diamond className={cx('absolute -left-[27px] top-0.5 size-3.5', m.done ? 'fill-success text-success' : 'fill-surface text-faint')} />
                  <span className={cx('font-semibold', m.done && 'text-muted line-through')}>{m.name}</span> <span className="text-muted">— {date(m.date)}</span>
                </li>
              ))}
              {!o.milestones.length && <li className="text-sm text-faint">Вех нет</li>}
            </ol>
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Параметры"><FieldsPanel entity="projects" item={p} fields={['status', 'kind', 'manager_id', 'members', 'company_id', 'deal_id', 'start_date', 'end_date', 'budget', 'cost_budget', 'description']} /></Card>
          {o.openIssues > 0 && <Card><p className="text-sm">Открытых замечаний: <b className="text-danger">{o.openIssues}</b></p></Card>}
        </div>
      </div>
    </div>
  );
}

function ProjectTasks({ p, userId }: { p: any; userId: number }) {
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const { data } = useList('tasks', { project_id: p.id, limit: 500, sort: 'sort', dir: 'asc' });
  const inv = useInvalidate();
  const toast = useToast();
  const nav = useNavigate();
  const [create, setCreate] = useState<any>(null);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Segmented value={view} onChange={setView} options={[{ value: 'kanban', label: 'Канбан' }, { value: 'list', label: 'Список' }]} />
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreate({ project_id: p.id, assignee_id: userId, status: 'new' })}>Задача</Button>
      </div>
      {view === 'kanban' ? (
        <Kanban columns={TASK_STATUS.map((s) => ({ id: s.value, title: s.label, color: s.color }))} items={data?.items ?? []} groupOf={(t: any) => t.status}
          renderCard={(t) => <TaskCard t={t} showProject={false} />} onCardClick={(t) => nav(`/tasks/${t.id}`)}
          onAdd={(col) => setCreate({ project_id: p.id, assignee_id: userId, status: col })}
          onMove={async (t, to) => { try { await api.patch(`/api/e/tasks/${t.id}`, { status: to }); inv('tasks'); } catch (e) { toast.error(e); } }} />
      ) : (
        <Card padded={false}><DataTable entity="tasks" rows={data?.items ?? []} onRowClick={(r) => nav(`/tasks/${r.id}`)} columns={['title', 'status', 'priority', 'assignee_id', 'start_date', 'deadline', 'milestone_id']} /></Card>
      )}
      <RecordForm entity="tasks" open={!!create} onClose={() => setCreate(null)} initial={create} fields={['title', 'description', 'assignee_id', 'start_date', 'deadline', 'priority', 'status', 'milestone_id', ...(p.kind === 'agile' ? ['sprint_id', 'story_points'] : []), 'estimate_hours']} />
    </div>
  );
}

function Gantt({ projectId }: { projectId: number }) {
  const { data } = useApi<any>(['gantt', projectId], `/api/projects/${projectId}/gantt`);
  const [scale, setScale] = useState<'day' | 'week'>('day');
  const inv = useInvalidate();
  const toast = useToast();
  const range = useMemo(() => {
    if (!data) return null;
    const dates = [data.project.start_date, data.project.end_date, ...data.tasks.flatMap((t: any) => [t.start, t.end]), ...data.milestones.map((m: any) => m.date)].filter(Boolean).sort();
    const from = addDaysIso(dates[0] ?? todayIso(), -2), to = addDaysIso(dates[dates.length - 1] ?? todayIso(), 3);
    const days: string[] = [];
    for (let d = from; d <= to && days.length < 400; d = addDaysIso(d, 1)) days.push(d);
    return { from, days };
  }, [data]);
  if (!data || !range) return <Loading />;
  const W = scale === 'day' ? 34 : 12;
  const idx = (d: string) => range.days.indexOf(d.slice(0, 10));
  const today = idx(todayIso());
  const shift = async (t: any, days: number) => {
    try {
      const deadline = t.deadline ? addDaysIso(String(t.deadline).slice(0, 10), days) + String(t.deadline).slice(10) : addDaysIso(t.end, days) + 'T18:00';
      await api.patch(`/api/e/tasks/${t.id}`, { start_date: addDaysIso(t.start, days), deadline });
      inv('gantt', 'tasks');
    } catch (e) { toast.error(e); }
  };
  return (
    <Card padded={false} title="Диаграмма Ганта" subtitle="Перетащите полосу, чтобы сдвинуть сроки задачи" actions={<Segmented value={scale} onChange={setScale} options={[{ value: 'day', label: 'Дни' }, { value: 'week', label: 'Недели' }]} />}>
      {!data.tasks.length ? <EmptyState compact title="Задач нет" text="Добавьте задачи со сроками — они появятся на диаграмме." /> : (
        <div className="flex overflow-hidden">
          <div className="w-64 shrink-0 border-r border-line">
            <div className="h-10 border-b border-line px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-faint">Задача</div>
            {data.tasks.map((t: any) => (
              <Link key={t.id} to={`/tasks/${t.id}`} className="flex h-9 items-center gap-2 border-b border-line px-3 text-sm hover:bg-surface-2">
                <span className="size-2 shrink-0 rounded-full" style={{ background: TASK_STATUS.find((s) => s.value === t.status)?.color }} />
                <span className={cx('truncate', t.status === 'done' && 'text-muted line-through')}>{t.title}</span>
              </Link>
            ))}
            {data.milestones.map((m: any) => <div key={'m' + m.id} className="flex h-9 items-center gap-2 border-b border-line px-3 text-sm font-semibold"><Diamond className="size-3.5 text-accent" /><span className="truncate">{m.name}</span></div>)}
          </div>
          <div className="relative flex-1 overflow-x-auto">
            <div style={{ width: range.days.length * W }} className="relative">
              <div className="flex h-10 border-b border-line">
                {range.days.map((d, i) => {
                  const dt = parseDate(d)!;
                  const weekend = dt.getDay() === 0 || dt.getDay() === 6;
                  const label = scale === 'day' ? String(dt.getDate()) : dt.getDay() === 1 ? `${dt.getDate()}.${String(dt.getMonth() + 1).padStart(2, '0')}` : '';
                  return <div key={d} className={cx('shrink-0 border-r border-line/60 pt-3 text-center text-[11px] text-faint', weekend && 'bg-surface-2', i === today && 'font-bold text-accent')} style={{ width: W }}>{label}</div>;
                })}
              </div>
              {today >= 0 && <div className="pointer-events-none absolute bottom-0 top-10 w-0.5 bg-accent/70" style={{ left: today * W + W / 2 }} />}
              {data.tasks.map((t: any) => {
                const a = Math.max(0, idx(t.start)), b = Math.max(a, idx(t.end));
                const color = t.color ?? data.project.color ?? '#12A994';
                return (
                  <div key={t.id} className="relative h-9 border-b border-line">
                    <GanttBar left={a * W} width={(b - a + 1) * W} color={color} done={t.status === 'done'} title={`${t.title}: ${date(t.start)} — ${date(t.end)}${t.assignee ? ', ' + t.assignee : ''}`}
                      label={scale === 'day' ? t.assignee?.split(' ')[0] : ''} step={W} onShift={(days) => days && shift(t, days)} />
                  </div>
                );
              })}
              {data.milestones.map((m: any) => (
                <div key={'m' + m.id} className="relative h-9 border-b border-line">
                  <Diamond className={cx('absolute top-2.5 size-4', m.done ? 'fill-success text-success' : 'fill-accent text-accent')} style={{ left: idx(m.date) * W + W / 2 - 8 }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function GanttBar({ left, width, color, done, title, label, step, onShift }: { left: number; width: number; color: string; done: boolean; title: string; label?: string; step: number; onShift: (days: number) => void }) {
  const [dx, setDx] = useState(0);
  const start = (e: React.PointerEvent) => {
    const x0 = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setDx(ev.clientX - x0);
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDx(0);
      onShift(Math.round((ev.clientX - x0) / step));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div title={title} onPointerDown={start} className={cx('absolute top-1.5 flex h-6 cursor-grab items-center overflow-hidden rounded-md px-2 text-[11px] font-semibold text-white shadow-sm active:cursor-grabbing', done && 'opacity-50')}
      style={{ left: left + dx, width: Math.max(width - 2, 8), background: color }}>
      <span className="truncate">{label}</span>
    </div>
  );
}

function Sprints({ p }: { p: any }) {
  const sprints = useList('sprints', { project_id: p.id, limit: 100, sort: 'start_date', dir: 'asc' }).data?.items ?? [];
  const tasks = useList('tasks', { project_id: p.id, limit: 500 }).data?.items ?? [];
  const [form, setForm] = useState<any>(null);
  const backlog = tasks.filter((t: any) => !t.sprint_id && t.status !== 'done');
  const sp = (list: any[]) => list.reduce((s, t) => s + (t.story_points || 0), 0);
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ project_id: p.id, status: 'planned', start_date: todayIso(), end_date: addDaysIso(todayIso(), 13) })}>Спринт</Button></div>
      {sprints.map((s: any) => {
        const st = tasks.filter((t: any) => t.sprint_id === s.id);
        const done = st.filter((t: any) => t.status === 'done');
        return (
          <Card key={s.id} title={<span className="flex items-center gap-2">{s.name}<Badge color={s.status === 'active' ? '#0ea5e9' : s.status === 'done' ? '#10b981' : '#94a3b8'}>{({ planned: 'Запланирован', active: 'Активен', done: 'Завершён' } as any)[s.status]}</Badge></span>}
            subtitle={`${date(s.start_date)} — ${date(s.end_date)}${s.goal ? ' · ' + s.goal : ''}`} actions={<Button size="sm" variant="ghost" onClick={() => setForm(s)}>Изменить</Button>}>
            <div className="mb-3 flex items-center gap-3 text-sm"><Progress value={sp(st) ? (sp(done) / sp(st)) * 100 : 0} className="flex-1" /><span className="tabular text-muted">{sp(done)} / {sp(st)} SP</span></div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{st.map((t: any) => <Link key={t.id} to={`/tasks/${t.id}`} className="rounded-lg border border-line p-3 hover:border-line-strong"><TaskCard t={t} showProject={false} /><p className="mt-1 text-xs text-faint">{t.story_points ?? 0} SP</p></Link>)}</div>
          </Card>
        );
      })}
      <Card title="Бэклог" subtitle={`${backlog.length} задач, ${sp(backlog)} SP`}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{backlog.map((t: any) => <Link key={t.id} to={`/tasks/${t.id}`} className="rounded-lg border border-line p-3 hover:border-line-strong"><TaskCard t={t} showProject={false} /></Link>)}</div>
        {!backlog.length && <p className="text-sm text-faint">Бэклог пуст</p>}
      </Card>
      <RecordForm entity="sprints" open={!!form} onClose={() => setForm(null)} initial={form} fields={['name', 'start_date', 'end_date', 'status', 'goal']} />
    </div>
  );
}

function ProjectFinance({ p }: { p: any }) {
  const { can } = useAuth();
  const { data: o } = useApi<any>(['overview', p.id], `/api/projects/${p.id}/overview`);
  if (!can('finance')) return <EmptyState title="Нет доступа к финансам" text="Попросите администратора открыть модуль «Финансы»." />;
  if (!o) return <Loading />;
  const s = o.stats;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Поступления" value={money(s.income)} tone="success" sub={p.budget ? `из бюджета ${compactMoney(p.budget)}` : undefined} />
        <Stat label="Прямые расходы" value={money(s.expense)} tone="accent" />
        <Stat label="Затраты на труд" value={money(s.labor_cost)} sub={minutes(s.minutes)} />
        <Stat label="Прибыль" value={money(s.profit)} tone={s.profit < 0 ? 'danger' : 'primary'} sub={s.margin != null ? `Рентабельность ${s.margin}%` : undefined} />
      </div>
      <EntityList entity="fin_operations" baseParams={{ project_id: p.id }} defaults={{ project_id: p.id, kind: 'expense', date: todayIso(), status: 'fact' }} createLabel="Операция"
        columns={['date', 'kind', 'amount', 'category_id', 'company_id', 'description', 'status']}
        formFields={['kind', 'date', 'amount', 'account_id', 'category_id', 'company_id', 'description', 'status']} />
    </div>
  );
}
