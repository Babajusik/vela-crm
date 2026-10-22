import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Archive, ArchiveRestore, Check, Copy, ExternalLink, Eye, EyeOff, Link2, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.ts';
import { PRIORITY, TASK_STATUS } from '../../core/schema.ts';
import { dateTime, deadlineInfo, minutes, money, relative } from '../lib/format.ts';
import { useApi, useAuth, useInvalidate, useList, useRecord } from '../lib/state.tsx';
import { Badge, Button, Card, Checkbox, EmptyState, IconButton, Input, Loading, MenuItem, Popover, Progress, Select, Switch, Tabs, cx, useToast } from '../ui/ui.tsx';
import { FieldsPanel, Timeline } from '../ui/data.tsx';
import { RecordForm, RefSelect, RichText, SafeHtml } from '../ui/fields.tsx';
import { FilesBlock } from './Files.tsx';

const LINK_KINDS = [{ value: 'fs', label: 'Окончание — Начало' }, { value: 'ss', label: 'Начало — Начало' }, { value: 'ff', label: 'Окончание — Окончание' }, { value: 'sf', label: 'Начало — Окончание' }];

/** Task card: used in the slide-over over task lists and as a standalone page */
export function TaskDetail({ id: tid }: { id: number }) {
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const { user, can } = useAuth();
  const { data: t, isLoading, error } = useRecord('tasks', tid);
  const [tab, setTab] = useState<'comments' | 'time' | 'files'>('comments');
  const [editDesc, setEditDesc] = useState<string | null>(null);
  const [sub, setSub] = useState<any>(null);
  const timer = useApi<any>(['time', 'running'], '/api/time/running');
  const spent = useList('time_entries', { task_id: tid, limit: 500, expand: 0 }).data?.items ?? [];
  if (isLoading) return <div className="p-6"><Loading /></div>;
  if (error || !t) return <div className="p-6"><EmptyState title="Задача не найдена" action={<Button onClick={() => nav('/tasks')}>К задачам</Button>} /></div>;
  const status = TASK_STATUS.find((s) => s.value === t.status);
  const dl = deadlineInfo(t.deadline, t.status === 'done');
  const writable = can('tasks', 'write');
  const spentMin = spent.reduce((s: number, e: any) => s + (e.minutes || 0), 0);
  const watching = (t.watchers ?? []).includes(user!.id);
  const patch = async (d: any, ok?: string) => { try { await api.patch(`/api/e/tasks/${tid}`, d); inv('tasks'); if (ok) toast.success(ok); } catch (e) { toast.error(e); } };
  const running = timer.data && timer.data.task_id === tid;
  const toggleTimer = async () => {
    try { if (running) await api.post('/api/time/stop'); else await api.post('/api/time/start', { task_id: tid }); inv('time_entries', 'tasks'); }
    catch (e) { toast.error(e); }
  };
  const remove = async () => {
    if (!(await toast.confirm({ title: 'Удалить задачу?', danger: true, ok: 'Удалить' }))) return;
    await api.del(`/api/e/tasks/${tid}`);
    inv('tasks');
    nav('/tasks');
  };
  const copyTask = async () => {
    try {
      const { id: _i, created_at: _c, updated_at: _u, _ref: _r, extra: _e, completed_at: _d, viewed_at: _v, ...rest } = t;
      const copy = await api.post('/api/e/tasks', { ...rest, title: `${t.title} (копия)`, status: 'new', progress: 0 });
      inv('tasks');
      nav(`/tasks/${copy.id}`);
    } catch (e) { toast.error(e); }
  };
  const pay = t.bill_customer ? (t.bill_by === 'plan' ? (t.estimate_hours ?? 0) : spentMin / 60) * (t.hour_price ?? 0) : 0;
  return (
    <div className="min-h-full">
      <div className="border-b border-line bg-surface px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-start gap-3 pr-12 2xl:pr-0">
          <div className="min-w-0 flex-1">
            <h1 className={cx('text-xl font-extrabold leading-snug tracking-tight sm:text-2xl', t.status === 'done' && 'text-muted line-through')}>{t.title}</h1>
            {(t._ref?.project_id || t._ref?.deal_id) && (
              <p className="mt-0.5 text-sm">{t._ref?.project_id && <Link to={`/projects/${t.project_id}`} className="text-muted hover:text-primary">{t._ref.project_id.title}</Link>}
                {t._ref?.deal_id && <Link to={`/crm/deals/${t.deal_id}`} className="ml-2 text-muted hover:text-primary">Сделка: {t._ref.deal_id.title}</Link>}</p>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <IconButton label={watching ? 'Перестать наблюдать' : 'Наблюдать'} onClick={() => patch({ watchers: watching ? t.watchers.filter((x: number) => x !== user!.id) : [...(t.watchers ?? []), user!.id] }, watching ? 'Вы больше не наблюдаете' : 'Вы наблюдаете за задачей')}>
              {watching ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </IconButton>
            <IconButton label="Скопировать ссылку" onClick={() => { navigator.clipboard?.writeText(location.href); toast.success('Ссылка скопирована'); }}><Link2 className="size-4" /></IconButton>
            <IconButton label="Открыть отдельно" onClick={() => window.open(location.href, '_blank')}><ExternalLink className="size-4" /></IconButton>
            {writable && (
              <Popover align="right" trigger={({ toggle }) => <IconButton label="Ещё" onClick={toggle}><span className="text-lg leading-none">⋮</span></IconButton>}>
                {(close) => (
                  <div className="w-52">
                    <MenuItem icon={<Copy className="size-4" />} onClick={() => { close(); copyTask(); }}>Копировать задачу</MenuItem>
                    <MenuItem icon={t.is_archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} onClick={() => { patch({ is_archived: t.is_archived ? 0 : 1 }, t.is_archived ? 'Задача возвращена' : 'Задача в архиве'); close(); }}>{t.is_archived ? 'Вернуть из архива' : 'В архив'}</MenuItem>
                    <MenuItem icon={<Trash2 className="size-4" />} danger onClick={() => { close(); remove(); }}>Удалить</MenuItem>
                  </div>
                )}
              </Popover>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Select disabled={!writable} value={t.status} onChange={(e) => patch({ status: e.target.value })} className="w-auto min-w-40 font-semibold" style={{ color: status?.color, borderColor: status?.color }}>
              {TASK_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
            {t.status !== 'done' && writable && <Button variant="primary" icon={<Check className="size-4" />} onClick={() => patch({ status: t.status === 'review' || t.author_id === user!.id ? 'done' : 'review' }, 'Готово')}>
              {t.author_id === user!.id || t.status === 'review' ? 'Завершить' : 'Сдать на проверку'}</Button>}
            <div className="ml-auto flex items-center gap-2 rounded-xl border border-line bg-surface px-2 py-1">
              <IconButton label={running ? 'Остановить таймер' : 'Запустить таймер'} onClick={toggleTimer} className={cx('size-8', running && 'text-accent')}>{running ? <Pause className="size-4" /> : <Play className="size-4" />}</IconButton>
              <span className="pr-2 text-sm tabular text-muted">{minutes(spentMin)}{t.estimate_hours ? ` / ${minutes(t.estimate_hours * 60)}` : ''}</span>
            </div>
          </div>

          <Card>
            {editDesc !== null ? (
              <div className="space-y-2">
                <RichText value={editDesc} onChange={setEditDesc} minHeight={140} />
                <div className="flex gap-2"><Button size="sm" variant="primary" onClick={async () => { await patch({ description: editDesc }); setEditDesc(null); }}>Сохранить</Button><Button size="sm" onClick={() => setEditDesc(null)}>Отмена</Button></div>
              </div>
            ) : (
              <button type="button" disabled={!writable} onClick={() => setEditDesc(t.description ?? '')} className="block w-full rounded-lg text-left hover:bg-surface-2/60">
                {t.description ? (/<\w/.test(t.description) ? <SafeHtml html={t.description} /> : <p className="whitespace-pre-line text-sm">{t.description}</p>) : <p className="text-sm text-faint">Добавить описание…</p>}
              </button>
            )}
          </Card>
          <Checklist taskId={tid} writable={writable} />
          <Subtasks task={t} onAdd={() => setSub({ parent_id: tid, project_id: t.project_id, assignee_id: user!.id })} />
          <Links task={t} writable={writable} />
          <div>
            <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: 'comments', label: 'Комментарии и история' }, { value: 'time', label: 'Затраченное время' }, { value: 'files', label: 'Файлы' }]} />
            {tab === 'comments' && <Timeline entity="tasks" id={tid} />}
            {tab === 'time' && <TaskTime taskId={tid} />}
            {tab === 'files' && <FilesBlock entityType="tasks" entityId={tid} />}
          </div>
        </div>

        <aside className="space-y-4 border-line p-4 sm:p-6 xl:border-l xl:bg-surface">
          {dl.tone === 'danger' && <div className="flex items-center justify-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger"><AlertTriangle className="size-4" />Задача просрочена</div>}
          <div>
            <div className="mb-1 flex justify-between text-sm"><span className="text-muted">Прогресс</span><span className="font-semibold tabular">{t.progress ?? 0}%</span></div>
            <Progress value={t.progress ?? 0} className="h-2" />
          </div>
          <FieldsPanel entity="tasks" item={t} fields={['start_date', 'deadline', 'priority', 'author_id', 'assignee_id', 'helpers', 'watchers', 'list_id', 'project_id', 'parent_id', 'deal_id', 'company_id', 'milestone_id', 'sprint_id', 'story_points', 'estimate_hours', 'repeat', 'progress', 'tags']} />
          <dl className="space-y-2 border-t border-line pt-3 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted">Просмотрено исполнителем</dt><dd>{t.viewed_at ? dateTime(t.viewed_at) : <span className="text-faint">ещё нет</span>}</dd></div>
            {t._ref?.template_id && <div className="flex justify-between gap-3"><dt className="text-muted">Шаблон</dt><dd className="truncate">{t._ref.template_id.title}</dd></div>}
            <div className="flex justify-between gap-3"><dt className="text-muted">ID задачи</dt><dd className="tabular">{t.id}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Создана</dt><dd>{relative(t.created_at)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Изменена</dt><dd>{relative(t.updated_at)}</dd></div>
          </dl>
          <div className="space-y-3 border-t border-line pt-3">
            <p className="font-bold">Выплата</p>
            <Switch checked={!!t.bill_customer} disabled={!writable} onChange={(v) => patch({ bill_customer: v ? 1 : 0 })} label="Оплачивается заказчиком" />
            {!!t.bill_customer && (
              <>
                <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted">Учитывать</span>
                  <Select value={t.bill_by ?? 'fact'} disabled={!writable} onChange={(e) => patch({ bill_by: e.target.value })} className="h-8 w-auto"><option value="fact">Фактическое время</option><option value="plan">Плановое время</option></Select></div>
                <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted">Стоимость часа</span>
                  <Input type="number" defaultValue={t.hour_price ?? ''} disabled={!writable} onBlur={(e) => Number(e.target.value) !== t.hour_price && patch({ hour_price: Number(e.target.value) })} className="h-8 w-32 text-right" /></div>
                <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted">К оплате</span><span className="font-bold tabular">{money(Math.round(pay))}</span></div>
              </>
            )}
          </div>
        </aside>
      </div>
      <RecordForm entity="tasks" open={!!sub} onClose={() => setSub(null)} initial={sub} title="Новая подзадача" fields={['title', 'assignee_id', 'deadline', 'priority', 'description']} />
    </div>
  );
}

export default function TaskPage() {
  return null;
}

function Checklist({ taskId, writable }: { taskId: number; writable: boolean }) {
  const { data } = useList('checklist_items', { task_id: taskId, limit: 200, sort: 'sort', dir: 'asc' });
  const inv = useInvalidate();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const items = data?.items ?? [];
  const done = items.filter((i: any) => i.done).length;
  const add = async () => {
    if (!text.trim()) return;
    await api.post('/api/e/checklist_items', { task_id: taskId, text, sort: items.length });
    setText('');
    inv('checklist_items', 'tasks');
  };
  if (!items.length && !open) return writable ? <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-primary hover:underline">Добавить чек-лист</button> : null;
  return (
    <Card title="Чек-лист" subtitle={items.length ? `Выполнено ${done} из ${items.length}` : undefined}>
      <ul className="space-y-1">
        {items.map((i: any) => (
          <li key={i.id} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface-2">
            <Checkbox checked={!!i.done} onChange={async (v) => { await api.patch(`/api/e/checklist_items/${i.id}`, { done: v ? 1 : 0 }); inv('checklist_items', 'tasks'); }} label={<span className={cx(i.done && 'text-muted line-through')}>{i.text}</span>} />
            {writable && <button type="button" aria-label="Удалить пункт" className="ml-auto opacity-0 group-hover:opacity-100" onClick={async () => { await api.del(`/api/e/checklist_items/${i.id}`); inv('checklist_items', 'tasks'); }}><Trash2 className="size-3.5 text-faint hover:text-danger" /></button>}
          </li>
        ))}
      </ul>
      {writable && (
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Новый пункт" autoFocus={open && !items.length} />
          <Button type="submit" icon={<Plus className="size-4" />}>Добавить</Button>
        </form>
      )}
    </Card>
  );
}

function Subtasks({ task, onAdd }: { task: any; onAdd: () => void }) {
  const { data } = useList('tasks', { parent_id: task.id, limit: 100 });
  const items = data?.items ?? [];
  if (!items.length) return <button type="button" onClick={onAdd} className="block text-sm font-semibold text-primary hover:underline">Добавить подзадачу</button>;
  return (
    <Card title="Подзадачи" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={onAdd}>Подзадача</Button>} padded={false}>
      <ul className="divide-y divide-line">
        {items.map((s: any) => (
          <li key={s.id}>
            <Link to={`/tasks/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">
              {s.status === 'done' ? <Check className="size-4 text-success" /> : <span className="size-4 rounded-[4px] border-2 border-line-strong" />}
              <span className={cx('flex-1 truncate', s.status === 'done' && 'text-muted line-through')}>{s.title}</span>
              <span className="text-xs text-muted">{s._ref?.assignee_id?.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Links({ task, writable }: { task: any; writable: boolean }) {
  const { data } = useList('task_links', { task_id: task.id, limit: 50 });
  const inv = useInvalidate();
  const toast = useToast();
  const [dep, setDep] = useState<number | null>(null);
  const [kind, setKind] = useState('fs');
  const [lag, setLag] = useState('0');
  const items = data?.items ?? [];
  const add = async () => {
    if (!dep) return;
    if (dep === task.id) return toast.error('Задача не может зависеть от самой себя');
    try { await api.post('/api/e/task_links', { task_id: task.id, depends_on_id: dep, kind, lag_days: Number(lag) || 0 }); setDep(null); setLag('0'); inv('task_links'); }
    catch (e) { toast.error(e); }
  };
  return (
    <Card title={<span className="flex items-center gap-2">Связи <span className="text-sm font-normal text-faint">{items.length}</span></span>}>
      {writable && (
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="min-w-56 flex-1"><RefSelect entity="tasks" value={dep} onChange={setDep} placeholder="Выберите задачу из существующих" filter={task.project_id ? { project_id: task.project_id } : undefined} /></div>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto">{LINK_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select>
          <Input type="number" value={lag} onChange={(e) => setLag(e.target.value)} className="w-24" aria-label="Сдвиг в днях" title="Сдвиг, дней" />
          <Button variant="primary" onClick={add} disabled={!dep} aria-label="Добавить связь"><Check className="size-4" /></Button>
        </div>
      )}
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((l: any) => (
            <li key={l.id} className="group flex items-center gap-3 rounded-lg px-1 py-1 text-sm hover:bg-surface-2">
              <Badge color="#0b8a7a">{LINK_KINDS.find((k) => k.value === l.kind)?.label}</Badge>
              <Link to={`/tasks/${l.depends_on_id}`} className="min-w-0 flex-1 truncate font-semibold hover:text-primary">{l._ref?.depends_on_id?.title}</Link>
              {l.lag_days ? <span className="text-xs text-muted">{l.lag_days > 0 ? '+' : ''}{l.lag_days} дн.</span> : null}
              {writable && <button type="button" aria-label="Удалить связь" className="opacity-0 group-hover:opacity-100" onClick={async () => { await api.del(`/api/e/task_links/${l.id}`); inv('task_links'); }}><Trash2 className="size-3.5 text-faint hover:text-danger" /></button>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-faint">Связей нет. Укажите, после какой задачи можно начинать эту.</p>}
    </Card>
  );
}

function TaskTime({ taskId }: { taskId: number }) {
  const { data } = useList('time_entries', { task_id: taskId, limit: 200 });
  const inv = useInvalidate();
  const toast = useToast();
  const [m, setM] = useState('');
  const items = data?.items ?? [];
  const total = items.reduce((s: number, e: any) => s + (e.minutes ?? 0), 0);
  const add = async () => {
    const mm = Math.round(Number(m.replace(',', '.')) * 60);
    if (!(mm > 0)) return toast.error('Укажите время в часах, например 1,5');
    await api.post('/api/e/time_entries', { task_id: taskId, minutes: mm, comment: 'Ручной ввод' });
    setM('');
    inv('time_entries');
  };
  return (
    <Card title={`Затрачено: ${minutes(total)}`}>
      <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Input value={m} onChange={(e) => setM(e.target.value)} placeholder="Часов, например 1,5" inputMode="decimal" className="max-w-48" />
        <Button type="submit">Добавить время</Button>
      </form>
      <ul className="divide-y divide-line text-sm">
        {items.map((e: any) => (
          <li key={e.id} className="flex items-center justify-between py-2">
            <span>{e._ref?.user_id?.title} <span className="text-muted">· {e.date}</span></span>
            <span className="font-semibold tabular">{e.is_running ? 'идёт…' : minutes(e.minutes)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export { PRIORITY };
