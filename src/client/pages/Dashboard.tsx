import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlarmClock, ArrowDown, ArrowUp, BookOpen, CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign, Clock4, Code2, Copy, FileSpreadsheet, FileWarning, Gift,
  Handshake, ListTodo, MoreVertical, Plane, PlugZap, Plus, Receipt, RotateCcw, Smartphone, Target, TrendingUp, UserPlus, Wallet, X } from 'lucide-react';
import { api, IS_DEMO } from '../api.ts';
import { compactMoney, date, deadlineInfo, money, monthLabel, relative, time } from '../lib/format.ts';
import { useApi, useAuth, useInvalidate } from '../lib/state.tsx';
import { Avatar, Badge, Button, Card, EmptyState, IconButton, Input, Loading, MenuItem, Modal, PageHeader, Popover, Progress, Stat, cx, useMediaQuery, useToast } from '../ui/ui.tsx';
import { Donut, MoneyArea, MoneyBars, PALETTE, SERIES } from '../ui/charts.tsx';
import { RecordForm } from '../ui/fields.tsx';
import { SOURCES } from '../../core/schema.ts';

// ---------------- widgets ----------------
interface Widget { key: string; title: string; text: string; module?: string; wide?: boolean; render: (d: any) => ReactNode }
const INV_STATUS: Record<string, [string, string]> = { draft: ['Черновик', '#94a3b8'], sent: ['Выставлен', '#0ea5e9'], partially_paid: ['Оплачен частично', '#f59e0b'], paid: ['Оплачен', '#10b981'], cancelled: ['Отменён', '#64748b'] };
const prio = (v: string) => ({ low: '#94a3b8', normal: '#0ea5e9', high: '#f59e0b', critical: '#ef4444' } as Record<string, string>)[v];

const WIDGETS: Widget[] = [
  { key: 'task_stats', title: 'Мои задачи: цифры', text: 'В работе, на сегодня, просрочено, сделано за неделю', wide: true, render: (d) => (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Stat label="В работе" value={d.tasks.open} icon={<ListTodo className="size-5" />} tone="primary" />
      <Stat label="На сегодня" value={d.tasks.today} icon={<Clock4 className="size-5" />} />
      <Stat label="Просрочено" value={d.tasks.overdue} icon={<AlarmClock className="size-5" />} tone={d.tasks.overdue ? 'danger' : 'default'} />
      <Stat label="Сделано за 7 дней" value={d.tasks.done_week} icon={<CheckCircle2 className="size-5" />} tone="success" />
    </div>) },
  { key: 'my_tasks', title: 'Мои задачи', text: 'Ближайшие задачи со сроками', render: (d) => (
    <Card title="Мои задачи" padded={false} actions={<Link to="/tasks" className="text-sm font-semibold text-primary hover:underline">Все</Link>}>
      {d.tasks.list.length ? <ul className="divide-y divide-line">{d.tasks.list.map((t: any) => { const dl = deadlineInfo(t.deadline); return (
        <li key={t.id}><Link to={`/tasks/${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
          <span className="size-3.5 shrink-0 rounded-[4px] border-2" style={{ borderColor: prio(t.priority) }} />
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{t.title}</span>{t.project && <span className="block truncate text-xs text-muted">{t.project}</span>}</span>
          <span className={cx('shrink-0 text-xs font-semibold', dl.tone === 'danger' ? 'text-danger' : dl.tone === 'warning' ? 'text-warning' : 'text-muted')}>{dl.text}</span>
        </Link></li>); })}</ul> : <EmptyState compact icon={<CheckCircle2 />} title="Все задачи выполнены" />}
    </Card>) },
  { key: 'team_load', title: 'Загрузка команды', text: 'Открытые и просроченные задачи по сотрудникам', render: (d) => (
    <Card title="Загрузка команды" padded={false}>
      <ul className="divide-y divide-line">{d.tasks.team.map((u: any) => (
        <li key={u.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
          <Avatar name={u.name} color={u.color} size={26} /><span className="w-36 truncate font-semibold">{u.name}</span>
          <Progress value={Math.min(100, ((u.open ?? 0) / 12) * 100)} className="flex-1" color={(u.open ?? 0) > 10 ? '#FF6B57' : undefined} />
          <span className="w-8 text-right tabular">{u.open ?? 0}</span><span className={cx('w-8 text-right tabular', u.overdue ? 'text-danger' : 'text-faint')}>{u.overdue ?? 0}</span>
        </li>))}</ul>
    </Card>) },
  { key: 'events_today', title: 'Календарь на сегодня', text: 'Встречи и звонки сегодня', render: (d) => (
    <Card title="Сегодня в календаре" actions={<Link to="/calendar" className="text-sm font-semibold text-primary hover:underline">Календарь</Link>}>
      {d.events.length ? <ul className="space-y-2.5">{d.events.map((e: any) => <li key={e.id} className="flex gap-3 text-sm"><span className="w-12 shrink-0 font-bold tabular text-primary">{time(e.start)}</span><span className="min-w-0"><span className="block truncate font-semibold">{e.title}</span>{e.location && <span className="block truncate text-xs text-muted">{e.location}</span>}</span></li>)}</ul>
        : <p className="text-sm text-muted">Встреч на сегодня нет</p>}
    </Card>) },
  { key: 'team_today', title: 'Команда сегодня', text: 'Кто в отпуске, у кого скоро день рождения', render: (d) => (
    <Card title="Команда">
      <div className="space-y-3 text-sm">
        {d.absent.map((a: any) => <p key={a.id} className="flex items-center gap-2"><Plane className="size-4 text-muted" /><span className="font-semibold">{a.name}</span><span className="text-muted">— до {date(a.date_to)}</span></p>)}
        {d.birthdays.slice(0, 3).map((b: any) => <p key={b.id} className="flex items-center gap-2"><Gift className="size-4 text-accent" /><span className="font-semibold">{b.name}</span><span className="text-muted">— {new Date('2000-' + b.birthday.slice(5) + 'T12:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span></p>)}
        {!d.absent.length && !d.birthdays.length && <p className="text-muted">Все на месте</p>}
      </div>
    </Card>) },
  { key: 'activity', title: 'Лента событий', text: 'Последние действия в CRM', render: (d) => (
    <Card title="Лента событий" padded={false}>
      <ul className="max-h-[360px] divide-y divide-line overflow-y-auto">{d.activity.map((a: any) => (
        <li key={a.id} className="flex gap-3 px-4 py-2.5"><Avatar name={a.user_name ?? 'Система'} color={a.user_color ?? '#94a3b8'} size={26} />
          <div className="min-w-0 text-sm"><p className="truncate"><span className="font-semibold">{a.user_name ?? 'Система'}</span> <span className="text-muted">· {relative(a.created_at)}</span></p>
            <p className="line-clamp-2 text-muted">{a.text}{a.title && <> — <span className="text-fg">{a.title}</span></>}</p></div></li>))}</ul>
    </Card>) },
  { key: 'sales_stats', title: 'Продажи: цифры', text: 'В работе, выиграно за месяц, конверсия, средний чек', module: 'crm', wide: true, render: (d) => d.sales && (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Сделок в работе" value={d.sales.open.count} icon={<Target className="size-5" />} tone="primary" sub={money(d.sales.open.amount)} />
      <Stat label="Выиграно в месяце" value={compactMoney(d.sales.won_month.amount)} icon={<Handshake className="size-5" />} tone="success" sub={`${d.sales.won_month.count} сделок`} />
      <Stat label="Конверсия" value={d.sales.conversion != null ? `${d.sales.conversion}%` : '—'} icon={<TrendingUp className="size-5" />} sub="из закрытых в этом месяце" />
      <Stat label="Средний чек" value={d.sales.won_month.count ? compactMoney(d.sales.won_month.amount / d.sales.won_month.count) : '—'} icon={<CircleDollarSign className="size-5" />} tone="accent" />
    </div>) },
  { key: 'funnel', title: 'Воронка продаж', text: 'Сделки и суммы по стадиям', module: 'crm', render: (d) => d.sales && (
    <Card title="Воронка продаж" subtitle={d.sales.pipeline?.name} actions={<Link to="/crm/deals" className="text-sm font-semibold text-primary hover:underline">Открыть</Link>}><Funnel stages={d.sales.funnel} /></Card>) },
  { key: 'won_by_month', title: 'Выигранные по месяцам', text: 'Сумма выигранных сделок', module: 'crm', render: (d) => d.sales && (
    <Card title="Выигранные сделки по месяцам"><MoneyBars data={d.sales.wonByMonth} keys={[{ key: 'amount', label: 'Сумма', color: SERIES.income }]} /></Card>) },
  { key: 'sources', title: 'Источники сделок', text: 'Откуда приходят клиенты', module: 'crm', render: (d) => d.sales && (
    <Card title="Источники сделок" subtitle="за полгода"><Donut data={d.sales.sources.map((x: any, i: number) => ({ name: SOURCES.find((o) => o.value === x.source)?.label ?? x.source, value: x.count, color: PALETTE[i % PALETTE.length] }))} /></Card>) },
  { key: 'managers', title: 'Рейтинг менеджеров', text: 'Кто больше продал за полгода', module: 'crm', render: (d) => d.sales && (
    <Card title="Рейтинг менеджеров" padded={false}><ul className="divide-y divide-line">{d.sales.byManager.map((m: any, i: number) => (
      <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm"><span className="w-4 text-xs font-bold text-faint">{i + 1}</span><Avatar name={m.name} color={m.color} size={28} />
        <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{m.name}</span><span className="text-xs text-muted">{m.count} сделок</span></span><span className="font-bold tabular">{compactMoney(m.amount)}</span></li>))}</ul></Card>) },
  { key: 'fin_stats', title: 'Деньги: цифры', text: 'Остаток, поступления и выплаты за месяц', module: 'finance', wide: true, render: (d) => d.finance && (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Stat label="Остаток на всех счетах" value={money(d.finance.balance)} icon={<Wallet className="size-5" />} tone="primary" />
      <Stat label="Поступления за месяц" value={money(d.finance.income_month)} icon={<TrendingUp className="size-5" />} tone="success" />
      <Stat label="Выплаты за месяц" value={money(d.finance.expense_month)} icon={<Receipt className="size-5" />} tone="accent" />
    </div>) },
  { key: 'cashflow', title: 'Приход и расход', text: 'Деньги по месяцам', module: 'finance', render: (d) => d.finance && (
    <Card title="Приход и расход"><MoneyBars data={d.finance.series} keys={[{ key: 'income', label: 'Поступления', color: SERIES.income }, { key: 'expense', label: 'Выплаты', color: SERIES.expense }]} /></Card>) },
  { key: 'net_flow', title: 'Чистый поток', text: 'Разница прихода и расхода', module: 'finance', render: (d) => d.finance && (
    <Card title="Чистый денежный поток" subtitle={d.finance.series.length ? `${monthLabel(d.finance.series[0].month)} — ${monthLabel(d.finance.series[d.finance.series.length - 1].month)}` : ''}>
      <MoneyArea data={d.finance.series.map((r: any) => ({ ...r, net: Math.round(r.income - r.expense) }))} dataKey="net" color={SERIES.net} label="Чистый поток" /></Card>) },
  { key: 'accounts', title: 'Остатки по счетам', text: 'Деньги на каждом счёте и в кассе', module: 'finance', render: (d) => d.finance && (
    <Card title="Остатки по счетам" padded={false}><ul className="divide-y divide-line">{d.finance.accounts.map((a: any) => (
      <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="min-w-0"><span className="block truncate font-semibold">{a.name}</span><span className="text-xs text-muted">{a.bank_name ?? ''}</span></span>
        <span className={cx('font-bold tabular', a.balance < 0 && 'text-danger')}>{money(a.balance, { currency: a.currency })}</span></li>))}</ul></Card>) },
  { key: 'inv_stats', title: 'Счета: цифры', text: 'Ждём оплату, просрочено, оплачено за месяц', module: 'crm', wide: true, render: (d) => d.invoices && (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Ждём оплату" value={compactMoney(d.invoices.unpaid?.s)} icon={<Receipt className="size-5" />} tone="primary" sub={`${d.invoices.unpaid?.c ?? 0} счетов`} />
      <Stat label="Просрочены" value={compactMoney(d.invoices.overdue?.s)} icon={<AlarmClock className="size-5" />} tone={d.invoices.overdue?.c ? 'danger' : 'default'} sub={`${d.invoices.overdue?.c ?? 0} счетов`} />
      <Stat label="Оплачено в месяце" value={compactMoney(d.invoices.paid_month?.s)} icon={<CheckCircle2 className="size-5" />} tone="success" />
      <Stat label="Черновики" value={d.invoices.draft?.c ?? 0} icon={<FileWarning className="size-5" />} sub="ещё не отправлены" />
    </div>) },
  { key: 'inv_unpaid', title: 'Счета к оплате', text: 'Неоплаченные счета по срокам', module: 'crm', render: (d) => d.invoices && (
    <Card title="Счета к оплате" padded={false} actions={<Link to="/crm/invoices" className="text-sm font-semibold text-primary hover:underline">Все счета</Link>}>
      {d.invoices.list.length ? <table className="w-full text-sm"><tbody>{d.invoices.list.map((x: any) => { const overdue = x.due_date && x.due_date < new Date().toISOString().slice(0, 10); return (
        <tr key={x.id} className="border-t border-line first:border-0 hover:bg-surface-2"><td className="px-4 py-2.5"><Link to={`/crm/invoices/${x.id}`} className="font-semibold hover:text-primary">№ {x.number}</Link><div className="text-xs text-muted">{x.company}</div></td>
          <td className={cx('px-4 py-2.5 text-xs', overdue ? 'font-semibold text-danger' : 'text-muted')}>до {date(x.due_date)}</td><td className="px-4 py-2.5"><Badge color={INV_STATUS[x.status]?.[1]}>{INV_STATUS[x.status]?.[0]}</Badge></td>
          <td className="px-4 py-2.5 text-right font-bold tabular">{money(x.total - (x.paid_amount || 0))}</td></tr>); })}</tbody></table> : <EmptyState compact title="Неоплаченных счетов нет" />}
    </Card>) },
  { key: 'inv_status', title: 'Счета по статусам', text: 'Сколько счетов в каждом статусе', module: 'crm', render: (d) => d.invoices && (
    <Card title="Счета по статусам"><Donut data={d.invoices.byStatus.map((x: any) => ({ name: INV_STATUS[x.status]?.[0] ?? x.status, value: x.count, color: INV_STATUS[x.status]?.[1] ?? '#64748b' }))} height={180} /></Card>) },
];
const W = Object.fromEntries(WIDGETS.map((w) => [w.key, w]));

interface Board { id: string; title: string; widgets: string[]; builtin?: boolean }
const DEFAULT_BOARDS: Board[] = [
  { id: 'start', title: 'Начало работы', widgets: [], builtin: true },
  { id: 'tasks', title: 'Обзор задач', widgets: ['task_stats', 'my_tasks', 'events_today', 'team_load', 'team_today', 'activity'] },
  { id: 'sales', title: 'Отчёт по продажам', widgets: ['sales_stats', 'funnel', 'sources', 'won_by_month', 'managers'] },
  { id: 'finance', title: 'Финансовый отчёт', widgets: ['fin_stats', 'cashflow', 'accounts', 'net_flow'] },
  { id: 'invoices', title: 'Сводка по счетам', widgets: ['inv_stats', 'inv_unpaid', 'inv_status'] },
];

function Funnel({ stages }: { stages: any[] }) {
  const open = stages.filter((s) => s.kind === 'open');
  const max = Math.max(1, ...open.map((s) => s.count));
  return (
    <div className="space-y-2">
      {open.map((s) => (
        <div key={s.id} className="grid grid-cols-[minmax(100px,170px)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-muted">{s.name}</span>
          <div className="h-7 overflow-hidden rounded-md bg-surface-2"><div className="flex h-full items-center rounded-md px-2 text-xs font-bold text-white" style={{ width: `${Math.max(8, (s.count / max) * 100)}%`, background: s.color }}>{s.count}</div></div>
          <span className="w-24 text-right font-semibold tabular">{compactMoney(s.amount)}</span>
        </div>
      ))}
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-sm">
        {stages.filter((s) => s.kind !== 'open').map((s) => <span key={s.id} className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: s.color }} />{s.name}: <b className="tabular">{s.count}</b> <span className="text-muted">({compactMoney(s.amount)})</span></span>)}
      </div>
    </div>
  );
}

function usePref<T>(key: string, fallback: T): [T, (v: T) => void, boolean] {
  const { data, isFetched } = useApi<T | null>(['prefs', key], `/api/prefs/${key}`);
  const inv = useInvalidate();
  const [local, setLocal] = useState<T | null>(null);
  useEffect(() => { if (isFetched) setLocal((data as T) ?? fallback); }, [isFetched, data]);
  const set = (v: T) => { setLocal(v); api.put(`/api/prefs/${key}`, v).then(() => inv('prefs')); };
  return [local ?? fallback, set, isFetched];
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
}

export default function Dashboard() {
  const { user, can } = useAuth();
  const { data: d, isLoading } = useApi<any>(['dashboard'], '/api/dashboard');
  const [boards, setBoards] = usePref<Board[]>('dashboards', DEFAULT_BOARDS);
  const [active, setActive] = useState('start');
  const [picker, setPicker] = useState(false);
  const [newBoard, setNewBoard] = useState<string | null>(null);
  const toast = useToast();
  const board = boards.find((b) => b.id === active) ?? boards[0];
  const allowed = (w: Widget) => !w.module || can(w.module);
  const update = (b: Board) => setBoards(boards.map((x) => (x.id === b.id ? b : x)));
  const move = (i: number, dir: -1 | 1) => {
    const ws = [...board.widgets];
    const j = i + dir;
    if (j < 0 || j >= ws.length) return;
    [ws[i], ws[j]] = [ws[j], ws[i]];
    update({ ...board, widgets: ws });
  };
  return (
    <div>
      <PageHeader title="Рабочий стол"
        tabs={
          <nav className="-mb-px flex items-center gap-5 overflow-x-auto">
            {boards.map((b) => (
              <button key={b.id} type="button" onClick={() => setActive(b.id)}
                className={cx('shrink-0 whitespace-nowrap border-b-2 pb-2.5 text-sm font-semibold', b.id === board.id ? 'border-primary text-fg' : 'border-transparent text-muted hover:text-fg')}>{b.title}</button>
            ))}
            <button type="button" aria-label="Новый рабочий стол" onClick={() => setNewBoard('')} className="mb-2 shrink-0 rounded-md p-1 text-faint hover:bg-surface-2 hover:text-primary"><Plus className="size-4" /></button>
          </nav>
        }
        actions={<>
          {!board.builtin && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setPicker(true)}>Добавить виджет</Button>}
          <Popover align="right" trigger={({ toggle }) => <IconButton label="Ещё" onClick={toggle}><MoreVertical className="size-5" /></IconButton>}>
            {(close) => (
              <div className="w-60">
                {!board.builtin && <MenuItem onClick={() => { const t = prompt('Название рабочего стола', board.title); if (t) update({ ...board, title: t }); close(); }}>Переименовать</MenuItem>}
                {!DEFAULT_BOARDS.some((x) => x.id === board.id) && <MenuItem danger onClick={() => { setBoards(boards.filter((x) => x.id !== board.id)); setActive('start'); close(); }}>Удалить рабочий стол</MenuItem>}
                <MenuItem icon={<RotateCcw className="size-4" />} onClick={() => { setBoards(DEFAULT_BOARDS); setActive('start'); toast.success('Рабочие столы сброшены'); close(); }}>Вернуть как было</MenuItem>
              </div>
            )}
          </Popover>
        </>} />
      {isLoading || !d ? <Loading /> : board.builtin ? <StartTab name={user?.name.split(' ')[0] ?? ''} d={d} /> : (
        board.widgets.length ? (
          <div className="grid gap-5 xl:grid-cols-2">
            {board.widgets.map((k, i) => W[k] && allowed(W[k]) && (
              <div key={k + i} className={cx('group relative', W[k].wide && 'xl:col-span-2')}>
                {W[k].render(d)}
                <div className="absolute -top-2.5 right-2 hidden gap-1 group-hover:flex">
                  {[[<ArrowUp key="u" className="size-3.5" />, -1, 'Выше'], [<ArrowDown key="d" className="size-3.5" />, 1, 'Ниже']].map(([ic, dir, l]) => (
                    <button key={String(l)} type="button" aria-label={String(l)} onClick={() => move(i, dir as -1 | 1)} className="rounded-full border border-line bg-surface p-1 text-muted shadow-sm hover:text-fg">{ic}</button>
                  ))}
                  <button type="button" aria-label="Убрать виджет" onClick={() => update({ ...board, widgets: board.widgets.filter((_, j) => j !== i) })} className="rounded-full border border-line bg-surface p-1 text-muted shadow-sm hover:text-danger"><X className="size-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState title="На этом рабочем столе пусто" text="Добавьте виджеты: задачи, воронку, деньги, счета." action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setPicker(true)}>Добавить виджет</Button>} />
      )}
      <Modal open={picker} onClose={() => setPicker(false)} size="lg" title="Добавить виджет" subtitle={`На рабочий стол «${board.title}»`}>
        <div className="grid gap-2 sm:grid-cols-2">
          {WIDGETS.filter(allowed).map((w) => {
            const has = board.widgets.includes(w.key);
            return (
              <button key={w.key} type="button" disabled={has} onClick={() => { update({ ...board, widgets: [...board.widgets, w.key] }); setPicker(false); }}
                className="rounded-xl border border-line p-3 text-left hover:border-primary disabled:opacity-50">
                <p className="font-semibold">{w.title}{has && <span className="ml-2 text-xs text-faint">уже добавлен</span>}</p><p className="text-sm text-muted">{w.text}</p>
              </button>
            );
          })}
        </div>
      </Modal>
      <Modal open={newBoard !== null} onClose={() => setNewBoard(null)} size="sm" title="Новый рабочий стол"
        footer={<><Button onClick={() => setNewBoard(null)}>Отмена</Button><Button variant="primary" onClick={() => {
          const t = (newBoard ?? '').trim() || 'Мой рабочий стол';
          const id = 'b' + Date.now().toString(36);
          setBoards([...boards, { id, title: t, widgets: [] }]);
          setActive(id);
          setNewBoard(null);
          setPicker(true);
        }}>Создать</Button></>}>
        <Input autoFocus value={newBoard ?? ''} onChange={(e) => setNewBoard(e.target.value)} placeholder="Например: Мой день" />
      </Modal>
      <Checklist />
      {d && <p className="sr-only">{greeting()}</p>}
    </div>
  );
}

// ---------------- «Начало работы» ----------------
function StartTab({ name, d }: { name: string; d: any }) {
  const nav = useNavigate();
  const toast = useToast();
  const [task, setTask] = useState(false);
  const { user } = useAuth();
  const url = location.href.split('#')[0];
  const steps: [ReactNode, string, string, string, () => void][] = [
    [<UserPlus key="a" className="size-6" />, 'Пригласите коллег', 'Добавьте сотрудников и выдайте роли', 'from-sky-500 to-indigo-500', () => nav('/team?invite=1')],
    [<ListTodo key="b" className="size-6" />, 'Поставьте первую задачу', 'Себе или коллеге, со сроком', 'from-emerald-500 to-teal-500', () => setTask(true)],
    [<PlugZap key="c" className="size-6" />, 'Подключите 1С', 'Контрагенты, товары и оплаты', 'from-orange-500 to-rose-500', () => nav('/settings/onec')],
    [<FileSpreadsheet key="d" className="size-6" />, 'Загрузите клиентов', 'Из Excel или CSV за пару минут', 'from-violet-500 to-fuchsia-500', () => nav('/crm/companies')],
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-2xl font-extrabold tracking-tight">{greeting()}, {name}!</h2><p className="text-sm text-muted">Несколько шагов — и система работает под вашу компанию</p></div>
        {IS_DEMO && <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted">Демо-версия <span className="ml-1 inline-block size-2 rounded-full bg-success" /></span>}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="grid gap-4 sm:grid-cols-2">
          {steps.map(([icon, title, text, grad, go]) => (
            <button key={title} type="button" onClick={go} className="group relative flex min-h-36 flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg">
              <span className={cx('flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md', grad)}>{icon}</span>
              <span className="mt-6"><span className="block text-lg font-bold">{title}</span><span className="block text-sm text-muted">{text}</span></span>
              <ChevronRight className="absolute right-4 top-4 size-5 text-faint transition group-hover:translate-x-0.5 group-hover:text-primary" />
              <span className={cx('pointer-events-none absolute -bottom-10 -right-10 size-32 rounded-full bg-gradient-to-br opacity-10', grad)} />
            </button>
          ))}
        </div>
        <div className="space-y-4">
          <Card>
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><Smartphone className="size-5" /></span>
              <div className="min-w-0"><p className="font-bold">Работайте с телефона</p><p className="text-sm text-muted">Vela адаптирована под смартфон: откройте этот адрес в браузере телефона.</p>
                <button type="button" onClick={() => { navigator.clipboard?.writeText(url); toast.success('Адрес скопирован'); }} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"><Copy className="size-3.5" />Скопировать адрес</button></div>
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-4">
            <Link to="/kb" className="flex items-center justify-between rounded-2xl border border-line bg-surface p-4 font-semibold hover:border-primary"><span className="flex items-center gap-2"><BookOpen className="size-4 text-primary" />Инструкции</span><ChevronRight className="size-4 text-faint" /></Link>
            <a href="https://github.com/Babajusik/vela-crm" target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-2xl border border-line bg-surface p-4 font-semibold hover:border-primary"><span className="flex items-center gap-2"><Code2 className="size-4 text-primary" />Исходный код</span><ChevronRight className="size-4 text-faint" /></a>
          </div>
          {d.approvals > 0 && (
            <Link to="/bp" className="flex items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-semibold"><FileWarning className="size-5 text-warning" />Ждут вашего согласования: {d.approvals}<ChevronRight className="ml-auto size-4" /></Link>
          )}
        </div>
      </div>
      <Card title="Коротко о главном" subtitle="Как устроена работа в Vela">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[['Задачи и рабочий день', 'Планирование, сроки, контроль', '/tasks', '#0FA596'], ['Воронка продаж', 'Сделки, дела, счета', '/crm/deals', '#6366F1'], ['Проекты и шаблоны', 'Этапы, Гант, рентабельность', '/projects', '#F97362'],
            ['Деньги компании', 'ДДС, прибыль, баланс', '/finance', '#F59E0B'], ['Обмен с 1С', 'OData, CommerceML, выписки', '/settings/onec', '#0EA5E9']].map(([t, s, to, c]) => (
            <Link key={to} to={to} className="group rounded-xl border border-line p-4 transition hover:border-primary">
              <span className="mb-3 block h-1.5 w-10 rounded-full" style={{ background: c }} />
              <p className="font-semibold group-hover:text-primary">{t}</p><p className="text-xs text-muted">{s}</p>
            </Link>
          ))}
        </div>
      </Card>
      <RecordForm entity="tasks" open={task} onClose={() => setTask(false)} initial={{ assignee_id: user?.id, status: 'new' }} onSaved={(r) => nav(`/tasks/${r.id}`)} fields={['title', 'assignee_id', 'deadline', 'priority', 'description']} />
    </div>
  );
}

// ---------------- floating onboarding checklist ----------------
const STEPS = [
  { key: 'roles', label: 'Настройте права доступа', to: '/settings/roles' },
  { key: 'chat', label: 'Напишите коллеге в мессенджере', to: '/messenger' },
  { key: 'deal', label: 'Создайте сделку', to: '/crm/deals' },
  { key: 'project', label: 'Запустите проект из сделки', to: '/crm/deals' },
  { key: 'profit', label: 'Посмотрите рентабельность проектов', to: '/finance/reports?tab=projects' },
  { key: 'onec', label: 'Подключите обмен с 1С', to: '/settings/onec' },
];

function Checklist() {
  const [state, setState, loaded] = usePref<{ done: string[]; hidden?: boolean; collapsed?: boolean }>('onboarding', { done: [] });
  const nav = useNavigate();
  const pct = useMemo(() => Math.round((state.done.length / STEPS.length) * 100), [state]);
  const phone = useMediaQuery('(max-width: 767px)');
  if (!loaded || state.hidden) return null;
  if (state.collapsed ?? phone) {
    return (
      <button type="button" onClick={() => setState({ ...state, collapsed: false })} title="Первые шаги"
        className="fixed bottom-20 right-4 z-20 flex size-12 items-center justify-center rounded-full border border-line bg-surface text-xs font-bold shadow-lg md:bottom-5 md:right-5">{pct}%</button>
    );
  }
  return (
    <div className="fixed bottom-20 right-4 z-20 w-[300px] rounded-2xl border border-line bg-surface p-4 shadow-2xl anim-in md:bottom-5 md:right-5">
      <div className="flex items-start gap-2">
        <p className="flex-1 font-bold leading-snug">Пройдите первые шаги</p>
        <IconButton label="Свернуть" className="size-7" onClick={() => setState({ ...state, collapsed: true })}><ChevronDown className="size-4" /></IconButton>
        <IconButton label="Скрыть" className="size-7" onClick={() => setState({ ...state, hidden: true })}><X className="size-4" /></IconButton>
      </div>
      <div className="mt-2 flex items-center gap-2"><Progress value={pct} className="flex-1" /><span className="text-xs font-semibold text-muted tabular">{pct}%</span></div>
      <ul className="mt-3 space-y-1">
        {STEPS.map((s) => {
          const done = state.done.includes(s.key);
          return (
            <li key={s.key}>
              <button type="button" onClick={() => { if (!done) setState({ ...state, done: [...state.done, s.key] }); nav(s.to); }} className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-sm hover:bg-surface-2">
                <span className={cx('flex size-5 shrink-0 items-center justify-center rounded-full border-2', done ? 'border-success bg-success text-white' : 'border-line-strong')}>{done && <CheckCircle2 className="size-3.5" />}</span>
                <span className={cx(done ? 'text-muted line-through' : 'underline decoration-line-strong underline-offset-2')}>{s.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
