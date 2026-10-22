import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Check, Plus, Search, UserRound } from 'lucide-react';
import { api } from '../../api.ts';
import { SOURCES } from '../../../core/schema.ts';
import { compactMoney, deadlineInfo, money, nowLocalDateTime, todayIso } from '../../lib/format.ts';
import { useApi, useAuth, useInvalidate, useList } from '../../lib/state.tsx';
import { Avatar, Badge, Button, Card, EmptyState, FormRow, Input, Loading, Segmented, Select, Stat, cx, useToast } from '../../ui/ui.tsx';
import { RecordForm } from '../../ui/fields.tsx';
import { Donut, MoneyBars, PALETTE, SERIES } from '../../ui/charts.tsx';
import { CrmHeader } from './Crm.tsx';
import { LOST_REASONS } from './Deals.tsx';

const KIND: Record<string, [string, string]> = { call: ['Звонок', '#0ea5e9'], meeting: ['Встреча', '#a855f7'], task: ['Задача', '#f59e0b'], email: ['Письмо', '#64748b'], letter: ['Документы', '#10b981'] };

export function Activities() {
  const { user } = useAuth();
  const toast = useToast();
  const inv = useInvalidate();
  const [tab, setTab] = useState<'today' | 'overdue' | 'upcoming' | 'done'>('today');
  const [mine, setMine] = useState(true);
  const [form, setForm] = useState<any>(null);
  const now = nowLocalDateTime();
  const t = todayIso();
  const params: Record<string, any> = { limit: 500, sort: 'due_at', dir: tab === 'done' ? 'desc' : 'asc', responsible_id: mine ? user!.id : undefined };
  if (tab === 'done') params.is_done = 1;
  else {
    params.is_done = 0;
    if (tab === 'today') { params.due_at__gte = `${t}T00:00`; params.due_at__lte = `${t}T23:59`; }
    if (tab === 'overdue') params.due_at__lt = now;
    if (tab === 'upcoming') params.due_at__gt = `${t}T23:59`;
  }
  const { data, isLoading } = useList('crm_activities', params);
  const counts = {
    today: useList('crm_activities', { is_done: 0, due_at__gte: `${t}T00:00`, due_at__lte: `${t}T23:59`, responsible_id: mine ? user!.id : undefined, limit: 1, expand: 0 }).data?.total ?? 0,
    overdue: useList('crm_activities', { is_done: 0, due_at__lt: now, responsible_id: mine ? user!.id : undefined, limit: 1, expand: 0 }).data?.total ?? 0,
  };
  const complete = async (a: any) => {
    const result = prompt(`Результат: ${a.subject}`, '') ?? '';
    try { await api.patch(`/api/e/crm_activities/${a.id}`, { is_done: 1, result }); inv('crm_activities', 'timeline'); toast.success('Дело выполнено'); }
    catch (e) { toast.error(e); }
  };
  const items = data?.items ?? [];
  return (
    <div>
      <CrmHeader title="Дела" subtitle="Звонки, встречи и договорённости с клиентами"
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ responsible_id: user!.id, kind: 'call', due_at: nowLocalDateTime(2) })}>Дело</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={tab} onChange={setTab} options={[
          { value: 'today', label: `Сегодня${counts.today ? ` · ${counts.today}` : ''}` }, { value: 'overdue', label: `Просрочены${counts.overdue ? ` · ${counts.overdue}` : ''}` },
          { value: 'upcoming', label: 'Предстоящие' }, { value: 'done', label: 'Выполненные' }]} />
        <Segmented value={mine ? 'mine' : 'all'} onChange={(v) => setMine(v === 'mine')} options={[{ value: 'mine', label: 'Мои' }, { value: 'all', label: 'Все' }]} />
      </div>
      <Card padded={false}>
        {isLoading ? <Loading /> : !items.length ? <EmptyState title={tab === 'overdue' ? 'Просроченных дел нет' : 'Дел нет'} text="Планируйте звонки и встречи прямо из карточки сделки." /> : (
          <ul className="divide-y divide-line">
            {items.map((a: any) => {
              const dl = deadlineInfo(a.due_at, !!a.is_done);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-2/60">
                  {!a.is_done ? (
                    <button type="button" aria-label="Выполнено" onClick={() => complete(a)} className="flex size-5 shrink-0 items-center justify-center rounded-md border-2 border-line-strong hover:border-success hover:bg-success hover:text-white"><Check className="size-3" /></button>
                  ) : <Check className="size-5 text-success" />}
                  <Badge color={KIND[a.kind]?.[1]}>{KIND[a.kind]?.[0]}</Badge>
                  <button type="button" onClick={() => setForm(a)} className={cx('min-w-0 flex-1 text-left text-sm font-semibold hover:text-primary', a.is_done && 'text-muted line-through')}>{a.subject}</button>
                  {a._ref?.deal_id && <Link to={`/crm/deals/${a.deal_id}`} className="max-w-56 truncate text-xs text-primary hover:underline">{a._ref.deal_id.title}</Link>}
                  {!a._ref?.deal_id && a._ref?.company_id && <Link to={`/crm/companies/${a.company_id}`} className="max-w-56 truncate text-xs text-primary hover:underline">{a._ref.company_id.title}</Link>}
                  <span className={cx('w-40 text-right text-xs font-semibold', dl.tone === 'danger' ? 'text-danger' : dl.tone === 'warning' ? 'text-warning' : 'text-muted')}>{dl.text}</span>
                  <Avatar name={a._ref?.responsible_id?.title} color={a._ref?.responsible_id?.color} size={24} />
                  {a.is_done && a.result && <p className="w-full pl-8 text-xs text-muted">Результат: {a.result}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <RecordForm entity="crm_activities" open={!!form} onClose={() => setForm(null)} initial={form} />
    </div>
  );
}

export function Counterparties() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'companies' | 'contacts'>('all');
  const [form, setForm] = useState<string | null>(null);
  const { data, isLoading } = useApi<any[]>(['companies', 'counterparties'], '/api/crm/counterparties', { q });
  const rows = (data ?? []).filter((r) => kind === 'all' || r.entity === kind);
  return (
    <div>
      <CrmHeader title="Все контрагенты" subtitle="Компании и контакты в одном списке"
        actions={<><Button icon={<Building2 className="size-4" />} onClick={() => setForm('companies')}>Компания</Button><Button variant="primary" icon={<UserRound className="size-4" />} onClick={() => setForm('contacts')}>Контакт</Button></>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название, ФИО, ИНН, телефон, email" icon={<Search className="size-4" />} className="w-full sm:w-80" />
        <Segmented value={kind} onChange={setKind} options={[{ value: 'all', label: 'Все' }, { value: 'companies', label: 'Компании' }, { value: 'contacts', label: 'Контакты' }]} />
      </div>
      <Card padded={false}>
        {isLoading ? <Loading /> : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.entity + r.id}>
                <button type="button" onClick={() => nav(`/crm/${r.entity}/${r.id}`)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                  <span className={cx('flex size-9 items-center justify-center rounded-lg', r.entity === 'companies' ? 'bg-primary-soft text-primary' : 'bg-accent-soft text-accent')}>{r.entity === 'companies' ? <Building2 className="size-4" /> : <UserRound className="size-4" />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{r.name}</span><span className="block truncate text-xs text-muted">{r.entity === 'companies' ? (r.sub ? `ИНН ${r.sub}` : 'Компания') : (r.sub ?? 'Контакт')}</span></span>
                  <span className="hidden w-40 truncate text-sm text-muted sm:block">{r.phone}</span>
                  <span className="hidden w-52 truncate text-sm text-muted lg:block">{r.email}</span>
                  <span className="hidden w-40 truncate text-xs text-faint md:block">{r.responsible}</span>
                </button>
              </li>
            ))}
            {!rows.length && <li className="px-4 py-10 text-center text-sm text-faint">Ничего не найдено</li>}
          </ul>
        )}
      </Card>
      {form && <RecordForm entity={form} open onClose={() => setForm(null)} initial={null} onSaved={(r) => nav(`/crm/${form}/${r.id}`)} />}
    </div>
  );
}

export function CrmReport() {
  const pipelines = useList('pipelines', { limit: 20 }).data?.items ?? [];
  const [pipe, setPipe] = useState('');
  const [from, setFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(todayIso());
  const { data: r, isLoading } = useApi<any>(['deals', 'report'], '/api/crm/report', { from, to, pipeline_id: pipe || undefined });
  return (
    <div>
      <CrmHeader title="Отчёт по продажам" subtitle="Конверсия, менеджеры, источники и причины отказов" />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormRow label="Воронка"><Select value={pipe} onChange={(e) => setPipe(e.target.value)}><option value="">Основная</option>{pipelines.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FormRow>
        <FormRow label="Сделки созданы с"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></FormRow>
        <FormRow label="по"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></FormRow>
      </div>
      {isLoading || !r ? <Loading /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <Stat label="Создано сделок" value={r.totals.created ?? 0} tone="primary" />
            <Stat label="Выиграно" value={r.totals.won ?? 0} sub={money(r.totals.won_amount)} tone="success" />
            <Stat label="Проиграно" value={r.totals.lost ?? 0} tone="danger" />
            <Stat label="Конверсия" value={r.totals.conversion != null ? `${r.totals.conversion}%` : '—'} />
            <Stat label="Средний чек / цикл" value={compactMoney(r.totals.avg_check)} sub={r.totals.avg_days != null ? `${r.totals.avg_days} дн. до победы` : undefined} tone="accent" />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="Сделки по стадиям сейчас">
              <div className="space-y-2">
                {r.stages.map((s: any) => {
                  const max = Math.max(1, ...r.stages.map((x: any) => x.now));
                  return (
                    <div key={s.id} className="grid grid-cols-[140px_1fr_40px] items-center gap-3 text-sm">
                      <span className="truncate text-muted">{s.name}</span>
                      <div className="h-6 rounded-md bg-surface-2"><div className="h-full rounded-md" style={{ width: `${Math.max(4, (s.now / max) * 100)}%`, background: s.color }} /></div>
                      <span className="text-right font-semibold tabular">{s.now}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card title="Причины проигрыша">
              {r.lost.length ? <Donut data={r.lost.map((l: any, i: number) => ({ name: LOST_REASONS.find((x) => x.value === l.reason)?.label ?? l.reason, value: l.count, color: PALETTE[i % PALETTE.length] }))} height={200} />
                : <EmptyState compact title="Проигранных сделок нет" />}
            </Card>
          </div>
          <Card title="Менеджеры" padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="text-left text-xs font-bold uppercase tracking-wide text-faint"><th className="px-4 py-2.5">Менеджер</th><th className="px-4 py-2.5 text-right">Создано</th><th className="px-4 py-2.5 text-right">Выиграно</th><th className="px-4 py-2.5 text-right">Проиграно</th><th className="px-4 py-2.5 text-right">Конверсия</th><th className="px-4 py-2.5 text-right">Сумма побед</th></tr></thead>
                <tbody>{r.managers.map((m: any) => (
                  <tr key={m.id ?? 'none'} className="border-t border-line">
                    <td className="px-4 py-2.5"><span className="flex items-center gap-2"><Avatar name={m.name ?? '—'} color={m.color} size={24} />{m.name ?? 'Без ответственного'}</span></td>
                    <td className="px-4 py-2.5 text-right tabular">{m.created}</td><td className="px-4 py-2.5 text-right tabular text-success">{m.won}</td><td className="px-4 py-2.5 text-right tabular text-danger">{m.lost}</td>
                    <td className="px-4 py-2.5 text-right tabular">{m.created ? Math.round((m.won / m.created) * 100) : 0}%</td><td className="px-4 py-2.5 text-right font-semibold tabular">{money(m.amount)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
          <Card title="Источники сделок"><MoneyBars data={r.sources.map((s: any) => ({ name: SOURCES.find((x) => x.value === s.source)?.label ?? s.source, amount: s.amount }))} xKey="name" keys={[{ key: 'amount', label: 'Выиграно, ₽', color: SERIES.income }]} height={240} /></Card>
        </div>
      )}
    </div>
  );
}
