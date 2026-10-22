import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarRange, LayoutGrid, List as ListIcon, Plus } from 'lucide-react';
import { compactMoney, date } from '../lib/format.ts';
import { useApi, useAuth, useList, useMeta } from '../lib/state.tsx';
import { AvatarStack, Badge, Button, Card, EmptyState, Loading, PageHeader, Progress, Segmented, Select, cx } from '../ui/ui.tsx';
import { EntityList } from '../ui/data.tsx';
import { RecordForm } from '../ui/fields.tsx';

export default function Projects() {
  const { can, user } = useAuth();
  const { field } = useMeta();
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const [status, setStatus] = useState('active');
  const [create, setCreate] = useState(false);
  const { data, isLoading } = useList('projects', { limit: 200, status: status || undefined });
  const ids = (data?.items ?? []).map((p: any) => p.id).join(',');
  const stats = useApi<Record<string, any>>(['stats', 'projects'], '/api/projects/stats', { ids }, { enabled: !!ids }).data ?? {};
  const statusOpts = field('projects', 'status')?.options ?? [];
  return (
    <div>
      <PageHeader title="Проекты" subtitle="Сроки, бюджет и загрузка команды"
        actions={<>
          <Segmented value={view} onChange={setView} options={[{ value: 'cards', label: 'Карточки', icon: <LayoutGrid className="size-4" /> }, { value: 'list', label: 'Список', icon: <ListIcon className="size-4" /> }]} />
          {can('projects', 'write') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreate(true)}>Проект</Button>}
        </>} />
      {view === 'list' ? (
        <EntityList entity="projects" rowLink={(r) => `/projects/${r.id}`} createLabel="Проект" defaults={{ manager_id: user!.id, status: 'planning' }}
          filters={[{ key: 'status', label: 'Статус', options: statusOpts }, { key: 'manager_id', label: 'Руководитель', type: 'user' }]}
          columns={['name', 'code', 'status', 'manager_id', 'company_id', 'start_date', 'end_date', 'budget']} />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto"><option value="">Все статусы</option>{statusOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          </div>
          {isLoading ? <Loading /> : !data?.items.length ? <EmptyState title="Проектов нет" text="Создайте проект вручную или запустите его из выигранной сделки." /> : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.items.map((p: any) => {
                const s = stats[p.id];
                const st = statusOpts.find((o) => o.value === p.status);
                const late = p.end_date && p.end_date < new Date().toISOString().slice(0, 10) && !['done', 'cancelled'].includes(p.status);
                return (
                  <Link key={p.id} to={`/projects/${p.id}`} className="group rounded-xl border border-line bg-surface p-4 transition hover:border-line-strong hover:shadow-md">
                    <div className="flex items-start gap-3">
                      <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: p.color }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold group-hover:text-primary">{p.name}</p>
                        <p className="truncate text-xs text-muted">{[p.code, p._ref?.company_id?.title].filter(Boolean).join(' · ') || 'Внутренний проект'}</p>
                      </div>
                      <Badge color={st?.color}>{st?.label}</Badge>
                    </div>
                    <div className="mt-4">
                      <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted">Задачи: {s?.tasks_done ?? 0} из {s?.tasks_total ?? 0}</span><span className="font-bold tabular">{s?.progress ?? 0}%</span></div>
                      <Progress value={s?.progress ?? 0} color={p.color} />
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                      <div><p className="text-faint">Бюджет</p><p className="font-bold tabular">{compactMoney(p.budget)}</p></div>
                      <div><p className="text-faint">Прибыль</p><p className={cx('font-bold tabular', (s?.profit ?? 0) < 0 ? 'text-danger' : 'text-success')}>{s ? compactMoney(s.profit) : '—'}</p></div>
                      <div><p className="text-faint">Просрочено</p><p className={cx('font-bold tabular', s?.tasks_overdue ? 'text-danger' : '')}>{s?.tasks_overdue ?? 0}</p></div>
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                      <AvatarStack users={p._ref?.members ?? []} size={24} />
                      <span className={cx('flex items-center gap-1 text-xs', late ? 'font-semibold text-danger' : 'text-muted')}><CalendarRange className="size-3.5" />до {date(p.end_date)}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
      <RecordForm entity="projects" open={create} onClose={() => setCreate(false)} initial={{ manager_id: user!.id, status: 'planning', members: [user!.id] }} />
    </div>
  );
}
