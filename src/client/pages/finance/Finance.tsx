import { Navigate, Route, Routes } from 'react-router-dom';
import { ModuleTabs } from '../../layout/Layout.tsx';
import { useAuth, useMeta } from '../../lib/state.tsx';
import { EmptyState, PageHeader } from '../../ui/ui.tsx';
import { EntityList } from '../../ui/data.tsx';
import { compactMoney, money, todayIso } from '../../lib/format.ts';
import { FinanceOverview, Operations, Accounts } from './Overview.tsx';
import { Reports } from './Reports.tsx';
import { PaymentCalendar } from './PaymentCalendar.tsx';
import { Budgets } from './Budgets.tsx';
import { ImportStatement } from './ImportStatement.tsx';
import { Payroll } from './Payroll.tsx';

const TABS = [
  { to: '/finance', label: 'Обзор', end: true }, { to: '/finance/operations', label: 'Операции' }, { to: '/finance/accounts', label: 'Счета и кассы' },
  { to: '/finance/calendar', label: 'Платёжный календарь' }, { to: '/finance/reports', label: 'Отчёты' }, { to: '/finance/budgets', label: 'Бюджеты' },
  { to: '/finance/payroll', label: 'Зарплата' }, { to: '/finance/advances', label: 'Подотчёт' }, { to: '/finance/loans', label: 'Кредиты и займы' },
  { to: '/finance/obligations', label: 'Обязательства' }, { to: '/finance/assets', label: 'Имущество' }, { to: '/finance/import', label: 'Загрузка выписки' },
  { to: '/finance/categories', label: 'Статьи' }, { to: '/finance/legal', label: 'Юрлица' },
];

export function FinHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <ModuleTabs tabs={TABS} />
    </>
  );
}

function Simple({ entity, title, subtitle, columns, defaults, formFields }: { entity: string; title: string; subtitle: string; columns: any[]; defaults?: any; formFields?: string[] }) {
  const { field } = useMeta();
  const statusField = field(entity, 'status') ?? field(entity, 'kind');
  return (
    <div>
      <FinHeader title={title} subtitle={subtitle} />
      <EntityList entity={entity} columns={columns} defaults={defaults} formFields={formFields}
        filters={statusField?.options ? [{ key: statusField.key, label: statusField.label, options: statusField.options }] : []} />
    </div>
  );
}

export default function Finance() {
  const { can } = useAuth();
  if (!can('finance')) return <EmptyState title="Нет доступа к финансам" text="Этот раздел видят руководители и бухгалтерия. Попросите администратора открыть доступ." />;
  return (
    <Routes>
      <Route index element={<FinanceOverview />} />
      <Route path="operations" element={<Operations />} />
      <Route path="accounts" element={<Accounts />} />
      <Route path="calendar" element={<PaymentCalendar />} />
      <Route path="reports" element={<Reports />} />
      <Route path="budgets" element={<Budgets />} />
      <Route path="payroll" element={<Payroll />} />
      <Route path="import" element={<ImportStatement />} />
      <Route path="advances" element={<Simple entity="advances" title="Подотчёт" subtitle="Деньги, выданные сотрудникам под отчёт" defaults={{ date: todayIso(), status: 'issued' }}
        columns={['user_id', 'date', 'amount', 'purpose', 'reported_amount', { key: 'left', label: 'Остаток', align: 'right', render: (r: any) => <span className="tabular">{money((r.amount || 0) - (r.reported_amount || 0))}</span> }, 'status']} />} />
      <Route path="loans" element={<Simple entity="loans" title="Кредиты и займы" subtitle="Полученные и выданные займы"
        columns={['name', 'kind', 'company_id', 'amount', 'rate', 'paid_amount', { key: 'left', label: 'Остаток долга', align: 'right', render: (r: any) => <b className="tabular">{compactMoney((r.amount || 0) - (r.paid_amount || 0))}</b> }, 'date_to', 'status']} />} />
      <Route path="obligations" element={<Simple entity="obligations" title="Обязательства" subtitle="Кто кому должен: дебиторская и кредиторская задолженность" defaults={{ status: 'open' }}
        columns={['kind', 'company_id', 'description', 'amount', 'paid_amount', 'due_date', 'status']} />} />
      <Route path="assets" element={<Simple entity="assets" title="Имущество" subtitle="Основные средства и инвентарь компании"
        columns={['name', 'inventory_number', 'category', 'cost', 'purchase_date', 'responsible_id', 'status']} />} />
      <Route path="categories" element={<Simple entity="fin_categories" title="Статьи доходов и расходов" subtitle="Справочник для отчётов ДДС и ОПиУ"
        columns={['name', 'kind', 'parent_id', 'activity', 'in_pnl']} />} />
      <Route path="legal" element={<Simple entity="legal_entities" title="Наши юрлица" subtitle="Реквизиты для счетов и актов"
        columns={['name', 'inn', 'tax_system', 'director', 'is_default']} />} />
      <Route path="*" element={<Navigate to="/finance" replace />} />
    </Routes>
  );
}
