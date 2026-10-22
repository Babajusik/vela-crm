import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, CheckCircle2, Clock, Pause, Play, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { api } from '../api.ts';
import { TASK_STATUS } from '../../core/schema.ts';
import { deadlineInfo, minutes, relative } from '../lib/format.ts';
import { useApi, useAuth, useInvalidate, useList, useRecord } from '../lib/state.tsx';
import { Badge, Button, Card, Checkbox, EmptyState, IconButton, Input, Loading, Tabs, cx, useToast } from '../ui/ui.tsx';
import { FieldsPanel, Timeline } from '../ui/data.tsx';
import { RecordForm, RichText, SafeHtml } from '../ui/fields.tsx';
import { FilesBlock } from './Files.tsx';

export default function TaskPage() {
  const { id } = useParams();
  const tid = Number(id);
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const { user, can } = useAuth();
  const { data: t, isLoading, error } = useRecord('tasks', tid);
  const [tab, setTab] = useState<'comments' | 'time' | 'files'>('comments');
  const [editDesc, setEditDesc] = useState<string | null>(null);
  const [sub, setSub] = useState<any>(null);
  const timer = useApi<any>(['time', 'running'], '/api/time/running');
  if (isLoading) return <Loading />;
  if (error || !t) return <EmptyState title="Задача не найдена" action={<Button onClick={() => nav('/tasks')}>К задачам</Button>} />;
  const status = TASK_STATUS.find((s) => s.value === t.status);
  const dl = deadlineInfo(t.deadline, t.status === 'done');
  const writable = can('tasks', 'write');
  const setStatus = async (s: string) => {
    try { await api.patch(`/api/e/tasks/${tid}`, { status: s }); inv('tasks'); toast.success(s === 'done' ? 'Задача завершена' : 'Статус изменён'); }
    catch (e) { toast.error(e); }
  };
  const running = timer.data && timer.data.task_id === tid;
  const toggleTimer = async () => {
    try {
      if (running) await api.post('/api/time/stop');
      else await api.post('/api/time/start', { task_id: tid });
      inv('time_entries', 'tasks');
    } catch (e) { toast.error(e); }
  };
  const remove = async () => {
    if (!(await toast.confirm({ title: 'Удалить задачу?', danger: true, ok: 'Удалить' }))) return;
    await api.del(`/api/e/tasks/${tid}`);
    inv('tasks');
    nav('/tasks');
  };
  return (
    <div>
      <Link to="/tasks" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" />Задачи</Link>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge color={status?.color} dot>{status?.label}</Badge>
                  <span className={cx('text-sm font-semibold', dl.tone === 'danger' ? 'text-danger' : dl.tone === 'warning' ? 'text-warning' : 'text-muted')}>{dl.text}</span>
                  {t.repeat && t.repeat !== 'none' && <Badge color="#6366F1"><RotateCcw className="size-3" />повторяется</Badge>}
                </div>
                <h1 className={cx('text-xl font-extrabold leading-snug tracking-tight sm:text-2xl', t.status === 'done' && 'text-muted line-through')}>{t.title}</h1>
              </div>
              {writable && <IconButton label="Удалить задачу" onClick={remove}><Trash2 className="size-4" /></IconButton>}
            </div>
            {writable && (
              <div className="mt-4 flex flex-wrap gap-2">
                {t.status === 'new' && <Button variant="primary" icon={<Play className="size-4" />} onClick={() => setStatus('in_progress')}>Начать</Button>}
                {t.status === 'in_progress' && <Button icon={<Send className="size-4" />} onClick={() => setStatus('review')}>На проверку</Button>}
                {t.status !== 'done' && <Button variant={t.status === 'review' ? 'primary' : 'secondary'} icon={<CheckCircle2 className="size-4" />} onClick={() => setStatus('done')}>Завершить</Button>}
                {t.status === 'done' && <Button icon={<RotateCcw className="size-4" />} onClick={() => setStatus('in_progress')}>Вернуть в работу</Button>}
                {t.status !== 'done' && <Button variant={running ? 'accent' : 'ghost'} icon={running ? <Pause className="size-4" /> : <Clock className="size-4" />} onClick={toggleTimer}>{running ? 'Остановить таймер' : 'Засечь время'}</Button>}
              </div>
            )}
            <div className="mt-5 border-t border-line pt-4">
              {editDesc !== null ? (
                <div className="space-y-2">
                  <RichText value={editDesc} onChange={setEditDesc} minHeight={140} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" onClick={async () => { await api.patch(`/api/e/tasks/${tid}`, { description: editDesc }); inv('tasks'); setEditDesc(null); }}>Сохранить</Button>
                    <Button size="sm" onClick={() => setEditDesc(null)}>Отмена</Button>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={!writable} onClick={() => setEditDesc(t.description ?? '')} className="block w-full rounded-lg text-left hover:bg-surface-2/60">
                  {t.description ? (/<\w/.test(t.description) ? <SafeHtml html={t.description} /> : <p className="whitespace-pre-line text-sm">{t.description}</p>) : <p className="text-sm text-faint">Добавить описание…</p>}
                </button>
              )}
            </div>
          </Card>
          <Checklist taskId={tid} writable={writable} />
          <Subtasks task={t} onAdd={() => setSub({ parent_id: tid, project_id: t.project_id, assignee_id: user!.id })} />
          <div>
            <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: 'comments', label: 'Комментарии и история' }, { value: 'time', label: 'Учёт времени' }, { value: 'files', label: 'Файлы' }]} />
            {tab === 'comments' && <Timeline entity="tasks" id={tid} />}
            {tab === 'time' && <TaskTime taskId={tid} />}
            {tab === 'files' && <FilesBlock entityType="tasks" entityId={tid} />}
          </div>
        </div>
        <aside className="space-y-5">
          <Card title="Параметры">
            <FieldsPanel entity="tasks" item={t} fields={['assignee_id', 'author_id', 'watchers', 'deadline', 'start_date', 'priority', 'status', 'project_id', 'parent_id', 'deal_id', 'company_id', 'milestone_id', 'sprint_id', 'story_points', 'estimate_hours', 'repeat', 'tags']} />
          </Card>
          <p className="px-1 text-xs text-faint">Создана {relative(t.created_at)}{t.completed_at && ` · завершена ${relative(t.completed_at)}`}</p>
        </aside>
      </div>
      <RecordForm entity="tasks" open={!!sub} onClose={() => setSub(null)} initial={sub} title="Новая подзадача" fields={['title', 'assignee_id', 'deadline', 'priority', 'description']} />
    </div>
  );
}

function Checklist({ taskId, writable }: { taskId: number; writable: boolean }) {
  const { data } = useList('checklist_items', { task_id: taskId, limit: 200, sort: 'sort', dir: 'asc' });
  const inv = useInvalidate();
  const [text, setText] = useState('');
  const items = data?.items ?? [];
  const done = items.filter((i: any) => i.done).length;
  const add = async () => {
    if (!text.trim()) return;
    await api.post('/api/e/checklist_items', { task_id: taskId, text, sort: items.length });
    setText('');
    inv('checklist_items');
  };
  return (
    <Card title="Чек-лист" subtitle={items.length ? `Выполнено ${done} из ${items.length}` : undefined}>
      <ul className="space-y-1">
        {items.map((i: any) => (
          <li key={i.id} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface-2">
            <Checkbox checked={!!i.done} onChange={async (v) => { await api.patch(`/api/e/checklist_items/${i.id}`, { done: v ? 1 : 0 }); inv('checklist_items'); }} label={<span className={cx(i.done && 'text-muted line-through')}>{i.text}</span>} />
            {writable && <button type="button" aria-label="Удалить пункт" className="ml-auto opacity-0 group-hover:opacity-100" onClick={async () => { await api.del(`/api/e/checklist_items/${i.id}`); inv('checklist_items'); }}><Trash2 className="size-3.5 text-faint hover:text-danger" /></button>}
          </li>
        ))}
      </ul>
      {writable && (
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Новый пункт" />
          <Button type="submit" icon={<Plus className="size-4" />}>Добавить</Button>
        </form>
      )}
    </Card>
  );
}

function Subtasks({ task, onAdd }: { task: any; onAdd: () => void }) {
  const { data } = useList('tasks', { parent_id: task.id, limit: 100 });
  const items = data?.items ?? [];
  return (
    <Card title="Подзадачи" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={onAdd}>Подзадача</Button>} padded={!items.length}>
      {items.length ? (
        <ul className="divide-y divide-line">
          {items.map((s: any) => (
            <li key={s.id}>
              <Link to={`/tasks/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">
                {s.status === 'done' ? <Check className="size-4 text-success" /> : <span className="size-4 rounded-full border-2 border-line-strong" />}
                <span className={cx('flex-1 truncate', s.status === 'done' && 'text-muted line-through')}>{s.title}</span>
                <span className="text-xs text-muted">{s._ref?.assignee_id?.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-faint">Разбейте большую задачу на шаги.</p>}
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
