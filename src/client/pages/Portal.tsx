import { useState } from 'react';
import { Building2, Eye, Printer } from 'lucide-react';
import { openPrint } from '../api.ts';
import { date, money } from '../lib/format.ts';
import { useList, useMeta } from '../lib/state.tsx';
import { Badge, Card, EmptyState, PageHeader, Progress, Tabs } from '../ui/ui.tsx';
import { EntityList } from '../ui/data.tsx';
import { RefSelect } from '../ui/fields.tsx';

export default function Portal() {
  const [tab, setTab] = useState<'requests' | 'preview'>('requests');
  const { field } = useMeta();
  return (
    <div>
      <PageHeader title="Кабинет клиента" subtitle="Клиент видит свои счета, акты и ход проектов, а также пишет обращения — они становятся задачами" />
      <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: 'requests', label: 'Обращения клиентов' }, { value: 'preview', label: 'Как видит клиент' }]} />
      {tab === 'requests' ? (
        <EntityList entity="portal_requests" createLabel="Обращение" filters={[{ key: 'status', label: 'Статус', options: field('portal_requests', 'status')?.options }]}
          columns={['subject', 'company_id', 'contact_id', 'status', 'task_id', { key: 'created_at', label: 'Создано', render: (r: any) => date(r.created_at) }]}
          formFields={['company_id', 'contact_id', 'subject', 'text', 'status', 'task_id', 'answer']} />
      ) : <Preview />}
    </div>
  );
}

function Preview() {
  const [company, setCompany] = useState<number | null>(null);
  const invoices = useList('invoices', { company_id: company ?? -1, limit: 50 }, { enabled: !!company }).data?.items ?? [];
  const acts = useList('acts', { company_id: company ?? -1, limit: 50 }, { enabled: !!company }).data?.items ?? [];
  const projects = useList('projects', { company_id: company ?? -1, limit: 50 }, { enabled: !!company }).data?.items ?? [];
  const reqs = useList('portal_requests', { company_id: company ?? -1, limit: 50 }, { enabled: !!company }).data?.items ?? [];
  const { field } = useMeta();
  const st = (e: string, v: string) => field(e, 'status')?.options?.find((o) => o.value === v);
  return (
    <div className="space-y-4">
      <div className="max-w-sm"><RefSelect entity="companies" value={company} onChange={setCompany} placeholder="Выберите клиента для предпросмотра" /></div>
      {!company ? <EmptyState icon={<Eye />} title="Выберите компанию" text="Покажем кабинет её глазами: только её счета, акты, проекты и обращения." /> : (
        <div className="rounded-2xl border-4 border-primary-soft p-4">
          <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-muted"><Building2 className="size-4" />Вид для клиента</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Счета" padded={false}>
              <ul className="divide-y divide-line">{invoices.map((i: any) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1">№ {i.number} от {date(i.date)}</span><Badge color={st('invoices', i.status)?.color}>{st('invoices', i.status)?.label}</Badge>
                  <span className="w-28 text-right font-semibold tabular">{money(i.total)}</span>
                  <button type="button" aria-label="Распечатать счёт" onClick={() => openPrint(`/api/print/invoice/${i.id}`)}><Printer className="size-4 text-faint hover:text-primary" /></button>
                </li>))}{!invoices.length && <li className="px-4 py-6 text-sm text-faint">Счетов нет</li>}</ul>
            </Card>
            <Card title="Акты" padded={false}>
              <ul className="divide-y divide-line">{acts.map((a: any) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1">№ {a.number} от {date(a.date)}</span><Badge color={st('acts', a.status)?.color}>{st('acts', a.status)?.label}</Badge>
                  <button type="button" aria-label="Распечатать акт" onClick={() => openPrint(`/api/print/act/${a.id}`)}><Printer className="size-4 text-faint hover:text-primary" /></button>
                </li>))}{!acts.length && <li className="px-4 py-6 text-sm text-faint">Актов нет</li>}</ul>
            </Card>
            <Card title="Проекты">{projects.map((p: any) => <div key={p.id} className="mb-3"><p className="text-sm font-semibold">{p.name}</p><p className="text-xs text-muted">{date(p.start_date)} — {date(p.end_date)}</p><Progress value={p.status === 'done' ? 100 : 50} className="mt-1.5" /></div>)}{!projects.length && <p className="text-sm text-faint">Проектов нет</p>}</Card>
            <Card title="Обращения">{reqs.map((r: any) => <div key={r.id} className="mb-2 flex items-center gap-2 text-sm"><span className="flex-1">{r.subject}</span><Badge color={st('portal_requests', r.status)?.color}>{st('portal_requests', r.status)?.label}</Badge></div>)}{!reqs.length && <p className="text-sm text-faint">Обращений нет</p>}</Card>
          </div>
        </div>
      )}
    </div>
  );
}
