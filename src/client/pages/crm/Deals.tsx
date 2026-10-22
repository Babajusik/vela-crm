import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, CalendarClock, Kanban as KanbanIcon, List as ListIcon, Search } from 'lucide-react';
import { api } from '../../api.ts';
import { SOURCES } from '../../../core/schema.ts';
import { compactMoney, date, money } from '../../lib/format.ts';
import { useAuth, useInvalidate, useList } from '../../lib/state.tsx';
import { Avatar, Button, Card, FormRow, Input, Loading, Modal, Segmented, Select, useToast } from '../../ui/ui.tsx';
import { EntityList, Kanban } from '../../ui/data.tsx';
import { RecordForm } from '../../ui/fields.tsx';
import { CrmHeader } from './Crm.tsx';

export const LOST_REASONS = [
  { value: 'price', label: 'Дорого' }, { value: 'competitor', label: 'Выбрали конкурента' }, { value: 'no_need', label: 'Нет потребности' },
  { value: 'no_answer', label: 'Пропал / не отвечает' }, { value: 'budget', label: 'Нет бюджета' }, { value: 'timing', label: 'Не устроили сроки' }, { value: 'other', label: 'Другое' },
];

export function LostDialog({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('price');
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Причина провала" subtitle="Поможет понять, где теряются деньги"
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="danger" onClick={() => onConfirm(reason)}>Закрыть сделку</Button></>}>
      <FormRow label="Почему не получилось?">
        <Select value={reason} onChange={(e) => setReason(e.target.value)}>{LOST_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select>
      </FormRow>
    </Modal>
  );
}

export default function Deals() {
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const { user } = useAuth();
  const pipelines = useList('pipelines', { limit: 50, sort: 'sort', dir: 'asc' }).data?.items ?? [];
  const [pipe, setPipe] = useState<number | null>(null);
  const pipelineId = pipe ?? pipelines.find((p: any) => p.is_default)?.id ?? pipelines[0]?.id;
  const stages = useList('stages', { pipeline_id: pipelineId, limit: 50, sort: 'sort', dir: 'asc' }, { enabled: !!pipelineId }).data?.items ?? [];
  const [view, setView] = useState<'kanban' | 'list'>(() => (localStorage.getItem('vela-deals-view') as any) ?? 'kanban');
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [source, setSource] = useState('');
  const [create, setCreate] = useState<any>(null);
  const [lost, setLost] = useState<{ deal: any; stage: number } | null>(null);
  const params = { pipeline_id: pipelineId, q, limit: 1000, responsible_id: mine ? user!.id : undefined, source: source || undefined };
  const { data, isLoading } = useList('deals', params, { enabled: !!pipelineId && view === 'kanban' });
  const deals = data?.items ?? [];
  const setV = (v: 'kanban' | 'list') => { setView(v); localStorage.setItem('vela-deals-view', v); };

  const columns = useMemo(() => stages.map((s: any) => {
    const list = deals.filter((d: any) => d.stage_id === s.id);
    const sum = list.reduce((a: number, d: any) => a + (d.amount || 0), 0);
    return { id: s.id, title: s.name, color: s.color, footer: <span className="font-semibold tabular">{compactMoney(sum)}</span>, kind: s.kind };
  }), [stages, deals]);

  const doMove = async (deal: any, stageId: number, reason?: string) => {
    try {
      await api.post(`/api/deals/${deal.id}/move`, { stage_id: stageId, lost_reason: reason });
      inv('deals', 'invoices', 'tasks');
      const st = stages.find((s: any) => s.id === stageId);
      if (st?.kind === 'won') toast.success(`Сделка выиграна: ${deal.title}`);
    } catch (e) { toast.error(e); }
  };
  const move = (deal: any, to: string | number) => {
    const st = stages.find((s: any) => s.id === Number(to));
    if (st?.kind === 'lost') setLost({ deal, stage: st.id });
    else doMove(deal, Number(to));
  };
  const totalOpen = deals.filter((d: any) => stages.find((s: any) => s.id === d.stage_id)?.kind === 'open').reduce((a: number, d: any) => a + (d.amount || 0), 0);

  return (
    <div>
      <CrmHeader title="Сделки" subtitle={view === 'kanban' && deals.length ? `В работе на ${money(totalOpen)}` : 'Воронка продаж'}
        actions={<Segmented value={view} onChange={setV} options={[{ value: 'kanban', label: 'Воронка', icon: <KanbanIcon className="size-4" /> }, { value: 'list', label: 'Список', icon: <ListIcon className="size-4" /> }]} />} />
      {view === 'list' ? (
        <EntityList entity="deals" rowLink={(r) => `/crm/deals/${r.id}`} createLabel="Сделка" canImport
          baseParams={{ pipeline_id: pipelineId }} defaults={{ pipeline_id: pipelineId, responsible_id: user!.id }}
          formFields={['title', 'amount', 'stage_id', 'company_id', 'contact_id', 'responsible_id', 'close_date', 'source', 'tags', 'description']}
          filters={[{ key: 'stage_id', label: 'Стадия', options: stages.map((s: any) => ({ value: String(s.id), label: s.name })) }, { key: 'responsible_id', label: 'Ответственный', type: 'user' }, { key: 'source', label: 'Источник', options: SOURCES }]}
          toolbar={pipelines.length > 1 ? <Select value={pipelineId ?? ''} onChange={(e) => setPipe(Number(e.target.value))} className="w-auto">{pipelines.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select> : undefined}
          columns={['title', 'stage_id', 'amount', 'company_id', 'responsible_id', 'close_date', { key: 'created_at', label: 'Создана', render: (r: any) => date(r.created_at) }]} />
      ) : (
        <Card padded={false}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            {pipelines.length > 1 && <Select value={pipelineId ?? ''} onChange={(e) => setPipe(Number(e.target.value))} className="w-auto font-semibold">{pipelines.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск сделки…" icon={<Search className="size-4" />} className="w-full sm:w-60" />
            <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-auto"><option value="">Источник: все</option>{SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold"><input type="checkbox" className="size-4 accent-[var(--c-primary)]" checked={mine} onChange={(e) => setMine(e.target.checked)} />Только мои</label>
            <Button variant="primary" className="ml-auto" onClick={() => setCreate({ pipeline_id: pipelineId, stage_id: stages[0]?.id, responsible_id: user!.id })}>Новая сделка</Button>
          </div>
          <div className="p-3">
            {isLoading ? <Loading /> : (
              <Kanban columns={columns} items={deals} groupOf={(d: any) => d.stage_id} onMove={move} onCardClick={(d) => nav(`/crm/deals/${d.id}`)}
                onAdd={(col) => setCreate({ pipeline_id: pipelineId, stage_id: col, responsible_id: user!.id })}
                renderCard={(d: any) => (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold leading-snug">{d.title}</p>
                    {d._ref?.company_id && <p className="flex items-center gap-1.5 truncate text-xs text-muted"><Building2 className="size-3.5 shrink-0" />{d._ref.company_id.title}</p>}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-extrabold tabular">{money(d.amount)}</span>
                      <span className="flex items-center gap-2">
                        {d.close_date && <span className={`flex items-center gap-1 text-xs ${d.close_date < new Date().toISOString().slice(0, 10) && stages.find((s: any) => s.id === d.stage_id)?.kind === 'open' ? 'font-semibold text-danger' : 'text-faint'}`}><CalendarClock className="size-3.5" />{date(d.close_date).slice(0, 5)}</span>}
                        {d._ref?.responsible_id && <Avatar name={d._ref.responsible_id.title} color={d._ref.responsible_id.color} size={22} />}
                      </span>
                    </div>
                  </div>
                )} />
            )}
          </div>
        </Card>
      )}
      <RecordForm entity="deals" open={!!create} onClose={() => setCreate(null)} initial={create} onSaved={(r) => nav(`/crm/deals/${r.id}`)}
        fields={['title', 'amount', 'stage_id', 'company_id', 'contact_id', 'responsible_id', 'close_date', 'source', 'description']} />
      <LostDialog open={!!lost} onClose={() => setLost(null)} onConfirm={(r) => { if (lost) doMove(lost.deal, lost.stage, r); setLost(null); }} />
    </div>
  );
}
