import { useState } from 'react';
import { AlertTriangle, FolderPlus } from 'lucide-react';
import { money, num, todayIso } from '../lib/format.ts';
import { useAuth, useList, useMeta } from '../lib/state.tsx';
import { Badge, Button, Card, PageHeader, Tabs, cx } from '../ui/ui.tsx';
import { EntityList } from '../ui/data.tsx';
import { RecordForm } from '../ui/fields.tsx';

export default function Catalog() {
  const { field } = useMeta();
  const { can } = useAuth();
  const [tab, setTab] = useState<'products' | 'moves'>('products');
  const [cat, setCat] = useState<number | null>(null);
  const [catForm, setCatForm] = useState<any>(null);
  const cats = useList('product_categories', { limit: 500 }).data?.items ?? [];
  const low = useList('products', { kind: 'product', limit: 500, expand: 0 }).data?.items.filter((p: any) => p.min_stock && p.stock <= p.min_stock) ?? [];
  return (
    <div>
      <PageHeader title="Каталог" subtitle="Товары и услуги, цены и складские остатки. Синхронизируется с номенклатурой 1С."
        actions={can('catalog', 'write') && <Button icon={<FolderPlus className="size-4" />} onClick={() => setCatForm({})}>Категория</Button>} />
      {low.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 text-warning" />
          <span><b>Заканчиваются:</b> {low.map((p: any) => `${p.name} (${num(p.stock)} ${p.unit})`).join(', ')}</span>
        </div>
      )}
      <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: 'products', label: 'Товары и услуги' }, { value: 'moves', label: 'Движения на складе' }]} />
      {tab === 'products' ? (
        <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
          <Card padded={false} className="h-fit">
            <ul className="p-1.5">
              <li><button type="button" onClick={() => setCat(null)} className={cx('w-full rounded-lg px-3 py-2 text-left text-sm font-semibold', !cat ? 'bg-primary-soft text-primary' : 'hover:bg-surface-2')}>Все категории</button></li>
              {cats.map((c: any) => (
                <li key={c.id}><button type="button" onClick={() => setCat(c.id)} className={cx('w-full truncate rounded-lg px-3 py-2 text-left text-sm font-semibold', cat === c.id ? 'bg-primary-soft text-primary' : 'hover:bg-surface-2', c.parent_id && 'pl-6')}>{c.name}</button></li>
              ))}
            </ul>
          </Card>
          <EntityList entity="products" canImport baseParams={{ category_id: cat ?? undefined }} defaults={{ category_id: cat, kind: 'product', unit: 'шт', vat: '22', is_active: 1 }} createLabel="Товар"
            filters={[{ key: 'kind', label: 'Тип', options: field('products', 'kind')?.options }]}
            formFields={['name', 'sku', 'kind', 'category_id', 'unit', 'price', 'purchase_price', 'vat', 'stock', 'min_stock', 'barcode', 'description', 'is_active']}
            columns={['name', 'sku', 'kind', 'category_id', { key: 'price', label: 'Цена', align: 'right', render: (r: any) => <span className="font-semibold tabular">{money(r.price)}</span> },
              { key: 'stock', label: 'Остаток', align: 'right', render: (r: any) => r.kind === 'service' ? <span className="text-faint">—</span> : <span className={cx('tabular', r.min_stock && r.stock <= r.min_stock && 'font-bold text-danger')}>{num(r.stock, 2)} {r.unit}</span> },
              { key: 'onec_guid', label: '1С', render: (r: any) => r.onec_guid ? <Badge color="#F59E0B">1С</Badge> : null, sortable: false }]} />
        </div>
      ) : (
        <EntityList entity="stock_moves" createLabel="Движение" defaults={{ date: todayIso(), kind: 'in' }}
          filters={[{ key: 'kind', label: 'Тип', options: field('stock_moves', 'kind')?.options }]}
          columns={['date', 'product_id', 'kind', 'qty', 'reason', 'company_id']} />
      )}
      <RecordForm entity="product_categories" open={!!catForm} onClose={() => setCatForm(null)} initial={catForm?.id ? catForm : null} fields={['name', 'parent_id']} size="md" />
    </div>
  );
}
