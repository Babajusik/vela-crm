import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { addDaysIso, dateLong, money, todayIso } from '../../lib/format.ts';
import { useApi } from '../../lib/state.tsx';
import { Badge, Card, FormRow, Input, Loading, Stat, cx } from '../../ui/ui.tsx';
import { MoneyArea, SERIES } from '../../ui/charts.tsx';
import { FinHeader } from './Finance.tsx';
import { NewOperationButtons } from './Overview.tsx';

const SRC: Record<string, [string, string]> = {
  plan: ['План', '#6366F1'], overdue_plan: ['План, просрочен', '#ef4444'], invoice: ['Счёт клиенту', '#0ea5e9'],
  overdue_invoice: ['Счёт просрочен', '#f59e0b'], obligation: ['Обязательство', '#a855f7'],
};

export function PaymentCalendar() {
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(addDaysIso(todayIso(), 30));
  const { data: c, isLoading } = useApi<any>(['finance', 'calendar'], '/api/finance/calendar', { from, to });
  return (
    <div>
      <FinHeader title="Платёжный календарь" subtitle="Плановые поступления и выплаты, прогноз остатка по дням" actions={<NewOperationButtons />} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormRow label="С"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></FormRow>
        <FormRow label="По"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></FormRow>
      </div>
      {isLoading || !c ? <Loading /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Остаток на начало" value={money(c.startBalance)} tone="primary" />
            <Stat label="Ожидаем поступлений" value={money(c.items.filter((i: any) => i.kind === 'income').reduce((s: number, i: any) => s + i.amount, 0))} tone="success" />
            <Stat label="Запланировано выплат" value={money(c.items.filter((i: any) => i.kind === 'expense').reduce((s: number, i: any) => s + i.amount, 0))} tone="accent" />
          </div>
          {c.gap && <div className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-semibold text-danger"><AlertTriangle className="size-5" />Кассовый разрыв: {dateLong(c.gap)} остаток уходит в минус.</div>}
          <Card title="Прогноз остатка"><MoneyArea data={c.days} dataKey="balance" xKey="date" color={SERIES.income} label="Остаток" height={240} /></Card>
          <Card title="Платежи по дням" padded={false}>
            {c.items.length ? (
              <ul className="divide-y divide-line">
                {c.days.filter((d: any) => d.income || d.expense).map((d: any) => (
                  <li key={d.date} className="px-4 py-3">
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="font-bold">{dateLong(d.date)}</span>
                      <span className="text-xs text-muted">остаток на конец дня: <b className={cx('tabular', d.balance < 0 ? 'text-danger' : 'text-fg')}>{money(d.balance)}</b></span>
                    </div>
                    <ul className="space-y-1">
                      {c.items.filter((i: any) => i.date === d.date).map((i: any) => (
                        <li key={i.source + i.id} className="flex items-center gap-3 text-sm">
                          <Badge color={SRC[i.source]?.[1]}>{SRC[i.source]?.[0]}</Badge>
                          {i.link ? <Link to={i.link} className="min-w-0 flex-1 truncate hover:text-primary">{i.title}</Link> : <span className="min-w-0 flex-1 truncate">{i.title}</span>}
                          <span className={cx('font-semibold tabular', i.kind === 'income' ? 'text-success' : 'text-danger')}>{i.kind === 'income' ? '+' : '−'}{money(i.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 py-8 text-center text-sm text-muted">Плановых платежей в этом периоде нет. Добавьте операцию со статусом «План».</p>}
          </Card>
        </div>
      )}
    </div>
  );
}
