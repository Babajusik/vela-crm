import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { saveText } from '../../api.ts';
import { money, monthLabel, toLocalDate } from '../../lib/format.ts';
import { useApi, useList } from '../../lib/state.tsx';
import { Button, Card, FormRow, Input, Loading, Select, Tabs, cx } from '../../ui/ui.tsx';
import { FinHeader } from './Finance.tsx';

type R = 'cashflow' | 'pnl' | 'projects';

function defaultRange() {
  const d = new Date();
  return { from: toLocalDate(new Date(d.getFullYear(), d.getMonth() - 5, 1)), to: toLocalDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
}

const cellCls = 'whitespace-nowrap border-b border-line px-3 py-2 text-right tabular';
const fmt = (v: number | undefined) => (v ? money(v) : <span className="text-faint">—</span>);

function csv(rows: (string | number)[][], name: string) {
  saveText('﻿' + rows.map((r) => r.map((c) => (typeof c === 'string' && /[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : String(c))).join(';')).join('\r\n'), name, 'text/csv;charset=utf-8');
}

export function Reports() {
  const [tab, setTab] = useState<R>('cashflow');
  const [range, setRange] = useState(defaultRange);
  const [project, setProject] = useState('');
  const projects = useList('projects', { limit: 200 }).data?.items ?? [];
  return (
    <div>
      <FinHeader title="Отчёты" subtitle="Управленческая отчётность: ДДС, прибыль, рентабельность проектов" />
      <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: 'cashflow', label: 'Движение денег (ДДС)' }, { value: 'pnl', label: 'Прибыли и убытки (ОПиУ)' }, { value: 'projects', label: 'Рентабельность проектов' }]} />
      {tab !== 'projects' && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <FormRow label="С"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></FormRow>
          <FormRow label="По"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></FormRow>
          <FormRow label="Проект"><Select value={project} onChange={(e) => setProject(e.target.value)}><option value="">Вся компания</option>{projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FormRow>
        </div>
      )}
      {tab === 'cashflow' && <Cashflow range={range} project={project} />}
      {tab === 'pnl' && <Pnl range={range} project={project} />}
      {tab === 'projects' && <ProjectsReport />}
    </div>
  );
}

function Cashflow({ range, project }: { range: { from: string; to: string }; project: string }) {
  const { data: r, isLoading } = useApi<any>(['finance', 'cashflow'], '/api/finance/cashflow', { ...range, project_id: project || undefined });
  if (isLoading || !r) return <Loading />;
  const exportCsv = () => {
    const rows: (string | number)[][] = [['Статья', ...r.months.map((m: string) => monthLabel(m)), 'Итого']];
    if (!project) rows.push(['Остаток на начало', ...r.months.map((m: string) => r.opening[m]), '']);
    for (const s of r.sections) {
      rows.push([s.title]);
      for (const l of s.lines) rows.push([l.name, ...r.months.map((m: string) => l.values[m] ?? 0), l.total]);
      rows.push([`Сальдо: ${s.title.toLowerCase()}`, ...r.months.map((m: string) => s.net[m] ?? 0), s.total]);
    }
    rows.push(['Чистый денежный поток', ...r.months.map((m: string) => r.net[m]), '']);
    if (!project) rows.push(['Остаток на конец', ...r.months.map((m: string) => r.closing[m]), '']);
    csv(rows, `ДДС ${range.from} — ${range.to}.csv`);
  };
  return (
    <Card padded={false} title="Отчёт о движении денежных средств" subtitle="Фактические операции, сгруппированные по видам деятельности" actions={<Button size="sm" icon={<Download className="size-4" />} onClick={exportCsv}>Excel</Button>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-xs font-bold uppercase tracking-wide text-faint">
              <th className="sticky left-0 border-b border-line bg-surface px-3 py-2.5 text-left">Статья</th>
              {r.months.map((m: string) => <th key={m} className="border-b border-line px-3 py-2.5 text-right">{monthLabel(m, true)}</th>)}
              <th className="border-b border-line px-3 py-2.5 text-right">Итого</th>
            </tr>
          </thead>
          <tbody>
            {!project && (
              <tr className="bg-surface-2/60 font-semibold">
                <td className="sticky left-0 border-b border-line bg-surface-2 px-3 py-2">Остаток на начало месяца</td>
                {r.months.map((m: string) => <td key={m} className={cellCls}>{money(r.opening[m])}</td>)}<td className={cellCls} />
              </tr>
            )}
            {r.sections.map((s: any) => (
              <SectionRows key={s.activity} s={s} months={r.months} />
            ))}
            <tr className="font-bold">
              <td className="sticky left-0 border-b border-line bg-surface px-3 py-2.5">Чистый денежный поток</td>
              {r.months.map((m: string) => <td key={m} className={cx(cellCls, r.net[m] < 0 ? 'text-danger' : 'text-success')}>{money(r.net[m])}</td>)}<td className={cellCls} />
            </tr>
            {!project && (
              <tr className="bg-primary-soft font-extrabold">
                <td className="sticky left-0 bg-primary-soft px-3 py-2.5">Остаток на конец месяца</td>
                {r.months.map((m: string) => <td key={m} className="whitespace-nowrap px-3 py-2.5 text-right tabular">{money(r.closing[m])}</td>)}<td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SectionRows({ s, months }: { s: any; months: string[] }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <tr className="cursor-pointer bg-surface-2/40" onClick={() => setOpen(!open)}>
        <td className="sticky left-0 border-b border-line bg-surface-2 px-3 py-2 font-bold" colSpan={1}>{open ? '▾' : '▸'} {s.title}</td>
        {months.map((m) => <td key={m} className={cx(cellCls, 'font-semibold', (s.net[m] ?? 0) < 0 && 'text-danger')}>{fmt(s.net[m])}</td>)}
        <td className={cx(cellCls, 'font-bold')}>{money(s.total)}</td>
      </tr>
      {open && s.lines.map((l: any) => (
        <tr key={l.kind + l.id} className="hover:bg-surface-2/50">
          <td className="sticky left-0 border-b border-line bg-surface py-2 pl-7 pr-3">
            <span className={cx('mr-2 inline-block size-1.5 rounded-full align-middle', l.kind === 'income' ? 'bg-success' : 'bg-danger')} />{l.name}
          </td>
          {months.map((m) => <td key={m} className={cellCls}>{fmt(l.values[m])}</td>)}
          <td className={cx(cellCls, 'font-semibold')}>{money(l.total)}</td>
        </tr>
      ))}
    </>
  );
}

function Pnl({ range, project }: { range: { from: string; to: string }; project: string }) {
  const { data: r, isLoading } = useApi<any>(['finance', 'pnl'], '/api/finance/pnl', { ...range, project_id: project || undefined });
  if (isLoading || !r) return <Loading />;
  const block = (title: string, lines: any[], totals: Record<string, number>, total: number, tone: string) => (
    <>
      <tr className="bg-surface-2/40"><td className="sticky left-0 border-b border-line bg-surface-2 px-3 py-2 font-bold">{title}</td>{r.months.map((m: string) => <td key={m} className={cx(cellCls, 'font-semibold')}>{money(totals[m])}</td>)}<td className={cx(cellCls, 'font-bold', tone)}>{money(total)}</td></tr>
      {lines.map((l: any) => (
        <tr key={l.id ?? 'none'} className="hover:bg-surface-2/50">
          <td className="sticky left-0 border-b border-line bg-surface py-2 pl-7 pr-3">{l.name}</td>
          {r.months.map((m: string) => <td key={m} className={cellCls}>{fmt(l.values[m])}</td>)}<td className={cellCls}>{money(l.total)}</td>
        </tr>
      ))}
    </>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Card><p className="text-xs text-muted">Выручка</p><p className="text-xl font-extrabold tabular text-success">{money(r.total.revenue)}</p></Card>
        <Card><p className="text-xs text-muted">Расходы</p><p className="text-xl font-extrabold tabular text-danger">{money(r.total.expenses)}</p></Card>
        <Card><p className="text-xs text-muted">Прибыль</p><p className={cx('text-xl font-extrabold tabular', r.total.profit < 0 ? 'text-danger' : 'text-primary')}>{money(r.total.profit)}</p></Card>
        <Card><p className="text-xs text-muted">Рентабельность</p><p className="text-xl font-extrabold tabular">{r.total.margin != null ? `${r.total.margin}%` : '—'}</p></Card>
      </div>
      <Card padded={false} title="Отчёт о прибылях и убытках" subtitle="Кассовый метод: доходы и расходы по дате оплаты. Кредиты, займы, дивиденды и покупка оборудования не входят.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-xs font-bold uppercase tracking-wide text-faint"><th className="sticky left-0 border-b border-line bg-surface px-3 py-2.5 text-left">Показатель</th>{r.months.map((m: string) => <th key={m} className="border-b border-line px-3 py-2.5 text-right">{monthLabel(m, true)}</th>)}<th className="border-b border-line px-3 py-2.5 text-right">Итого</th></tr></thead>
            <tbody>
              {block('Выручка', r.revenue, r.totals.revenue, r.total.revenue, 'text-success')}
              {block('Расходы', r.expenses, r.totals.expenses, r.total.expenses, 'text-danger')}
              <tr className="bg-primary-soft font-extrabold">
                <td className="sticky left-0 bg-primary-soft px-3 py-2.5">Чистая прибыль</td>
                {r.months.map((m: string) => <td key={m} className={cx('whitespace-nowrap px-3 py-2.5 text-right tabular', r.totals.profit[m] < 0 && 'text-danger')}>{money(r.totals.profit[m])}</td>)}
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular">{money(r.total.profit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ProjectsReport() {
  const { data, isLoading } = useApi<any[]>(['finance', 'projects-report'], '/api/finance/projects');
  if (isLoading || !data) return <Loading />;
  return (
    <Card padded={false} title="Рентабельность проектов" subtitle="Поступления минус прямые расходы и стоимость часов сотрудников">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead><tr className="text-left text-xs font-bold uppercase tracking-wide text-faint">
            <th className="border-b border-line px-3 py-2.5">Проект</th><th className="border-b border-line px-3 py-2.5 text-right">Бюджет</th><th className="border-b border-line px-3 py-2.5 text-right">Поступления</th>
            <th className="border-b border-line px-3 py-2.5 text-right">Расходы</th><th className="border-b border-line px-3 py-2.5 text-right">Труд</th><th className="border-b border-line px-3 py-2.5 text-right">Прибыль</th><th className="border-b border-line px-3 py-2.5 text-right">Маржа</th>
          </tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id} className="hover:bg-surface-2">
                <td className="border-b border-line px-3 py-2.5"><Link to={`/projects/${p.id}`} className="font-semibold hover:text-primary">{p.name}</Link><div className="text-xs text-muted">{p.company ?? 'Внутренний'}</div></td>
                <td className={cellCls}>{money(p.budget)}</td><td className={cx(cellCls, 'text-success')}>{money(p.income)}</td><td className={cellCls}>{money(p.expense)}</td>
                <td className={cellCls}>{money(p.labor)}</td><td className={cx(cellCls, 'font-bold', p.profit < 0 ? 'text-danger' : 'text-primary')}>{money(p.profit)}</td>
                <td className={cx(cellCls, 'font-semibold')}>{p.margin != null ? `${p.margin}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
