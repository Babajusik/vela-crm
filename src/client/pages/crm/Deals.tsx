import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Filter, MessageSquare, Plus, Search, X } from 'lucide-react';
import { api } from '../../api.ts';
import { SOURCES } from '../../../core/schema.ts';
import { compactMoney, date, hexAlpha, money } from '../../lib/format.ts';
import { useApi, useAuth, useInvalidate, useList } from '../../lib/state.tsx';
import { Avatar, Badge, Button, Card, FormRow, Input, Loading, MenuItem, Modal, Popover, Select, SlideOver, cx, useToast } from '../../ui/ui.tsx';
import { DataTable, Kanban } from '../../ui/data.tsx';
import { RecordForm } from '../../ui/fields.tsx';
import { CrmHeader } from './Crm.tsx';
import { DealCard } from './DealPage.tsx';
import { ModuleTabs } from '../../layout/Layout.tsx';

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

type Tab = 'kanban' | 'active' | 'archive' | 'all';
type Quick = '' | 'today' | 'none' | 'overdue';

function Chip({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const cur = options.find((o) => o.value === value);
  return (
    <Popover trigger={({ toggle }) => (
      <button type="button" onClick={toggle} className={cx('inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium', value ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface hover:border-line-strong')}>
        {cur ? `${label}: ${cur.label}` : label}
        {value ? <X className="size-3.5" onClick={(e) => { e.stopPropagation(); onChange(''); }} /> : <ChevronDown className="size-3.5 text-faint" />}
      </button>
    )}>
      {(close) => <div className="max-h-72 w-56 overflow-y-auto">{options.map((o) => <MenuItem key={o.value} active={o.value === value} onClick={() => { onChange(o.value); close(); }}>{o.label}</MenuItem>)}</div>}
    </Popover>
  );
}

export default function Deals() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const { user } = useAuth();
  const [sp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'kanban';
  const pipelines = useList('pipelines', { limit: 50, sort: 'sort', dir: 'asc' }).data?.items ?? [];
  const [pipe, setPipe] = useState<number | null>(null);
  const pipelineId = pipe ?? pipelines.find((p: any) => p.is_default)?.id ?? pipelines[0]?.id;
  const pipeline = pipelines.find((p: any) => p.id === pipelineId);
  const stages = useList('stages', { pipeline_id: pipelineId, limit: 50, sort: 'sort', dir: 'asc' }, { enabled: !!pipelineId }).data?.items ?? [];
  const users = useList('users', { is_active: 1, limit: 500, expand: 0 }).data?.items ?? [];
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [stage, setStage] = useState('');
  const [resp, setResp] = useState('');
  const [quick, setQuick] = useState<Quick>('');
  const [create, setCreate] = useState<any>(null);
  const [lost, setLost] = useState<{ deal: any; stage: number } | null>(null);
  const params: Record<string, any> = { pipeline_id: pipelineId, q, limit: 1000, source: source || undefined, stage_id: stage || undefined, responsible_id: resp || undefined };
  if (tab === 'archive') params.is_archived = 1; else if (tab !== 'all') params.is_archived__ne = 1;
  const { data, isLoading } = useList('deals', params, { enabled: !!pipelineId });
  const flags = useApi<Record<string, { overdue: number; today: number; open: number; comments: number }>>(['crm_activities', 'flags'], '/api/crm/activity-flags').data ?? {};
  const all = data?.items ?? [];
  const stageKind = (sid: number) => stages.find((s: any) => s.id === sid)?.kind;
  const byQuick = (d: any) => {
    const f = flags[d.id];
    if (quick === 'today') return !!f?.today;
    if (quick === 'overdue') return !!f?.overdue;
    if (quick === 'none') return !f?.open && stageKind(d.stage_id) === 'open';
    return true;
  };
  const deals = all.filter(byQuick).filter((d: any) => tab !== 'active' || stageKind(d.stage_id) === 'open');
  const counts = useMemo(() => ({
    today: all.filter((d: any) => flags[d.id]?.today).length,
    none: all.filter((d: any) => !flags[d.id]?.open && stageKind(d.stage_id) === 'open').length,
    overdue: all.filter((d: any) => flags[d.id]?.overdue).length,
  }), [all, flags, stages]);

  const columns = useMemo(() => stages.map((s: any) => {
    const list = deals.filter((d: any) => d.stage_id === s.id);
    return { id: s.id, title: s.name, color: s.color, kind: s.kind, sum: list.reduce((a: number, d: any) => a + (d.amount || 0), 0), n: list.length };
  }), [stages, deals]);

  const doMove = async (deal: any, stageId: number, reason?: string) => {
    try {
      await api.post(`/api/deals/${deal.id}/move`, { stage_id: stageId, lost_reason: reason });
      inv('deals', 'invoices', 'tasks');
      if (stageKind(stageId) === 'won') toast.success(`Сделка выиграна: ${deal.title}`);
    } catch (e) { toast.error(e); }
  };
  const move = (deal: any, to: string | number) => {
    if (stageKind(Number(to)) === 'lost') setLost({ deal, stage: Number(to) });
    else doMove(deal, Number(to));
  };
  const open = (d: any) => nav(`/crm/deals/${d.id}${location.hash.includes('?') ? '?' + location.hash.split('?')[1] : ''}`);

  const tabs = <ModuleTabs tabs={[
    { to: '/crm/deals?tab=kanban', label: 'Канбан', default: true }, { to: '/crm/deals?tab=active', label: 'Активные' },
    { to: '/crm/deals?tab=archive', label: 'В архиве' }, { to: '/crm/deals?tab=all', label: 'Все сделки' },
  ]} />;

  return (
    <div>
      <CrmHeader title="Сделки" tabs={tabs} subtitle={undefined}
        actions={<>
          {pipelines.length > 0 && (
            <Popover align="right" trigger={({ toggle }) => <button type="button" onClick={toggle} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold hover:bg-surface-2">{pipeline?.name}<ChevronDown className="size-4 text-faint" /></button>}>
              {(close) => <div className="w-60">{pipelines.map((p: any) => <MenuItem key={p.id} active={p.id === pipelineId} onClick={() => { setPipe(p.id); close(); }}>{p.name}</MenuItem>)}
                <MenuItem icon={<Plus className="size-4" />} onClick={() => { nav('/settings/pipelines'); close(); }}>Настроить воронки</MenuItem></div>}
            </Popover>
          )}
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreate({ pipeline_id: pipelineId, stage_id: stages[0]?.id, responsible_id: user!.id, start_date: new Date().toISOString().slice(0, 10) })}>Создать</Button>
        </>} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск" icon={<Search className="size-4" />} className="w-full sm:w-56" />
        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-fg"><Filter className="size-3.5" />{source || stage || resp ? 'Свой фильтр' : 'По умолчанию'}</span>
        <Chip label="Источник сделки" value={source} onChange={setSource} options={SOURCES} />
        <Chip label="Этап сделки" value={stage} onChange={setStage} options={stages.map((s: any) => ({ value: String(s.id), label: s.name }))} />
        <Chip label="Ответственный" value={resp} onChange={setResp} options={[{ value: String(user!.id), label: 'Я' }, ...users.filter((u: any) => u.id !== user!.id).map((u: any) => ({ value: String(u.id), label: u.name }))]} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {([['today', 'Дела на сегодня', '#0b8a7a'], ['none', 'Нет дел', '#d98a06'], ['overdue', 'Дела просрочены', '#dc3b3b']] as [Quick, string, string][]).map(([k, l, c]) => (
          <button key={k} type="button" onClick={() => setQuick(quick === k ? '' : k)}
            className={cx('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold', quick === k ? 'text-white' : 'bg-surface text-fg')}
            style={quick === k ? { background: c, borderColor: c } : { borderColor: hexAlpha(c, 0.35) }}>
            <span className="flex size-4 items-center justify-center rounded-full text-[10px] text-white" style={{ background: quick === k ? 'rgba(255,255,255,.25)' : c }}>{counts[k as 'today']}</span>{l}
          </button>
        ))}
      </div>

      {isLoading ? <Loading /> : tab === 'kanban' ? (
        <Kanban columns={columns} items={deals} groupOf={(d: any) => d.stage_id} onMove={move} onCardClick={open}
          onAdd={(col) => setCreate({ pipeline_id: pipelineId, stage_id: col, responsible_id: user!.id })}
          header={(c: any) => (
            <div className="mt-2 rounded-lg px-2.5 py-2" style={{ background: hexAlpha(c.color, 0.12), borderLeft: `3px solid ${c.color}` }}>
              <p className="text-xs text-muted">{c.n} {c.n % 10 === 1 && c.n % 100 !== 11 ? 'сделка' : [2, 3, 4].includes(c.n % 10) && ![12, 13, 14].includes(c.n % 100) ? 'сделки' : 'сделок'}</p>
              <p className="text-sm font-bold tabular">{money(c.sum)}</p>
            </div>
          )}
          renderCard={(d: any) => {
            const f = flags[d.id];
            return (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold leading-snug">{d.title}</p>
                {d._ref?.company_id && <p className="truncate text-xs font-medium text-primary">{d._ref.company_id.title}</p>}
                {d._ref?.contact_id && <p className="truncate text-xs text-primary/80">{d._ref.contact_id.title}</p>}
                <p className="text-sm font-bold tabular">{money(d.amount)}</p>
                {(d.tags ?? []).length > 0 && <div className="flex flex-wrap gap-1">{d.tags.map((t: string) => <Badge key={t} color="#EC4899">{t}</Badge>)}</div>}
                <div className="flex items-center gap-2 pt-1">
                  {d._ref?.responsible_id && <Avatar name={d._ref.responsible_id.title} color={d._ref.responsible_id.color} size={22} />}
                  {(d.start_date || d.close_date) && (
                    <span className="flex items-center gap-1 text-[11px] leading-tight text-muted">
                      <span><span className="block text-faint">Начало</span>{d.start_date ? date(d.start_date).slice(0, 5) : '—'}</span>
                      <ChevronRight className="size-3 text-faint" />
                      <span><span className="block text-faint">Конец</span>{d.close_date ? date(d.close_date).slice(0, 5) : '—'}</span>
                    </span>
                  )}
                  {f?.comments ? <span className="ml-auto flex items-center gap-1 text-xs text-faint"><MessageSquare className="size-3.5" />{f.comments}</span> : null}
                </div>
                {f?.overdue ? <p className="text-xs font-semibold text-danger">Дела просрочены</p> : stageKind(d.stage_id) === 'open' && !f?.open ? <p className="text-xs font-semibold text-warning">Нет запланированных дел</p> : null}
              </div>
            );
          }} />
      ) : (
        <Card padded={false}>
          <DataTable entity="deals" rows={deals} onRowClick={open}
            columns={['title', 'stage_id', 'amount', 'company_id', 'responsible_id', { key: 'start_date', label: 'Начало', render: (r: any) => date(r.start_date) }, 'close_date',
              { key: 'acts', label: 'Дела', render: (r: any) => flags[r.id]?.overdue ? <Badge color="#dc3b3b">просрочены</Badge> : flags[r.id]?.open ? <Badge color="#0b8a7a">{flags[r.id].open}</Badge> : <span className="text-faint">—</span> }]} />
          <div className="border-t border-line px-4 py-2 text-xs text-faint">Всего: {deals.length} · на сумму {compactMoney(deals.reduce((s: number, d: any) => s + (d.amount || 0), 0))}</div>
        </Card>
      )}

      {id && <SlideOver onClose={() => nav(`/crm/deals${location.hash.includes('?') ? '?' + location.hash.split('?')[1] : ''}`)}><DealCard id={Number(id)} /></SlideOver>}
      <RecordForm entity="deals" open={!!create} onClose={() => setCreate(null)} initial={create} onSaved={(r) => nav(`/crm/deals/${r.id}`)}
        fields={['title', 'amount', 'stage_id', 'company_id', 'contact_id', 'responsible_id', 'start_date', 'close_date', 'source', 'tags', 'description']} />
      <LostDialog open={!!lost} onClose={() => setLost(null)} onConfirm={(r) => { if (lost) doMove(lost.deal, lost.stage, r); setLost(null); }} />
    </div>
  );
}
