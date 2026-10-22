import { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { api } from '../api.ts';
import { addDaysIso, minutes, money, todayIso } from '../lib/format.ts';
import { useApi, useAuth, useInvalidate } from '../lib/state.tsx';
import { Button, Card, FormRow, Input, Loading, PageHeader, Segmented, Stat, useToast } from '../ui/ui.tsx';
import { EntityList } from '../ui/data.tsx';
import { RefSelect } from '../ui/fields.tsx';
import { MoneyBars } from '../ui/charts.tsx';

export default function Time() {
  const { user, can } = useAuth();
  const toast = useToast();
  const inv = useInvalidate();
  const running = useApi<any>(['time', 'running'], '/api/time/running').data;
  const [task, setTask] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [group, setGroup] = useState<'user' | 'project' | 'task'>('user');
  const [range, setRange] = useState({ from: addDaysIso(todayIso(), -30), to: todayIso() });
  const report = useApi<any>(['time', 'report'], '/api/time/report', { ...range, group });
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 10000); return () => clearInterval(t); }, []);
  const start = async () => {
    try { await api.post('/api/time/start', { task_id: task ?? undefined, comment }); inv('time_entries', 'tasks'); setComment(''); }
    catch (e) { toast.error(e); }
  };
  const stop = async () => { await api.post('/api/time/stop'); inv('time_entries'); };
  const elapsed = running ? Math.round((Date.now() - new Date(running.started_at).getTime()) / 60000) : 0;
  const r = report.data;
  const total = (r?.rows ?? []).reduce((s: number, x: any) => s + x.minutes, 0);
  const billable = (r?.rows ?? []).reduce((s: number, x: any) => s + x.billable, 0);
  const cost = (r?.rows ?? []).reduce((s: number, x: any) => s + x.cost, 0);
  return (
    <div>
      <PageHeader title="Тайм-трекер" subtitle="Учёт рабочего времени по задачам и проектам" />
      <Card className="mb-5">
        {running ? (
          <div className="flex flex-wrap items-center gap-4">
            <span className="relative flex size-3"><span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" /><span className="relative inline-flex size-3 rounded-full bg-accent" /></span>
            <div className="min-w-0 flex-1"><p className="font-bold">{running.task_title || running.comment || 'Без задачи'}</p><p className="text-sm text-muted">Идёт {minutes(elapsed)}</p></div>
            <Button variant="accent" icon={<Pause className="size-4" />} onClick={stop}>Остановить</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <FormRow label="Задача" className="min-w-64 flex-1"><RefSelect entity="tasks" value={task} onChange={setTask} filter={{ assignee_id: user!.id, status__ne: 'done' }} placeholder="Выберите задачу (необязательно)" /></FormRow>
            <FormRow label="Чем занимаетесь" className="min-w-64 flex-1"><Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: созвон с клиентом" /></FormRow>
            <Button variant="primary" icon={<Play className="size-4" />} onClick={start}>Старт</Button>
          </div>
        )}
      </Card>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormRow label="С"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></FormRow>
        <FormRow label="По"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></FormRow>
        <Segmented value={group} onChange={setGroup} options={[{ value: 'user', label: 'По сотрудникам' }, { value: 'project', label: 'По проектам' }, { value: 'task', label: 'По задачам' }]} />
      </div>
      {!r ? <Loading /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Всего учтено" value={minutes(total)} tone="primary" />
            <Stat label="Оплачиваемое время" value={minutes(billable)} sub={total ? `${Math.round((billable / total) * 100)}% от всего` : undefined} tone="success" />
            {can('finance') && <Stat label="Себестоимость часов" value={money(cost)} tone="accent" />}
          </div>
          <Card title="Часы по дням"><MoneyBars data={(r.byDay ?? []).map((d: any) => ({ day: d.date.slice(8) + '.' + d.date.slice(5, 7), hours: Math.round((d.minutes / 60) * 10) / 10 }))} xKey="day" keys={[{ key: 'hours', label: 'Часы', color: '#12A994' }]} height={200} /></Card>
          <Card padded={false} title="Сводка">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs font-bold uppercase tracking-wide text-faint"><th className="px-4 py-2.5">{group === 'user' ? 'Сотрудник' : group === 'project' ? 'Проект' : 'Задача'}</th><th className="px-4 py-2.5 text-right">Время</th><th className="px-4 py-2.5 text-right">Оплачиваемое</th>{can('finance') && <th className="px-4 py-2.5 text-right">Себестоимость</th>}</tr></thead>
              <tbody>{r.rows.map((x: any) => <tr key={x.key_id ?? x.label} className="border-t border-line"><td className="px-4 py-2.5 font-semibold">{x.label}</td><td className="px-4 py-2.5 text-right tabular">{minutes(x.minutes)}</td><td className="px-4 py-2.5 text-right tabular">{minutes(x.billable)}</td>{can('finance') && <td className="px-4 py-2.5 text-right tabular">{money(x.cost)}</td>}</tr>)}</tbody>
            </table>
          </Card>
          <EntityList entity="time_entries" baseParams={{ user_id: user!.id }} defaults={{ user_id: user!.id, date: todayIso(), billable: 1 }} createLabel="Запись вручную"
            header={<div className="border-b border-line px-4 py-3 font-bold">Мои записи</div>}
            columns={['date', 'task_id', 'project_id', { key: 'minutes', label: 'Время', render: (x: any) => x.is_running ? 'идёт…' : minutes(x.minutes) }, 'comment', 'billable']}
            formFields={['date', 'task_id', 'project_id', 'minutes', 'comment', 'billable']} />
        </div>
      )}
    </div>
  );
}
