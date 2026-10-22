import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Settings2, Trash2 } from 'lucide-react';
import type { Field } from '../../core/types.ts';
import { api, saveText } from '../api.ts';
import { useAuth, useInvalidate, useList, useRecord } from '../lib/state.tsx';
import { Button, Card, EmptyState, FormRow, IconButton, Input, Loading, Modal, PageHeader, Select, Textarea, useToast } from '../ui/ui.tsx';
import { DataTable } from '../ui/data.tsx';
import { FieldInput, FieldValue } from '../ui/fields.tsx';

interface LF { key: string; label: string; type: string; options?: string[] }
const TYPES = [{ value: 'text', label: 'Строка' }, { value: 'textarea', label: 'Текст' }, { value: 'number', label: 'Число' }, { value: 'money', label: 'Деньги' },
  { value: 'date', label: 'Дата' }, { value: 'bool', label: 'Да/нет' }, { value: 'select', label: 'Список значений' }, { value: 'url', label: 'Ссылка' }, { value: 'phone', label: 'Телефон' }];

const toField = (f: LF): Field => ({ key: f.key, label: f.label, type: f.type as Field['type'], options: f.type === 'select' ? (f.options ?? []).map((o) => ({ value: o, label: o })) : undefined });

export default function Lists() {
  const { id } = useParams();
  return id ? <ListView id={Number(id)} /> : <Home />;
}

function Home() {
  const { data, isLoading } = useList('custom_lists', { limit: 200 });
  const { can } = useAuth();
  const [edit, setEdit] = useState<any>(null);
  return (
    <div>
      <PageHeader title="Списки" subtitle="Свои справочники и реестры: договоры, подрядчики, автопарк — что угодно"
        actions={can('lists', 'write') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ name: '', icon: '📋', fields: [{ key: 'name', label: 'Название', type: 'text' }] })}>Список</Button>} />
      {isLoading ? <Loading /> : !data?.items.length ? <EmptyState title="Списков пока нет" text="Создайте реестр с нужными колонками — как таблицу, только с правами доступа и историей." /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((l: any) => (
            <Link key={l.id} to={`/lists/${l.id}`} className="rounded-xl border border-line bg-surface p-4 transition hover:border-line-strong hover:shadow-md">
              <p className="text-2xl">{l.icon || '📋'}</p>
              <p className="mt-2 font-bold">{l.name}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{l.description}</p>
              <p className="mt-3 text-xs text-faint">{(l.fields ?? []).length} полей</p>
            </Link>
          ))}
        </div>
      )}
      {edit && <ListEditor list={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ListEditor({ list, onClose }: { list: any; onClose: () => void }) {
  const [f, setF] = useState<any>(list);
  const toast = useToast();
  const inv = useInvalidate();
  const nav = useNavigate();
  const fields: LF[] = f.fields ?? [];
  const set = (i: number, patch: Partial<LF>) => setF({ ...f, fields: fields.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const save = async () => {
    if (!f.name?.trim()) return toast.error('Введите название списка');
    try {
      const payload = { name: f.name, description: f.description, icon: f.icon, fields: fields.map((x, i) => ({ ...x, key: x.key || `f${i}_${Date.now() % 1000}` })) };
      const r = f.id ? await api.patch(`/api/e/custom_lists/${f.id}`, payload) : await api.post('/api/e/custom_lists', payload);
      inv('custom_lists');
      onClose();
      if (!f.id) nav(`/lists/${r.id}`);
    } catch (e) { toast.error(e); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={f.id ? 'Настройка списка' : 'Новый список'} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[80px_1fr]">
          <FormRow label="Иконка"><Input value={f.icon ?? ''} onChange={(e) => setF({ ...f, icon: e.target.value })} /></FormRow>
          <FormRow label="Название"><Input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormRow>
        </div>
        <FormRow label="Описание"><Textarea rows={2} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></FormRow>
        <div>
          <p className="mb-2 text-[13px] font-semibold text-muted">Колонки</p>
          <div className="space-y-2">
            {fields.map((x, i) => (
              <div key={i} className="flex flex-wrap gap-2 rounded-lg border border-line p-2">
                <Input value={x.label} onChange={(e) => set(i, { label: e.target.value })} className="min-w-40 flex-1" placeholder="Название колонки" />
                <Select value={x.type} onChange={(e) => set(i, { type: e.target.value })} className="w-auto">{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
                {x.type === 'select' && <Input value={(x.options ?? []).join(', ')} onChange={(e) => set(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="Значения через запятую" className="min-w-48 flex-1" />}
                <IconButton label="Удалить колонку" onClick={() => setF({ ...f, fields: fields.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></IconButton>
              </div>
            ))}
          </div>
          <Button size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setF({ ...f, fields: [...fields, { key: `f${fields.length}_${Date.now() % 1000}`, label: 'Новая колонка', type: 'text' }] })}>Колонка</Button>
        </div>
      </div>
    </Modal>
  );
}

function ListView({ id }: { id: number }) {
  const { data: list, isLoading } = useRecord('custom_lists', id);
  const items = useList('custom_list_items', { list_id: id, limit: 2000 }).data?.items ?? [];
  const { can } = useAuth();
  const toast = useToast();
  const inv = useInvalidate();
  const nav = useNavigate();
  const [row, setRow] = useState<any>(null);
  const [cfg, setCfg] = useState(false);
  const [q, setQ] = useState('');
  if (isLoading) return <Loading />;
  if (!list) return <EmptyState title="Список не найден" />;
  const fields: LF[] = list.fields ?? [];
  const rows = items.map((it: any) => ({ id: it.id, ...(it.data ?? {}) })).filter((r: any) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  const exportCsv = () => {
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    saveText('﻿' + [fields.map((f) => esc(f.label)).join(';'), ...rows.map((r: any) => fields.map((f) => esc(r[f.key])).join(';'))].join('\r\n'), `${list.name}.csv`, 'text/csv;charset=utf-8');
  };
  return (
    <div>
      <Link to="/lists" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" />Списки</Link>
      <PageHeader title={`${list.icon ?? ''} ${list.name}`} subtitle={list.description}
        actions={<>
          <Button onClick={exportCsv}>Excel</Button>
          {can('lists', 'write') && <>
            <Button icon={<Settings2 className="size-4" />} onClick={() => setCfg(true)}>Колонки</Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setRow({})}>Запись</Button>
            <IconButton label="Удалить список" onClick={async () => { if (await toast.confirm({ title: `Удалить список «${list.name}» со всеми записями?`, danger: true, ok: 'Удалить' })) { await api.del(`/api/e/custom_lists/${id}`); inv('custom_lists'); nav('/lists'); } }}><Trash2 className="size-4" /></IconButton>
          </>}
        </>} />
      <Card padded={false}>
        <div className="border-b border-line p-3"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по списку…" className="max-w-sm" /></div>
        <DataTable rows={rows} onRowClick={(r) => can('lists', 'write') && setRow(r)}
          columns={fields.map((f) => ({ key: f.key, label: f.label, render: (r: any) => <FieldValue field={toField(f)} value={r[f.key]} /> }))}
          empty={<EmptyState compact title="Записей нет" />} />
      </Card>
      {row && <RowEditor list={list} row={row} onClose={() => setRow(null)} />}
      {cfg && <ListEditor list={list} onClose={() => setCfg(false)} />}
    </div>
  );
}

function RowEditor({ list, row, onClose }: { list: any; row: any; onClose: () => void }) {
  const [d, setD] = useState<any>({});
  const toast = useToast();
  const inv = useInvalidate();
  useEffect(() => { const { id: _id, ...rest } = row; setD(rest); }, [row]);
  const save = async () => {
    try {
      if (row.id) await api.patch(`/api/e/custom_list_items/${row.id}`, { data: d });
      else await api.post('/api/e/custom_list_items', { list_id: list.id, data: d });
      inv('custom_list_items');
      onClose();
    } catch (e) { toast.error(e); }
  };
  return (
    <Modal open onClose={onClose} title={row.id ? 'Запись' : 'Новая запись'}
      footer={<>{row.id && <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { await api.del(`/api/e/custom_list_items/${row.id}`); inv('custom_list_items'); onClose(); }}>Удалить</Button>}<Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {(list.fields ?? []).map((f: LF) => (
          <FormRow key={f.key} label={f.label} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
            <FieldInput field={toField(f)} value={d[f.key]} onChange={(v) => setD({ ...d, [f.key]: v })} />
          </FormRow>
        ))}
      </div>
    </Modal>
  );
}
