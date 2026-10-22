import { Navigate, Route, Routes } from 'react-router-dom';
import { ModuleTabs } from '../../layout/Layout.tsx';
import { PageHeader } from '../../ui/ui.tsx';
import Deals from './Deals.tsx';
import DealPage from './DealPage.tsx';
import { Companies, CompanyPage, ContactPage, Contacts } from './Clients.tsx';
import { ActPage, Acts, InvoicePage, Invoices } from './Invoices.tsx';
import WebForms from './WebForms.tsx';

export const CRM_TABS = [
  { to: '/crm/deals', label: 'Сделки' }, { to: '/crm/companies', label: 'Компании' }, { to: '/crm/contacts', label: 'Контакты' },
  { to: '/crm/invoices', label: 'Счета' }, { to: '/crm/acts', label: 'Акты' }, { to: '/crm/forms', label: 'Веб-формы' },
];

export function CrmHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <ModuleTabs tabs={CRM_TABS} />
    </>
  );
}

export default function Crm() {
  return (
    <Routes>
      <Route index element={<Navigate to="deals" replace />} />
      <Route path="deals" element={<Deals />} />
      <Route path="deals/:id" element={<DealPage />} />
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
