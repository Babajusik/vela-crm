import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Download, FileUp, MessageSquare, Pencil, Phone, Plus, Search, Trash2, Users as UsersIcon, X } from 'lucide-react';
import type { Field } from '../../core/types.ts';
import { api, saveText } from '../api.ts';
import { relative } from '../lib/format.ts';
import { useAuth, useInvalidate, useList, useMeta, useApi, type ListParams } from '../lib/state.tsx';
import { Avatar, Button, Card, Checkbox, EmptyState, FormRow, IconButton, Input, Loading, Modal, Select, Segmented, Textarea, cx, useToast } from './ui.tsx';
import { FieldInput, FieldValue, RecordForm, customToField } from './fields.tsx';

// ---------------- table ----------------
export interface Column<T = any> {
  key: string;
  label?: ReactNode;
  render?: (row: T) => ReactNode;
  className?: string;
  sortable?: boolean;
  align?: 'right' | 'left';
}

export function DataTable<T extends { id: number }>({ entity, columns, rows, onRowClick, sort, onSort, selected, onSelect, empty }: {
  entity?: string; columns: (Column<T> | string)[]; rows: T[]; onRowClick?: (r: T) => void; sort?: { key: string; dir: 'asc' | 'desc' };
  onSort?: (key: string) => void; selected?: number[]; onSelect?: (ids: number[]) => void; empty?: ReactNode;
}) {
  const { field } = useMeta();
  const cols: Column<T>[] = columns.map((c) => (typeof c === 'string' ? { key: c, sortable: true } : c));
  const fieldOf = (k: string): Field | undefined => (entity ? field(entity, k) : undefined);
  const allOn = !!rows.length && rows.every((r) => selected?.includes(r.id));
  if (!rows.length) return <>{empty ?? <EmptyState title="Пока пусто" text="Записей нет или ни одна не подходит под фильтры." compact />}</>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {onSelect && (
              <th className="sticky top-0 w-10 border-b border-line bg-surface px-3 py-2.5">
                <Checkbox checked={allOn} onChange={(v) => onSelect(v ? rows.map((r) => r.id) : [])} />
              </th>
            )}
            {cols.map((c) => {
              const f = fieldOf(c.key);
              const label = c.label ?? f?.label ?? c.key;
              const active = sort?.key === c.key;
              const sortable = c.sortable !== false && !!onSort && (!!f || c.sortable);
              return (
                <th key={c.key} className={cx('sticky top-0 whitespace-nowrap border-b border-line bg-surface px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-faint', (c.align === 'right' || f?.type === 'money') && 'text-right', c.className)}>
                  {sortable ? (
                    <button type="button" onClick={() => onSort!(c.key)} className={cx('inline-flex items-center gap-1 uppercase hover:text-fg', active && 'text-fg')}>
                      {label}{active && (sort!.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                    </button>
                  ) : label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => onRowClick?.(r)} className={cx('group', onRowClick && 'cursor-pointer', selected?.includes(r.id) ? 'bg-primary-soft/60' : 'hover:bg-surface-2')}>
              {onSelect && (
                <td className="border-b border-line px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={!!selected?.includes(r.id)} onChange={(v) => onSelect(v ? [...(selected ?? []), r.id] : (selected ?? []).filter((x) => x !== r.id))} />
                </td>
              )}
              {cols.map((c) => {
                const f = fieldOf(c.key);
                return (
                  <td key={c.key} className={cx('max-w-[320px] truncate border-b border-line px-3 py-2.5', (c.align === 'right' || f?.type === 'money') && 'text-right', c.className)}>
                    {c.render ? c.render(r) : f ? <FieldValue field={f} item={r as any} /> : String((r as any)[c.key] ?? '')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- list page ----------------
export interface QuickFilter { key: string; label: string; options?: { value: string; label: string }[]; type?: 'select' | 'user' | 'bool' }

export function EntityList({ entity, columns, rowLink, onRowClick, filters = [], defaults, baseParams = {}, toolbar, createLabel, formFields, empty, pageSize = 50, header, canImport, canExport = true, onCreate }: {
  entity: string; columns: (Column | string)[]; rowLink?: (r: any) => string; onRowClick?: (r: any) => void; filters?: QuickFilter[]; defaults?: Record<string, any>;
  baseParams?: ListParams; toolbar?: ReactNode; createLabel?: string; formFields?: string[]; empty?: ReactNode; pageSize?: number; header?: ReactNode;
  canImport?: boolean; canExport?: boolean; onCreate?: () => void;
}) {
  const { ent } = useMeta();
  const { can } = useAuth();
  const e = ent(entity);
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [f, setF] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | undefined>();
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [form, setForm] = useState<Record<string, any> | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(0); }, [debounced, JSON.stringify(f), JSON.stringify(baseParams)]);
  const params: ListParams = { ...baseParams, ...f, q: debounced, limit: pageSize, offset: page * pageSize, sort: sort?.key, dir: sort?.dir };
  const { data, isLoading } = useList(entity, params);
  const writable = e ? can(e.module, 'write') : false;
  const total = data?.total ?? 0;

  const bulkDelete = async () => {
    if (!(await toast.confirm({ title: `Удалить ${selected.length} шт.?`, danger: true, ok: 'Удалить' }))) return;
    try {
      await api.post(`/api/e/${entity}/bulk`, { action: 'delete', ids: selected });
      setSelected([]);
      inv(entity);
      toast.success('Удалено');
    } catch (err) { toast.error(err); }
  };
  const exportCsv = async () => {
    try {
      const r = await api.get(`/api/export/${entity}`, { ...baseParams, ...f, q: debounced } as any);
      saveText(r.content, r.filename, 'text/csv;charset=utf-8');
    } catch (err) { toast.error(err); }
  };

  return (
    <Card padded={false}>
      {header}
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <Input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Поиск…" icon={<Search className="size-4" />} className="w-full sm:w-64" />
        {filters.map((fl) => (
          <Select key={fl.key} value={f[fl.key] ?? ''} onChange={(ev) => setF((x) => ({ ...x, [fl.key]: ev.target.value }))} className="w-auto min-w-36">
            <option value="">{fl.label}: все</option>
            {fl.type === 'user' ? <UserOptions /> : fl.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        ))}
        {Object.values(f).some(Boolean) && <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => setF({})}>Сбросить</Button>}
        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          {selected.length > 0 && writable && <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={bulkDelete}>Удалить ({selected.length})</Button>}
          {canImport && writable && <IconButton label="Импорт из CSV" onClick={() => setImportOpen(true)}><FileUp className="size-4" /></IconButton>}
          {canExport && <IconButton label="Выгрузить в CSV (Excel)" onClick={exportCsv}><Download className="size-4" /></IconButton>}
          {writable && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => (onCreate ? onCreate() : setForm({ ...(defaults ?? {}) }))}>{createLabel ?? 'Создать'}</Button>}
        </div>
      </div>
      {isLoading && !data ? <Loading /> : (
        <DataTable entity={entity} columns={columns} rows={data?.items ?? []} sort={sort}
          onSort={(k) => setSort((s) => (s?.key === k ? (s.dir === 'asc' ? { key: k, dir: 'desc' } : undefined) : { key: k, dir: 'asc' }))}
          onRowClick={(r) => (onRowClick ? onRowClick(r) : rowLink ? nav(rowLink(r)) : writable && setForm(r))}
          selected={writable ? selected : undefined} onSelect={writable ? setSelected : undefined}
          empty={empty ?? <EmptyState title={debounced || Object.values(f).some(Boolean) ? 'Ничего не найдено' : `${e?.plural ?? 'Записи'}: пока пусто`} text={debounced ? 'Попробуйте изменить запрос.' : 'Создайте первую запись — это займёт минуту.'}
            action={writable && !debounced ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => (onCreate ? onCreate() : setForm({ ...(defaults ?? {}) }))}>{createLabel ?? 'Создать'}</Button> : undefined} />} />
      )}
      {total > pageSize && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-sm text-muted">
          <span>{page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} из {total}</span>
          <div className="flex gap-1.5">
            <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Назад</Button>
            <Button size="sm" disabled={(page + 1) * pageSize >= total} onClick={() => setPage((p) => p + 1)}>Вперёд</Button>
          </div>
        </div>
      )}
      {total > 0 && total <= pageSize && <div className="border-t border-line px-4 py-2 text-xs text-faint">Всего: {total}</div>}
      <RecordForm entity={entity} open={!!form} onClose={() => setForm(null)} initial={form} fields={formFields} />
      {canImport && <CsvImport entity={entity} open={importOpen} onClose={() => setImportOpen(false)} />}
    </Card>
  );
}

function UserOptions() {
  const { data } = useList('users', { limit: 500, is_active: 1, expand: 0 });
  return <>{(data?.items ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</>;
}

// ---------------- kanban ----------------
export interface KanbanColumn { id: string | number; title: string; color?: string; footer?: ReactNode }

export function Kanban<T extends { id: number }>({ columns, items, groupOf, renderCard, onMove, onCardClick, onAdd, header }: {
  columns: KanbanColumn[]; items: T[]; groupOf: (i: T) => string | number; renderCard: (i: T) => ReactNode; onMove: (item: T, to: string | number) => void;
  onCardClick?: (i: T) => void; onAdd?: (col: string | number) => void; header?: (col: KanbanColumn, items: T[]) => ReactNode;
}) {
  const [over, setOver] = useState<string | number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const grouped = useMemo(() => {
    const m = new Map<string | number, T[]>();
    for (const c of columns) m.set(String(c.id), []);
    for (const it of items) m.get(String(groupOf(it)))?.push(it);
    return m;
  }, [columns, items, groupOf]);
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {columns.map((c) => {
        const list = grouped.get(String(c.id)) ?? [];
        return (
          <div key={c.id} className={cx('kanban-col flex max-h-[calc(100vh-230px)] flex-col rounded-xl bg-surface-2/70 dark:bg-surface/50', over === c.id && 'drag-over')}
            onDragOver={(e) => { e.preventDefault(); setOver(c.id); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const it = items.find((x) => x.id === dragId);
              if (it && String(groupOf(it)) !== String(c.id)) onMove(it, c.id);
            }}>
            <div className="px-3 pb-2 pt-3">
              <div className="h-1 rounded-full" style={{ background: c.color ?? 'var(--c-line-strong)' }} />
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-bold">{c.title}</span>
                <span className="rounded-full bg-surface px-2 text-xs font-bold text-muted tabular">{list.length}</span>
              </div>
              {header?.(c, list)}
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {list.map((it) => (
                <div key={it.id} draggable onDragStart={() => setDragId(it.id)} onDragEnd={() => setDragId(null)} onClick={() => onCardClick?.(it)}
                  className={cx('cursor-grab rounded-lg border border-line bg-surface p-3 shadow-[0_1px_2px_rgba(15,27,45,.04)] transition hover:border-line-strong hover:shadow-md active:cursor-grabbing', dragId === it.id && 'opacity-50')}>
                  {renderCard(it)}
                </div>
              ))}
              {onAdd && (
                <button type="button" onClick={() => onAdd(c.id)} className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold text-faint hover:bg-surface hover:text-primary">
                  <Plus className="size-4" /> Добавить
                </button>
              )}
            </div>
            {c.footer && <div className="border-t border-line px-3 py-2 text-xs text-muted">{c.footer}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ---------------- timeline ----------------
const KIND_ICON: Record<string, ReactNode> = {
  comment: <MessageSquare className="size-3.5" />, call: <Phone className="size-3.5" />, meeting: <UsersIcon className="size-3.5" />,
};
const KIND_LABEL: Record<string, string> = { comment: 'Комментарий', call: 'Звонок', meeting: 'Встреча', email: 'Письмо', system: 'Событие', stage: 'Стадия' };

export function Timeline({ entity, id }: { entity: string; id: number }) {
  const { data, refetch, isLoading } = useApi<any[]>(['timeline', entity, id], `/api/e/${entity}/${id}/timeline`);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'comment' | 'call' | 'meeting'>('comment');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/e/${entity}/${id}/comment`, { text, kind });
      setText('');
      refetch();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="rounded-xl border border-line bg-surface p-3">
        <Segmented value={kind} onChange={setKind} options={[{ value: 'comment', label: 'Комментарий' }, { value: 'call', label: 'Звонок' }, { value: 'meeting', label: 'Встреча' }]} />
        <Textarea className="mt-2" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === 'call' ? 'Итоги звонка…' : kind === 'meeting' ? 'Итоги встречи…' : 'Напишите комментарий. @Имя Фамилия — упомянуть коллегу'}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }} />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-faint">Ctrl + Enter — отправить</span>
          <Button size="sm" variant="primary" loading={busy} onClick={send} disabled={!text.trim()}>Добавить</Button>
        </div>
      </div>
      {isLoading ? <Loading /> : (
        <ol className="relative mt-4 space-y-4 border-l border-line pl-5">
          {(data ?? []).map((a) => (
            <li key={a.id} className="relative">
              <span className={cx('absolute -left-[29px] top-0.5 flex size-[18px] items-center justify-center rounded-full ring-4 ring-canvas',
                a.kind === 'system' || a.kind === 'stage' ? 'bg-surface-2 text-faint' : 'bg-primary-soft text-primary')}>
                {KIND_ICON[a.kind] ?? <span className="size-1.5 rounded-full bg-current" />}
              </span>
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-faint">
                {a.user_name && <span className="font-semibold text-muted">{a.user_name}</span>}
                <span>{KIND_LABEL[a.kind] ?? ''}</span>
                <span>· {relative(a.created_at)}</span>
              </div>
              <p className={cx('mt-0.5 whitespace-pre-line text-sm', (a.kind === 'system' || a.kind === 'stage') ? 'text-muted' : 'rounded-lg bg-surface px-3 py-2 border border-line')}>{a.text}</p>
            </li>
          ))}
          {!data?.length && <li className="text-sm text-faint">Событий пока нет</li>}
        </ol>
      )}
    </div>
  );
}

// ---------------- inline-edit field panel ----------------
export function FieldsPanel({ entity, item, fields, onSaved, readOnly }: { entity: string; item: Record<string, any>; fields?: string[]; onSaved?: () => void; readOnly?: boolean }) {
  const { ent, custom } = useMeta();
  const { can } = useAuth();
  const inv = useInvalidate();
  const toast = useToast();
  const e = ent(entity);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>(null);
  if (!e) return null;
  const writable = !readOnly && can(e.module, 'write');
  const list = fields ? (fields.map((k) => e.fields.find((f) => f.key === k)).filter(Boolean) as Field[]) : e.fields.filter((f) => !f.hidden && f.type !== 'json' && f.key !== e.titleField);
  const cfs = custom(entity).map(customToField);
  const save = async (key: string, value: unknown, isExtra = false) => {
    try {
      await api.patch(`/api/e/${entity}/${item.id}`, isExtra ? { extra: { [key]: value } } : { [key]: value });
      inv(entity);
      onSaved?.();
    } catch (err) { toast.error(err); }
    setEditing(null);
  };
  const row = (f: Field, isExtra = false) => {
    const val = isExtra ? item.extra?.[f.key] : item[f.key];
    const editable = writable && !f.readonly;
    const isEditing = editing === f.key;
    return (
      <div key={f.key} className="group grid grid-cols-[minmax(110px,40%)_1fr] items-start gap-3 py-2">
        <dt className="pt-1.5 text-[13px] text-muted">{f.label}</dt>
        <dd className="min-w-0">
          {isEditing ? (
            <div className="space-y-2">
              <FieldInput field={f} value={draft} item={item} onChange={(v) => {
                setDraft(v);
                if (['select', 'ref', 'user', 'bool', 'date', 'color'].includes(f.type)) save(f.key, v, isExtra);
              }} />
              {!['select', 'ref', 'user', 'bool', 'date', 'color'].includes(f.type) && (
                <div className="flex gap-1.5">
                  <Button size="xs" variant="primary" onClick={() => save(f.key, draft, isExtra)}>Сохранить</Button>
                  <Button size="xs" onClick={() => setEditing(null)}>Отмена</Button>
                </div>
              )}
            </div>
          ) : (
            <button type="button" disabled={!editable} onClick={() => { setEditing(f.key); setDraft(val); }}
              className={cx('flex min-h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-sm', editable && 'hover:bg-surface-2')}>
              <span className="min-w-0 flex-1 truncate"><FieldValue field={f} item={item} value={isExtra ? val : undefined} /></span>
              {editable && <Pencil className="size-3.5 shrink-0 text-faint opacity-0 group-hover:opacity-100" />}
            </button>
          )}
        </dd>
      </div>
    );
  };
  return (
    <dl className="divide-y divide-line">
      {list.map((f) => row(f))}
      {cfs.map((f) => row(f, true))}
    </dl>
  );
}

// ---------------- CSV import ----------------
function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let cur: string[] = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { cur.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      cur.push(cell); cell = '';
      if (cur.some((c) => c.trim())) rows.push(cur);
      cur = [];
    } else cell += ch;
  }
  cur.push(cell);
  if (cur.some((c) => c.trim())) rows.push(cur);
  return rows;
}

export async function readTextFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1251').decode(buf);
  }
}

export function CsvImport({ entity, open, onClose }: { entity: string; open: boolean; onClose: () => void }) {
  const { ent } = useMeta();
  const e = ent(entity);
  const toast = useToast();
  const inv = useInvalidate();
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<number, string>>({});
  const [dedupe, setDedupe] = useState('');
  const [busy, setBusy] = useState(false);
  const fields = (e?.fields ?? []).filter((f) => !f.internal && !f.readonly && f.type !== 'json' && f.type !== 'users');
  const onFile = async (file: File) => {
    const parsed = parseCsv(await readTextFile(file));
    setRows(parsed);
    const head = parsed[0] ?? [];
    const auto: Record<number, string> = {};
    head.forEach((h, i) => {
      const hh = h.trim().toLowerCase();
      const f = fields.find((x) => x.label.toLowerCase() === hh || x.key === hh);
      if (f) auto[i] = f.key;
    });
    setMap(auto);
  };
  const run = async () => {
    setBusy(true);
    try {
      const data = rows.slice(1).map((r) => Object.fromEntries(Object.entries(map).filter(([, k]) => k).map(([i, k]) => [k, r[Number(i)]?.trim() ?? ''])));
      const res = await api.post(`/api/import/${entity}`, { rows: data, dedupe: dedupe || undefined });
      toast.success(`Загружено: ${res.created}, обновлено: ${res.updated}${res.errorCount ? `, ошибок: ${res.errorCount}` : ''}`);
      if (res.errorCount) toast.error(res.errors.slice(0, 3).map((x: any) => `Строка ${x.row}: ${x.error}`).join('\n'));
      inv(entity);
      setRows([]);
      onClose();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title={`Импорт из CSV: ${e?.plural ?? ''}`} subtitle="Файл из Excel или Google Таблиц: первая строка — заголовки. Кодировка UTF-8 или Windows-1251."
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" disabled={rows.length < 2} loading={busy} onClick={run}>Загрузить {rows.length > 1 ? rows.length - 1 : ''}</Button></>}>
      {!rows.length ? (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line py-12 text-center hover:border-primary">
          <FileUp className="size-8 text-faint" />
          <span className="font-semibold">Выберите CSV-файл</span>
          <span className="text-sm text-muted">Разделитель «;» или «,» определится сам</span>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(ev) => ev.target.files?.[0] && onFile(ev.target.files[0])} />
        </label>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">Сопоставьте колонки файла с полями CRM. Строк к загрузке: <b className="text-fg">{rows.length - 1}</b>.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(rows[0] ?? []).map((h, i) => (
              <FormRow key={i} label={<span>{h || `Колонка ${i + 1}`} <span className="font-normal text-faint">— напр. «{rows[1]?.[i] ?? ''}»</span></span>}>
                <Select value={map[i] ?? ''} onChange={(ev) => setMap((m) => ({ ...m, [i]: ev.target.value }))}>
                  <option value="">Не загружать</option>
                  {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </Select>
              </FormRow>
            ))}
          </div>
          <FormRow label="Если запись уже есть" hint="Например, обновлять компанию по ИНН, а не создавать дубль">
            <Select value={dedupe} onChange={(ev) => setDedupe(ev.target.value)}>
              <option value="">Всегда создавать новую</option>
              {fields.filter((f) => ['inn', 'email', 'sku', 'phone', 'name'].includes(f.key)).map((f) => <option key={f.key} value={f.key}>Обновлять по полю «{f.label}»</option>)}
            </Select>
          </FormRow>
        </div>
      )}
    </Modal>
  );
}

export function UserChip({ user, size = 22 }: { user?: { title?: string; name?: string; color?: string } | null; size?: number }) {
  if (!user) return <span className="text-faint">—</span>;
  return <span className="inline-flex min-w-0 items-center gap-2"><Avatar name={user.title ?? user.name} color={user.color} size={size} /><span className="truncate">{user.title ?? user.name}</span></span>;
}
