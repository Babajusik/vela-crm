import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ArrowDown, ArrowUp, Copy, Download, KeyRound, Plus, Save, Trash2, Upload } from 'lucide-react';
import { api, IS_DEMO, saveText } from '../../api.ts';
import { MODULES } from '../../../core/schema.ts';
import { useApi, useAuth, useInvalidate, useList, useMeta } from '../../lib/state.tsx';
import { Badge, Button, Card, EmptyState, FormRow, IconButton, Input, Loading, Modal, PageHeader, Select, Textarea, cx, useToast } from '../../ui/ui.tsx';
import { EntityList } from '../../ui/data.tsx';
import { ColorPicker, RecordForm, RefSelect, UserSelect } from '../../ui/fields.tsx';
import { ModuleTabs } from '../../layout/Layout.tsx';
import OneC from './OneC.tsx';
import { TelephonySettingsPage } from '../comms/Telephony.tsx';

const TABS = [
  { to: '/settings', label: 'Компания', end: true }, { to: '/settings/onec', label: 'Интеграция с 1С' }, { to: '/settings/telephony', label: 'Телефония' }, { to: '/settings/roles', label: 'Роли и права' },
  { to: '/settings/pipelines', label: 'Воронки' }, { to: '/settings/automations', label: 'Автодействия' }, { to: '/settings/fields', label: 'Свои поля' },
  { to: '/settings/api', label: 'API и вебхуки' }, { to: '/settings/modules', label: 'Модули' }, { to: '/settings/backup', label: 'Резервная копия' },
];

export function SettingsHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return <PageHeader title={title} subtitle={subtitle} actions={actions} tabs={<ModuleTabs tabs={TABS} />} />;
}

export default function Settings() {
  const { can } = useAuth();
  if (!can('settings')) return <EmptyState title="Нет доступа к настройкам" />;
  return (
    <Routes>
      <Route index element={<Company />} />
      <Route path="onec" element={<OneC />} />
      <Route path="telephony" element={<TelephonySettingsPage />} />
      <Route path="roles" element={<Roles />} />
      <Route path="pipelines" element={<Pipelines />} />
      <Route path="automations" element={<Automations />} />
      <Route path="fields" element={<CustomFields />} />
      <Route path="api" element={<ApiKeys />} />
      <Route path="backup" element={<Backup />} />
      <Route path="modules" element={<Modules />} />
      <Route path="*" element={<Navigate to="/settings" replace />} />
    </Routes>
  );
}

function Company() {
  const { data } = useApi<any>(['settings'], '/api/settings');
  const [c, setC] = useState<any>(null);
  const toast = useToast();
  const { refresh } = useAuth();
  useEffect(() => { if (data) setC(data.company ?? {}); }, [data]);
  if (!c) return <Loading />;
  const save = async () => {
    try { await api.put('/api/settings/company', c); toast.success('Сохранено'); refresh(); } catch (e) { toast.error(e); }
  };
  return (
    <div>
      <SettingsHeader title="Настройки" subtitle="Общие параметры компании" />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Компания">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormRow label="Название" className="sm:col-span-2"><Input value={c.name ?? ''} onChange={(e) => setC({ ...c, name: e.target.value })} /></FormRow>
            <FormRow label="Телефон"><Input value={c.phone ?? ''} onChange={(e) => setC({ ...c, phone: e.target.value })} /></FormRow>
            <FormRow label="Email"><Input value={c.email ?? ''} onChange={(e) => setC({ ...c, email: e.target.value })} /></FormRow>
            <FormRow label="Сайт"><Input value={c.site ?? ''} onChange={(e) => setC({ ...c, site: e.target.value })} /></FormRow>
            <FormRow label="Часовой пояс"><Select value={c.timezone ?? 'Europe/Moscow'} onChange={(e) => setC({ ...c, timezone: e.target.value })}>
              {['Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka'].map((z) => <option key={z}>{z}</option>)}
            </Select></FormRow>
          </div>
          <Button variant="primary" className="mt-4" icon={<Save className="size-4" />} onClick={save}>Сохранить</Button>
        </Card>
        <Card title="Наши юрлица" subtitle="Реквизиты подставляются в счета и акты" padded={false}>
          <EntityList entity="legal_entities" columns={['name', 'inn', 'tax_system', 'is_default']} canExport={false} />
        </Card>
      </div>
    </div>
  );
}

const LEVELS = [{ value: 'none', label: 'Нет' }, { value: 'read', label: 'Просмотр' }, { value: 'write', label: 'Изменение' }, { value: 'admin', label: 'Полный' }];

function Roles() {
  const { data, isLoading } = useList('roles', { limit: 50, sort: 'id', dir: 'asc' });
  const inv = useInvalidate();
  const toast = useToast();
  const { can } = useAuth();
  const [roles, setRoles] = useState<any[]>([]);
  const [newRole, setNewRole] = useState(false);
  useEffect(() => { if (data) setRoles(data.items.map((r: any) => ({ ...r, permissions: r.permissions ?? {} }))); }, [data]);
  if (isLoading) return <Loading />;
  const admin = can('settings', 'admin');
  const level = (r: any, m: string) => r.permissions['*'] ?? r.permissions[m] ?? 'none';
  const setLevel = (rid: number, m: string, v: string) => setRoles(roles.map((r) => (r.id === rid ? { ...r, permissions: { ...r.permissions, [m]: v } } : r)));
  const save = async () => {
    try { for (const r of roles) if (!r.is_system) await api.patch(`/api/e/roles/${r.id}`, { permissions: r.permissions }); inv('roles'); toast.success('Права сохранены. Сотрудники увидят изменения после повторного входа.'); }
    catch (e) { toast.error(e); }
  };
  return (
    <div>
      <SettingsHeader title="Роли и права доступа" subtitle="Кто что видит и может менять в каждом модуле"
        actions={admin && <><Button icon={<Plus className="size-4" />} onClick={() => setNewRole(true)}>Роль</Button><Button variant="primary" icon={<Save className="size-4" />} onClick={save}>Сохранить</Button></>} />
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr><th className="sticky left-0 border-b border-line bg-surface px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-faint">Модуль</th>
              {roles.map((r) => <th key={r.id} className="border-b border-line px-3 py-3 text-left font-bold">{r.name}{r.is_system ? <Badge color="#64748b" className="ml-1">системная</Badge> : null}</th>)}</tr></thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m.value} className="hover:bg-surface-2/50">
                  <td className="sticky left-0 border-b border-line bg-surface px-4 py-2 font-semibold">{m.label}</td>
                  {roles.map((r) => (
                    <td key={r.id} className="border-b border-line px-3 py-1.5">
                      <Select disabled={!admin || !!r.is_system} value={level(r, m.value)} onChange={(e) => setLevel(r.id, m.value, e.target.value)}
                        className={cx('h-8 w-36 text-xs', level(r, m.value) === 'none' && 'text-faint')}>{LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</Select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <RecordForm entity="roles" open={newRole} onClose={() => setNewRole(false)} initial={{ permissions: { dashboard: 'read', tasks: 'write', notes: 'write' } }} fields={['name', 'description']} size="md" />
    </div>
  );
}

function Pipelines() {
  const pipelines = useList('pipelines', { limit: 50, sort: 'sort', dir: 'asc' }).data?.items ?? [];
  const [sel, setSel] = useState<number | null>(null);
  const [pform, setPform] = useState<any>(null);
  const pid = sel ?? pipelines[0]?.id;
  const stages = useList('stages', { pipeline_id: pid, limit: 50, sort: 'sort', dir: 'asc' }, { enabled: !!pid }).data?.items ?? [];
  const inv = useInvalidate();
  const toast = useToast();
  const patch = async (id: number, d: any) => { try { await api.patch(`/api/e/stages/${id}`, d); inv('stages'); } catch (e) { toast.error(e); } };
  const move = async (i: number, dir: -1 | 1) => {
    const a = stages[i], b = stages[i + dir];
    if (!a || !b) return;
    await api.patch(`/api/e/stages/${a.id}`, { sort: b.sort });
    await api.patch(`/api/e/stages/${b.id}`, { sort: a.sort });
    inv('stages');
  };
  const add = async () => {
    const lastOpen = stages.filter((s: any) => s.kind === 'open').pop();
    await api.post('/api/e/stages', { pipeline_id: pid, name: 'Новая стадия', color: '#0EA5E9', kind: 'open', sort: (lastOpen?.sort ?? 0) + 1, probability: 50 });
    for (const s of stages.filter((x: any) => x.kind !== 'open')) await api.patch(`/api/e/stages/${s.id}`, { sort: s.sort + 1 });
    inv('stages');
  };
  return (
    <div>
      <SettingsHeader title="Воронки продаж" subtitle="Стадии, их порядок и цвета. Тип стадии «Успешно» или «Провал» закрывает сделку."
        actions={<Button icon={<Plus className="size-4" />} onClick={() => setPform({ sort: pipelines.length + 1 })}>Воронка</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        {pipelines.map((p: any) => <Button key={p.id} variant={p.id === pid ? 'soft' : 'secondary'} onClick={() => setSel(p.id)}>{p.name}{p.is_default ? ' ★' : ''}</Button>)}
        {pid && <Button variant="ghost" onClick={() => setPform(pipelines.find((p: any) => p.id === pid))}>Переименовать</Button>}
      </div>
      <Card padded={false}>
        <ul className="divide-y divide-line">
          {stages.map((s: any, i: number) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="flex flex-col">
                <button type="button" aria-label="Выше" disabled={i === 0} onClick={() => move(i, -1)} className="text-faint hover:text-fg disabled:opacity-30"><ArrowUp className="size-4" /></button>
                <button type="button" aria-label="Ниже" disabled={i === stages.length - 1} onClick={() => move(i, 1)} className="text-faint hover:text-fg disabled:opacity-30"><ArrowDown className="size-4" /></button>
              </div>
              <span className="size-4 rounded" style={{ background: s.color }} />
              <input defaultValue={s.name} onBlur={(e) => e.target.value !== s.name && patch(s.id, { name: e.target.value })} className="h-9 min-w-48 flex-1 rounded-lg border border-transparent bg-transparent px-2 font-semibold hover:border-line focus:border-primary focus:outline-none" />
              <Select value={s.kind} onChange={(e) => patch(s.id, { kind: e.target.value })} className="w-36"><option value="open">В работе</option><option value="won">Успешно</option><option value="lost">Провал</option></Select>
              <span className="flex items-center gap-1 text-sm text-muted"><input type="number" defaultValue={s.probability} onBlur={(e) => patch(s.id, { probability: Number(e.target.value) })} className="h-9 w-16 rounded-lg border border-line bg-surface px-2 text-right tabular" aria-label="Вероятность" />%</span>
              <ColorPicker value={s.color} onChange={(c) => patch(s.id, { color: c })} colors={['#94A3B8', '#38BDF8', '#0EA5E9', '#6366F1', '#A855F7', '#F59E0B', '#14B8A6', '#10B981', '#EF4444']} />
              <IconButton label="Удалить стадию" onClick={async () => { const n = (await api.get('/api/e/deals', { stage_id: s.id, limit: 1, expand: 0 })).total; if (n) return toast.error(`На стадии ${n} сделок — сначала переместите их`); await api.del(`/api/e/stages/${s.id}`); inv('stages'); }}><Trash2 className="size-4" /></IconButton>
            </li>
          ))}
        </ul>
        <div className="border-t border-line p-3"><Button size="sm" icon={<Plus className="size-4" />} onClick={add}>Стадия</Button></div>
      </Card>
      <RecordForm entity="pipelines" open={!!pform} onClose={() => setPform(null)} initial={pform?.id ? pform : null} fields={['name', 'is_default']} size="md" onSaved={async (r) => {
        if (!pform?.id) {
          const defs: [string, string, string][] = [['Новая', '#94A3B8', 'open'], ['В работе', '#0EA5E9', 'open'], ['Успешно', '#10B981', 'won'], ['Провал', '#EF4444', 'lost']];
          for (const [i, [name, color, kind]] of defs.entries()) await api.post('/api/e/stages', { pipeline_id: r.id, name, color, kind, sort: i + 1, probability: kind === 'won' ? 100 : kind === 'lost' ? 0 : 30 });
          setSel(r.id);
          inv('stages');
        }
      }} />
    </div>
  );
}

function Automations() {
  const { data } = useList('automations', { limit: 200 });
  const [edit, setEdit] = useState<any>(null);
  const { field } = useMeta();
  const inv = useInvalidate();
  const toast = useToast();
  const actions = field('automations', 'action')?.options ?? [];
  const save = async () => {
    try {
      const d = { name: edit.name, pipeline_id: edit.pipeline_id, stage_id: edit.stage_id, action: edit.action, params: edit.params ?? {}, is_active: edit.is_active ?? 1 };
      if (edit.id) await api.patch(`/api/e/automations/${edit.id}`, d); else await api.post('/api/e/automations', d);
      inv('automations');
      setEdit(null);
    } catch (e) { toast.error(e); }
  };
  const p = edit?.params ?? {};
  const setP = (patch: any) => setEdit({ ...edit, params: { ...p, ...patch } });
  return (
    <div>
      <SettingsHeader title="Автодействия" subtitle="Что CRM делает сама, когда сделка переходит на стадию"
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ action: 'create_task', params: { title: 'Связаться с клиентом', assignee: 'responsible', due_days: 1 }, is_active: 1 })}>Автодействие</Button>} />
      <Card padded={false}>
        <ul className="divide-y divide-line">
          {(data?.items ?? []).map((a: any) => (
            <li key={a.id}>
              <button type="button" onClick={() => setEdit(a)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                <span className="font-semibold">{a.name}</span>
                <span className="text-sm text-muted">при переходе на «{a._ref?.stage_id?.title}» → {actions.find((x) => x.value === a.action)?.label}</span>
                <Badge color={a.is_active ? '#10b981' : '#94a3b8'} className="ml-auto">{a.is_active ? 'включено' : 'выключено'}</Badge>
              </button>
            </li>
          ))}
          {!data?.items.length && <li className="px-4 py-8 text-center text-sm text-faint">Автодействий нет</li>}
        </ul>
      </Card>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Автодействие' : 'Новое автодействие'}
          footer={<>{edit.id && <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { await api.del(`/api/e/automations/${edit.id}`); inv('automations'); setEdit(null); }}>Удалить</Button>}<Button onClick={() => setEdit(null)}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
          <div className="space-y-3">
            <FormRow label="Название"><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></FormRow>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormRow label="Воронка"><RefSelect entity="pipelines" value={edit.pipeline_id} onChange={(v) => setEdit({ ...edit, pipeline_id: v, stage_id: null })} /></FormRow>
              <FormRow label="При переходе на стадию"><RefSelect entity="stages" value={edit.stage_id} onChange={(v) => setEdit({ ...edit, stage_id: v })} filter={edit.pipeline_id ? { pipeline_id: edit.pipeline_id } : undefined} /></FormRow>
            </div>
            <FormRow label="Действие"><Select value={edit.action} onChange={(e) => setEdit({ ...edit, action: e.target.value })}>{actions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</Select></FormRow>
            {edit.action === 'create_task' && <div className="grid gap-3 sm:grid-cols-2">
              <FormRow label="Название задачи" className="sm:col-span-2"><Input value={p.title ?? ''} onChange={(e) => setP({ title: e.target.value })} /></FormRow>
              <FormRow label="Срок, дней"><Input type="number" value={p.due_days ?? 1} onChange={(e) => setP({ due_days: Number(e.target.value) })} /></FormRow>
              <FormRow label="Исполнитель"><Select value={String(p.assignee ?? 'responsible')} onChange={(e) => setP({ assignee: e.target.value })}><option value="responsible">Ответственный за сделку</option></Select></FormRow>
            </div>}
            {edit.action === 'notify' && <div className="grid gap-3 sm:grid-cols-2">
              <FormRow label="Кому"><UserSelect value={p.user_id ?? null} onChange={(v) => setP({ user_id: v })} placeholder="Ответственному" /></FormRow>
              <FormRow label="Текст"><Input value={p.text ?? ''} onChange={(e) => setP({ text: e.target.value })} /></FormRow>
            </div>}
            {edit.action === 'set_responsible' && <FormRow label="Новый ответственный"><UserSelect value={p.user_id ?? null} onChange={(v) => setP({ user_id: v })} /></FormRow>}
            {edit.action === 'start_bp' && <FormRow label="Процесс"><RefSelect entity="bp_templates" value={p.template_id ?? null} onChange={(v) => setP({ template_id: v })} /></FormRow>}
            {edit.action === 'webhook' && <FormRow label="URL" hint="CRM отправит POST с данными сделки в формате JSON"><Input value={p.url ?? ''} onChange={(e) => setP({ url: e.target.value })} placeholder="https://" /></FormRow>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function CustomFields() {
  const { field } = useMeta();
  const [form, setForm] = useState<any>(null);
  const toast = useToast();
  const inv = useInvalidate();
  const save = async () => {
    try {
      const d = { ...form, key: form.key || `cf_${Date.now().toString(36)}`, options: typeof form.options === 'string' ? form.options.split(',').map((s: string) => s.trim()).filter(Boolean) : form.options ?? [] };
      if (form.id) await api.patch(`/api/e/custom_fields/${form.id}`, d); else await api.post('/api/e/custom_fields', d);
      inv('custom_fields', 'meta');
      setForm(null);
    } catch (e) { toast.error(e); }
  };
  return (
    <div>
      <SettingsHeader title="Свои поля" subtitle="Дополнительные поля в карточках сделок, компаний, задач и других объектов"
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ entity: 'deals', type: 'text' })}>Поле</Button>} />
      <EntityList entity="custom_fields" onRowClick={(r) => setForm({ ...r, options: (r.options ?? []).join(', ') })} onCreate={() => setForm({ entity: 'deals', type: 'text' })} columns={['label', 'entity', 'type', 'required']} canExport={false} />
      <Modal open={!!form} onClose={() => setForm(null)} title="Пользовательское поле"
        footer={<>{form?.id && <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { await api.del(`/api/e/custom_fields/${form.id}`); inv('custom_fields', 'meta'); setForm(null); }}>Удалить</Button>}<Button onClick={() => setForm(null)}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
        {form && <div className="space-y-3">
          <FormRow label="Название"><Input value={form.label ?? ''} onChange={(e) => setForm({ ...form, label: e.target.value })} /></FormRow>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormRow label="Где показывать"><Select value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })}>{field('custom_fields', 'entity')?.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormRow>
            <FormRow label="Тип"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{field('custom_fields', 'type')?.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormRow>
          </div>
          {form.type === 'select' && <FormRow label="Варианты" hint="Через запятую"><Input value={form.options ?? ''} onChange={(e) => setForm({ ...form, options: e.target.value })} /></FormRow>}
        </div>}
      </Modal>
    </div>
  );
}

function ApiKeys() {
  const toast = useToast();
  const inv = useInvalidate();
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState('');
  const base = IS_DEMO ? 'https://crm.ваша-компания.ru' : location.origin;
  const create = async () => {
    try { const r = await api.post('/api/api-keys', { name: name || 'Интеграция' }); setToken(r.token); setName(''); inv('api_keys'); }
    catch (e) { toast.error(e); }
  };
  return (
    <div>
      <SettingsHeader title="API и вебхуки" subtitle="Подключение внешних систем: сайт, 1С, телефония, BI" />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="API-ключи" subtitle="Ключ передаётся в заголовке Authorization: Bearer …">
          <div className="mb-4 flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название, например «Сайт»" /><Button variant="primary" icon={<KeyRound className="size-4" />} onClick={create}>Создать ключ</Button></div>
          <EntityList entity="api_keys" columns={['name', 'prefix', 'user_id', 'last_used_at', 'is_active']} canExport={false} onCreate={create} />
        </Card>
        <Card title="Как обращаться к API">
          <div className="space-y-3 text-sm">
            <p className="text-muted">Все объекты CRM доступны по REST: список, карточка, создание, изменение, удаление.</p>
            <pre className="overflow-x-auto rounded-lg bg-ink-900 p-3 text-xs leading-relaxed text-brand-200">{`GET    ${base}/api/e/deals?stage_id=3&limit=50
GET    ${base}/api/e/companies?q=вектор
POST   ${base}/api/e/companies   {"name":"ООО Ромашка","inn":"7700000000"}
PATCH  ${base}/api/e/deals/15    {"amount":150000}
DELETE ${base}/api/e/tasks/42

Authorization: Bearer vk_…`}</pre>
            <p className="text-muted">Объекты: companies, contacts, deals, deal_products, invoices, invoice_items, tasks, projects, products, fin_operations и ещё 50 — полный список отдаёт <code>GET /api/meta</code>.</p>
          </div>
        </Card>
      </div>
      <Card title="Вебхуки" subtitle="CRM отправляет POST на ваш адрес при событиях. Подпись: заголовок X-Vela-Signature (HMAC-SHA256 по секрету)." className="mt-5" padded={false}>
        <EntityList entity="webhooks" columns={['name', 'url', 'is_active', 'last_sent_at']} formFields={['name', 'url', 'secret', 'is_active']} canExport={false}
          header={<p className="border-b border-line px-4 py-2.5 text-xs text-muted">События: deals.created, deals.updated, deals.stage_changed, companies.created, invoices.updated, tasks.created … или * для всех. Поле «События» по умолчанию — все.</p>} />
      </Card>
      <Modal open={!!token} onClose={() => setToken(null)} size="md" title="Ключ создан" subtitle="Скопируйте сейчас — повторно его показать нельзя"
        footer={<Button variant="primary" icon={<Copy className="size-4" />} onClick={() => { navigator.clipboard?.writeText(token!); toast.success('Скопировано'); }}>Скопировать</Button>}>
        <code className="block break-all rounded-lg bg-surface-2 p-3 text-sm">{token}</code>
      </Modal>
    </div>
  );
}

function Backup() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [json, setJson] = useState('');
  const download = async () => {
    try { const d = await api.get('/api/backup'); saveText(JSON.stringify(d), `vela-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json'); }
    catch (e) { toast.error(e); }
  };
  const restore = async () => {
    if (!(await toast.confirm({ title: 'Восстановить из копии?', text: 'Текущие данные будут заменены данными из файла.', danger: true, ok: 'Восстановить' }))) return;
    setBusy(true);
    try { await api.post('/api/backup/restore', JSON.parse(json)); toast.success('Данные восстановлены'); setTimeout(() => location.reload(), 800); }
    catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <div>
      <SettingsHeader title="Резервная копия" subtitle="Выгрузка и восстановление всех данных CRM" />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Скачать копию">
          <p className="mb-4 text-sm text-muted">Все данные в одном JSON-файле. На своём сервере дополнительно настройте ежедневное копирование файла базы <code>data/vela.db</code> — инструкция в README.</p>
          <Button variant="primary" icon={<Download className="size-4" />} onClick={download}>Скачать</Button>
        </Card>
        <Card title="Восстановить">
          <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm font-semibold text-primary hover:underline">
            <Upload className="size-4" />Выбрать файл копии
            <input type="file" accept=".json" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setJson(await f.text()); }} />
          </label>
          <Textarea rows={3} value={json ? `${json.slice(0, 200)}…` : ''} readOnly placeholder="Файл не выбран" />
          <Button variant="danger" className="mt-3" disabled={!json} loading={busy} onClick={restore}>Восстановить</Button>
        </Card>
      </div>
    </div>
  );
}

const MODULE_INFO: { key: string; label: string; text: string }[] = [
  { key: 'tasks', label: 'Задачи', text: 'Поручения, канбан, Гант, шаблоны и учёт времени' },
  { key: 'crm', label: 'CRM', text: 'Воронки, сделки, дела, компании, контакты, счета, веб-формы' },
  { key: 'projects', label: 'Проекты', text: 'Этапы, вехи, спринты, портфели, рентабельность' },
  { key: 'finance', label: 'Финансы', text: 'Деньги, ДДС, ОПиУ, баланс, бюджеты, регулярные счета' },
  { key: 'team', label: 'Команда', text: 'Сотрудники, структура, приглашения, отсутствия' },
  { key: 'kb', label: 'База знаний', text: 'Регламенты и курсы для сотрудников' },
  { key: 'calendar', label: 'Календарь', text: 'Встречи и события' }, { key: 'messenger', label: 'Мессенджер', text: 'Чаты команды' },
  { key: 'communications', label: 'Коммуникации', text: 'Диалоги с клиентами из мессенджеров' }, { key: 'mail', label: 'Почта', text: 'Письма, привязанные к клиентам' },
  { key: 'files', label: 'Файлы', text: 'Общее хранилище' }, { key: 'catalog', label: 'Каталог', text: 'Товары, услуги, склад' },
  { key: 'lists', label: 'Списки', text: 'Свои реестры и справочники' }, { key: 'time', label: 'Тайм-трекер', text: 'Учёт рабочего времени' },
  { key: 'bp', label: 'Бизнес-процессы', text: 'Согласования и цепочки действий' }, { key: 'documents', label: 'Документы', text: 'Шаблоны договоров и КП' },
  { key: 'notes', label: 'Заметки', text: 'Личные заметки' }, { key: 'portal', label: 'Кабинет клиента', text: 'Счета, акты и обращения клиентов' },
];

function Modules() {
  const { settings, refresh, can } = useAuth();
  const toast = useToast();
  const disabled: string[] = settings?.modules?.disabled ?? [];
  const admin = can('settings', 'admin');
  const toggle = async (key: string) => {
    const next = disabled.includes(key) ? disabled.filter((k) => k !== key) : [...disabled, key];
    try { await api.put('/api/settings/modules', { disabled: next }); await refresh(); toast.success(next.includes(key) ? 'Модуль выключен' : 'Модуль включён'); }
    catch (e) { toast.error(e); }
  };
  return (
    <div>
      <SettingsHeader title="Модули" subtitle="Оставьте только то, чем пользуется компания: выключенные модули пропадут из меню у всех" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {MODULE_INFO.map((m) => {
          const on = !disabled.includes(m.key);
          return (
            <div key={m.key} className={cx('flex items-start gap-3 rounded-2xl border bg-surface p-4', on ? 'border-line' : 'border-dashed border-line-strong opacity-70')}>
              <div className="min-w-0 flex-1"><p className="font-bold">{m.label}</p><p className="text-sm text-muted">{m.text}</p></div>
              <button type="button" role="switch" aria-checked={on} aria-label={m.label} disabled={!admin} onClick={() => toggle(m.key)}
                className={cx('relative mt-1 h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-primary' : 'bg-line-strong')}>
                <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-4.5' : 'translate-x-0.5')} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
