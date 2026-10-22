import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compactMoney, money, monthLabel } from '../lib/format.ts';

export const SERIES = { income: '#12A994', expense: '#FF6B57', net: '#6366F1', neutral: '#94A3B8' };
const tooltipStyle = { background: 'var(--c-surface)', border: '1px solid var(--c-line)', borderRadius: 10, fontSize: 12, color: 'var(--c-fg)', boxShadow: '0 8px 24px rgba(0,0,0,.08)' };
const axis = { stroke: 'var(--c-faint)', fontSize: 11, tickLine: false, axisLine: false } as const;

export function MoneyBars({ data, keys, height = 260, xKey = 'month' }: { data: any[]; keys: { key: string; label: string; color: string }[]; height?: number; xKey?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={3}>
        <CartesianGrid vertical={false} stroke="var(--c-line)" />
        <XAxis dataKey={xKey} {...axis} tickFormatter={(v) => (/^\d{4}-\d{2}$/.test(v) ? monthLabel(v, true) : v)} />
        <YAxis {...axis} width={70} tickFormatter={(v) => compactMoney(v).replace(' ₽', '')} />
        <Tooltip cursor={{ fill: 'var(--c-surface-2)' }} contentStyle={tooltipStyle} formatter={(v: number, name) => [money(v), name]} labelFormatter={(v) => (/^\d{4}-\d{2}$/.test(v) ? monthLabel(v) : v)} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        {keys.map((k) => <Bar key={k.key} dataKey={k.key} name={k.label} fill={k.color} radius={[5, 5, 0, 0]} maxBarSize={28} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MoneyArea({ data, dataKey, color = SERIES.income, height = 220, xKey = 'month', label = 'Сумма' }: { data: any[]; dataKey: string; color?: string; height?: number; xKey?: string; label?: string }) {
  const id = `g-${dataKey}-${color.replace('#', '')}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--c-line)" />
        <XAxis dataKey={xKey} {...axis} tickFormatter={(v) => (/^\d{4}-\d{2}$/.test(v) ? monthLabel(v, true) : /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v.slice(8)}.${v.slice(5, 7)}` : v)} minTickGap={16} />
        <YAxis {...axis} width={70} tickFormatter={(v) => compactMoney(v).replace(' ₽', '')} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [money(v), label]} labelFormatter={(v) => (/^\d{4}-\d{2}$/.test(v) ? monthLabel(v) : v)} />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#${id})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, height = 220 }: { data: { name: string; value: number; color: string }[]; height?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-extrabold tabular">{total}</span>
          <span className="text-xs text-muted">всего</span>
        </div>
      </div>
      <ul className="w-full space-y-1.5 text-sm">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
            <span className="min-w-0 flex-1 truncate text-muted">{d.name}</span>
            <span className="font-semibold tabular">{d.value}</span>
            <span className="w-10 text-right text-xs text-faint tabular">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const PALETTE = ['#12A994', '#6366F1', '#FF6B57', '#F59E0B', '#0EA5E9', '#EC4899', '#84CC16', '#8B5CF6', '#64748B'];
