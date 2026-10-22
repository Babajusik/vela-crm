import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BookOpen, Briefcase, CalendarDays, CheckSquare, ChevronsLeft, ChevronsRight, Clock, FileText, Folder, FolderKanban, GitBranch, Inbox,
  LayoutDashboard, ListChecks, LogOut, Mail, Menu, MessageCircle, Moon, Package, Plus, Search, Settings, StickyNote, Sun, Target, UserCircle2, Users,
  Wallet, Square, X, KeyRound, RotateCcw } from 'lucide-react';
import { api, IS_DEMO } from '../api.ts';
import { minutes, relative } from '../lib/format.ts';
import { useApi, useAuth, useInvalidate } from '../lib/state.tsx';
import { Avatar, Button, FormRow, IconButton, Input, Kbd, MenuItem, Modal, Popover, cx, useToast } from '../ui/ui.tsx';
import { RecordForm } from '../ui/fields.tsx';
import { Logo } from './Logo.tsx';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';

interface NavItem { to: string; label: string; icon: ReactNode; module: string; match?: string }
const NAV: NavItem[] = [
  { to: '/', label: 'Рабочий стол', icon: <LayoutDashboard />, module: 'dashboard' },
  { to: '/tasks', label: 'Задачи', icon: <CheckSquare />, module: 'tasks' },
  { to: '/crm/deals', label: 'CRM', icon: <Target />, module: 'crm', match: '/crm' },
  { to: '/projects', label: 'Проекты', icon: <FolderKanban />, module: 'projects' },
  { to: '/finance', label: 'Финансы', icon: <Wallet />, module: 'finance' },
  { to: '/team', label: 'Команда', icon: <Users />, module: 'team' },
  { to: '/calendar', label: 'Календарь', icon: <CalendarDays />, module: 'calendar' },
  { to: '/messenger', label: 'Мессенджер', icon: <MessageCircle />, module: 'messenger' },
  { to: '/communications', label: 'Коммуникации', icon: <Inbox />, module: 'communications' },
  { to: '/mail', label: 'Почта', icon: <Mail />, module: 'mail' },
  { to: '/kb', label: 'База знаний', icon: <BookOpen />, module: 'kb' },
];
const MORE: NavItem[] = [
  { to: '/files', label: 'Файлы', icon: <Folder />, module: 'files' },
  { to: '/catalog', label: 'Каталог', icon: <Package />, module: 'catalog' },
  { to: '/lists', label: 'Списки', icon: <ListChecks />, module: 'lists' },
  { to: '/time', label: 'Тайм-трекер', icon: <Clock />, module: 'time' },
  { to: '/bp', label: 'Бизнес-процессы', icon: <GitBranch />, module: 'bp' },
  { to: '/documents', label: 'Документы', icon: <FileText />, module: 'documents' },
  { to: '/notes', label: 'Заметки', icon: <StickyNote />, module: 'notes' },
  { to: '/portal', label: 'Кабинет клиента', icon: <Briefcase />, module: 'portal' },
];

function SideLink({ item, collapsed, onClick }: { item: NavItem; collapsed: boolean; onClick?: () => void }) {
  const loc = useLocation();
  const active = item.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(item.match ?? item.to);
  return (
    <NavLink to={item.to} onClick={onClick} title={collapsed ? item.label : undefined}
      className={cx('group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] font-semibold transition-colors [&>svg]:size-[18px] [&>svg]:shrink-0',
        active ? 'bg-white/10 text-white' : 'text-side-muted hover:bg-white/5 hover:text-side-fg', collapsed && 'justify-center px-0')}>
      {active && <span className="absolute -left-3 top-1.5 h-6 w-1 rounded-r-full bg-brand-400" />}
      {item.icon}
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
}

function Sidebar({ collapsed, setCollapsed, mobileOpen, closeMobile }: { collapsed: boolean; setCollapsed: (v: boolean) => void; mobileOpen: boolean; closeMobile: () => void }) {
  const { can } = useAuth();
  const nav = NAV.filter((n) => can(n.module));
  const more = MORE.filter((n) => can(n.module));
  const body = (isMobile: boolean) => {
    const c = isMobile ? false : collapsed;
    return (
      <div className="flex h-full flex-col bg-side text-side-fg">
        <div className={cx('flex h-14 shrink-0 items-center gap-2.5 px-4', c && 'justify-center px-0')}>
          <Logo size={28} />
          {!c && <span className="text-lg font-extrabold tracking-tight">Vela<span className="text-brand-400">.</span></span>}
          {isMobile && <IconButton label="Закрыть меню" className="ml-auto text-side-muted hover:bg-white/10" onClick={closeMobile}><X className="size-5" /></IconButton>}
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
          {nav.map((n) => <SideLink key={n.to} item={n} collapsed={c} onClick={isMobile ? closeMobile : undefined} />)}
          {more.length > 0 && <div className={cx('px-2.5 pb-1 pt-4 text-[11px] font-bold uppercase tracking-wider text-side-muted/70', c && 'text-center px-0')}>{c ? '•••' : 'Ещё'}</div>}
          {more.map((n) => <SideLink key={n.to} item={n} collapsed={c} onClick={isMobile ? closeMobile : undefined} />)}
        </nav>
        <div className="space-y-0.5 border-t border-white/5 p-3">
          {can('settings') && <SideLink item={{ to: '/settings', label: 'Настройки', icon: <Settings />, module: 'settings' }} collapsed={c} onClick={isMobile ? closeMobile : undefined} />}
          {!isMobile && (
            <button type="button" onClick={() => setCollapsed(!collapsed)} className={cx('flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-[13px] font-semibold text-side-muted hover:bg-white/5 hover:text-side-fg', c && 'justify-center px-0')}>
              {collapsed ? <ChevronsRight className="size-[18px]" /> : <><ChevronsLeft className="size-[18px]" /><span>Свернуть</span></>}
            </button>
          )}
        </div>
      </div>
    );
  };
  return (
    <>
      <aside className={cx('hidden shrink-0 transition-[width] duration-200 lg:block', collapsed ? 'w-[68px]' : 'w-[232px]')}>
        <div className={cx('fixed inset-y-0 left-0 z-30 transition-[width] duration-200', collapsed ? 'w-[68px]' : 'w-[232px]')}>{body(false)}</div>
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={closeMobile}>
          <div className="absolute inset-0 bg-ink-950/50 anim-fade" />
          <div className="relative h-full w-[260px] anim-slide" onClick={(e) => e.stopPropagation()}>{body(true)}</div>
        </div>
      )}
    </>
  );
}

// ---------------- command palette / search ----------------
function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const nav = useNavigate();
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (!open) setQ(''); }, [open]);
  const { data, isFetching } = useApi<any[]>(['search'], '/api/search', { q: debounced }, { enabled: open && debounced.length >= 2 });
  const go = (link: string) => { nav(link); onClose(); };
  const quick = [
    ['Сделки', '/crm/deals'], ['Задачи', '/tasks'], ['Компании', '/crm/companies'], ['Счета', '/crm/invoices'], ['Финансы', '/finance'], ['Интеграция с 1С', '/settings/onec'],
  ];
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

// ---------------- notifications ----------------
function Notifications() {
  const nav = useNavigate();
  const inv = useInvalidate();
  const { data } = useApi<{ items: any[]; unread: number }>(['notifications'], '/api/notifications', undefined, { refetchInterval: 30_000 });
  const readAll = async () => { await api.post('/api/notifications/read-all'); inv('notifications'); };
  return (
    <Popover align="right" className="w-[min(380px,calc(100vw-1.5rem))] p-0" trigger={({ toggle }) => (
      <IconButton label="Уведомления" onClick={toggle} className="relative">
        <Bell className="size-5" />
        {!!data?.unread && <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{data.unread > 9 ? '9+' : data.unread}</span>}
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
                <span className="min-w-0">
                  <span className={cx('block text-sm', !n.is_read && 'font-semibold')}>{n.text}</span>
                  <span className="text-xs text-faint">{relative(n.created_at)}</span>
                </span>
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
      className="hidden items-center gap-2 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-bold text-accent hover:brightness-95 sm:inline-flex">
      <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-accent" /></span>
      <span className="max-w-40 truncate">{data.task_title || data.comment || 'Таймер'}</span>
      <span className="tabular">{minutes(mins)}</span>
      <Square className="size-3 fill-current" />
    </button>
  );
}

function useTheme() {
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

function Topbar({ openMobile }: { openMobile: () => void }) {
  const { user, logout, can } = useAuth();
  const nav = useNavigate();
  const { dark, toggle } = useTheme();
  const [search, setSearch] = useState(false);
  const [create, setCreate] = useState<{ entity: string; initial?: any } | null>(null);
  const [pw, setPw] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const creators = [
    { entity: 'deals', label: 'Сделку', module: 'crm' }, { entity: 'tasks', label: 'Задачу', module: 'tasks' }, { entity: 'companies', label: 'Компанию', module: 'crm' },
    { entity: 'contacts', label: 'Контакт', module: 'crm' }, { entity: 'events', label: 'Событие', module: 'calendar' }, { entity: 'projects', label: 'Проект', module: 'projects' },
    { entity: 'fin_operations', label: 'Операцию', module: 'finance' },
  ].filter((c) => can(c.module, 'write'));
  const today = new Date();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur sm:px-5">
      <IconButton label="Меню" className="lg:hidden" onClick={openMobile}><Menu className="size-5" /></IconButton>
      <button type="button" onClick={() => setSearch(true)} className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-sm text-faint hover:border-line-strong">
        <Search className="size-4" /><span className="flex-1 truncate text-left">Поиск по CRM…</span><span className="hidden sm:inline"><Kbd>Ctrl K</Kbd></span>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <TimerPill />
        <div className="mr-1 hidden items-center gap-2 border-r border-line pr-3 xl:flex">
          <span className="text-2xl font-light leading-none tabular">{today.getDate()}</span>
          <span className="text-[11px] leading-tight text-muted">{today.toLocaleDateString('ru-RU', { weekday: 'long' })}<br />{today.toLocaleDateString('ru-RU', { month: 'long' })}</span>
        </div>
        {creators.length > 0 && (
          <Popover align="right" trigger={({ toggle: t }) => <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={t} className="mr-1"><span className="hidden sm:inline">Создать</span></Button>}>
            {(close) => creators.map((c) => <MenuItem key={c.entity} onClick={() => { setCreate({ entity: c.entity }); close(); }}>{c.label}</MenuItem>)}
          </Popover>
        )}
        <Notifications />
        <IconButton label={dark ? 'Светлая тема' : 'Тёмная тема'} onClick={toggle}>{dark ? <Sun className="size-5" /> : <Moon className="size-5" />}</IconButton>
        <Popover align="right" trigger={({ toggle: t }) => (
          <button type="button" onClick={t} className="ml-1 flex items-center gap-2 rounded-lg p-1 hover:bg-surface-2" aria-label="Профиль">
            <Avatar name={user?.name} color={user?.color} size={30} />
          </button>
        )}>
          {(close) => (
            <div className="w-60">
              <div className="border-b border-line px-3 py-2.5">
                <p className="truncate font-bold">{user?.name}</p>
                <p className="truncate text-xs text-muted">{user?.email}</p>
              </div>
              <div className="p-1">
                <MenuItem icon={<UserCircle2 className="size-4" />} onClick={() => { nav(`/team/${user?.id}`); close(); }}>Мой профиль</MenuItem>
                <MenuItem icon={<KeyRound className="size-4" />} onClick={() => { setPw(true); close(); }}>Сменить пароль</MenuItem>
                <MenuItem icon={<LogOut className="size-4" />} danger onClick={() => { logout(); close(); }}>Выйти</MenuItem>
              </div>
            </div>
          )}
        </Popover>
      </div>
      <SearchPalette open={search} onClose={() => setSearch(false)} />
      {create && <RecordForm entity={create.entity} open onClose={() => setCreate(null)} initial={create.initial ?? null}
        onSaved={(r) => { const map: Record<string, string> = { deals: '/crm/deals/', tasks: '/tasks/', companies: '/crm/companies/', contacts: '/crm/contacts/', projects: '/projects/' }; if (map[create.entity]) nav(map[create.entity] + r.id); }} />}
      <PasswordDialog open={pw} onClose={() => setPw(false)} />
    </header>
  );
}

function DemoBar() {
  const toast = useToast();
  const { logout } = useAuth();
  if (!IS_DEMO) return null;
  const reset = async () => {
    if (!(await toast.confirm({ title: 'Сбросить демо?', text: 'Все изменения, которые вы сделали, удалятся, и данные вернутся к исходным.', ok: 'Сбросить', danger: true }))) return;
    const { resetDemo } = await import('../engine.ts');
    resetDemo();
  };
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-ink-900 px-4 py-1.5 text-center text-xs text-side-muted">
      <span><b className="text-brand-300">Демо-версия.</b> Всё работает прямо в вашем браузере, данные видите только вы.</span>
      <button type="button" className="font-semibold text-white hover:underline" onClick={() => logout()}>Войти другим сотрудником</button>
      <button type="button" className="inline-flex items-center gap-1 font-semibold text-white hover:underline" onClick={reset}><RotateCcw className="size-3" />Сбросить данные</button>
    </div>
  );
}

export function Layout() {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('vela-sidebar') === '1'; } catch { return false; } });
  const [mobile, setMobile] = useState(false);
  const loc = useLocation();
  useEffect(() => { try { localStorage.setItem('vela-sidebar', collapsed ? '1' : '0'); } catch { /* ignore */ } }, [collapsed]);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-1">
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} mobileOpen={mobile} closeMobile={() => setMobile(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <DemoBar />
          <Topbar openMobile={() => setMobile(true)} />
          <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 sm:px-6 lg:py-6">
            <ErrorBoundary resetKey={loc.pathname}><Outlet /></ErrorBoundary>
          </main>
        </div>
      </div>
    </div>
  );
}

export function ModuleTabs({ tabs }: { tabs: { to: string; label: string; end?: boolean; hidden?: boolean }[] }) {
  return (
    <nav className="-mt-1 mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.filter((t) => !t.hidden).map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end}
          className={({ isActive }) => cx('-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors', isActive ? 'border-primary text-fg' : 'border-transparent text-muted hover:text-fg')}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
