import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, CalendarDays, CalendarX, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Eye, FolderKanban, Handshake, Inbox, Layers, ListChecks,
  MessageSquare, Plus, Search, Settings, Star, Sun, Sunrise, UserCheck, Users } from 'lucide-react';
import { api } from '../api.ts';
import { PRIORITY, TASK_STATUS } from '../../core/schema.ts';
import { addDaysIso, date, deadlineInfo, parseDate, relative, todayIso, toLocalDate, WEEKDAYS } from '../lib/format.ts';
import { useApi, useAuth, useInvalidate, useList, useUsers } from '../lib/state.tsx';
import { Avatar, Button, Card, EmptyState, IconButton, Input, Loading, MenuItem, PageHeader, Popover, Select, SlideOver, cx, useToast } from '../ui/ui.tsx';
import { DataTable, EntityList, Kanban } from '../ui/data.tsx';
import { RecordForm } from '../ui/fields.tsx';
import { ModuleTabs } from '../layout/Layout.tsx';
import { TaskDetail } from './TaskPage.tsx';

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

type View = 'plan' | 'kanban' | 'list' | 'gantt' | 'calendar';
type Filter = 'unsorted' | 'all' | 'today' | 'tomorrow' | 'nodate' | 'assigned' | 'watch' | 'help' | 'accept' | 'control' | 'done' | `list:${number}` | `project:${number}`;

function useFilterParams(f: Filter, uid: number): Record<string, any> {
  const t = todayIso();
  const tm = addDaysIso(t, 1);
  const base = { is_archived__ne: 1 };
  if (f.startsWith('list:')) return { ...base, list_id: Number(f.slice(5)), status__ne: 'done' };
  if (f.startsWith('project:')) return { ...base, project_id: Number(f.slice(8)), assignee_id: uid, status__ne: 'done' };
  switch (f) {
    case 'unsorted': return { ...base, assignee_id: uid, viewed_at__null: '1', status__ne: 'done' };
    case 'today': return { ...base, assignee_id: uid, status__ne: 'done', deadline__lte: `${t}T23:59` };
    case 'tomorrow': return { ...base, assignee_id: uid, status__ne: 'done', deadline__gte: `${tm}T00:00`, deadline__lte: `${tm}T23:59` };
    case 'nodate': return { ...base, assignee_id: uid, status__ne: 'done', deadline__null: '1' };
    case 'assigned': return { ...base, author_id: uid, assignee_id__ne: uid, status__ne: 'done' };
    case 'watch': return { ...base, watchers__has: uid, status__ne: 'done' };
    case 'help': return { ...base, helpers__has: uid, status__ne: 'done' };
    case 'accept': return { ...base, author_id: uid, status: 'review' };
    case 'control': return { ...base, author_id: uid, assignee_id__ne: uid, status__ne: 'done', deadline__lt: `${t}T00:00` };
    case 'done': return { ...base, assignee_id: uid, status: 'done' };
    default: return { ...base, assignee_id: uid, status__ne: 'done' };
  }
}

function useCount(params: Record<string, any>) {
  return useList('tasks', { ...params, limit: 1, expand: 0 }).data?.total ?? 0;
}

export default function Tasks() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const view = (sp.get('view') as View) || 'plan';
  const [create, setCreate] = useState<any>(null);
  const [fromTpl, setFromTpl] = useState(false);
  const back = `/tasks${location.hash.includes('?') ? '?' + location.hash.split('?')[1] : ''}`;
  return (
    <div>
      <PageHeader title="Задачи"
        tabs={<ModuleTabs tabs={[{ to: '/tasks?view=plan', label: 'Планирование', default: true }, { to: '/tasks?view=kanban', label: 'Канбан' }, { to: '/tasks?view=list', label: 'Список' },
          { to: '/tasks?view=gantt', label: 'Гант' }, { to: '/tasks?view=calendar', label: 'Календарь' }]} />}
        actions={<>
          <div className="flex">
            <Button variant="primary" className="rounded-r-none" icon={<Plus className="size-4" />} onClick={() => setCreate({ assignee_id: user!.id, status: 'new' })}>Создать</Button>
            <Popover align="right" trigger={({ toggle }) => <Button variant="primary" className="rounded-l-none border-l border-white/25 px-2" onClick={toggle} aria-label="Ещё варианты"><ChevronDown className="size-4" /></Button>}>
              {(close) => <div className="w-56"><MenuItem icon={<Layers className="size-4" />} onClick={() => { setFromTpl(true); close(); }}>Из шаблона</MenuItem><MenuItem icon={<Archive className="size-4" />} onClick={() => { nav('/tasks/archive'); close(); }}>Архив задач</MenuItem></div>}
            </Popover>
          </div>
          <IconButton label="Настройки задач" onClick={() => nav('/settings/fields')}><Settings className="size-5" /></IconButton>
        </>} />
      {view === 'plan' && <Planning onCreate={setCreate} />}
      {view === 'kanban' && <BoardView />}
      {view === 'list' && (
        <EntityList entity="tasks" baseParams={{ is_archived__ne: 1 }} rowLink={(r) => `/tasks/${r.id}?view=list`} createLabel="Задача"
          defaults={{ assignee_id: user!.id }}
          filters={[{ key: 'status', label: 'Статус', options: TASK_STATUS }, { key: 'priority', label: 'Приоритет', options: PRIORITY }, { key: 'assignee_id', label: 'Исполнитель', type: 'user' }]}
          formFields={['title', 'description', 'assignee_id', 'deadline', 'priority', 'status', 'project_id', 'helpers', 'watchers', 'deal_id', 'parent_id', 'estimate_hours', 'repeat', 'tags']}
          columns={['title', 'status', 'priority', 'deadline', 'assignee_id', 'author_id', 'project_id']} />
      )}
      {view === 'gantt' && <TasksGantt />}
      {view === 'calendar' && <TasksCalendar />}
      {id && <SlideOver onClose={() => nav(back)}><TaskDetail id={Number(id)} /></SlideOver>}
      <RecordForm entity="tasks" open={!!create} onClose={() => setCreate(null)} initial={create} onSaved={(r) => nav(`/tasks/${r.id}`)}
        fields={['title', 'description', 'assignee_id', 'helpers', 'watchers', 'start_date', 'deadline', 'priority', 'project_id', 'deal_id', 'list_id', 'estimate_hours', 'repeat', 'tags']} />
      {fromTpl && <FromTemplate onClose={() => setFromTpl(false)} />}
    </div>
  );
}

function FromTemplate({ onClose }: { onClose: () => void }) {
  const { data } = useList('task_templates', { limit: 100 });
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const run = async (tid: number) => {
    try { const t = await api.post('/api/tasks/from-template', { template_id: tid }); inv('tasks'); onClose(); nav(`/tasks/${t.id}`); } catch (e) { toast.error(e); }
  };
  return (
    <SlideOver onClose={onClose} width={520}>
      <div className="p-6">
        <h2 className="text-xl font-extrabold">Задача из шаблона</h2>
        <p className="mt-1 text-sm text-muted">Название, описание, чек-лист и срок подставятся из шаблона.</p>
        <ul className="mt-4 space-y-2">
          {(data?.items ?? []).map((t: any) => (
            <li key={t.id}><button type="button" onClick={() => run(t.id)} className="w-full rounded-xl border border-line bg-surface p-3.5 text-left hover:border-primary">
              <p className="font-semibold">{t.name}</p><p className="text-sm text-muted">{t.title} · срок {t.duration_days} дн.</p>
            </button></li>
          ))}
        </ul>
        <Link to="/tasks/templates" onClick={onClose} className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">Управлять шаблонами</Link>
      </div>
    </SlideOver>
  );
}

function Planning({ onCreate }: { onCreate: (v: any) => void }) {
  const { user } = useAuth();
  const uid = user!.id;
  const [sp, setSp] = useSearchParams();
  const filter = (sp.get('filter') as Filter) || 'today';
  const setFilter = (f: Filter) => { sp.set('filter', f); sp.set('view', 'plan'); setSp(sp, { replace: true }); };
  const lists = useList('task_lists', { user_id: uid, limit: 50 }).data?.items ?? [];
  const myProjects = useApi<any[]>(['tasks', 'my-projects', uid], '/api/e/projects', { members__has: uid, limit: 20, status__in: 'planning,active,paused' }).data as any;
  const [newList, setNewList] = useState<string | null>(null);
  const inv = useInvalidate();
  const counts = {
    unsorted: useCount(useFilterParams('unsorted', uid)), all: useCount(useFilterParams('all', uid)), today: useCount(useFilterParams('today', uid)),
    tomorrow: useCount(useFilterParams('tomorrow', uid)), nodate: useCount(useFilterParams('nodate', uid)), assigned: useCount(useFilterParams('assigned', uid)),
    watch: useCount(useFilterParams('watch', uid)), help: useCount(useFilterParams('help', uid)), accept: useCount(useFilterParams('accept', uid)), control: useCount(useFilterParams('control', uid)),
  };
  const overdueToday = useCount({ assignee_id: uid, status__ne: 'done', deadline__lt: `${todayIso()}T00:00`, is_archived__ne: 1 });
  const item = (f: Filter, label: string, icon: React.ReactNode, count?: number, badge?: number) => (
    <button key={f} type="button" onClick={() => setFilter(f)}
      className={cx('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] [&>svg]:size-4 [&>svg]:shrink-0', filter === f ? 'bg-primary-soft font-semibold text-primary' : 'text-fg hover:bg-surface-2 [&>svg]:text-faint')}>
      {icon}<span className="flex-1 truncate">{label}</span>
      {!!badge && <span className="rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">{badge}</span>}
      {count !== undefined && <span className="text-xs text-faint tabular">{count}</span>}
    </button>
  );
  const params = useFilterParams(filter, uid);
  return (
    <div className="grid gap-5 lg:grid-cols-[250px_1fr]">
      <Card padded={false} className="h-fit">
        <div className="p-2">{item('unsorted', 'Несортированные', <Inbox />, counts.unsorted)}</div>
        <div className="border-t border-line p-2">
          {item('all', 'Все', <ListChecks />, counts.all)}
          {item('today', 'Сегодня', <Sun />, counts.today, overdueToday)}
          {item('tomorrow', 'Завтра', <Sunrise />, counts.tomorrow)}
          {item('nodate', 'Без даты', <CalendarX />, counts.nodate)}
        </div>
        <div className="border-t border-line p-2">
          {item('assigned', 'Поручено', <Users />, counts.assigned)}
          {item('watch', 'Наблюдаю', <Eye />, counts.watch)}
          {item('help', 'Помогаю', <Handshake />, counts.help)}
        </div>
        <div className="border-t border-line p-2">
          {item('accept', 'Принять работу', <CheckCheck />, counts.accept)}
          {item('control', 'Ожидают контроля', <UserCheck />, counts.control)}
        </div>
        <div className="border-t border-line p-2">
          <div className="flex items-center justify-between px-3 py-1.5 text-xs font-semibold text-faint">Списки
            <button type="button" aria-label="Новый список" onClick={() => setNewList('')} className="rounded p-0.5 text-primary hover:bg-surface-2"><Plus className="size-4" /></button></div>
          {lists.map((l: any) => item(`list:${l.id}`, l.name, <span className="size-2.5 rounded-full" style={{ background: l.color }} />))}
          {newList !== null && (
            <form className="flex gap-1 px-2 py-1" onSubmit={async (e) => { e.preventDefault(); if (newList.trim()) { await api.post('/api/e/task_lists', { name: newList.trim(), user_id: uid }); inv('task_lists'); } setNewList(null); }}>
              <Input autoFocus value={newList} onChange={(e) => setNewList(e.target.value)} placeholder="Название" className="h-8" /><Button type="submit" size="sm">ОК</Button>
            </form>
          )}
        </div>
        <div className="border-t border-line p-2">
          <p className="px-3 py-1.5 text-xs font-semibold text-faint">Проекты</p>
          {(myProjects?.items ?? []).map((p: any) => item(`project:${p.id}`, p.name, <FolderKanban />))}
        </div>
        <div className="border-t border-line p-2">{item('done', 'Завершённые', <Check />)}</div>
      </Card>
      <TaskPlanList params={params} filter={filter} onCreate={onCreate} />
    </div>
  );
}

function TaskPlanList({ params, filter, onCreate }: { params: Record<string, any>; filter: Filter; onCreate: (v: any) => void }) {
  const { user } = useAuth();
  const { users } = useUsers();
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const [q, setQ] = useState('');
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<number>(user!.id);
  const { data, isLoading } = useList('tasks', { ...params, q, limit: 300, sort: 'deadline', dir: 'asc' });
  const comments = useApi<Record<string, number>>(['timeline', 'task-counts'], '/api/e/activities', { entity_type: 'tasks', kind: 'comment', limit: 2000, expand: 0 }).data as any;
  const ccount = useMemo(() => { const m: Record<number, number> = {}; for (const a of comments?.items ?? []) m[a.entity_id] = (m[a.entity_id] ?? 0) + 1; return m; }, [comments]);
  const quickDeadline = () => {
    const t = todayIso();
    if (filter === 'tomorrow') return `${addDaysIso(t, 1)}T18:00`;
    if (filter === 'nodate' || filter === 'unsorted') return null;
    return `${t}T18:00`;
  };
  const quickCreate = async () => {
    if (!title.trim()) return;
    try {
      const extra: Record<string, any> = {};
      if (filter.startsWith('list:')) extra.list_id = Number(filter.slice(5));
      if (filter.startsWith('project:')) extra.project_id = Number(filter.slice(8));
      await api.post('/api/e/tasks', { title: title.trim(), assignee_id: assignee, deadline: quickDeadline(), status: 'new', priority: 'normal', ...extra });
      setTitle('');
      inv('tasks');
    } catch (e) { toast.error(e); }
  };
  const toggleDone = async (t: any) => {
    try { await api.patch(`/api/e/tasks/${t.id}`, { status: t.status === 'done' ? 'in_progress' : 'done' }); inv('tasks'); } catch (e) { toast.error(e); }
  };
  const items = data?.items ?? [];
  const au = users.find((u: any) => u.id === assignee);
  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap gap-2">
        <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); quickCreate(); }}>
          <div className="relative min-w-0 flex-1">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Быстрое создание задачи"
              className="h-10 w-full rounded-xl border border-line bg-surface px-4 pr-10 text-sm placeholder:text-faint focus:border-primary focus:outline-none" />
            <button type="button" aria-label="Расширенная форма" onClick={() => onCreate({ title, assignee_id: assignee, deadline: quickDeadline() })} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-primary"><Plus className="size-4" /></button>
          </div>
          <div className="relative hidden w-48 xl:block">
            <Select value={assignee} onChange={(e) => setAssignee(Number(e.target.value))} className="h-10 rounded-xl pl-10">{users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"><Avatar name={au?.name} color={au?.color} size={24} /></span>
          </div>
          <Button type="submit" variant="primary" className="h-10 w-10 rounded-xl px-0" aria-label="Создать задачу"><Check className="size-5" /></Button>
        </form>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск" icon={<Search className="size-4" />} className="h-10 w-full sm:w-48" />
      </div>
      <Card padded={false}>
        {isLoading ? <Loading /> : !items.length ? <EmptyState icon={<Star />} title="Здесь пусто" text="Нет задач под этот фильтр. Создайте задачу в строке выше." /> : (
          <ul className="divide-y divide-line">
            {items.map((t: any) => {
              const p = PRIORITY.find((x) => x.value === t.priority);
              const dl = deadlineInfo(t.deadline, t.status === 'done');
              return (
                <li key={t.id} className="group flex items-start gap-3 px-4 py-3 hover:bg-surface-2/60">
                  <button type="button" aria-label={t.status === 'done' ? 'Вернуть в работу' : 'Завершить'} onClick={() => toggleDone(t)}
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors"
                    style={{ borderColor: p?.color, background: t.status === 'done' ? p?.color : undefined }}>
                    {t.status === 'done' && <Check className="size-3 text-white" />}
                  </button>
                  <button type="button" onClick={() => nav(`/tasks/${t.id}${location.hash.includes('?') ? '?' + location.hash.split('?')[1] : ''}`)} className="min-w-0 flex-1 text-left">
                    <p className={cx('flex items-center gap-2 text-sm font-semibold', t.status === 'done' && 'text-muted line-through')}>
                      {!t.viewed_at && t.assignee_id === user!.id && <span className="size-2 shrink-0 rounded-full bg-accent" title="Новая, ещё не открыта" />}{t.title}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                      {t.start_date && <span className="text-faint">Начало {relative(t.start_date)}</span>}
                      <span className={cx(dl.tone === 'danger' ? 'text-danger' : dl.tone === 'warning' ? 'text-warning' : 'text-faint')}>{t.deadline ? `Крайний срок ${dl.tone === 'danger' ? relative(t.deadline) : dl.text}` : 'Без срока'}</span>
                    </p>
                    {(t._ref?.deal_id || t._ref?.project_id) && <p className="mt-0.5 truncate text-xs text-muted">{t._ref?.deal_id ? `Сделка: ${t._ref.deal_id.title}` : `Проект: ${t._ref.project_id.title}`}</p>}
                  </button>
                  {ccount[t.id] ? <span className="mt-0.5 flex items-center gap-1 text-xs text-faint"><MessageSquare className="size-3.5" />{ccount[t.id]}</span> : null}
                  {t.assignee_id !== user!.id && t._ref?.assignee_id && <Avatar name={t._ref.assignee_id.title} color={t._ref.assignee_id.color} size={24} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function BoardView() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const [mine, setMine] = useState(true);
  const [q, setQ] = useState('');
  const [create, setCreate] = useState<any>(null);
  const { data, isLoading } = useList('tasks', { assignee_id: mine ? user!.id : undefined, q, limit: 500, sort: 'deadline', dir: 'asc', is_archived__ne: 1 });
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск" icon={<Search className="size-4" />} className="w-full sm:w-60" />
        <label className="inline-flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="size-4 accent-[var(--c-primary)]" checked={mine} onChange={(e) => setMine(e.target.checked)} />Только мои</label>
      </div>
      {isLoading ? <Loading /> : (
        <Kanban columns={TASK_STATUS.map((s) => ({ id: s.value, title: s.label, color: s.color }))} items={data?.items ?? []} groupOf={(t: any) => t.status}
          renderCard={(t) => <TaskCard t={t} />} onCardClick={(t) => nav(`/tasks/${t.id}?view=kanban`)} onAdd={(col) => setCreate({ status: col, assignee_id: user!.id })}
          onMove={async (t, status) => { try { await api.patch(`/api/e/tasks/${t.id}`, { status }); inv('tasks'); } catch (e) { toast.error(e); } }} />
      )}
      <RecordForm entity="tasks" open={!!create} onClose={() => setCreate(null)} initial={create} fields={['title', 'description', 'assignee_id', 'deadline', 'priority', 'status', 'project_id']} />
    </div>
  );
}

function TasksGantt() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [mine, setMine] = useState(true);
  const { data, isLoading } = useList('tasks', { assignee_id: mine ? user!.id : undefined, status__ne: 'done', deadline__null: '0', limit: 200, sort: 'deadline', dir: 'asc', is_archived__ne: 1 });
  const tasks = (data?.items ?? []).map((t: any) => {
    const end = String(t.deadline).slice(0, 10);
    const start = t.start_date && t.start_date <= end ? t.start_date : addDaysIso(end, -2);
    return { ...t, start, end };
  });
  const from = addDaysIso(todayIso(), -7);
  const days: string[] = [];
  for (let d = from; days.length < 42; d = addDaysIso(d, 1)) days.push(d);
  const W = 30;
  const idx = (d: string) => Math.round((parseDate(d)!.getTime() - parseDate(from)!.getTime()) / 864e5);
  return (
    <Card padded={false} title="Гант моих задач" subtitle="Шесть недель от прошлой недели" actions={<label className="inline-flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="size-4 accent-[var(--c-primary)]" checked={mine} onChange={(e) => setMine(e.target.checked)} />Только мои</label>}>
      {isLoading ? <Loading /> : !tasks.length ? <EmptyState compact title="Нет задач со сроками" /> : (
        <div className="flex overflow-hidden">
          <div className="w-56 shrink-0 border-r border-line sm:w-72">
            <div className="h-10 border-b border-line" />
            {tasks.map((t: any) => <button key={t.id} type="button" onClick={() => nav(`/tasks/${t.id}?view=gantt`)} className="block h-9 w-full truncate border-b border-line px-3 text-left text-sm hover:bg-surface-2">{t.title}</button>)}
          </div>
          <div className="flex-1 overflow-x-auto">
            <div className="relative" style={{ width: days.length * W }}>
              <div className="flex h-10 border-b border-line">{days.map((d) => { const dt = parseDate(d)!; const we = dt.getDay() === 0 || dt.getDay() === 6;
                return <div key={d} className={cx('shrink-0 border-r border-line/60 pt-3 text-center text-[11px]', we ? 'bg-surface-2 text-faint' : 'text-muted', d === todayIso() && 'font-bold text-accent')} style={{ width: W }}>{dt.getDate()}</div>; })}</div>
              <div className="pointer-events-none absolute bottom-0 top-10 w-0.5 bg-accent/70" style={{ left: idx(todayIso()) * W + W / 2 }} />
              {tasks.map((t: any) => {
                const a = Math.max(0, idx(t.start)), b = Math.min(days.length - 1, Math.max(a, idx(t.end)));
                const color = PRIORITY.find((x) => x.value === t.priority)?.color ?? '#12A994';
                return <div key={t.id} className="relative h-9 border-b border-line">{b >= 0 && a < days.length && <div title={`${t.title}: ${date(t.start)} — ${date(t.end)}`} className="absolute top-1.5 h-6 rounded-md opacity-90" style={{ left: a * W, width: (b - a + 1) * W - 2, background: color }} />}</div>;
              })}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function TasksCalendar() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [anchor, setAnchor] = useState(() => { const d = new Date(); d.setDate(1); return toLocalDate(d); });
  const first = parseDate(anchor)!;
  const start = addDaysIso(anchor, -((first.getDay() + 6) % 7));
  const days: string[] = [];
  for (let d = start; days.length < 42; d = addDaysIso(d, 1)) days.push(d);
  const { data } = useList('tasks', { assignee_id: user!.id, deadline__gte: `${days[0]}T00:00`, deadline__lte: `${days[41]}T23:59`, limit: 500, is_archived__ne: 1 });
  const shift = (n: number) => { const d = parseDate(anchor)!; d.setMonth(d.getMonth() + n); setAnchor(toLocalDate(d)); };
  return (
    <Card padded={false}>
      <div className="flex items-center gap-2 border-b border-line p-3">
        <IconButton label="Предыдущий месяц" onClick={() => shift(-1)}><ChevronLeft className="size-4" /></IconButton>
        <IconButton label="Следующий месяц" onClick={() => shift(1)}><ChevronRight className="size-4" /></IconButton>
        <span className="text-lg font-bold capitalize">{first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</span>
        <CalendarDays className="ml-auto size-5 text-faint" />
      </div>
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((w) => <div key={w} className="border-b border-line px-2 py-2 text-xs font-bold uppercase text-faint">{w}</div>)}
        {days.map((d) => {
          const list = (data?.items ?? []).filter((t: any) => String(t.deadline).slice(0, 10) === d);
          return (
            <div key={d} className={cx('min-h-24 border-b border-r border-line p-1.5', parseDate(d)!.getMonth() !== first.getMonth() && 'bg-surface-2/40')}>
              <span className={cx('mb-1 flex size-6 items-center justify-center rounded-full text-xs font-bold', d === todayIso() && 'bg-primary text-primary-fg')}>{parseDate(d)!.getDate()}</span>
              {list.slice(0, 4).map((t: any) => (
                <button key={t.id} type="button" onClick={() => nav(`/tasks/${t.id}?view=calendar`)} className={cx('mb-0.5 block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-semibold', t.status === 'done' ? 'bg-surface-2 text-muted line-through' : 'bg-primary-soft text-primary')}>{t.title}</button>
              ))}
              {list.length > 4 && <p className="px-1 text-[11px] text-muted">ещё {list.length - 4}</p>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function TaskTemplates() {
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  return (
    <div>
      <PageHeader title="Шаблоны задач" subtitle="Типовые задачи с готовым описанием, чек-листом и сроком" />
      <EntityList entity="task_templates" createLabel="Шаблон" columns={['name', 'title', 'priority', 'assignee_id', { key: 'duration_days', label: 'Срок, дн.' },
        { key: 'go', label: '', sortable: false, render: (r: any) => <Button size="xs" variant="soft" onClick={async (e) => { e.stopPropagation(); try { const t = await api.post('/api/tasks/from-template', { template_id: r.id }); inv('tasks'); nav(`/tasks/${t.id}`); } catch (er) { toast.error(er); } }}>Создать задачу</Button> }]}
        formFields={['name', 'title', 'description', 'priority', 'assignee_id', 'estimate_hours', 'duration_days', 'tags']} />
      <p className="mt-3 text-xs text-faint">Пункты чек-листа шаблона редактируются в API или задаются при импорте; базовые шаблоны уже содержат типовые чек-листы.</p>
    </div>
  );
}

export function TaskArchive() {
  return (
    <div>
      <PageHeader title="Архив задач" subtitle="Задачи, убранные из рабочих списков. Их можно вернуть." />
      <EntityList entity="tasks" baseParams={{ is_archived: 1 }} rowLink={(r) => `/tasks/${r.id}`} canExport columns={['title', 'status', 'assignee_id', 'deadline', 'project_id']}
        empty={<EmptyState icon={<Archive />} title="Архив пуст" text="Отправить задачу в архив можно из её карточки." />} onCreate={undefined} />
    </div>
  );
}
