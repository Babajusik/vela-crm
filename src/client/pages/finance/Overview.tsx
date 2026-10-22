import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, CalendarClock, CreditCard, Landmark, Receipt, Wallet } from 'lucide-react';
import { compactMoney, date, money, todayIso } from '../../lib/format.ts';
import { useApi, useAuth, useMeta } from '../../lib/state.tsx';
import { Button, Card, Loading, Stat, cx } from '../../ui/ui.tsx';
import { EntityList } from '../../ui/data.tsx';
import { RecordForm } from '../../ui/fields.tsx';
import { MoneyArea, MoneyBars, SERIES } from '../../ui/charts.tsx';
import { FinHeader } from './Finance.tsx';

const ACC_ICON: Record<string, React.ReactNode> = { bank: <Landmark className="size-5" />, cash: <Banknote className="size-5" />, card: <CreditCard className="size-5" />, ewallet: <Wallet className="size-5" /> };

export function NewOperationButtons() {
  const { can } = useAuth();
  const [form, setForm] = useState<any>(null);
  if (!can('finance', 'write')) return null;
  const base = { date: todayIso(), status: 'fact' };
  return (
    <>
      <Button icon={<ArrowDownLeft className="size-4 text-success" />} onClick={() => setForm({ ...base, kind: 'income' })}>Поступление</Button>
      <Button icon={<ArrowUpRight className="size-4 text-danger" />} onClick={() => setForm({ ...base, kind: 'expense' })}>Выплата</Button>
      <Button icon={<ArrowLeftRight className="size-4 text-primary" />} onClick={() => setForm({ ...base, kind: 'transfer' })}>Перемещение</Button>
      <RecordForm entity="fin_operations" open={!!form} onClose={() => setForm(null)} initial={form}
        title={form?.kind === 'income' ? 'Новое поступление' : form?.kind === 'expense' ? 'Новая выплата' : 'Перемещение между счетами'}
        fields={form?.kind === 'transfer' ? ['date', 'amount', 'account_id', 'to_account_id', 'description', 'status'] : ['date', 'amount', 'account_id', 'category_id', 'company_id', 'project_id', 'deal_id', 'description', 'status']} />
    </>
  );
}

export function FinanceOverview() {
  const { data: s, isLoading } = useApi<any>(['finance', 'summary'], '/api/finance/summary');
  const cal = useApi<any>(['finance', 'calendar', 'short'], '/api/finance/calendar').data;
  return (
    <div>
      <FinHeader title="Финансы" subtitle="Деньги компании: остатки, движение, прогноз" actions={<NewOperationButtons />} />
      {isLoading || !s ? <Loading /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Остаток на всех счетах" value={money(s.balance)} icon={<Wallet className="size-5" />} tone="primary" />
            <Stat label="Поступления за 12 мес." value={compactMoney(s.income)} icon={<ArrowDownLeft className="size-5" />} tone="success" />
            <Stat label="Выплаты за 12 мес." value={compactMoney(s.expense)} icon={<ArrowUpRight className="size-5" />} tone="accent" />
            <Stat label="Ждём от клиентов" value={compactMoney(s.receivable.amount)} icon={<Receipt className="size-5" />} sub={`${s.receivable.count} неоплаченных счетов`} />
          </div>
          {cal?.gap && (
            <Link to="/finance/calendar" className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
              <CalendarClock className="size-5" />По платёжному календарю {date(cal.gap)} денег может не хватить. Проверьте плановые платежи.
            </Link>
          )}
          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Поступления и выплаты" className="xl:col-span-2">
              <MoneyBars data={s.series} keys={[{ key: 'income', label: 'Поступления', color: SERIES.income }, { key: 'expense', label: 'Выплаты', color: SERIES.expense }]} height={280} />
            </Card>
            <Card title="Счета и кассы" padded={false} actions={<Link to="/finance/accounts" className="text-sm font-semibold text-primary hover:underline">Все</Link>}>
              <ul className="divide-y divide-line">
                {s.accounts.filter((a: any) => !a.is_archived).map((a: any) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-muted">{ACC_ICON[a.kind]}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{a.name}</span><span className="text-xs text-muted">{a.bank_name ?? a.currency}</span></span>
                    <span className={cx('font-bold tabular', a.balance < 0 && 'text-danger')}>{money(a.balance, { currency: a.currency })}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Чистый поток по месяцам" className="xl:col-span-2"><MoneyArea data={s.series} dataKey="net" color={SERIES.net} label="Чистый поток" /></Card>
            <Card title="Крупнейшие расходы" subtitle="за 12 месяцев">
              <ul className="space-y-2.5 text-sm">
                {s.topExpense.map((c: any) => {
                  const max = s.topExpense[0]?.amount || 1;
                  return (
                    <li key={c.name ?? 'none'}>
                      <div className="mb-1 flex justify-between gap-2"><span className="truncate text-muted">{c.name ?? 'Без статьи'}</span><span className="font-semibold tabular">{compactMoney(c.amount)}</span></div>
                      <div className="h-1.5 rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${(c.amount / max) * 100}%` }} /></div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

export function Operations() {
  const { field } = useMeta();
  return (
    <div>
      <FinHeader title="Операции" subtitle="Все поступления, выплаты и перемещения" actions={<NewOperationButtons />} />
      <EntityList entity="fin_operations" canImport createLabel="Операция" defaults={{ date: todayIso(), kind: 'expense', status: 'fact' }}
        filters={[{ key: 'kind', label: 'Тип', options: field('fin_operations', 'kind')?.options }, { key: 'status', label: 'Статус', options: field('fin_operations', 'status')?.options }]}
        formFields={['kind', 'date', 'amount', 'account_id', 'to_account_id', 'category_id', 'company_id', 'project_id', 'deal_id', 'invoice_id', 'employee_id', 'description', 'status']}
        columns={['date', 'kind', { key: 'amount', label: 'Сумма', align: 'right', render: (r: any) => <b className={cx('tabular', r.kind === 'income' ? 'text-success' : r.kind === 'expense' ? 'text-danger' : '')}>{r.kind === 'income' ? '+' : r.kind === 'expense' ? '−' : ''}{money(r.amount)}</b> },
          'account_id', 'category_id', 'company_id', 'project_id', 'description', 'status']} />
    </div>
  );
}

export function Accounts() {
  const balances = useApi<any[]>(['finance', 'balances'], '/api/finance/balances').data ?? [];
  const bal = (id: number) => balances.find((b) => b.id === id);
  return (
    <div>
      <FinHeader title="Счета и кассы" subtitle="Расчётные счета, кассы, карты и их остатки" />
      <EntityList entity="fin_accounts" createLabel="Счёт" defaults={{ kind: 'bank', currency: 'RUB', opening_balance: 0, opening_date: todayIso() }}
        columns={['name', 'kind', 'bank_name', 'currency', { key: 'balance', label: 'Остаток', align: 'right', render: (r: any) => <b className="tabular">{money(bal(r.id)?.balance ?? 0, { currency: r.currency })}</b> }, 'is_archived']} />
    </div>
  );
}
