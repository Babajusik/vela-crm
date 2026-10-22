import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../api.ts';
import { compactMoney, monthShort } from '../../lib/format.ts';
import { useApi, useAuth, useInvalidate, useList } from '../../lib/state.tsx';
import { Button, Card, EmptyState, Loading, Select, cx, useToast } from '../../ui/ui.tsx';
import { RecordForm, RefSelect } from '../../ui/fields.tsx';
import { FinHeader } from './Finance.tsx';

export function Budgets() {
  const budgets = useList('budgets', { limit: 100 }).data?.items ?? [];
  const [sel, setSel] = useState<number | null>(null);
  const [form, setForm] = useState<any>(null);
  const { can } = useAuth();
  const id = sel ?? budgets[0]?.id;
  return (
    <div>
      <FinHeader title="Бюджеты" subtitle="План доходов и расходов по месяцам и сравнение с фактом"
        actions={can('finance', 'write') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ year: new Date().getFullYear(), status: 'draft' })}>Бюджет</Button>} />
      {budgets.length > 1 && (
        <Select value={id ?? ''} onChange={(e) => setSel(Number(e.target.value))} className="mb-4 w-auto">{budgets.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
      )}
      {id ? <PlanFact id={id} /> : <EmptyState title="Бюджетов нет" text="Создайте бюджет на год и заполните план по статьям." />}
      <RecordForm entity="budgets" open={!!form} onClose={() => setForm(null)} initial={form} onSaved={(r) => setSel(r.id)} />
    </div>
  );
}

function PlanFact({ id }: { id: number }) {
  const { data, isLoading } = useApi<any>(['finance', 'budget', id], `/api/finance/budgets/${id}`);
  const inv = useInvalidate();
  const toast = useToast();
  const { can } = useAuth();
  const [cat, setCat] = useState<number | null>(null);
  if (isLoading || !data) return <Loading />;
  const writable = can('finance', 'write');
  const setPlan = async (categoryId: number, month: number, value: number) => {
    try {
      const existing = await api.get('/api/e/budget_lines', { budget_id: id, category_id: categoryId, month, limit: 1, expand: 0 });
      if (existing.items[0]) await api.patch(`/api/e/budget_lines/${existing.items[0].id}`, { amount: value });
      else await api.post('/api/e/budget_lines', { budget_id: id, category_id: categoryId, month, amount: value });
      inv('finance');
    } catch (e) { toast.error(e); }
  };
  const addCategory = async () => {
    if (!cat) return;
    for (let m = 1; m <= 12; m++) await api.post('/api/e/budget_lines', { budget_id: id, category_id: cat, month: m, amount: 0 });
    setCat(null);
    inv('finance');
  };
  const total = (kind: string, arr: 'plan' | 'fact', m: number) => data.rows.filter((r: any) => r.kind === kind).reduce((s: number, r: any) => s + r[arr][m], 0);
  return (
    <Card padded={false} title={data.budget.name} subtitle="Верхняя строка — план (можно редактировать), нижняя — факт из операций">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead><tr className="text-xs font-bold uppercase tracking-wide text-faint"><th className="sticky left-0 border-b border-line bg-surface px-3 py-2.5 text-left">Статья</th>
            {Array.from({ length: 12 }, (_, m) => <th key={m} className="border-b border-line px-2 py-2.5 text-right">{monthShort(m)}</th>)}<th className="border-b border-line px-3 py-2.5 text-right">Год</th></tr></thead>
          <tbody>
            {data.rows.map((r: any) => {
              const planY = r.plan.reduce((a: number, b: number) => a + b, 0), factY = r.fact.reduce((a: number, b: number) => a + b, 0);
              const good = r.kind === 'income' ? factY >= planY : factY <= planY;
              return (
                <tr key={r.id} className="align-top">
                  <td className="sticky left-0 border-b border-line bg-surface px-3 py-2">
                    <span className={cx('mr-2 inline-block size-1.5 rounded-full align-middle', r.kind === 'income' ? 'bg-success' : 'bg-danger')} />
                    <span className="font-semibold">{r.name}</span>
                  </td>
                  {r.plan.map((v: number, m: number) => (
                    <td key={m} className="border-b border-line px-1 py-1 text-right">
                      {writable ? <input defaultValue={v || ''} placeholder="0" onBlur={(e) => Number(e.target.value || 0) !== v && setPlan(r.id, m + 1, Number(e.target.value || 0))}
                        className="h-7 w-20 rounded border border-transparent bg-transparent px-1 text-right text-xs tabular hover:border-line focus:border-primary focus:outline-none" /> : <span className="text-xs tabular">{compactMoney(v)}</span>}
                      <div className={cx('px-1 text-[11px] tabular', r.fact[m] ? (r.kind === 'income' ? (r.fact[m] >= v ? 'text-success' : 'text-warning') : (r.fact[m] <= v ? 'text-success' : 'text-danger')) : 'text-faint')}>{r.fact[m] ? compactMoney(r.fact[m]).replace(' ₽', '') : '—'}</div>
                    </td>
                  ))}
                  <td className="border-b border-line px-3 py-2 text-right text-xs tabular"><div className="font-bold">{compactMoney(planY)}</div><div className={good ? 'text-success' : 'text-danger'}>{compactMoney(factY)}</div></td>
                </tr>
              );
            })}
            {(['income', 'expense'] as const).map((k) => (
              <tr key={k} className="bg-surface-2/60 font-bold">
                <td className="sticky left-0 border-b border-line bg-surface-2 px-3 py-2">{k === 'income' ? 'Итого доходы' : 'Итого расходы'}</td>
                {Array.from({ length: 12 }, (_, m) => <td key={m} className="border-b border-line px-2 py-2 text-right text-xs tabular"><div>{compactMoney(total(k, 'plan', m)).replace(' ₽', '')}</div><div className="font-normal text-muted">{compactMoney(total(k, 'fact', m)).replace(' ₽', '')}</div></td>)}
                <td className="border-b border-line" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {writable && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
          <div className="w-72"><RefSelect entity="fin_categories" value={cat} onChange={setCat} placeholder="Добавить статью в бюджет" /></div>
          <Button size="sm" disabled={!cat} onClick={addCategory}>Добавить</Button>
        </div>
      )}
    </Card>
  );
}
