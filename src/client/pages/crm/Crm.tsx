import { Navigate, Route, Routes } from 'react-router-dom';
import { ModuleTabs } from '../../layout/Layout.tsx';
import { PageHeader } from '../../ui/ui.tsx';
import Deals from './Deals.tsx';
import { Companies, CompanyPage, ContactPage, Contacts } from './Clients.tsx';
import { ActPage, Acts, InvoicePage, Invoices } from './Invoices.tsx';
import WebForms from './WebForms.tsx';
import { Activities, Counterparties, CrmReport } from './More.tsx';

export const CRM_TABS = [
  { to: '/crm/deals', label: 'Сделки' }, { to: '/crm/activities', label: 'Дела' }, { to: '/crm/companies', label: 'Компании' }, { to: '/crm/contacts', label: 'Контакты' },
  { to: '/crm/counterparties', label: 'Все контрагенты' }, { to: '/crm/invoices', label: 'Счета' }, { to: '/crm/acts', label: 'Акты' }, { to: '/crm/forms', label: 'Веб-формы' },
  { to: '/crm/report', label: 'Отчёт' },
];

export function CrmHeader({ title, subtitle, actions, tabs }: { title: string; subtitle?: string; actions?: React.ReactNode; tabs?: React.ReactNode }) {
  return <PageHeader title={title} subtitle={subtitle} actions={actions} tabs={tabs ?? <ModuleTabs tabs={CRM_TABS} />} />;
}

export default function Crm() {
  return (
    <Routes>
      <Route index element={<Navigate to="deals" replace />} />
      <Route path="deals" element={<Deals />} />
      <Route path="deals/:id" element={<Deals />} />
      <Route path="activities" element={<Activities />} />
      <Route path="counterparties" element={<Counterparties />} />
      <Route path="report" element={<CrmReport />} />
      <Route path="companies" element={<Companies />} />
      <Route path="companies/:id" element={<CompanyPage />} />
      <Route path="contacts" element={<Contacts />} />
      <Route path="contacts/:id" element={<ContactPage />} />
      <Route path="invoices" element={<Invoices />} />
      <Route path="invoices/:id" element={<InvoicePage />} />
      <Route path="acts" element={<Acts />} />
      <Route path="acts/:id" element={<ActPage />} />
      <Route path="forms" element={<WebForms />} />
    </Routes>
  );
}
