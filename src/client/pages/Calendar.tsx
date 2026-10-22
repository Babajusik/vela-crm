import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckSquare, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { addDaysIso, parseDate, time, toLocalDate, todayIso, WEEKDAYS } from '../lib/format.ts';
import { useApi, useAuth } from '../lib/state.tsx';
import { Button, Card, Loading, PageHeader, Segmented, cx } from '../ui/ui.tsx';
import { RecordForm } from '../ui/fields.tsx';

const KIND_COLOR: Record<string, string> = { meeting: '#0FA596', call: '#0EA5E9', event: '#A855F7', reminder: '#F59E0B' };

function startOfWeek(iso: string) {
  const d = parseDate(iso)!;
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toLocalDate(d);
}

export default function Calendar() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [view, setView] = useState<'month' | 'week'>('month');
  const [anchor, setAnchor] = useState(todayIso());
  const [mine, setMine] = useState(true);
  const [form, setForm] = useState<any>(null);
  const range = useMemo(() => {
    if (view === 'week') { const s = startOfWeek(anchor); return { from: s, to: addDaysIso(s, 6) }; }
    const d = parseDate(anchor)!;
    const first = toLocalDate(new Date(d.getFullYear(), d.getMonth(), 1));
    const s = startOfWeek(first);
    return { from: s, to: addDaysIso(s, 41) };
  }, [view, anchor]);
  const { data, isLoading } = useApi<any>(['calendar'], '/api/calendar', { ...range, user_id: mine ? user!.id : undefined });
  const days = useMemo(() => { const out: string[] = []; for (let d = range.from; d <= range.to; d = addDaysIso(d, 1)) out.push(d); return out; }, [range]);
  const month = parseDate(anchor)!.getMonth();
  const shift = (n: number) => {
    const d = parseDate(anchor)!;
    if (view === 'week') d.setDate(d.getDate() + 7 * n); else d.setMonth(d.getMonth() + n);
    setAnchor(toLocalDate(d));
  };
  const items = (day: string) => [
    ...(data?.events ?? []).filter((e: any) => String(e.start).slice(0, 10) <= day && String(e.end ?? e.start).slice(0, 10) >= day).map((e: any) => ({ ...e, _t: 'event' })),
    ...(data?.tasks ?? []).filter((t: any) => String(t.start).slice(0, 10) === day).map((t: any) => ({ ...t, _t: 'task' })),
  ].sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const newEvent = (day: string) => setForm({ start: `${day}T10:00`, end: `${day}T11:00`, owner_id: user!.id, attendees: [user!.id], kind: 'meeting' });
  const title = view === 'week'
    ? `${parseDate(range.from)!.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — ${parseDate(range.to)!.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : parseDate(anchor)!.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const today = todayIso();
  const chip = (it: any) => (
    <button key={it._t + it.id} type="button" onClick={(e) => { e.stopPropagation(); it._t === 'task' ? nav(`/tasks/${it.id}`) : setForm(it); }}
      className={cx('flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] font-semibold', it._t === 'task' ? 'bg-surface-2 text-muted hover:text-fg' : 'text-white hover:brightness-110', it.status === 'done' && 'line-through opacity-60')}
      style={it._t === 'event' ? { background: it.color || KIND_COLOR[it.kind] || '#0FA596' } : undefined} title={it.title}>
      {it._t === 'task' ? <CheckSquare className="size-3 shrink-0" /> : !it.all_day && <span className="opacity-80 tabular">{time(it.start)}</span>}
      <span className="truncate">{it.title}</span>
    </button>
  );
  return (
    <div>
      <PageHeader title="Календарь" subtitle="Встречи, звонки и сроки задач"
        actions={<>
          <Segmented value={mine ? 'mine' : 'all'} onChange={(v) => setMine(v === 'mine')} options={[{ value: 'mine', label: 'Мой' }, { value: 'all', label: 'Компании' }]} />
          <Segmented value={view} onChange={setView} options={[{ value: 'month', label: 'Месяц' }, { value: 'week', label: 'Неделя' }]} />
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => newEvent(today)}>Событие</Button>
        </>} />
      <Card padded={false}>
        <div className="flex items-center gap-2 border-b border-line p-3">
          <Button size="sm" variant="ghost" aria-label="Назад" onClick={() => shift(-1)}><ChevronLeft className="size-4" /></Button>
          <Button size="sm" variant="ghost" aria-label="Вперёд" onClick={() => shift(1)}><ChevronRight className="size-4" /></Button>
          <Button size="sm" onClick={() => setAnchor(today)}>Сегодня</Button>
          <span className="ml-2 text-lg font-bold capitalize">{title}</span>
        </div>
        {isLoading ? <Loading /> : view === 'month' ? (
          <div className="grid grid-cols-7">
            {WEEKDAYS.map((w) => <div key={w} className="border-b border-line px-2 py-2 text-xs font-bold uppercase text-faint">{w}</div>)}
            {days.map((d) => {
              const dt = parseDate(d)!;
              const list = items(d);
              const abs = (data?.absences ?? []).filter((a: any) => a.date_from <= d && a.date_to >= d);
              return (
                <div key={d} onClick={() => newEvent(d)} className={cx('min-h-28 cursor-pointer border-b border-r border-line p-1.5 hover:bg-surface-2/60', dt.getMonth() !== month && 'bg-surface-2/40')}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className={cx('flex size-6 items-center justify-center rounded-full text-xs font-bold', d === today ? 'bg-primary text-primary-fg' : dt.getMonth() !== month ? 'text-faint' : 'text-fg')}>{dt.getDate()}</span>
                    {abs.length > 0 && <span className="text-[10px] text-faint" title={abs.map((a: any) => a.name).join(', ')}>✈ {abs.length}</span>}
                  </div>
                  <div className="space-y-0.5">{list.slice(0, 4).map(chip)}{list.length > 4 && <p className="px-1 text-[11px] text-muted">ещё {list.length - 4}</p>}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-7">
            {days.map((d) => {
              const dt = parseDate(d)!;
              return (
                <div key={d} className="min-h-72 border-b border-r border-line">
                  <div className={cx('flex items-center justify-between border-b border-line px-2 py-2', d === today && 'bg-primary-soft')}>
                    <span className="text-xs font-bold uppercase text-muted">{WEEKDAYS[(dt.getDay() + 6) % 7]}</span>
                    <span className={cx('text-lg font-extrabold', d === today && 'text-primary')}>{dt.getDate()}</span>
                  </div>
                  <div className="space-y-1 p-1.5">{items(d).map(chip)}<button type="button" onClick={() => newEvent(d)} className="w-full rounded py-1 text-xs text-faint hover:bg-surface-2 hover:text-primary">+ добавить</button></div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <RecordForm entity="events" open={!!form} onClose={() => setForm(null)} initial={form} fields={['title', 'kind', 'start', 'end', 'all_day', 'location', 'attendees', 'company_id', 'deal_id', 'project_id', 'description']} />
    </div>
  );
}
