import { useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Mail, Phone, Plus, UserPlus } from 'lucide-react';
import { api } from '../api.ts';
import { addDaysIso, date, parseDate, toLocalDate, todayIso, WEEKDAYS } from '../lib/format.ts';
import { useAuth, useInvalidate, useList, useRecord } from '../lib/state.tsx';
import { Avatar, AvatarStack, Badge, Button, Card, Checkbox, EmptyState, FormRow, Input, Loading, Modal, PageHeader, Progress, Select, cx, useToast } from '../ui/ui.tsx';
import { DataTable, EntityList, FieldsPanel } from '../ui/data.tsx';
import { RecordForm } from '../ui/fields.tsx';
import { ModuleTabs } from '../layout/Layout.tsx';

const TABS = [{ to: '/team', label: 'Сотрудники', end: true }, { to: '/team/structure', label: 'Структура компании' }, { to: '/team/groups', label: 'Группы' },
  { to: '/team/invitations', label: 'Приглашения' }, { to: '/team/absences', label: 'Отсутствия' }, { to: '/team/onboarding', label: 'Онбординг' }];
const ABS: Record<string, [string, string]> = { vacation: ['Отпуск', '#10b981'], sick: ['Больничный', '#ef4444'], trip: ['Командировка', '#0ea5e9'], dayoff: ['Отгул', '#f59e0b'], remote: ['Удалёнка', '#a855f7'] };

function Header({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return <PageHeader title={title} subtitle={subtitle} actions={actions} tabs={<ModuleTabs tabs={TABS} />} />;
}

export default function Team() {
  return (
    <Routes>
      <Route index element={<Employees />} />
      <Route path="structure" element={<Structure />} />
      <Route path="groups" element={<Groups />} />
      <Route path="invitations" element={<Invitations />} />
      <Route path="absences" element={<Absences />} />
      <Route path="onboarding" element={<Onboarding />} />
      <Route path=":id" element={<Profile />} />
      <Route path="*" element={<Navigate to="/team" replace />} />
    </Routes>
  );
}

function Employees() {
  const { can } = useAuth();
  const [sp] = useSearchParams();
  const [invite, setInvite] = useState(sp.get('invite') === '1');
  return (
    <div>
      <Header title="Команда" subtitle="Сотрудники компании и их роли"
        actions={can('team', 'admin') && <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setInvite(true)}>Пригласить</Button>} />
      <EntityList entity="users" rowLink={(r) => `/team/${r.id}`} canExport onCreate={() => setInvite(true)} createLabel="Сотрудник"
        filters={[{ key: 'is_active', label: 'Статус', options: [{ value: '1', label: 'Активные' }, { value: '0', label: 'Отключённые' }] }]}
        columns={[{ key: 'name', label: 'Сотрудник', render: (r: any) => <span className="flex items-center gap-2.5"><Avatar name={r.name} color={r.color} size={30} /><span><span className="block font-semibold">{r.name}</span><span className="text-xs text-muted">{r.position}</span></span></span> },
          'department_id', 'role_id', 'email', 'phone', 'is_active']} />
      <InviteDialog open={invite} onClose={() => setInvite(false)} />
    </div>
  );
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const roles = useList('roles', { limit: 50 }).data?.items ?? [];
  const deps = useList('departments', { limit: 200 }).data?.items ?? [];
  const toast = useToast();
  const inv = useInvalidate();
  const [f, setF] = useState<any>({ password: Math.random().toString(36).slice(2, 10) });
  const submit = async () => {
    try {
      await api.post('/api/users/invite', { ...f, role_id: Number(f.role_id || roles[roles.length - 1]?.id), department_id: f.department_id ? Number(f.department_id) : null });
      toast.success(`Сотрудник добавлен. Логин: ${f.email}, пароль: ${f.password}`);
      inv('users');
      onClose();
      setF({ password: Math.random().toString(36).slice(2, 10) });
    } catch (e) { toast.error(e); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Новый сотрудник" subtitle="Передайте сотруднику email и пароль — он сменит пароль после входа"
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit}>Добавить</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormRow label="ФИО" required><Input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormRow>
        <FormRow label="Email (логин)" required><Input type="email" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></FormRow>
        <FormRow label="Должность"><Input value={f.position ?? ''} onChange={(e) => setF({ ...f, position: e.target.value })} /></FormRow>
        <FormRow label="Телефон"><Input value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></FormRow>
        <FormRow label="Роль"><Select value={f.role_id ?? ''} onChange={(e) => setF({ ...f, role_id: e.target.value })}><option value="">Сотрудник</option>{roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></FormRow>
        <FormRow label="Отдел"><Select value={f.department_id ?? ''} onChange={(e) => setF({ ...f, department_id: e.target.value })}><option value="">—</option>{deps.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></FormRow>
        <FormRow label="Пароль" hint="Не короче 6 символов"><Input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></FormRow>
      </div>
    </Modal>
  );
}

function Profile() {
  const { id } = useParams();
  const uid = Number(id);
  const nav = useNavigate();
  const { user, can } = useAuth();
  const toast = useToast();
  const { data: u, isLoading } = useRecord('users', uid);
  const tasks = useList('tasks', { assignee_id: uid, status__ne: 'done', limit: 50 }).data?.items ?? [];
  const absences = useList('absences', { user_id: uid, limit: 20 }).data?.items ?? [];
  const [pw, setPw] = useState('');
  if (isLoading) return <Loading />;
  if (!u) return <EmptyState title="Сотрудник не найден" action={<Button onClick={() => nav('/team')}>К команде</Button>} />;
  const admin = can('team', 'admin');
  return (
    <div>
      <Link to="/team" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" />Команда</Link>
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={u.name} color={u.color} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold tracking-tight">{u.name}</h1>
            <p className="text-muted">{[u.position, u._ref?.department_id?.title].filter(Boolean).join(' · ')}</p>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <a href={`mailto:${u.email}`} className="flex items-center gap-1.5 hover:text-primary"><Mail className="size-4 text-faint" />{u.email}</a>
              {u.phone && <a href={`tel:${u.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1.5 hover:text-primary"><Phone className="size-4 text-faint" />{u.phone}</a>}
            </div>
          </div>
          {!u.is_active && <Badge color="#94a3b8">Отключён</Badge>}
        </div>
      </Card>
      <div className="grid gap-5 xl:grid-cols-[400px_1fr]">
        <div className="space-y-5">
          <Card title="Карточка сотрудника"><FieldsPanel entity="users" item={u} readOnly={!admin && user!.id !== uid} fields={['position', 'department_id', 'role_id', 'phone', 'birthday', 'hired_at', ...(u.salary !== undefined ? ['salary', 'hour_rate'] : []), 'color', 'is_active']} /></Card>
          {admin && (
            <Card title="Сброс пароля">
              <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); try { await api.post(`/api/users/${uid}/password`, { password: pw }); toast.success('Пароль изменён'); setPw(''); } catch (err) { toast.error(err); } }}>
                <Input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Новый пароль" />
                <Button type="submit">Задать</Button>
              </form>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card title={`Задачи в работе: ${tasks.length}`} padded={false}><DataTable entity="tasks" rows={tasks} onRowClick={(r) => nav(`/tasks/${r.id}`)} columns={['title', 'status', 'deadline', 'project_id']} /></Card>
          <Card title="Отсутствия" padded={false}><DataTable entity="absences" rows={absences} columns={['type', 'date_from', 'date_to', 'status']} /></Card>
        </div>
      </div>
    </div>
  );
}

function Structure() {
  const deps = useList('departments', { limit: 500 }).data?.items ?? [];
  const users = useList('users', { limit: 500, is_active: 1 }).data?.items ?? [];
  const { can } = useAuth();
  const [form, setForm] = useState<any>(null);
  const node = (d: any): JSX.Element => {
    const kids = deps.filter((x: any) => x.parent_id === d.id);
    const people = users.filter((u: any) => u.department_id === d.id);
    return (
      <li key={d.id} className="relative">
        <div className="inline-block min-w-64 rounded-xl border border-line bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="font-bold">{d.name}</p>
            {can('team', 'write') && <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setForm(d)}>Изменить</button>}
          </div>
          {d._ref?.head_id && <p className="mt-1 flex items-center gap-2 text-sm"><Avatar name={d._ref.head_id.title} color={d._ref.head_id.color} size={22} /><span>{d._ref.head_id.title}</span><span className="text-xs text-faint">руководитель</span></p>}
          <div className="mt-2 flex items-center gap-2"><AvatarStack users={people.map((p: any) => ({ id: p.id, name: p.name, color: p.color }))} max={6} size={24} /><span className="text-xs text-muted">{people.length} чел.</span></div>
        </div>
        {kids.length > 0 && <ul className="ml-6 mt-3 space-y-3 border-l-2 border-line pl-6">{kids.map(node)}</ul>}
      </li>
    );
  };
  const roots = deps.filter((d: any) => !d.parent_id);
  return (
    <div>
      <Header title="Структура компании" subtitle="Отделы, руководители и подчинённость"
        actions={can('team', 'write') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({})}>Отдел</Button>} />
      <div className="overflow-x-auto pb-4"><ul className="space-y-3">{roots.map(node)}</ul></div>
      <RecordForm entity="departments" open={!!form} onClose={() => setForm(null)} initial={form?.id ? form : null} fields={['name', 'parent_id', 'head_id', 'description']} />
    </div>
  );
}

function Groups() {
  return (
    <div>
      <Header title="Группы" subtitle="Рабочие группы по направлениям и интересам" />
      <EntityList entity="groups" columns={['name', 'description', 'owner_id', 'members', 'kind']} />
    </div>
  );
}

function Absences() {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return toLocalDate(d); });
  const users = useList('users', { limit: 500, is_active: 1 }).data?.items ?? [];
  const from = month, to = (() => { const d = parseDate(month)!; return toLocalDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)); })();
  const abs = useList('absences', { date_from__lte: to, date_to__gte: from, limit: 1000 }).data?.items ?? [];
  const [form, setForm] = useState<any>(null);
  const { user } = useAuth();
  const days = useMemo(() => { const out: string[] = []; for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d); return out; }, [from, to]);
  const shift = (n: number) => { const d = parseDate(month)!; d.setMonth(d.getMonth() + n); setMonth(toLocalDate(d)); };
  const title = parseDate(month)!.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const today = todayIso();
  return (
    <div>
      <Header title="Отсутствия" subtitle="Отпуска, больничные и командировки. Заявка на отпуск автоматически уходит руководителю на согласование."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ user_id: user!.id, type: 'vacation', date_from: today, date_to: addDaysIso(today, 13) })}>Заявка</Button>} />
      <Card padded={false}>
        <div className="flex items-center gap-2 border-b border-line p-3">
          <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label="Предыдущий месяц"><ChevronLeft className="size-4" /></Button>
          <span className="w-40 text-center font-bold capitalize">{title}</span>
          <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label="Следующий месяц"><ChevronRight className="size-4" /></Button>
          <div className="ml-auto hidden flex-wrap gap-3 text-xs md:flex">{Object.entries(ABS).map(([k, [l, c]]) => <span key={k} className="flex items-center gap-1.5"><span className="size-2.5 rounded" style={{ background: c }} />{l}</span>)}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead><tr><th className="sticky left-0 z-10 min-w-48 border-b border-line bg-surface px-3 py-2 text-left font-bold">Сотрудник</th>
              {days.map((d) => { const dt = parseDate(d)!; const we = dt.getDay() === 0 || dt.getDay() === 6; return <th key={d} className={cx('w-7 min-w-7 border-b border-line py-1 text-center font-semibold', we ? 'bg-surface-2 text-faint' : 'text-muted', d === today && 'text-accent')}><div>{dt.getDate()}</div><div className="text-[10px] font-normal">{WEEKDAYS[(dt.getDay() + 6) % 7]}</div></th>; })}
            </tr></thead>
            <tbody>
              {users.map((u: any) => (
                <tr key={u.id}>
                  <td className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-1.5"><span className="flex items-center gap-2"><Avatar name={u.name} color={u.color} size={22} /><span className="truncate font-semibold">{u.name}</span></span></td>
                  {days.map((d) => {
                    const a = abs.find((x: any) => x.user_id === u.id && x.date_from <= d && x.date_to >= d);
                    const dt = parseDate(d)!;
                    const we = dt.getDay() === 0 || dt.getDay() === 6;
                    return (
                      <td key={d} className={cx('h-8 border-b border-line p-0.5', we && 'bg-surface-2')}>
                        {a && <div title={`${ABS[a.type]?.[0]}: ${date(a.date_from)} — ${date(a.date_to)}${a.status === 'requested' ? ' (ждёт согласования)' : ''}`}
                          className={cx('h-full rounded-sm', a.status === 'requested' && 'opacity-50 [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(255,255,255,.5)_3px,rgba(255,255,255,.5)_6px)]', a.status === 'rejected' && 'opacity-20')}
                          style={{ background: ABS[a.type]?.[1] }} />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <RecordForm entity="absences" open={!!form} onClose={() => setForm(null)} initial={form} fields={['user_id', 'type', 'date_from', 'date_to', 'comment']} title="Заявка на отсутствие" />
    </div>
  );
}

function Onboarding() {
  const { data, isLoading } = useList('onboarding', { limit: 100 });
  const inv = useInvalidate();
  const [form, setForm] = useState<any>(null);
  const toggle = async (o: any, i: number) => {
    const steps = (o.steps ?? []).map((s: any, j: number) => (j === i ? { ...s, done: !s.done } : s));
    const all = steps.every((s: any) => s.done);
    await api.patch(`/api/e/onboarding/${o.id}`, { steps, status: all ? 'done' : 'active' });
    inv('onboarding');
  };
  const addStep = async (o: any, text: string) => {
    await api.patch(`/api/e/onboarding/${o.id}`, { steps: [...(o.steps ?? []), { text, done: false }] });
    inv('onboarding');
  };
  return (
    <div>
      <Header title="Онбординг" subtitle="Планы адаптации новых сотрудников"
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setForm({ start_date: todayIso(), due_date: addDaysIso(todayIso(), 30), status: 'active', steps: [{ text: 'Получить доступы к CRM и почте', done: false }, { text: 'Прочитать базу знаний', done: false }, { text: 'Встреча с наставником', done: false }] })}>План адаптации</Button>} />
      {isLoading ? <Loading /> : !data?.items.length ? <EmptyState title="Планов адаптации нет" text="Создайте план для нового сотрудника: шаги, наставник и срок." /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.items.map((o: any) => {
            const steps = o.steps ?? [];
            const done = steps.filter((s: any) => s.done).length;
            return (
              <Card key={o.id} title={o.title} subtitle={`${o._ref?.user_id?.title ?? ''} · наставник ${o._ref?.mentor_id?.title ?? '—'} · до ${date(o.due_date)}`}>
                <div className="mb-3 flex items-center gap-3"><Progress value={steps.length ? (done / steps.length) * 100 : 0} className="flex-1" /><span className="text-xs font-bold tabular">{done}/{steps.length}</span></div>
                <ul className="space-y-1.5">{steps.map((s: any, i: number) => <li key={i}><Checkbox checked={!!s.done} onChange={() => toggle(o, i)} label={<span className={cx(s.done && 'text-muted line-through')}>{s.text}</span>} /></li>)}</ul>
                <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const inp = (e.currentTarget.elements.namedItem('step') as HTMLInputElement); if (inp.value.trim()) { addStep(o, inp.value.trim()); inp.value = ''; } }}>
                  <Input name="step" placeholder="Новый шаг" /><Button type="submit" icon={<Check className="size-4" />}>Добавить</Button>
                </form>
              </Card>
            );
          })}
        </div>
      )}
      <RecordForm entity="onboarding" open={!!form} onClose={() => setForm(null)} initial={form} fields={['title', 'user_id', 'mentor_id', 'start_date', 'due_date']} />
    </div>
  );
}


function Invitations() {
  const { can } = useAuth();
  const toast = useToast();
  const inv = useInvalidate();
  const [invite, setInvite] = useState(false);
  return (
    <div>
      <Header title="Приглашения" subtitle="Кого позвали в систему и кто уже пришёл" actions={can('team', 'admin') && <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setInvite(true)}>Пригласить</Button>} />
      <EntityList entity="invitations" onCreate={() => setInvite(true)} createLabel="Пригласить"
        columns={['email', 'name', 'role_id', 'status', 'invited_by', { key: 'created_at', label: 'Отправлено', render: (r: any) => date(r.created_at) },
          { key: 'act', label: '', sortable: false, render: (r: any) => r.status === 'pending' && can('team', 'admin') ? <Button size="xs" variant="ghost" onClick={async (e) => { e.stopPropagation(); await api.patch('/api/e/invitations/' + r.id, { status: 'revoked' }); inv('invitations'); toast.success('Приглашение отозвано'); }}>Отозвать</Button> : null }]} />
      <InviteDialog open={invite} onClose={() => setInvite(false)} />
    </div>
  );
}
