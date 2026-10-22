// Editable product lines for deals, invoices and acts
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../api.ts';
import { UNITS, VAT_RATES } from '../../../core/schema.ts';
import { money } from '../../lib/format.ts';
import { useInvalidate, useList } from '../../lib/state.tsx';
import { Button, EmptyState, IconButton, Select, useToast } from '../../ui/ui.tsx';
import { RefSelect } from '../../ui/fields.tsx';

const lineSum = (l: any) => Number(l.qty || 0) * Number(l.price || 0) * (1 - Number(l.discount || 0) / 100);

export function totals(lines: any[], vatMode = 'included') {
  let subtotal = 0, vat = 0;
  for (const l of lines) {
    const s = lineSum(l);
    const r = Number(l.vat ?? -1);
    subtotal += s;
    if (vatMode !== 'none' && r > 0) vat += vatMode === 'on_top' ? (s * r) / 100 : (s * r) / (100 + r);
  }
  return { subtotal, vat, total: vatMode === 'on_top' ? subtotal + vat : subtotal };
}

export function LinesEditor({ entity, parentField, parentId, vatMode = 'included', readOnly, withDiscount = true, also = [] }: {
  entity: 'deal_products' | 'invoice_items' | 'act_items' | 'offer_items'; parentField: string; parentId: number; vatMode?: string; readOnly?: boolean; withDiscount?: boolean; also?: string[];
}) {
  const { data } = useList(entity, { [parentField]: parentId, limit: 500, sort: 'id', dir: 'asc' });
  const inv = useInvalidate();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const lines = data?.items ?? [];
  const refresh = () => inv(entity, ...also);
  const patch = async (id: number, d: Record<string, unknown>) => {
    try { await api.patch(`/api/e/${entity}/${id}`, d); refresh(); } catch (e) { toast.error(e); }
  };
  const add = async (productId: number | null, p?: any) => {
    if (!productId) return;
    try {
      await api.post(`/api/e/${entity}`, { [parentField]: parentId, product_id: productId, qty: 1, price: p?.price, unit: p?.unit, vat: p?.vat });
      setAdding(false);
      refresh();
    } catch (e) { toast.error(e); }
  };
  const addFree = async () => {
    try { await api.post(`/api/e/${entity}`, { [parentField]: parentId, name: 'Новая позиция', qty: 1, price: 0, unit: 'шт', vat: '22' }); refresh(); }
    catch (e) { toast.error(e); }
  };
  const t = totals(lines, vatMode);
  const cell = 'border-b border-line px-2 py-1.5';
  const num = 'h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-right text-sm tabular hover:border-line focus:border-primary focus:bg-surface focus:outline-none';
  return (
    <div>
      {lines.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-faint">
                <th className="px-2 py-2">Наименование</th><th className="w-24 px-2 py-2 text-right">Кол-во</th><th className="w-20 px-2 py-2">Ед.</th>
                <th className="w-32 px-2 py-2 text-right">Цена</th>{withDiscount && <th className="w-24 px-2 py-2 text-right">Скидка, %</th>}
                <th className="w-24 px-2 py-2">НДС</th><th className="w-32 px-2 py-2 text-right">Сумма</th><th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l: any) => (
                <tr key={l.id} className="group">
                  <td className={cell}>
                    {readOnly ? l.name : <input defaultValue={l.name} onBlur={(e) => e.target.value !== l.name && patch(l.id, { name: e.target.value })} className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 hover:border-line focus:border-primary focus:bg-surface focus:outline-none" />}
                  </td>
                  <td className={cell}>{readOnly ? <span className="block text-right">{l.qty}</span> : <input type="number" step="any" defaultValue={l.qty} onBlur={(e) => Number(e.target.value) !== l.qty && patch(l.id, { qty: Number(e.target.value) })} className={num} />}</td>
                  <td className={cell}>{readOnly ? l.unit : <Select value={l.unit ?? 'шт'} onChange={(e) => patch(l.id, { unit: e.target.value })} className="h-8 px-2">{UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</Select>}</td>
                  <td className={cell}>{readOnly ? <span className="block text-right">{money(l.price)}</span> : <input type="number" step="any" defaultValue={l.price} onBlur={(e) => Number(e.target.value) !== l.price && patch(l.id, { price: Number(e.target.value) })} className={num} />}</td>
                  {withDiscount && <td className={cell}>{readOnly ? <span className="block text-right">{l.discount || 0}</span> : <input type="number" step="any" defaultValue={l.discount ?? 0} onBlur={(e) => Number(e.target.value) !== (l.discount ?? 0) && patch(l.id, { discount: Number(e.target.value) })} className={num} />}</td>}
                  <td className={cell}>{readOnly ? VAT_RATES.find((v) => v.value === String(l.vat))?.label : <Select value={String(l.vat ?? '22')} onChange={(e) => patch(l.id, { vat: e.target.value })} className="h-8 px-2">{VAT_RATES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</Select>}</td>
                  <td className={`${cell} text-right font-semibold tabular`}>{money(lineSum(l), { cents: true })}</td>
                  <td className={cell}>{!readOnly && <IconButton label="Удалить позицию" className="size-8 opacity-0 group-hover:opacity-100" onClick={async () => { await api.del(`/api/e/${entity}/${l.id}`); refresh(); }}><Trash2 className="size-4" /></IconButton>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState compact title="Позиций пока нет" text="Добавьте товары или услуги из каталога — сумма посчитается сама." />}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {adding ? (
              <div className="w-80"><RefSelect entity="products" value={null} onChange={add} placeholder="Выберите товар или услугу" /></div>
            ) : <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Из каталога</Button>}
            <Button size="sm" variant="ghost" onClick={addFree}>Произвольная позиция</Button>
          </div>
        )}
        {lines.length > 0 && (
          <dl className="ml-auto grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted">Итого</dt><dd className="text-right tabular">{money(t.subtotal, { cents: true })}</dd>
            <dt className="text-muted">{vatMode === 'none' ? 'Без НДС' : vatMode === 'on_top' ? 'НДС сверху' : 'В т. ч. НДС'}</dt><dd className="text-right tabular">{vatMode === 'none' ? '—' : money(t.vat, { cents: true })}</dd>
            <dt className="font-bold">Всего</dt><dd className="text-right text-base font-extrabold tabular">{money(t.total, { cents: true })}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}
