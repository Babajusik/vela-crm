import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlarmClock, ArrowRight, CalendarDays, CheckCircle2, CircleDollarSign, Clock4, FileWarning, Gift, Handshake, ListTodo, Plane, Receipt, Target, TrendingUp, Wallet } from 'lucide-react';
import { useApi, useAuth } from '../lib/state.tsx';
import { compactMoney, date, deadlineInfo, money, monthLabel, relative, time } from '../lib/format.ts';
import { Avatar, Badge, Card, EmptyState, Loading, PageHeader, Progress, Stat, Tabs, cx } from '../ui/ui.tsx';
import { Donut, MoneyArea, MoneyBars, PALETTE, SERIES } from '../ui/charts.tsx';
import { PRIORITY, SOURCES, TASK_STATUS } from '../../core/schema.ts';

type Tab = 'overview' | 'tasks' | 'sales' | 'finance' | 'invoices';
const prio = (v: string) => PRIORITY.find((p) => p.value === v);
const INV_STATUS: Record<string, [string, string]> = { draft: ['Черновик', '#94a3b8'], sent: ['Выставлен', '#0ea5e9'], partially_paid: ['Оплачен частично', '#f59e0b'], paid: ['Оплачен', '#10b981'], cancelled: ['Отменён', '#64748b'] };

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
}

export default function Dashboard() {
  const { user, can } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const { data: d, isLoading } = useApi<any>(['dashboard'], '/api/dashboard');
  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: 'Обзор' }, { value: 'tasks', label: 'Задачи' },
    ...(can('crm') ? [{ value: 'sales' as Tab, label: 'Продажи' }, { value: 'invoices' as Tab, label: 'Счета' }] : []),
    ...(can('finance') ? [{ value: 'finance' as Tab, label: 'Финансы' }] : []),
  ];
  return (
    <div>
      <PageHeader title={`${greeting()}, ${user?.name.split(' ')[0]}!`} subtitle={new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-5" />
      {isLoading || !d ? <Loading /> : (
        <>
          {tab === 'overview' && <Overview d={d} nav={nav} can={can} />}
          {tab === 'tasks' && <TasksTab d={d} />}
          {tab === 'sales' && d.sales && <SalesTab d={d} />}
          {tab === 'invoices' && d.invoices && <InvoicesTab d={d} />}
          {tab === 'finance' && d.finance && <FinanceTab d={d} />}
        </>
      )}
    </div>
  );
}

function Overview({ d, nav, can }: { d: any; nav: (p: string) => void; can: (m: string, l?: any) => boolean }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Мои задачи в работе" value={d.tasks.open} icon={<ListTodo className="size-5" />} tone="primary" sub={`${d.tasks.today} на сегодня`} onClick={() => nav('/tasks')} />
        <Stat label="Просрочено" value={d.tasks.overdue} icon={<AlarmClock className="size-5" />} tone={d.tasks.overdue ? 'danger' : 'default'} sub="задач с истёкшим сроком" onClick={() => nav('/tasks?filter=overdue')} />
        {d.sales
          ? <Stat label="Выиграно в этом месяце" value={compactMoney(d.sales.won_month.amount)} icon={<Handshake className="size-5" />} tone="success" sub={`${d.sales.won_month.count} сделок · конверсия ${d.sales.conversion ?? '—'}%`} onClick={() => nav('/crm/deals')} />
          : <Stat label="Сделано за неделю" value={d.tasks.done_week} icon={<CheckCircle2 className="size-5" />} tone="success" />}
        {d.finance
          ? <Stat label="Деньги на счетах" value={compactMoney(d.finance.balance)} icon={<Wallet className="size-5" />} tone="accent" sub={`Приход за месяц ${compactMoney(d.finance.income_month)}`} onClick={() => nav('/finance')} />
          : <Stat label="Поставлено мной" value={d.tasks.assigned_by_me} icon={<Target className="size-5" />} sub="задач коллегам в работе" />}
      </div>
      {d.approvals > 0 && (
        <Link to="/bp" className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-semibold">
          <FileWarning className="size-5 text-warning" />Ждут вашего согласования: {d.approvals}<ArrowRight className="ml-auto size-4" />
        </Link>
      )}
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Мои задачи" className="xl:col-span-2" actions={<Link to="/tasks" className="text-sm font-semibold text-primary hover:underline">Все задачи</Link>} padded={false}>
          {d.tasks.list.length ? (
            <ul className="divide-y divide-line">
              {d.tasks.list.map((t: any) => {
                const dl = deadlineInfo(t.deadline);
                const p = prio(t.priority);
                return (
                  <li key={t.id}>
                    <Link to={`/tasks/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: p?.color }} title={p?.label} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{t.title}</span>
                        {t.project && <span className="block truncate text-xs text-muted">{t.project}</span>}
                      </span>
                      <span className={cx('shrink-0 text-xs font-semibold', dl.tone === 'danger' ? 'text-danger' : dl.tone === 'warning' ? 'text-warning' : 'text-muted')}>{dl.text}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState compact icon={<CheckCircle2 />} title="Все задачи выполнены" text="Отличная работа — можно браться за новое." />}
        </Card>
        <div className="space-y-5">
          <Card title="Сегодня в календаре" actions={<Link to="/calendar" className="text-sm font-semibold text-primary hover:underline">Календарь</Link>}>
            {d.events.length ? (
              <ul className="space-y-2.5">
                {d.events.map((e: any) => (
                  <li key={e.id} className="flex gap-3 text-sm">
                    <span className="w-12 shrink-0 font-bold tabular text-primary">{time(e.start)}</span>
                    <span className="min-w-0"><span className="block truncate font-semibold">{e.title}</span>{e.location && <span className="block truncate text-xs text-muted">{e.location}</span>}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="flex items-center gap-2 text-sm text-muted"><CalendarDays className="size-4" />Встреч на сегодня нет</p>}
          </Card>
          <Card title="Команда">
            <div className="space-y-3 text-sm">
              {d.absent.length > 0 && d.absent.map((a: any) => (
                <p key={a.id} className="flex items-center gap-2"><Plane className="size-4 text-muted" /><span className="font-semibold">{a.name}</span><span className="text-muted">— {({ vacation: 'в отпуске', sick: 'на больничном', trip: 'в командировке', dayoff: 'отгул', remote: 'на удалёнке' } as any)[a.type]} до {date(a.date_to)}</span></p>
              ))}
              {d.birthdays.slice(0, 2).map((b: any) => (
                <p key={b.id} className="flex items-center gap-2"><Gift className="size-4 text-accent" /><span className="font-semibold">{b.name}</span><span className="text-muted">— день рождения {new Date('2000-' + b.birthday.slice(5) + 'T12:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span></p>
              ))}
              {!d.absent.length && !d.birthdays.length && <p className="text-muted">Все на месте</p>}
            </div>
          </Card>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        {d.sales && (
          <Card title="Воронка продаж" subtitle={d.sales.pipeline?.name} className="xl:col-span-2" actions={<Link to="/crm/deals" className="text-sm font-semibold text-primary hover:underline">Открыть</Link>}>
            <Funnel stages={d.sales.funnel} />
          </Card>
        )}
        <Card title="Лента событий" className={d.sales ? '' : 'xl:col-span-3'} padded={false}>
          <ul className="max-h-[360px] divide-y divide-line overflow-y-auto">
            {d.activity.map((a: any) => (
              <li key={a.id} className="flex gap-3 px-4 py-2.5">
                <Avatar name={a.user_name ?? 'Система'} color={a.user_color ?? '#94a3b8'} size={26} />
                <div className="min-w-0 text-sm">
                  <p className="truncate"><span className="font-semibold">{a.user_name ?? 'Система'}</span> <span className="text-muted">· {relative(a.created_at)}</span></p>
                  <p className="line-clamp-2 text-muted">{a.text}{a.title && <> — <span className="text-fg">{a.title}</span></>}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {can('finance') && d.finance && (
        <Card title="Деньги: приход и расход по месяцам" actions={<Link to="/finance" className="text-sm font-semibold text-primary hover:underline">Финансы</Link>}>
          <MoneyBars data={d.finance.series} keys={[{ key: 'income', label: 'Поступления', color: SERIES.income }, { key: 'expense', label: 'Выплаты', color: SERIES.expense }]} />
        </Card>
      )}
    </div>
  );
}

function Funnel({ stages }: { stages: any[] }) {
  const open = stages.filter((s) => s.kind === 'open');
  const max = Math.max(1, ...open.map((s) => s.count));
  return (
    <div className="space-y-2">
      {open.map((s) => (
        <div key={s.id} className="grid grid-cols-[minmax(110px,180px)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-muted">{s.name}</span>
          <div className="h-7 overflow-hidden rounded-md bg-surface-2">
            <div className="flex h-full items-center rounded-md px-2 text-xs font-bold text-white" style={{ width: `${Math.max(8, (s.count / max) * 100)}%`, background: s.color }}>{s.count}</div>
          </div>
          <span className="w-28 text-right font-semibold tabular">{compactMoney(s.amount)}</span>
        </div>
      ))}
      <div className="flex gap-6 border-t border-line pt-3 text-sm">
        {stages.filter((s) => s.kind !== 'open').map((s) => (
          <span key={s.id} className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: s.color }} />{s.name}: <b className="tabular">{s.count}</b> <span className="text-muted">({compactMoney(s.amount)})</span></span>
        ))}
      </div>
    </div>
  );
}

function TasksTab({ d }: { d: any }) {
  const t = d.tasks;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="В работе" value={t.open} icon={<ListTodo className="size-5" />} tone="primary" />
        <Stat label="На сегодня" value={t.today} icon={<Clock4 className="size-5" />} />
        <Stat label="Просрочено" value={t.overdue} icon={<AlarmClock className="size-5" />} tone={t.overdue ? 'danger' : 'default'} />
        <Stat label="Сделано за 7 дней" value={t.done_week} icon={<CheckCircle2 className="size-5" />} tone="success" />
      </div>
      <Card title="Загрузка команды" subtitle="Открытые и просроченные задачи по сотрудникам" padded={false}>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-faint"><th className="px-4 py-2.5">Сотрудник</th><th className="px-4 py-2.5">Нагрузка</th><th className="px-4 py-2.5 text-right">В работе</th><th className="px-4 py-2.5 text-right">Просрочено</th><th className="px-4 py-2.5 text-right">Сделано за неделю</th></tr></thead>
          <tbody>
            {t.team.map((u: any) => (
              <tr key={u.id} className="border-t border-line">
                <td className="px-4 py-2.5"><span className="flex items-center gap-2"><Avatar name={u.name} color={u.color} size={26} /><span className="font-semibold">{u.name}</span></span></td>
                <td className="w-1/3 px-4 py-2.5"><Progress value={Math.min(100, (u.open / 12) * 100)} color={u.open > 10 ? '#FF6B57' : undefined} /></td>
                <td className="px-4 py-2.5 text-right font-semibold tabular">{u.open ?? 0}</td>
                <td className={cx('px-4 py-2.5 text-right font-semibold tabular', u.overdue ? 'text-danger' : 'text-faint')}>{u.overdue ?? 0}</td>
                <td className="px-4 py-2.5 text-right tabular text-success">{u.done_week ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-faint">Статусы задач: {TASK_STATUS.map((s) => s.label).join(' → ')}. Время по задачам — в <Link className="text-primary hover:underline" to="/time">тайм-трекере</Link>.</p>
    </div>
  );
}

function SalesTab({ d }: { d: any }) {
  const s = d.sales;
  const sources = s.sources.map((x: any, i: number) => ({ name: SOURCES.find((o) => o.value === x.source)?.label ?? x.source, value: x.count, color: PALETTE[i % PALETTE.length] }));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Сделок в работе" value={s.open.count} icon={<Target className="size-5" />} tone="primary" sub={money(s.open.amount)} />
        <Stat label="Выиграно в месяце" value={money(s.won_month.amount)} icon={<Handshake className="size-5" />} tone="success" sub={`${s.won_month.count} сделок`} />
        <Stat label="Конверсия в победу" value={s.conversion != null ? `${s.conversion}%` : '—'} icon={<TrendingUp className="size-5" />} sub="из закрытых в этом месяце" />
        <Stat label="Средний чек" value={s.won_month.count ? compactMoney(s.won_month.amount / s.won_month.count) : '—'} icon={<CircleDollarSign className="size-5" />} tone="accent" />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Выигранные сделки по месяцам" className="xl:col-span-2">
          <MoneyBars data={s.wonByMonth.map((r: any) => ({ ...r, month: r.month }))} keys={[{ key: 'amount', label: 'Сумма', color: SERIES.income }]} />
        </Card>
        <Card title="Источники сделок" subtitle="за полгода"><Donut data={sources} /></Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Воронка" className="xl:col-span-2"><Funnel stages={s.funnel} /></Card>
        <Card title="Рейтинг менеджеров" subtitle="выиграно за полгода" padded={false}>
          <ul className="divide-y divide-line">
            {s.byManager.map((m: any, i: number) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-4 text-xs font-bold text-faint">{i + 1}</span>
                <Avatar name={m.name} color={m.color} size={28} />
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{m.name}</span><span className="text-xs text-muted">{m.count} сделок</span></span>
                <span className="font-bold tabular">{compactMoney(m.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function InvoicesTab({ d }: { d: any }) {
  const i = d.invoices;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Ждём оплату" value={compactMoney(i.unpaid?.s)} icon={<Receipt className="size-5" />} tone="primary" sub={`${i.unpaid?.c ?? 0} счетов`} />
        <Stat label="Просрочены" value={compactMoney(i.overdue?.s)} icon={<AlarmClock className="size-5" />} tone={i.overdue?.c ? 'danger' : 'default'} sub={`${i.overdue?.c ?? 0} счетов`} />
        <Stat label="Оплачено в этом месяце" value={compactMoney(i.paid_month?.s)} icon={<CheckCircle2 className="size-5" />} tone="success" />
        <Stat label="Черновики" value={i.draft?.c ?? 0} icon={<FileWarning className="size-5" />} sub="ещё не отправлены клиентам" />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Счета к оплате" className="xl:col-span-2" padded={false} actions={<Link to="/crm/invoices" className="text-sm font-semibold text-primary hover:underline">Все счета</Link>}>
          {i.list.length ? (
            <table className="w-full text-sm">
              <tbody>
                {i.list.map((x: any) => {
                  const overdue = x.due_date && x.due_date < new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={x.id} className="border-t border-line first:border-0 hover:bg-surface-2">
                      <td className="px-4 py-2.5"><Link to={`/crm/invoices/${x.id}`} className="font-semibold hover:text-primary">№ {x.number}</Link><div className="text-xs text-muted">{x.company}</div></td>
                      <td className={cx('px-4 py-2.5 text-xs', overdue ? 'font-semibold text-danger' : 'text-muted')}>до {date(x.due_date)}</td>
                      <td className="px-4 py-2.5"><Badge color={INV_STATUS[x.status]?.[1]}>{INV_STATUS[x.status]?.[0]}</Badge></td>
                      <td className="px-4 py-2.5 text-right font-bold tabular">{money(x.total - (x.paid_amount || 0))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <EmptyState compact title="Неоплаченных счетов нет" />}
        </Card>
        <Card title="Счета по статусам">
          <Donut data={i.byStatus.map((x: any) => ({ name: INV_STATUS[x.status]?.[0] ?? x.status, value: x.count, color: INV_STATUS[x.status]?.[1] ?? '#64748b' }))} height={180} />
        </Card>
      </div>
    </div>
  );
}

function FinanceTab({ d }: { d: any }) {
  const f = d.finance;
  const series = f.series.map((r: any) => ({ ...r, net: Math.round(r.income - r.expense) }));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Остаток на всех счетах" value={money(f.balance)} icon={<Wallet className="size-5" />} tone="primary" />
        <Stat label="Поступления за месяц" value={money(f.income_month)} icon={<TrendingUp className="size-5" />} tone="success" />
        <Stat label="Выплаты за месяц" value={money(f.expense_month)} icon={<Receipt className="size-5" />} tone="accent" />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Приход и расход" className="xl:col-span-2">
          <MoneyBars data={series} keys={[{ key: 'income', label: 'Поступления', color: SERIES.income }, { key: 'expense', label: 'Выплаты', color: SERIES.expense }]} />
        </Card>
        <Card title="Остатки по счетам" padded={false}>
          <ul className="divide-y divide-line">
            {f.accounts.map((a: any) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0"><span className="block truncate font-semibold">{a.name}</span><span className="text-xs text-muted">{a.bank_name ?? ({ cash: 'Наличные', card: 'Карта' } as any)[a.kind] ?? ''}</span></span>
                <span className={cx('font-bold tabular', a.balance < 0 && 'text-danger')}>{money(a.balance, { currency: a.currency })}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Чистый денежный поток" subtitle={series.length ? `${monthLabel(series[0].month)} — ${monthLabel(series[series.length - 1].month)}` : ''}>
        <MoneyArea data={series} dataKey="net" color={SERIES.net} label="Чистый поток" />
      </Card>
    </div>
  );
}
