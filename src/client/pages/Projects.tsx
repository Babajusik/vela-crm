import { Fragment, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, Download, Layers, Plus, Search, Settings } from 'lucide-react';
import { api, saveText } from '../api.ts';
import { addDaysIso, compactMoney, date, money, parseDate, todayIso } from '../lib/format.ts';
import { useApi, useAuth, useInvalidate, useList, useMeta } from '../lib/state.tsx';
import { AvatarStack, Badge, Button, Card, EmptyState, FormRow, IconButton, Input, Loading, MenuItem, Modal, PageHeader, Popover, Select, cx, useToast } from '../ui/ui.tsx';
import { EntityList } from '../ui/data.tsx';
import { RecordForm, RefSelect, UserSelect } from '../ui/fields.tsx';
import { ModuleTabs } from '../layout/Layout.tsx';

type Tab = 'active' | 'gantt' | 'archive' | 'all';

export function StageBar({ stages, current }: { stages?: { name: string; status: string }[]; current?: string | null }) {
  if (!stages?.length) return <span className="text-xs text-faint">Этапы не заданы</span>;
  return (
    <div className="min-w-32">
      <div className="flex gap-0.5">{stages.map((s, i) => <span key={i} title={s.name} className={cx('h-1.5 flex-1 rounded-full', s.status === 'done' ? 'bg-primary' : s.status === 'active' ? 'bg-primary/50' : 'bg-line-strong')} />)}</div>
      <p className="mt-1 truncate text-[11px] text-muted">{current ?? 'Все этапы пройдены'}</p>
    </div>
  );
}

export default function Projects() {
  const { can, user } = useAuth();
  const { field } = useMeta();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'active';
  const group = sp.get('group') as 'template' | 'manager' | null;
  const [q, setQ] = useState('');
  const [create, setCreate] = useState(false);
  const [fromTpl, setFromTpl] = useState(false);
  const params: Record<string, any> = { limit: 500, q };
  if (tab === 'archive') params.is_archived = 1;
  else { params.is_archived__ne = 1; if (tab === 'active') params.status__in = 'planning,active,paused'; }
  const { data, isLoading } = useList('projects', params);
  const items = data?.items ?? [];
  const ids = items.map((p: any) => p.id).join(',');
  const stats = useApi<Record<string, any>>(['stats', 'projects', ids], '/api/projects/stats', { ids }, { enabled: !!ids }).data ?? {};
  const stages = useApi<Record<string, any>>(['stats', 'stages', ids], '/api/projects/stages', { ids }, { enabled: !!ids }).data ?? {};
  const statusOpts = field('projects', 'status')?.options ?? [];
  const groups = useMemo(() => {
    if (!group) return [{ key: 'all', title: '', rows: items }];
    const m = new Map<string, { key: string; title: string; rows: any[] }>();
    for (const p of items) {
      const k = group === 'manager' ? String(p.manager_id ?? 0) : String(p.template_id ?? 0);
      const title = group === 'manager' ? (p._ref?.manager_id?.title ?? 'Без руководителя') : (p._ref?.template_id?.title ?? 'Без шаблона');
      if (!m.has(k)) m.set(k, { key: k, title, rows: [] });
      m.get(k)!.rows.push(p);
    }
    return [...m.values()];
  }, [items, group]);
  const totals = items.reduce((a: any, p: any) => {
    const s = stats[p.id];
    return { planIn: a.planIn + (p.budget || 0), factIn: a.factIn + (s?.income || 0), planOut: a.planOut + (p.cost_budget || 0), factOut: a.factOut + (s?.expense || 0) + (s?.labor_cost || 0) };
  }, { planIn: 0, factIn: 0, planOut: 0, factOut: 0 });
  const exportCsv = () => {
    const rows = [['Проект', 'Заказчик', 'Этап', 'Начало', 'Окончание', 'Поступления (план)', 'Поступления (факт)', 'Списания (план)', 'Списания (факт)']];
    for (const p of items) { const s = stats[p.id]; rows.push([p.name, p._ref?.company_id?.title ?? '', stages[p.id]?.current ?? '', p.start_date ?? '', p.end_date ?? '', p.budget ?? 0, s?.income ?? 0, p.cost_budget ?? 0, (s?.expense ?? 0) + (s?.labor_cost ?? 0)]); }
    saveText('﻿' + rows.map((r) => r.join(';')).join('\r\n'), 'projects.csv', 'text/csv;charset=utf-8');
  };
  const title = group === 'manager' ? 'Проекты по менеджерам' : group === 'template' ? 'Проекты по шаблонам' : 'Список проектов';
  return (
    <div>
      <PageHeader title={title}
        tabs={<ModuleTabs tabs={[{ to: '/projects?tab=active', label: 'Активные проекты', default: true }, { to: '/projects?tab=gantt', label: 'Гант' }, { to: '/projects?tab=archive', label: 'В архиве' }, { to: '/projects?tab=all', label: 'Все проекты' }]} />}
        actions={can('projects', 'write') && <>
          <div className="flex">
            <Button variant="primary" className="rounded-r-none" icon={<Plus className="size-4" />} onClick={() => setCreate(true)}>Создать</Button>
            <Popover align="right" trigger={({ toggle }) => <Button variant="primary" className="rounded-l-none border-l border-white/25 px-2" onClick={toggle} aria-label="Ещё"><ChevronDown className="size-4" /></Button>}>
              {(close) => <div className="w-56"><MenuItem icon={<Layers className="size-4" />} onClick={() => { setFromTpl(true); close(); }}>Из шаблона</MenuItem></div>}
            </Popover>
          </div>
          <IconButton label="Настройки проектов" onClick={() => nav('/projects/templates')}><Settings className="size-5" /></IconButton>
        </>} />
      {tab === 'gantt' ? <ProjectsGantt items={items} stages={stages} loading={isLoading} /> : (
        <Card padded={false}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск" icon={<Search className="size-4" />} className="w-full sm:w-64" />
            <div className="ml-auto flex gap-1"><IconButton label="Выгрузить в Excel" onClick={exportCsv}><Download className="size-4" /></IconButton></div>
          </div>
          {isLoading ? <Loading /> : !items.length ? <EmptyState title="Проектов нет" text="Создайте проект вручную, из шаблона или запустите его из выигранной сделки." /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-sm">
                <thead><tr className="text-left text-xs font-semibold text-faint">
                  {['Проект', 'Этап', 'Начало', 'До дедлайна', 'Поступления (план)', 'Поступления (факт)', 'Списания (план)', 'Списания (факт)', 'Команда'].map((h, i) => (
                    <th key={h} className={cx('border-b border-line px-3 py-2.5', i >= 4 && i <= 7 && 'text-right')}>{h}</th>))}
                </tr></thead>
                <tbody>
                  {groups.map((g) => (
                    <Fragment key={g.key}>
                      {group && <tr><td colSpan={9} className="bg-surface-2 px-3 py-2 text-xs font-bold">{g.title} <span className="font-normal text-faint">· {g.rows.length}</span></td></tr>}
                      {g.rows.map((p: any) => {
                        const s = stats[p.id];
                        const left = p.end_date ? Math.ceil((parseDate(p.end_date)!.getTime() - Date.now()) / 864e5) : null;
                        const st = statusOpts.find((o) => o.value === p.status);
                        return (
                          <tr key={p.id} onClick={() => nav(`/projects/${p.id}`)} className="cursor-pointer hover:bg-surface-2">
                            <td className="border-b border-line px-3 py-2.5">
                              <span className="flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} /><span className="font-semibold">{p.name}</span>{p.status !== 'active' && <Badge color={st?.color}>{st?.label}</Badge>}</span>
                              <span className="ml-4.5 block text-xs text-muted">{p._ref?.company_id?.title ?? 'Внутренний проект'}</span>
                            </td>
                            <td className="border-b border-line px-3 py-2.5"><StageBar stages={stages[p.id]?.stages} current={stages[p.id]?.current} /></td>
                            <td className="whitespace-nowrap border-b border-line px-3 py-2.5">{date(p.start_date)}</td>
                            <td className={cx('whitespace-nowrap border-b border-line px-3 py-2.5 font-semibold', left == null ? 'text-faint' : left < 0 ? 'text-danger' : left <= 7 ? 'text-warning' : 'text-primary')}>
                              {left == null ? '—' : left < 0 ? `просрочен на ${-left} дн.` : `${left} дн.`}</td>
                            <td className="border-b border-line px-3 py-2.5 text-right tabular">{money(p.budget)}</td>
                            <td className="border-b border-line px-3 py-2.5 text-right tabular text-success">{money(s?.income ?? 0)}</td>
                            <td className="border-b border-line px-3 py-2.5 text-right tabular">{money(p.cost_budget)}</td>
                            <td className="border-b border-line px-3 py-2.5 text-right tabular">{money((s?.expense ?? 0) + (s?.labor_cost ?? 0))}</td>
                            <td className="border-b border-line px-3 py-2.5"><AvatarStack users={p._ref?.members ?? []} size={22} /></td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot><tr className="bg-surface-2/60 text-sm font-bold">
                  <td className="px-3 py-2.5" colSpan={4}>Итого по {items.length} проектам</td>
                  <td className="px-3 py-2.5 text-right tabular">{compactMoney(totals.planIn)}</td><td className="px-3 py-2.5 text-right tabular text-success">{compactMoney(totals.factIn)}</td>
                  <td className="px-3 py-2.5 text-right tabular">{compactMoney(totals.planOut)}</td><td className="px-3 py-2.5 text-right tabular">{compactMoney(totals.factOut)}</td><td />
                </tr></tfoot>
              </table>
            </div>
          )}
        </Card>
      )}
      <RecordForm entity="projects" open={create} onClose={() => setCreate(false)} initial={{ manager_id: user!.id, status: 'planning', members: [user!.id], start_date: todayIso() }} onSaved={(r) => nav(`/projects/${r.id}`)} />
      {fromTpl && <FromTemplate onClose={() => setFromTpl(false)} />}
    </div>
  );
}

function ProjectsGantt({ items, stages, loading }: { items: any[]; stages: Record<string, any>; loading: boolean }) {
  const nav = useNavigate();
  const withDates = items.filter((p) => p.start_date && p.end_date);
  const from = withDates.length ? addDaysIso(withDates.map((p) => p.start_date).sort()[0], -7) : addDaysIso(todayIso(), -14);
  const to = withDates.length ? addDaysIso(withDates.map((p) => p.end_date).sort().reverse()[0], 7) : addDaysIso(todayIso(), 60);
  const days = Math.min(400, Math.round((parseDate(to)!.getTime() - parseDate(from)!.getTime()) / 864e5) + 1);
  const W = 10;
  const idx = (d: string) => Math.round((parseDate(d)!.getTime() - parseDate(from)!.getTime()) / 864e5);
  const months: { label: string; left: number }[] = [];
  for (let k = 0; k < days; k++) { const d = parseDate(addDaysIso(from, k))!; if (d.getDate() === 1 || k === 0) months.push({ label: d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }), left: k * W }); }
  if (loading) return <Loading />;
  return (
    <Card padded={false} title="Гант проектов" subtitle="Сроки всех проектов на одной шкале">
      <div className="flex overflow-hidden">
        <div className="w-56 shrink-0 border-r border-line sm:w-72">
          <div className="h-9 border-b border-line" />
          {withDates.map((p) => <button key={p.id} type="button" onClick={() => nav(`/projects/${p.id}`)} className="block h-11 w-full truncate border-b border-line px-3 text-left text-sm font-semibold hover:bg-surface-2">{p.name}<span className="block truncate text-[11px] font-normal text-faint">{stages[p.id]?.current ?? ''}</span></button>)}
        </div>
        <div className="flex-1 overflow-x-auto">
          <div className="relative" style={{ width: days * W }}>
            <div className="relative h-9 border-b border-line">{months.map((m) => <span key={m.left} className="absolute top-2.5 border-l border-line pl-1 text-[11px] text-muted" style={{ left: m.left }}>{m.label}</span>)}</div>
            <div className="pointer-events-none absolute bottom-0 top-9 w-0.5 bg-accent/70" style={{ left: idx(todayIso()) * W }} />
            {withDates.map((p) => {
              const a = idx(p.start_date), b = idx(p.end_date);
              const st = stages[p.id]?.stages ?? [];
              const done = st.filter((s: any) => s.status === 'done').length;
              return (
                <div key={p.id} className="relative h-11 border-b border-line">
                  <div title={`${p.name}: ${date(p.start_date)} — ${date(p.end_date)}`} className="absolute top-2.5 h-6 overflow-hidden rounded-md" style={{ left: a * W, width: Math.max(8, (b - a + 1) * W), background: `${p.color}33`, border: `1px solid ${p.color}` }}>
                    <div className="h-full" style={{ width: st.length ? `${(done / st.length) * 100}%` : '0%', background: p.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function FromTemplate({ onClose }: { onClose: () => void }) {
  const { data } = useList('project_templates', { limit: 100 });
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const [f, setF] = useState<any>({ manager_id: user!.id, start_date: todayIso() });
  const run = async () => {
    try { const p = await api.post('/api/projects/from-template', { ...f, template_id: Number(f.template_id || data?.items[0]?.id) }); inv('projects', 'tasks'); onClose(); nav(`/projects/${p.id}`); }
    catch (e) { toast.error(e); }
  };
  return (
    <Modal open onClose={onClose} title="Проект из шаблона" subtitle="Этапы и задачи создадутся автоматически, сроки посчитаются от даты начала"
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={run} disabled={!data?.items.length}>Создать проект</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormRow label="Шаблон" className="sm:col-span-2"><Select value={f.template_id ?? ''} onChange={(e) => setF({ ...f, template_id: e.target.value })}>{(data?.items ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name} · {t.duration_days} дн.</option>)}</Select></FormRow>
        <FormRow label="Название проекта" className="sm:col-span-2"><Input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Как в шаблоне" /></FormRow>
        <FormRow label="Заказчик"><RefSelect entity="companies" value={f.company_id ?? null} onChange={(v) => setF({ ...f, company_id: v })} /></FormRow>
        <FormRow label="Руководитель"><UserSelect value={f.manager_id} onChange={(v) => setF({ ...f, manager_id: v })} /></FormRow>
        <FormRow label="Дата начала"><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></FormRow>
      </div>
    </Modal>
  );
}

export function Portfolios() {
  const { data, isLoading } = useList('portfolios', { limit: 100 });
  const projects = useList('projects', { limit: 500, is_archived__ne: 1 }).data?.items ?? [];
  const ids = projects.map((p: any) => p.id).join(',');
  const stats = useApi<Record<string, any>>(['stats', 'projects', ids], '/api/projects/stats', { ids }, { enabled: !!ids }).data ?? {};
  const [form, setForm] = useState<any>(null);
  const { can } = useAuth();
  return (
    <div>
      <PageHeader title="Портфели проектов" subtitle="Группы проектов с общей картиной по срокам и деньгам"
        actions={can('projects', 'write') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({})}>Портфель</Button>} />
      {isLoading ? <Loading /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(data?.items ?? []).map((pf: any) => {
            const list = projects.filter((p: any) => p.portfolio_id === pf.id);
            const income = list.reduce((s: number, p: any) => s + (stats[p.id]?.income ?? 0), 0);
            const budget = list.reduce((s: number, p: any) => s + (p.budget ?? 0), 0);
            const progress = list.length ? Math.round(list.reduce((s: number, p: any) => s + (stats[p.id]?.progress ?? 0), 0) / list.length) : 0;
            return (
              <Card key={pf.id} title={<span className="flex items-center gap-2"><span className="size-3 rounded-full" style={{ background: pf.color }} />{pf.name}</span>} subtitle={pf.description}
                actions={can('projects', 'write') && <Button size="sm" variant="ghost" onClick={() => setForm(pf)}>Изменить</Button>}>
                <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
                  <div><p className="text-xs text-faint">Проектов</p><p className="font-bold">{list.length}</p></div>
                  <div><p className="text-xs text-faint">Бюджет / получено</p><p className="font-bold tabular">{compactMoney(budget)} / {compactMoney(income)}</p></div>
                  <div><p className="text-xs text-faint">Средний прогресс</p><p className="font-bold">{progress}%</p></div>
                </div>
                <ul className="divide-y divide-line">{list.map((p: any) => (
                  <li key={p.id}><Link to={`/projects/${p.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-primary"><span className="truncate">{p.name}</span><span className="text-xs text-muted">{stats[p.id]?.progress ?? 0}%</span></Link></li>
                ))}{!list.length && <li className="py-2 text-sm text-faint">Проектов нет. Укажите портфель в карточке проекта.</li>}</ul>
              </Card>
            );
          })}
          {!data?.items.length && <EmptyState title="Портфелей нет" />}
        </div>
      )}
      <RecordForm entity="portfolios" open={!!form} onClose={() => setForm(null)} initial={form?.id ? form : null} size="md" />
    </div>
  );
}

export function ProjectTemplates() {
  const [edit, setEdit] = useState<any>(null);
  return (
    <div>
      <PageHeader title="Шаблоны проектов" subtitle="Типовые этапы и задачи: новый проект собирается за минуту" />
      <EntityList entity="project_templates" columns={['name', 'description', 'duration_days', { key: 'stages', label: 'Этапов', render: (r: any) => (r.stages ?? []).length }, { key: 'tasks', label: 'Задач', render: (r: any) => (r.tasks ?? []).length }]}
        onRowClick={setEdit} onCreate={() => setEdit({ name: '', duration_days: 30, stages: [{ name: 'Подготовка', days: 10 }, { name: 'Работа', days: 15 }, { name: 'Сдача', days: 5 }], tasks: [] })} createLabel="Шаблон" />
      {edit && <TemplateEditor tpl={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TemplateEditor({ tpl, onClose }: { tpl: any; onClose: () => void }) {
  const [t, setT] = useState<any>(tpl);
  const toast = useToast();
  const inv = useInvalidate();
  const stages: { name: string; days: number }[] = t.stages ?? [];
  const tasks: { title: string; offset_days: number; duration_days: number }[] = t.tasks ?? [];
  const save = async () => {
    try {
      const d = { name: t.name, description: t.description, duration_days: Number(t.duration_days) || stages.reduce((s, x) => s + (x.days || 0), 0), stages, tasks };
      if (t.id) await api.patch(`/api/e/project_templates/${t.id}`, d); else await api.post('/api/e/project_templates', d);
      inv('project_templates');
      onClose();
    } catch (e) { toast.error(e); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={t.id ? 'Шаблон проекта' : 'Новый шаблон проекта'}
      footer={<>{t.id && <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { await api.del(`/api/e/project_templates/${t.id}`); inv('project_templates'); onClose(); }}>Удалить</Button>}<Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <FormRow label="Название"><Input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></FormRow>
          <FormRow label="Длительность, дней"><Input type="number" value={t.duration_days ?? 30} onChange={(e) => setT({ ...t, duration_days: e.target.value })} /></FormRow>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-semibold text-muted">Этапы</p>
          {stages.map((s, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <Input value={s.name} onChange={(e) => setT({ ...t, stages: stages.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <Input type="number" className="w-28" value={s.days} onChange={(e) => setT({ ...t, stages: stages.map((x, j) => (j === i ? { ...x, days: Number(e.target.value) } : x)) })} aria-label="Дней" />
              <Button variant="ghost" onClick={() => setT({ ...t, stages: stages.filter((_, j) => j !== i) })}>Убрать</Button>
            </div>
          ))}
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setT({ ...t, stages: [...stages, { name: 'Новый этап', days: 5 }] })}>Этап</Button>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-semibold text-muted">Задачи (смещение от старта и длительность в днях)</p>
          {tasks.map((s, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <Input value={s.title} onChange={(e) => setT({ ...t, tasks: tasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
              <Input type="number" className="w-24" value={s.offset_days} title="Начать через, дней" onChange={(e) => setT({ ...t, tasks: tasks.map((x, j) => (j === i ? { ...x, offset_days: Number(e.target.value) } : x)) })} />
              <Input type="number" className="w-24" value={s.duration_days} title="Длительность, дней" onChange={(e) => setT({ ...t, tasks: tasks.map((x, j) => (j === i ? { ...x, duration_days: Number(e.target.value) } : x)) })} />
              <Button variant="ghost" onClick={() => setT({ ...t, tasks: tasks.filter((_, j) => j !== i) })}>Убрать</Button>
            </div>
          ))}
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setT({ ...t, tasks: [...tasks, { title: 'Новая задача', offset_days: 0, duration_days: 3 }] })}>Задача</Button>
        </div>
      </div>
    </Modal>
  );
}
