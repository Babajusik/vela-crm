import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { Bold, Check, ChevronDown, Heading2, Italic, Link2, List, ListOrdered, Search, X } from 'lucide-react';
import type { Field } from '../../core/types.ts';
import { api } from '../api.ts';
import { date, dateTime, money, num } from '../lib/format.ts';
import { useMeta, useSave, useUsers, type CustomField } from '../lib/state.tsx';
import { Avatar, AvatarStack, Badge, Button, Checkbox, FormRow, Input, Modal, Select, Switch, Textarea, cx, useToast } from './ui.tsx';
import { PhoneLink } from './phone.tsx';

// links to record pages
export const ENTITY_LINKS: Record<string, string> = {
  companies: '/crm/companies/', contacts: '/crm/contacts/', deals: '/crm/deals/', invoices: '/crm/invoices/', acts: '/crm/acts/',
  tasks: '/tasks/', projects: '/projects/', users: '/team/', kb_articles: '/kb/', custom_lists: '/lists/',
};
export const linkTo = (entity: string, id: number | string) => (ENTITY_LINKS[entity] ? ENTITY_LINKS[entity] + id : null);

export const COLORS = ['#0FA596', '#0EA5E9', '#6366F1', '#8B5CF6', '#EC4899', '#F97362', '#F59E0B', '#84CC16', '#10B981', '#64748B'];
export const NOTE_COLORS = ['#FEF3C7', '#DCFCE7', '#E0F2FE', '#FCE7F3', '#EDE9FE', '#F1F5F9'];

// ---------------- value rendering ----------------
export function FieldValue({ field, item, value }: { field: Field; item?: Record<string, any>; value?: unknown }) {
  const v = value !== undefined ? value : item?.[field.key];
  const ref = item?._ref?.[field.key];
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return <span className="text-faint">—</span>;
  switch (field.type) {
    case 'select': {
      const o = field.options?.find((x) => x.value === String(v));
      return o?.color ? <Badge color={o.color} dot>{o.label}</Badge> : <span>{o?.label ?? String(v)}</span>;
    }
    case 'ref': {
      if (!ref) return <span className="text-faint">#{String(v)}</span>;
      const to = linkTo(field.ref!, v as number);
      const inner = ref.color && field.ref === 'stages' ? <Badge color={ref.color}>{ref.title}</Badge> : <span className="truncate">{ref.title}</span>;
      return to ? <Link to={to} onClick={(e) => e.stopPropagation()} className="truncate font-medium text-fg hover:text-primary hover:underline">{inner}</Link> : inner;
    }
    case 'user':
      return ref ? <span className="inline-flex min-w-0 items-center gap-2"><Avatar name={ref.title} color={ref.color} size={22} /><span className="truncate">{ref.title}</span></span> : <span className="text-faint">—</span>;
    case 'users':
      return Array.isArray(ref) && ref.length ? <AvatarStack users={ref} /> : <span className="text-faint">—</span>;
    case 'money': return <span className="tabular whitespace-nowrap">{money(v)}</span>;
    case 'number': return <span className="tabular">{num(v, 2)}</span>;
    case 'int': return <span className="tabular">{num(v)}</span>;
    case 'date': return <span className="whitespace-nowrap">{date(v)}</span>;
    case 'datetime': return <span className="whitespace-nowrap">{dateTime(v)}</span>;
    case 'bool': return v ? <Check className="size-4 text-success" /> : <span className="text-faint">—</span>;
    case 'tags': return <span className="flex flex-wrap gap-1">{(v as string[]).map((t) => <Badge key={t} color="#6366F1">{t}</Badge>)}</span>;
    case 'color': return <span className="inline-block size-4 rounded" style={{ background: String(v) }} />;
    case 'url': return <a href={String(v).startsWith('http') ? String(v) : `https://${v}`} target="_blank" rel="noreferrer" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{String(v)}</a>;
    case 'email': return <a href={`mailto:${v}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{String(v)}</a>;
    case 'phone': return <PhoneLink value={String(v)} />;
    case 'richtext': return <SafeHtml html={String(v)} />;
    case 'textarea': return <span className="whitespace-pre-line">{String(v)}</span>;
    case 'json': return <span className="text-faint">…</span>;
    default: return <span>{String(v)}</span>;
  }
}

export function SafeHtml({ html, className }: { html: string; className?: string }) {
  const clean = useMemo(() => DOMPurify.sanitize(html, { ADD_ATTR: ['target'] }), [html]);
  return <div className={cx('prose-vela', className)} dangerouslySetInnerHTML={{ __html: clean }} />;
}

// ---------------- reference pickers ----------------
interface RefItem { id: number; title: string; sub?: string; color?: string }

export function RefSelect({ entity, value, onChange, placeholder = 'Не выбрано', filter, allowClear = true, display }: {
  entity: string; value: number | null | undefined; onChange: (v: number | null, item?: any) => void; placeholder?: string;
  filter?: Record<string, string | number>; allowClear?: boolean; display?: string;
}) {
  const { ent } = useMeta();
  const e = ent(entity);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<RefItem[]>([]);
  const [label, setLabel] = useState<string | undefined>(display);
  const box = useRef<HTMLDivElement>(null);
  const titleField = e?.titleField ?? 'name';

  useEffect(() => { setLabel(display); }, [display]);
  useEffect(() => {
    if (!value) { setLabel(undefined); return; }
    if (display) return;
    let alive = true;
    api.get(`/api/e/${entity}/${value}`).then((r) => { if (alive) setLabel(String(r[titleField] ?? `#${value}`)); }).catch(() => {});
    return () => { alive = false; };
  }, [entity, value, titleField, display]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api.get(`/api/e/${entity}`, { q, limit: 30, expand: 0, ...(filter ?? {}) }).then((r) => {
        setItems(r.items.map((x: any) => ({ id: x.id, title: entity === 'invoices' ? `Счёт № ${x.number}` : String(x[titleField] ?? `#${x.id}`), sub: x.inn ?? x.sku ?? x.email ?? x.position ?? '', color: x.color })));
      }).catch(() => setItems([]));
    }, 150);
    return () => clearTimeout(t);
  }, [open, q, entity, titleField, JSON.stringify(filter)]);
  useEffect(() => {
    if (!open) return;
    const h = (ev: MouseEvent) => { if (box.current && !box.current.contains(ev.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 text-left text-sm hover:border-line-strong focus:border-primary focus:outline-none">
        <span className={cx('min-w-0 flex-1 truncate', !value && 'text-faint')}>{value ? (label ?? '…') : placeholder}</span>
        {value && allowClear ? <X className="size-4 text-faint hover:text-fg" onClick={(ev) => { ev.stopPropagation(); onChange(null); }} /> : <ChevronDown className="size-4 text-faint" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-64 rounded-xl border border-line bg-surface p-1.5 shadow-xl anim-in">
          <Input autoFocus value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Поиск…" icon={<Search className="size-4" />} />
          <div className="mt-1 max-h-64 overflow-y-auto">
            {items.map((it) => (
              <button key={it.id} type="button" onClick={() => { onChange(it.id, it); setLabel(it.title); setOpen(false); setQ(''); }}
                className={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-2', it.id === value && 'bg-primary-soft')}>
                {entity === 'users' && <Avatar name={it.title} color={it.color} size={22} />}
                {it.color && entity !== 'users' && <span className="size-2.5 rounded-full" style={{ background: it.color }} />}
                <span className="min-w-0 flex-1 truncate">{it.title}</span>
                {it.sub && <span className="truncate text-xs text-faint">{it.sub}</span>}
              </button>
            ))}
            {!items.length && <p className="px-2.5 py-3 text-sm text-faint">Ничего не найдено</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function UserSelect({ value, onChange, placeholder = 'Не назначен', allowClear = true }: { value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; allowClear?: boolean }) {
  const { users, byId } = useUsers();
  const u: any = value ? byId.get(value) : null;
  return (
    <div className="relative">
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className={u ? 'pl-10' : ''}>
        {(allowClear || !value) && <option value="">{placeholder}</option>}
        {users.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </Select>
      {u && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"><Avatar name={u.name} color={u.color} size={22} /></span>}
    </div>
  );
}

export function UsersSelect({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const { users } = useUsers();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const selected = users.filter((u: any) => value?.includes(u.id));
  useEffect(() => {
    if (!open) return;
    const h = (ev: MouseEvent) => { if (box.current && !box.current.contains(ev.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-left text-sm hover:border-line-strong">
        {selected.length ? selected.map((u: any) => (
          <span key={u.id} className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 py-0.5 pl-0.5 pr-2 text-xs font-semibold"><Avatar name={u.name} color={u.color} size={20} />{u.name.split(' ')[0]}</span>
        )) : <span className="px-1 text-faint">Никого</span>}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 max-h-72 w-full min-w-60 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-xl anim-in">
          {users.map((u: any) => {
            const on = value?.includes(u.id);
            return (
              <button key={u.id} type="button" onClick={() => onChange(on ? value.filter((x) => x !== u.id) : [...(value ?? []), u.id])}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                <span className={cx('flex size-4 items-center justify-center rounded border', on ? 'border-primary bg-primary text-white' : 'border-line-strong')}>{on && <Check className="size-3" />}</span>
                <Avatar name={u.name} color={u.color} size={22} />
                <span className="truncate">{u.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TagsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim().replace(/,$/, '');
    if (t && !value.includes(t)) onChange([...value, t]);
    setText('');
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 focus-within:border-primary">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
          {t}<button type="button" aria-label={`Удалить тег ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}><X className="size-3" /></button>
        </span>
      ))}
      <input value={text} onChange={(e) => setText(e.target.value)} onBlur={add} placeholder={value.length ? '' : 'Введите тег и нажмите Enter'}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)); }}
        className="min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-faint" />
    </div>
  );
}

export function ColorPicker({ value, onChange, colors = COLORS }: { value: string; onChange: (v: string) => void; colors?: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((c) => (
        <button key={c} type="button" aria-label={`Цвет ${c}`} onClick={() => onChange(c)}
          className={cx('size-7 rounded-lg border-2 transition-transform hover:scale-110', value === c ? 'border-fg' : 'border-transparent')} style={{ background: c }} />
      ))}
    </div>
  );
}

export function RichText({ value, onChange, minHeight = 220 }: { value: string; onChange: (v: string) => void; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = DOMPurify.sanitize(value ?? '');
  }, [value]);
  const cmd = (c: string, arg?: string) => { document.execCommand(c, false, arg); ref.current?.focus(); onChange(ref.current?.innerHTML ?? ''); };
  const tools: [ReactNode, string, () => void][] = [
    [<Bold className="size-4" />, 'Жирный', () => cmd('bold')], [<Italic className="size-4" />, 'Курсив', () => cmd('italic')],
    [<Heading2 className="size-4" />, 'Заголовок', () => cmd('formatBlock', 'h2')], [<List className="size-4" />, 'Список', () => cmd('insertUnorderedList')],
    [<ListOrdered className="size-4" />, 'Нумерованный список', () => cmd('insertOrderedList')],
    [<Link2 className="size-4" />, 'Ссылка', () => { const u = prompt('Адрес ссылки'); if (u) cmd('createLink', u); }],
  ];
  return (
    <div className="rounded-lg border border-line bg-surface focus-within:border-primary">
      <div className="flex gap-0.5 border-b border-line p-1">
        {tools.map(([icon, label, fn]) => (
          <button key={label} type="button" title={label} aria-label={label} onMouseDown={(e) => { e.preventDefault(); fn(); }} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg">{icon}</button>
        ))}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); cmd('formatBlock', 'p'); }} className="rounded-md px-2 text-xs font-semibold text-muted hover:bg-surface-2">Абзац</button>
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning className="prose-vela px-3 py-2 outline-none" style={{ minHeight }}
        onInput={() => onChange(ref.current?.innerHTML ?? '')} />
    </div>
  );
}

// ---------------- generic input ----------------
export function FieldInput({ field, value, onChange, item }: { field: Field; value: any; onChange: (v: any) => void; item?: Record<string, any> }) {
  switch (field.type) {
    case 'textarea': return <Textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} rows={3} />;
    case 'richtext': return <RichText value={value ?? ''} onChange={onChange} />;
    case 'int': case 'number': case 'money':
      return <Input type="number" step={field.type === 'int' ? 1 : 'any'} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} inputMode="decimal" />;
    case 'date': return <Input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
    case 'datetime': return <Input type="datetime-local" value={value ? String(value).slice(0, 16) : ''} onChange={(e) => onChange(e.target.value || null)} />;
    case 'bool': return <Switch checked={!!value} onChange={(v) => onChange(v ? 1 : 0)} />;
    case 'select':
      return (
        <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          {!field.required && <option value="">—</option>}
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      );
    case 'ref': {
      const filter: Record<string, string | number> = {};
      if (field.ref === 'stages' && item?.pipeline_id) filter.pipeline_id = item.pipeline_id;
      if (field.ref === 'contacts' && item?.company_id) filter.company_id = item.company_id;
      if ((field.ref === 'milestones' || field.ref === 'sprints') && item?.project_id) filter.project_id = item.project_id;
      return <RefSelect entity={field.ref!} value={value} onChange={onChange} filter={filter} display={item?._ref?.[field.key]?.title} />;
    }
    case 'user': return <UserSelect value={value} onChange={onChange} />;
    case 'users': return <UsersSelect value={value ?? []} onChange={onChange} />;
    case 'tags': return <TagsInput value={value ?? []} onChange={onChange} />;
    case 'color': return <ColorPicker value={value ?? ''} onChange={onChange} />;
    case 'email': return <Input type="email" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'phone': return <Input type="tel" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="+7 900 000-00-00" />;
    case 'url': return <Input type="url" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="https://" />;
    case 'json': return null;
    default: return <Input value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function customToField(c: CustomField): Field {
  return {
    key: c.key || `cf_${c.id}`, label: c.label, type: (c.type as Field['type']) ?? 'text', required: !!c.required,
    options: c.type === 'select' ? (c.options ?? []).map((o) => ({ value: o, label: o })) : undefined,
  };
}

// ---------------- record form ----------------
export function RecordForm({ entity, open, onClose, initial, fields, title, onSaved, size = 'lg' }: {
  entity: string; open: boolean; onClose: () => void; initial?: Record<string, any> | null; fields?: string[]; title?: ReactNode;
  onSaved?: (row: any) => void; size?: 'md' | 'lg' | 'xl';
}) {
  const { ent, custom } = useMeta();
  const e = ent(entity);
  const save = useSave(entity);
  const toast = useToast();
  const [data, setData] = useState<Record<string, any>>({});
  useEffect(() => {
    if (!open || !e) return;
    const base: Record<string, any> = {};
    for (const f of e.fields) if (f.default !== undefined && !initial?.id) base[f.key] = f.default;
    setData({ ...base, ...(initial ?? {}), extra: { ...(initial?.extra ?? {}) } });
  }, [open, initial, e]);
  if (!e) return null;
  const shown = (fields ? fields.map((k) => e.fields.find((f) => f.key === k)).filter(Boolean) as Field[] : e.fields.filter((f) => !f.hidden && !f.readonly && f.type !== 'json'));
  const groups = new Map<string, Field[]>();
  for (const f of shown) {
    const g = f.group ?? '';
    groups.set(g, [...(groups.get(g) ?? []), f]);
  }
  const cfs = custom(entity).map(customToField);
  const isEdit = !!initial?.id;
  const submit = async () => {
    try {
      const payload: Record<string, any> = {};
      for (const f of shown) payload[f.key] = data[f.key];
      if (cfs.length) payload.extra = data.extra;
      for (const [k, v] of Object.entries(initial ?? {})) if (!(k in payload) && !k.startsWith('_') && !['id', 'created_at', 'updated_at', 'created_by', 'extra'].includes(k) && !isEdit) payload[k] = v;
      const row = await save.mutateAsync({ id: initial?.id, data: payload });
      toast.success(isEdit ? 'Сохранено' : `${e.label}: создано`);
      onSaved?.(row);
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal open={open} onClose={onClose} size={size} title={title ?? (isEdit ? `${e.label}: редактирование` : `Новая запись: ${e.label.toLowerCase()}`)}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={save.isPending} onClick={submit}>{isEdit ? 'Сохранить' : 'Создать'}</Button></>}>
      <form onSubmit={(ev) => { ev.preventDefault(); submit(); }} className="space-y-5">
        {[...groups.entries()].map(([g, fs]) => (
          <fieldset key={g || 'main'}>
            {g && <legend className="mb-3 text-xs font-bold uppercase tracking-wide text-faint">{g}</legend>}
            <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
              {fs.map((f) => (
                <FormRow key={f.key} label={f.label} required={f.required} hint={f.hint} className={cx((f.wide || f.type === 'textarea' || f.type === 'richtext' || f.type === 'users') && 'sm:col-span-2')}>
                  <FieldInput field={f} value={data[f.key]} item={data} onChange={(v) => setData((d) => ({ ...d, [f.key]: v }))} />
                </FormRow>
              ))}
            </div>
          </fieldset>
        ))}
        {cfs.length > 0 && (
          <fieldset>
            <legend className="mb-3 text-xs font-bold uppercase tracking-wide text-faint">Дополнительно</legend>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
              {cfs.map((f) => (
                <FormRow key={f.key} label={f.label} required={f.required}>
                  <FieldInput field={f} value={data.extra?.[f.key]} onChange={(v) => setData((d) => ({ ...d, extra: { ...(d.extra ?? {}), [f.key]: v } }))} />
                </FormRow>
              ))}
            </div>
          </fieldset>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function CheckboxList({ options, value, onChange }: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {options.map((o) => <Checkbox key={o.value} checked={value.includes(o.value)} label={o.label} onChange={(c) => onChange(c ? [...value, o.value] : value.filter((x) => x !== o.value))} />)}
    </div>
  );
}
