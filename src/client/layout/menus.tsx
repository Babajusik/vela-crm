// Second-level navigation: what opens when a module is picked in the rail
import type { ReactNode } from 'react';
import { Archive, BarChart3, BookOpen, Briefcase, Building2, Calendar, CalendarClock, CheckSquare, Clock, Coins, Contact, FileCheck2, FileText, FileUp, Folder,
  FolderKanban, GanttChart, GitBranch, Inbox, Kanban, Landmark, LayoutList, Layers, ListChecks, ListTodo, Mail, MessageCircle, Network, Package, PiggyBank,
  Plane, Receipt, Repeat, Scale, Send, Settings, Shapes, Sparkles, StickyNote, Tags, Target, UserPlus, Users, Wallet, Workflow, Zap, Wrench, HandCoins, Boxes, PlugZap, PhoneCall, MessagesSquare } from 'lucide-react';

export interface MenuLink { to: string; label: string; icon?: ReactNode; create?: string; count?: string }
export interface MenuSection { title?: string; links: MenuLink[] }
export interface ModuleMenu {
  key: string;
  title: string;
  module: string;
  create?: string;
  sections: MenuSection[];
  /** dynamic block rendered between links and footer */
  dynamic?: 'tasks_today' | 'my_projects' | 'team' | 'kb_bases';
  footer: MenuLink[];
}

const i = (n: ReactNode) => n;

export const MENUS: ModuleMenu[] = [
  {
    key: 'tasks', title: 'Задачи', module: 'tasks', create: 'tasks',
    sections: [
      { links: [{ to: '/tasks?filter=accept', label: 'Принять работу', icon: i(<FileCheck2 />), count: 'accept' }] },
      { links: [
        { to: '/tasks?view=plan', label: 'Планирование', icon: i(<LayoutList />) }, { to: '/tasks?view=kanban', label: 'Канбан', icon: i(<Kanban />) },
        { to: '/tasks?view=list', label: 'Список', icon: i(<ListTodo />) }, { to: '/tasks?view=gantt', label: 'Гант', icon: i(<GanttChart />) },
        { to: '/tasks?view=calendar', label: 'Календарь', icon: i(<Calendar />) },
      ] },
    ],
    dynamic: 'tasks_today',
    footer: [{ to: '/tasks/templates', label: 'Шаблоны задач', icon: i(<Layers />) }, { to: '/tasks/archive', label: 'Архив', icon: i(<Archive />) }, { to: '/settings/fields', label: 'Настройки', icon: i(<Settings />) }],
  },
  {
    key: 'crm', title: 'CRM', module: 'crm',
    sections: [{ links: [
      { to: '/crm/deals', label: 'Воронка продаж', icon: i(<Target />) }, { to: '/crm/activities', label: 'Дела', icon: i(<CalendarClock />), count: 'activities' },
      { to: '/crm/companies', label: 'Компании', icon: i(<Building2 />), create: 'companies' }, { to: '/crm/contacts', label: 'Контакты', icon: i(<Contact />), create: 'contacts' },
      { to: '/crm/counterparties', label: 'Все контрагенты', icon: i(<Users />) },
    ] }, { title: 'Продажи', links: [
      { to: '/crm/invoices', label: 'Счета на оплату', icon: i(<Receipt />), create: 'invoices' }, { to: '/finance/offers', label: 'Предложения', icon: i(<Send />), create: 'offers' },
      { to: '/crm/acts', label: 'Акты', icon: i(<FileCheck2 />) }, { to: '/crm/forms', label: 'Веб-формы', icon: i(<Inbox />) },
    ] }, { title: 'Общение с клиентами', links: [
      { to: '/communications', label: 'Диалоги', icon: i(<MessagesSquare />) }, { to: '/communications/calls', label: 'Звонки', icon: i(<PhoneCall />) },
      { to: '/mail', label: 'Почта', icon: i(<Mail />) },
    ] }],
    footer: [{ to: '/crm/report', label: 'Отчёт', icon: i(<BarChart3 />) }, { to: '/settings/automations', label: 'Автодействия', icon: i(<Zap />) }, { to: '/settings/pipelines', label: 'Настройки', icon: i(<Settings />) }],
  },
  {
    key: 'projects', title: 'Проекты', module: 'projects', create: 'projects',
    sections: [{ links: [
      { to: '/projects', label: 'Все проекты', icon: i(<FolderKanban />) }, { to: '/projects?group=template', label: 'Проекты по шаблонам', icon: i(<Layers />) },
      { to: '/projects?group=manager', label: 'Проекты по менеджерам', icon: i(<Users />) }, { to: '/projects/portfolios', label: 'Портфели', icon: i(<Briefcase />) },
    ] }],
    dynamic: 'my_projects',
    footer: [{ to: '/projects/templates', label: 'Шаблоны проектов', icon: i(<Shapes />) }, { to: '/projects?tab=archive', label: 'Архив', icon: i(<Archive />) }, { to: '/settings/fields', label: 'Настройки', icon: i(<Settings />) }],
  },
  {
    key: 'finance', title: 'Финансы', module: 'finance',
    sections: [
      { links: [
        { to: '/finance/reports?tab=cashflow', label: 'Движение средств', icon: i(<Repeat />) }, { to: '/finance/reports?tab=pnl', label: 'Прибыли и убытки', icon: i(<BarChart3 />) },
        { to: '/finance/balance', label: 'Баланс', icon: i(<Scale />) },
      ] },
      { title: 'Операции', links: [{ to: '/finance/money', label: 'Деньги', icon: i(<Wallet />) }, { to: '/finance/import', label: 'Загрузка выписки', icon: i(<FileUp />) }] },
      { title: 'Счета и акты', links: [
        { to: '/crm/invoices', label: 'Счета на оплату', icon: i(<Receipt />), create: 'invoices' }, { to: '/crm/acts', label: 'Акты', icon: i(<FileCheck2 />), create: 'acts' },
        { to: '/finance/recurring', label: 'Регулярные счета', icon: i(<Repeat />), create: 'recurring_invoices' }, { to: '/finance/offers', label: 'Предложения', icon: i(<Send />), create: 'offers' },
      ] },
      { title: 'Планирование', links: [{ to: '/finance/calendar', label: 'Платёжный календарь', icon: i(<CalendarClock />) }, { to: '/finance/budgets', label: 'Бюджеты', icon: i(<PiggyBank />) }] },
      { title: 'Учёт', links: [
        { to: '/finance/payroll', label: 'Зарплата', icon: i(<Coins />) }, { to: '/finance/advances', label: 'Подотчёт', icon: i(<HandCoins />) },
        { to: '/finance/loans', label: 'Кредиты и займы', icon: i(<Landmark />) }, { to: '/finance/obligations', label: 'Обязательства', icon: i(<Scale />) },
        { to: '/finance/assets', label: 'Имущество', icon: i(<Boxes />) },
      ] },
    ],
    footer: [{ to: '/finance/categories', label: 'Статьи учёта', icon: i(<Tags />) }, { to: '/finance/directions', label: 'Направления', icon: i(<Network />) },
      { to: '/finance/accounts', label: 'Счета и организации', icon: i(<Landmark />) }],
  },
  {
    key: 'team', title: 'Команда', module: 'team',
    sections: [{ links: [{ to: '/team', label: 'Пользователи', icon: i(<Users />) }, { to: '/team/structure', label: 'Структура компании', icon: i(<Network />) }] }],
    dynamic: 'team',
    footer: [{ to: '/team/groups', label: 'Группы пользователей', icon: i(<Users />) }, { to: '/team/invitations', label: 'Приглашения', icon: i(<UserPlus />) },
      { to: '/team/absences', label: 'Отсутствия', icon: i(<Plane />) }, { to: '/team/onboarding', label: 'Онбординг', icon: i(<Sparkles />) }],
  },
  {
    key: 'kb', title: 'База знаний', module: 'kb', create: 'kb_bases',
    sections: [],
    dynamic: 'kb_bases',
    footer: [{ to: '/kb?manage=1', label: 'Настройки', icon: i(<Settings />) }],
  },
];

export interface ExtraModule { key: string; label: string; to: string; icon: ReactNode; color: string; module: string }

/** Tiles in «Ещё» */
export const EXTRA: ExtraModule[] = [
  { key: 'files', label: 'Файлы', to: '/files', icon: <Folder />, color: '#0EA5E9', module: 'files' },
  { key: 'catalog', label: 'Каталог', to: '/catalog', icon: <Package />, color: '#F59E0B', module: 'catalog' },
  { key: 'lists', label: 'Списки', to: '/lists', icon: <ListChecks />, color: '#8B5CF6', module: 'lists' },
  { key: 'time', label: 'Тайм-трекер', to: '/time', icon: <Clock />, color: '#10B981', module: 'time' },
  { key: 'mail', label: 'Почта', to: '/mail', icon: <Mail />, color: '#F97362', module: 'mail' },
  { key: 'communications', label: 'Коммуникации', to: '/communications', icon: <Inbox />, color: '#EC4899', module: 'communications' },
  { key: 'messenger', label: 'Мессенджер', to: '/messenger', icon: <MessageCircle />, color: '#14B8A6', module: 'messenger' },
  { key: 'calendar', label: 'Календарь', to: '/calendar', icon: <Calendar />, color: '#6366F1', module: 'calendar' },
  { key: 'structure', label: 'Структура компании', to: '/team/structure', icon: <Network />, color: '#0FA596', module: 'team' },
  { key: 'bp', label: 'Бизнес-процессы', to: '/bp', icon: <Workflow />, color: '#A855F7', module: 'bp' },
  { key: 'documents', label: 'Документы', to: '/documents', icon: <FileText />, color: '#64748B', module: 'documents' },
  { key: 'notes', label: 'Заметки', to: '/notes', icon: <StickyNote />, color: '#EAB308', module: 'notes' },
  { key: 'portal', label: 'Кабинет клиента', to: '/portal', icon: <Briefcase />, color: '#0EA5E9', module: 'portal' },
  { key: 'bank', label: 'Загрузка выписки', to: '/finance/import', icon: <FileUp />, color: '#22C55E', module: 'finance' },
  { key: 'onec', label: 'Интеграция с 1С', to: '/settings/onec', icon: <PlugZap />, color: '#EF4444', module: 'settings' },
  { key: 'telephony', label: 'Телефония', to: '/settings/telephony', icon: <PhoneCall />, color: '#0EA5E9', module: 'settings' },
  { key: 'gp', label: 'Бизнес-автоматизация', to: '/settings/automations', icon: <Wrench />, color: '#F59E0B', module: 'settings' },
];

export const RAIL = [
  { key: 'start', label: 'Старт', to: '/', module: 'dashboard', icon: 'start' },
  { key: 'tasks', label: 'Задачи', module: 'tasks', icon: 'tasks' },
  { key: 'crm', label: 'CRM', module: 'crm', icon: 'crm' },
  { key: 'projects', label: 'Проекты', module: 'projects', icon: 'projects' },
  { key: 'finance', label: 'Финансы', module: 'finance', icon: 'finance' },
  { key: 'team', label: 'Команда', module: 'team', icon: 'team' },
  { key: 'kb', label: 'База знаний', module: 'kb', icon: 'kb' },
  { key: 'more', label: 'Ещё', module: 'dashboard', icon: 'more' },
] as const;

export { CheckSquare, BookOpen, GitBranch };
