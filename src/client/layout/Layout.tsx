import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BookOpen, ChevronRight, CircleHelp, FolderKanban, Grid3X3, Home, KeyRound, ListTodo, LogOut, Mail, MessageCircle, Moon, Plus, RotateCcw,
  Search, Settings, Square, Sun, Target, UserCircle2, Users, Wallet, X } from 'lucide-react';
import { api, IS_DEMO } from '../api.ts';
import { deadlineInfo, minutes, relative } from '../lib/format.ts';
import { useApi, useAuth, useInvalidate, useList } from '../lib/state.tsx';
import { Avatar, Button, FormRow, IconButton, Input, Kbd, MenuItem, Modal, Popover, cx, useToast } from '../ui/ui.tsx';
import { RecordForm } from '../ui/fields.tsx';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { Logo } from './Logo.tsx';
import { EXTRA, MENUS, RAIL, type ModuleMenu } from './menus.tsx';

const RAIL_ICONS: Record<string, ReactNode> = {
  start: <Home />, tasks: <ListTodo />, crm: <Target />, projects: <FolderKanban />, finance: <Wallet />, team: <Users />, kb: <BookOpen />, more: <Grid3X3 />,
};
const MODULE_PATHS: Record<string, string[]> = {
  start: ['/'], tasks: ['/tasks'], crm: ['/crm'], projects: ['/projects'], finance: ['/finance'], team: ['/team'], kb: ['/kb'],
  more: ['/files', '/catalog', '/lists', '/time', '/mail', '/communications', '/messenger', '/calendar', '/bp', '/documents', '/notes', '/portal', '/settings'],
};

export function useModules() {
  const { settings, can } = useAuth();
  const disabled: string[] = settings?.modules?.disabled ?? [];
  return { enabled: (m: string) => !disabled.includes(m) && can(m), disabled };
}

function isMobileWidth() { return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches; }
export function useIsMobile() {
  const [m, setM] = useState(isMobileWidth);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return m;
}

// ---------------- flyout content ----------------
function MenuCounts() {
  const { user } = useAuth();
  const accept = useList('tasks', { author_id: user!.id, status: 'review', limit: 1, expand: 0 }).data?.total ?? 0;
  const activities = useList('crm_activities', { responsible_id: user!.id, is_done: 0, limit: 1, expand: 0 }).data?.total ?? 0;
  return { accept, activities } as Record<string, number>;
}

function TodayTasks({ close }: { close: () => void }) {
  const { user } = useAuth();
  const today = new Date();
  const end = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}T23:59`;
  const { data } = useList('tasks', { assignee_id: user!.id, status__ne: 'done', deadline__lte: end, limit: 6, sort: 'deadline', dir: 'asc', is_archived__ne: 1 });
  const items = data?.items ?? [];
  return (
    <div className="border-t border-line px-3 pb-2 pt-3">
      <p className="mb-1.5 px-2 text-xs font-semibold text-faint">Сегодня</p>
      {items.map((t: any) => {
        const dl = deadlineInfo(t.deadline);
        return (
          <Link key={t.id} to={`/tasks/${t.id}`} onClick={close} className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-surface-2">
            <Avatar name={t._ref?.author_id?.title} color={t._ref?.author_id?.color} size={22} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{t.title}</span>
              <span className="flex justify-between gap-2 text-[11px]"><span className="truncate text-faint">{relative(t.created_at)}</span>
                <span className={cx('shrink-0', dl.tone === 'danger' ? 'text-danger' : 'text-muted')}>{dl.text.replace('Просрочено: ', '')}</span></span>
            </span>
          </Link>
        );
      })}
      {!items.length && <p className="px-2 py-2 text-xs text-faint">На сегодня задач нет</p>}
    </div>
  );
}

function MyProjects({ close }: { close: () => void }) {
  const { user } = useAuth();
  const { data } = useList('projects', { manager_id: user!.id, status__in: 'planning,active,paused', limit: 8, is_archived__ne: 1 });
  const ids = (data?.items ?? []).map((p: any) => p.id).join(',');
  const stages = useApi<Record<string, any>>(['stats', 'stages', ids], '/api/projects/stages', { ids }, { enabled: !!ids }).data ?? {};
  return (
    <div className="border-t border-line px-3 pb-2 pt-3">
      <p className="mb-1.5 px-2 text-xs font-semibold text-faint">Проекты, где я руководитель</p>
      {(data?.items ?? []).map((p: any) => (
        <Link key={p.id} to={`/projects/${p.id}`} onClick={close} className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-surface-2">
          <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{p.name}</span>
            <span className="flex justify-between gap-2 text-[11px] text-faint"><span>{p.end_date ? new Date(p.end_date + 'T12:00').toLocaleDateString('ru-RU') : ''}</span><span className="truncate">{stages[p.id]?.current ?? ''}</span></span>
          </span>
        </Link>
      ))}
      {!data?.items.length && <p className="px-2 py-2 text-xs text-faint">Нет активных проектов</p>}
    </div>
  );
}

function TeamList({ close }: { close: () => void }) {
  const { data } = useList('users', { is_active: 1, limit: 12, sort: 'name', dir: 'asc' });
  const nav = useNavigate();
  return (
    <div className="border-t border-line px-3 pb-2 pt-3">
      {(data?.items ?? []).map((u: any) => (
        <Link key={u.id} to={`/team/${u.id}`} onClick={close} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
          <Avatar name={u.name} color={u.color} size={30} />
          <span className="min-w-0"><span className="block truncate text-[13px] font-semibold">{u.name}</span><span className="block truncate text-[11px] text-faint">{u.position}</span></span>
        </Link>
      ))}
      <Button size="sm" full className="mt-2" icon={<Plus className="size-4" />} onClick={() => { nav('/team?invite=1'); close(); }}>Пригласить</Button>
    </div>
  );
}

function KbBases({ close }: { close: () => void }) {
  const { data } = useList('kb_bases', { limit: 50, sort: 'sort', dir: 'asc' });
  const nav = useNavigate();
  return (
    <div className="px-3 pb-2 pt-1">
      <p className="mb-1.5 px-2 text-xs font-semibold text-faint">Базы знаний</p>
      {(data?.items ?? []).map((b: any) => (
        <Link key={b.id} to={`/kb?base=${b.id}`} onClick={close} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] font-semibold hover:bg-surface-2">
          <span>{b.icon || '📘'}</span><span className="truncate">{b.name}</span>
        </Link>
      ))}
      <Button size="sm" full className="mt-2" onClick={() => { nav('/kb'); close(); }}>Все базы знаний</Button>
    </div>
  );
}

function MenuPanel({ menu, close, onCreate }: { menu: ModuleMenu; close: () => void; onCreate: (entity: string) => void }) {
  const counts = MenuCounts();
  const loc = useLocation();
  const { can } = useAuth();
  const here = loc.pathname + loc.search;
  const link = (l: { to: string; label: string; icon?: ReactNode; create?: string; count?: string }) => {
    const active = here === l.to || (loc.pathname === l.to.split('?')[0] && !l.to.includes('?') && !loc.search);
    return (
      <div key={l.to + l.label} className="group flex items-center">
        <Link to={l.to} onClick={close}
          className={cx('flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium [&>svg]:size-[17px] [&>svg]:shrink-0 [&>svg]:text-faint',
            active ? 'bg-primary-soft text-primary [&>svg]:text-primary' : 'hover:bg-surface-2')}>
          {l.icon}<span className="flex-1 truncate">{l.label}</span>
          {l.count && counts[l.count] > 0 && <span className="text-xs font-semibold text-faint tabular">{counts[l.count]}</span>}
        </Link>
        {l.create && can(menu.module, 'write') && (
          <button type="button" aria-label={`Создать: ${l.label}`} onClick={() => { onCreate(l.create!); close(); }} className="ml-1 rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-primary"><Plus className="size-4" /></button>
        )}
      </div>
    );
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <h2 className="text-lg font-extrabold tracking-tight">{menu.title}</h2>
        {menu.create && can(menu.module, 'write') && <IconButton label="Создать" onClick={() => { onCreate(menu.create!); close(); }}><Plus className="size-5" /></IconButton>}
      </div>
      <div className="flex-1 overflow-y-auto">
        {menu.sections.map((s, k) => (
          <div key={k} className={cx('px-3 py-1.5', k > 0 && 'border-t border-line pt-2.5')}>
            {s.title && <p className="mb-1 px-2.5 text-xs font-semibold text-faint">{s.title}</p>}
            {s.links.map(link)}
          </div>
        ))}
        {menu.dynamic === 'tasks_today' && <TodayTasks close={close} />}
        {menu.dynamic === 'my_projects' && <MyProjects close={close} />}
        {menu.dynamic === 'team' && <TeamList close={close} />}
        {menu.dynamic === 'kb_bases' && <KbBases close={close} />}
      </div>
      <div className="border-t border-line px-3 py-2">
        {menu.footer.map((l) => (
          <Link key={l.to + l.label} to={l.to} onClick={close} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-fg [&>svg]:size-4">
            {l.icon}<span className="flex-1">{l.label}</span><ChevronRight className="size-4 text-faint" />
          </Link>
        ))}
      </div>
    </div>
  );
}

function MorePanel({ close }: { close: () => void }) {
  const { enabled } = useModules();
  const nav = useNavigate();
  const mobile = useIsMobile();
  const tiles = EXTRA.filter((m) => enabled(m.module));
  const coreOnMobile = mobile ? MENUS.filter((m) => ['finance', 'team', 'kb'].includes(m.key) && enabled(m.module)) : [];
  return (
    <div className="flex h-full flex-col">
      <h2 className="px-5 pb-3 pt-4 text-lg font-extrabold tracking-tight">Ещё</h2>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {coreOnMobile.length > 0 && (
          <div className="mb-3 grid grid-cols-3 gap-2">
            {coreOnMobile.map((m) => (
              <button key={m.key} type="button" onClick={() => { close(); window.dispatchEvent(new CustomEvent('vela:open-menu', { detail: m.key })); }}
                className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface p-3 text-center text-xs font-semibold hover:border-primary">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary [&>svg]:size-5">{RAIL_ICONS[m.key]}</span>{m.title}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 md:grid-cols-2">
          {tiles.map((m) => (
            <Link key={m.key} to={m.to} onClick={close} className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface px-2 py-3.5 text-center text-xs font-semibold leading-tight transition hover:border-primary hover:shadow-sm">
              <span className="flex size-10 items-center justify-center rounded-xl text-white shadow-sm [&>svg]:size-5" style={{ background: `linear-gradient(135deg, ${m.color}, ${m.color}cc)` }}>{m.icon}</span>
              {m.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="border-t border-line p-3"><Button full onClick={() => { nav('/settings/modules'); close(); }}>Список модулей</Button></div>
    </div>
  );
}

// ---------------- rail ----------------
function Rail({ open, setOpen }: { open: string | null; setOpen: (k: string | null) => void }) {
  const loc = useLocation();
  const nav = useNavigate();
  const { enabled } = useModules();
  const { can } = useAuth();
  const active = (key: string) => MODULE_PATHS[key]?.some((p) => (p === '/' ? loc.pathname === '/' : loc.pathname.startsWith(p)));
  return (
    <aside className="fixed bottom-0 left-0 top-14 z-30 hidden w-[72px] flex-col items-center border-r border-line bg-surface py-2 md:flex">
      <nav className="flex w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto">
        {RAIL.filter((r) => r.key === 'start' || r.key === 'more' || enabled(r.module)).map((r) => {
          const on = open === r.key || (!open && active(r.key));
          return (
            <button key={r.key} type="button" onClick={() => { if (r.key === 'start') { setOpen(null); nav('/'); } else setOpen(open === r.key ? null : r.key); }}
              className={cx('group flex w-[64px] flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[10.5px] font-semibold leading-tight transition-colors', on ? 'text-primary' : 'text-muted hover:text-fg')}>
              <span className={cx('flex size-9 items-center justify-center rounded-xl transition-colors [&>svg]:size-[19px]', on ? 'bg-primary text-primary-fg shadow-sm' : 'bg-surface-2 group-hover:bg-line')}>{RAIL_ICONS[r.icon]}</span>
              <span className="w-full truncate text-center">{r.label}</span>
            </button>
          );
        })}
      </nav>
      {can('settings') && (
        <Link to="/settings" onClick={() => setOpen(null)} title="Настройки" className={cx('flex size-9 items-center justify-center rounded-xl', loc.pathname.startsWith('/settings') ? 'bg-primary text-primary-fg' : 'text-muted hover:bg-surface-2')}>
          <Settings className="size-[19px]" />
        </Link>
      )}
    </aside>
  );
}

function Flyout({ open, setOpen, onCreate }: { open: string | null; setOpen: (k: string | null) => void; onCreate: (e: string) => void }) {
  const mobile = useIsMobile();
  const loc = useLocation();
  useEffect(() => { setOpen(null); }, [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, setOpen]);
  if (!open) return null;
  const menu = MENUS.find((m) => m.key === open);
  const close = () => setOpen(null);
  const body = open === 'more' ? <MorePanel close={close} /> : menu ? <MenuPanel menu={menu} close={close} onCreate={onCreate} /> : null;
  if (mobile) {
    return (
      <div className="fixed inset-0 z-40 md:hidden" onClick={close}>
        <div className="absolute inset-0 bg-ink-950/40 anim-fade" />
        <div className="absolute inset-x-0 bottom-0 top-10 overflow-hidden rounded-t-3xl bg-surface shadow-2xl anim-in" onClick={(e) => e.stopPropagation()}>
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" />
          <IconButton label="Закрыть" className="absolute right-3 top-3" onClick={close}><X className="size-5" /></IconButton>
          {body}
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="fixed inset-0 top-14 z-20 hidden bg-ink-950/10 md:block anim-fade" onClick={close} />
      <div className="fixed bottom-0 left-[72px] top-14 z-30 hidden w-[288px] border-r border-line bg-surface shadow-[8px_0_32px_-12px_rgba(15,27,45,.25)] md:block anim-slide-l">{body}</div>
    </>
  );
}

function BottomBar({ open, setOpen }: { open: string | null; setOpen: (k: string | null) => void }) {
  const loc = useLocation();
  const nav = useNavigate();
  const { enabled } = useModules();
  const items = [RAIL[0], ...RAIL.filter((r) => ['tasks', 'crm', 'projects'].includes(r.key) && enabled(r.module)), RAIL[RAIL.length - 1]];
  const active = (key: string) => MODULE_PATHS[key]?.some((p) => (p === '/' ? loc.pathname === '/' : loc.pathname.startsWith(p)));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {items.map((r) => {
        const on = open === r.key || (!open && active(r.key));
        return (
          <button key={r.key} type="button" onClick={() => { if (r.key === 'start') { setOpen(null); nav('/'); } else setOpen(open === r.key ? null : r.key); }}
            className={cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold', on ? 'text-primary' : 'text-muted')}>
            <span className={cx('flex h-7 w-12 items-center justify-center rounded-full [&>svg]:size-5', on && 'bg-primary-soft')}>{RAIL_ICONS[r.icon]}</span>{r.label}
          </button>
        );
      })}
    </nav>
  );
}

// ---------------- search, notifications, timer ----------------
function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const nav = useNavigate();
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (!open) setQ(''); }, [open]);
  const { data, isFetching } = useApi<any[]>(['search'], '/api/search', { q: debounced }, { enabled: open && debounced.length >= 2 });
  const go = (link: string) => { nav(link); onClose(); };
  const quick = [['Сделки', '/crm/deals'], ['Задачи', '/tasks'], ['Компании', '/crm/companies'], ['Счета', '/crm/invoices'], ['Деньги', '/finance/money'], ['Интеграция с 1С', '/settings/onec']];
  return (
    <Modal open={open} onClose={onClose} title="Поиск по CRM" size="md">
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Компания, ИНН, сделка, задача, счёт, телефон…" icon={<Search className="size-4" />} />
      <div className="mt-3 min-h-40">
        {debounced.length < 2 ? (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-faint">Быстрый переход</p>
            <div className="flex flex-wrap gap-2">{quick.map(([l, to]) => <Button key={to} size="sm" onClick={() => go(to)}>{l}</Button>)}</div>
          </div>
        ) : (data ?? []).length ? (
          <ul className="space-y-0.5">
            {data!.map((r) => (
              <li key={r.entity + r.id}>
                <button type="button" onClick={() => go(r.link)} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2">
                  <span className="w-24 shrink-0 text-xs font-semibold text-faint">{r.label}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{r.title}</span>
                  {r.sub && <span className="truncate text-xs text-muted">{r.sub}</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="py-8 text-center text-sm text-muted">{isFetching ? 'Ищем…' : 'Ничего не нашлось'}</p>}
      </div>
    </Modal>
  );
}

function Notifications() {
  const nav = useNavigate();
  const inv = useInvalidate();
  const { data } = useApi<{ items: any[]; unread: number }>(['notifications'], '/api/notifications', undefined, { refetchInterval: 30_000 });
  const readAll = async () => { await api.post('/api/notifications/read-all'); inv('notifications'); };
  return (
    <Popover align="right" className="w-[min(380px,calc(100vw-1.5rem))] p-0" trigger={({ toggle }) => (
      <IconButton label="Уведомления" onClick={toggle} className="relative">
        <Bell className="size-5" />
        {!!data?.unread && <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-fg">{data.unread > 9 ? '9+' : data.unread}</span>}
      </IconButton>
    )}>
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="font-bold">Уведомления</span>
            {!!data?.unread && <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={readAll}>Прочитать все</button>}
          </div>
          <div className="max-h-96 overflow-y-auto p-1.5">
            {(data?.items ?? []).map((n) => (
              <button key={n.id} type="button" onClick={async () => { await api.post(`/api/notifications/${n.id}/read`); inv('notifications'); if (n.link) nav(n.link); close(); }}
                className="flex w-full gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2">
                <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.is_read ? 'bg-transparent' : 'bg-accent')} />
                <span className="min-w-0"><span className={cx('block text-sm', !n.is_read && 'font-semibold')}>{n.text}</span><span className="text-xs text-faint">{relative(n.created_at)}</span></span>
              </button>
            ))}
            {!data?.items?.length && <p className="px-3 py-8 text-center text-sm text-muted">Новых уведомлений нет</p>}
          </div>
        </div>
      )}
    </Popover>
  );
}

function TimerPill() {
  const inv = useInvalidate();
  const { data } = useApi<any>(['time', 'running'], '/api/time/running', undefined, { refetchInterval: 30_000 });
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 15_000); return () => clearInterval(t); }, []);
  if (!data) return null;
  const mins = Math.max(0, Math.round((Date.now() - new Date(data.started_at).getTime()) / 60000)) + Number(data.minutes ?? 0);
  return (
    <button type="button" onClick={async () => { await api.post('/api/time/stop'); inv('time_entries', 'tasks'); }} title="Остановить таймер"
      className="hidden items-center gap-2 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-bold text-accent hover:brightness-95 lg:inline-flex">
      <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-accent" /></span>
      <span className="max-w-40 truncate">{data.task_title || data.comment || 'Таймер'}</span><span className="tabular">{minutes(mins)}</span><Square className="size-3 fill-current" />
    </button>
  );
}

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('vela-theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
  };
  return { dark, toggle };
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [old, setOld] = useState('');
  const [pw, setPw] = useState('');
  const toast = useToast();
  const submit = async () => {
    try { await api.post('/api/auth/password', { old, password: pw }); toast.success('Пароль изменён'); onClose(); setOld(''); setPw(''); }
    catch (e) { toast.error(e); }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Смена пароля" footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit}>Сохранить</Button></>}>
      <div className="space-y-3">
        <FormRow label="Текущий пароль"><Input type="password" value={old} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" /></FormRow>
        <FormRow label="Новый пароль" hint="Не короче 6 символов"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></FormRow>
      </div>
    </Modal>
  );
}

const CREATE_TARGET: Record<string, string> = { deals: '/crm/deals/', tasks: '/tasks/', companies: '/crm/companies/', contacts: '/crm/contacts/', projects: '/projects/', invoices: '/crm/invoices/', offers: '/finance/offers/' };

function TopBar({ onCreate, openMenu }: { onCreate: (e: string) => void; openMenu: (k: string) => void }) {
  const { user, logout, can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { dark, toggle } = useTheme();
  const [search, setSearch] = useState(false);
  const [pw, setPw] = useState(false);
  const unreadMail = useList('mails', { folder: 'inbox', is_read: 0, limit: 1, expand: 0 }, { enabled: can('mail') }).data?.total ?? 0;
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const creators = [
    { entity: 'tasks', label: 'Задачу', module: 'tasks' }, { entity: 'deals', label: 'Сделку', module: 'crm' }, { entity: 'companies', label: 'Компанию', module: 'crm' },
    { entity: 'contacts', label: 'Контакт', module: 'crm' }, { entity: 'crm_activities', label: 'Дело', module: 'crm' }, { entity: 'projects', label: 'Проект', module: 'projects' },
    { entity: 'invoices', label: 'Счёт', module: 'crm' }, { entity: 'events', label: 'Событие', module: 'calendar' }, { entity: 'fin_operations', label: 'Операцию', module: 'finance' },
  ].filter((c) => can(c.module, 'write'));
  const today = new Date();
  const reset = async () => {
    if (!(await toast.confirm({ title: 'Сбросить демо?', text: 'Все ваши изменения удалятся, данные вернутся к исходным.', ok: 'Сбросить', danger: true }))) return;
    const { resetDemo } = await import('../engine.ts');
    resetDemo();
  };
  void openMenu;
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-1 border-b border-line bg-surface px-3 md:px-4">
      <Link to="/" className="mr-2 flex items-center gap-2 md:w-[150px]">
        <Logo size={28} /><span className="text-lg font-extrabold tracking-tight">Vela<span className="text-primary">.</span></span>
      </Link>
      {creators.length > 0 && (
        <Popover trigger={({ toggle: t }) => <IconButton label="Создать" onClick={t}><Plus className="size-5" /></IconButton>}>
          {(close) => <div className="w-52">{creators.map((c) => <MenuItem key={c.entity} onClick={() => { onCreate(c.entity); close(); }}>{c.label}</MenuItem>)}</div>}
        </Popover>
      )}
      <IconButton label="Поиск (Ctrl+K)" onClick={() => setSearch(true)}><Search className="size-5" /></IconButton>
      <button type="button" onClick={() => setSearch(true)} className="ml-1 hidden h-9 w-64 items-center gap-2 rounded-lg bg-surface-2 px-3 text-sm text-faint hover:bg-line xl:flex">
        <span className="flex-1 text-left">Найти в CRM…</span><Kbd>Ctrl K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-0.5">
        {IS_DEMO && <button type="button" onClick={reset} className="mr-2 hidden items-center gap-1.5 rounded-lg bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent hover:brightness-95 lg:inline-flex"><RotateCcw className="size-3.5" />Сбросить демо</button>}
        <TimerPill />
        <Link to="/calendar" className="mr-2 hidden items-center gap-2.5 rounded-lg px-2 py-1 hover:bg-surface-2 lg:flex" title="Календарь">
          <span className="text-right leading-none"><span className="block text-[10px] text-faint">{today.toLocaleDateString('ru-RU', { weekday: 'short' })}</span><span className="text-2xl font-light tabular">{today.getDate()}</span></span>
          <span className="h-8 w-0.5 rounded-full bg-primary" />
          <span className="leading-tight"><span className="block text-[13px] font-semibold">Календарь</span><span onClick={(e) => { e.preventDefault(); onCreate('events'); }} className="text-xs text-primary hover:underline">Создать событие</span></span>
        </Link>
        {can('mail') && (
          <IconButton label="Почта" className="relative max-sm:!hidden" onClick={() => nav('/mail')}>
            <Mail className="size-5" />{unreadMail > 0 && <span className="absolute right-1 top-1 size-2 rounded-full bg-accent" />}
          </IconButton>
        )}
        <Notifications />
        {can('messenger') && <IconButton label="Мессенджер" className="max-sm:!hidden" onClick={() => nav('/messenger')}><MessageCircle className="size-5" /></IconButton>}
        <IconButton label="Справка" className="max-sm:!hidden" onClick={() => nav('/kb')}><CircleHelp className="size-5" /></IconButton>
        <IconButton label={dark ? 'Светлая тема' : 'Тёмная тема'} onClick={toggle} className="max-sm:!hidden">{dark ? <Sun className="size-5" /> : <Moon className="size-5" />}</IconButton>
        <Popover align="right" trigger={({ toggle: t }) => (
          <button type="button" onClick={t} className="ml-1 rounded-xl p-0.5 hover:ring-2 hover:ring-primary/30" aria-label="Профиль"><Avatar name={user?.name} color={user?.color} size={34} className="rounded-xl" /></button>
        )}>
          {(close) => (
            <div className="w-64">
              <div className="border-b border-line px-3 py-2.5"><p className="truncate font-bold">{user?.name}</p><p className="truncate text-xs text-muted">{user?.email}</p></div>
              <div className="p-1">
                <MenuItem icon={<UserCircle2 className="size-4" />} onClick={() => { nav(`/team/${user?.id}`); close(); }}>Мой профиль</MenuItem>
                <MenuItem icon={<KeyRound className="size-4" />} onClick={() => { setPw(true); close(); }}>Сменить пароль</MenuItem>
                <MenuItem icon={dark ? <Sun className="size-4" /> : <Moon className="size-4" />} onClick={() => { toggle(); close(); }}>{dark ? 'Светлая тема' : 'Тёмная тема'}</MenuItem>
                {IS_DEMO && <MenuItem icon={<RotateCcw className="size-4" />} onClick={() => { close(); reset(); }}>Сбросить демо</MenuItem>}
                <MenuItem icon={<LogOut className="size-4" />} danger onClick={() => { logout(); close(); }}>{IS_DEMO ? 'Войти другим сотрудником' : 'Выйти'}</MenuItem>
              </div>
            </div>
          )}
        </Popover>
      </div>
      <SearchPalette open={search} onClose={() => setSearch(false)} />
      <PasswordDialog open={pw} onClose={() => setPw(false)} />
    </header>
  );
}

export function Layout() {
  const [open, setOpen] = useState<string | null>(null);
  const [create, setCreate] = useState<string | null>(null);
  const loc = useLocation();
  const nav = useNavigate();
  const { user } = useAuth();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => {
    const h = (e: Event) => setOpen((e as CustomEvent).detail);
    window.addEventListener('vela:open-menu', h);
    return () => window.removeEventListener('vela:open-menu', h);
  }, []);
  const initial = useMemo(() => {
    if (!create) return null;
    if (create === 'tasks') return { assignee_id: user?.id, status: 'new' };
    if (create === 'crm_activities') return { responsible_id: user?.id, kind: 'call' };
    if (create === 'events') { const d = new Date(); d.setMinutes(0); d.setHours(d.getHours() + 1); const p = (n: number) => String(n).padStart(2, '0');
      const s = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`; return { start: s, owner_id: user?.id, attendees: [user?.id], kind: 'meeting' }; }
    return null;
  }, [create, user]);
  return (
    <div className="min-h-full">
      <TopBar onCreate={setCreate} openMenu={setOpen} />
      <Rail open={open} setOpen={setOpen} />
      <Flyout open={open} setOpen={setOpen} onCreate={setCreate} />
      <main className="min-h-screen px-4 pb-24 pt-[4.75rem] sm:px-6 md:ml-[72px] md:pb-8 lg:pt-[5rem]">
        <div className="mx-auto w-full max-w-[1600px]">
          <ErrorBoundary resetKey={loc.pathname}><Outlet /></ErrorBoundary>
        </div>
      </main>
      <BottomBar open={open} setOpen={setOpen} />
      {create && <RecordForm entity={create} open onClose={() => setCreate(null)} initial={initial}
        onSaved={(r) => { if (CREATE_TARGET[create]) nav(CREATE_TARGET[create] + r.id); }} />}
    </div>
  );
}

/** Page sub-navigation rendered inside PageHeader */
export function ModuleTabs({ tabs }: { tabs: { to: string; label: string; end?: boolean; hidden?: boolean; default?: boolean }[] }) {
  const loc = useLocation();
  return (
    <nav className="-mb-px flex gap-5 overflow-x-auto">
      {tabs.filter((t) => !t.hidden).map((t) => {
        const [path, query] = t.to.split('?');
        const key = query?.split('=')[0];
        const matchQuery = query ? loc.search.includes(query) || (!!t.default && !new URLSearchParams(loc.search).has(key!)) : true;
        return (
          <NavLink key={t.to} to={t.to} end={t.end ?? !!query}
            className={({ isActive }) => cx('shrink-0 whitespace-nowrap border-b-2 pb-2.5 text-sm font-semibold transition-colors',
              isActive && matchQuery && (query || !loc.search || path === loc.pathname) ? 'border-primary text-fg' : 'border-transparent text-muted hover:text-fg')}>
            {t.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
