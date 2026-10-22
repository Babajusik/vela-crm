import { useState } from 'react';
import { Plus, Printer } from 'lucide-react';
import { api, openPrint } from '../api.ts';
import { date } from '../lib/format.ts';
import { useAuth, useInvalidate, useList, useMeta } from '../lib/state.tsx';
import { Button, Card, EmptyState, FormRow, Input, Modal, PageHeader, Select, Tabs, useToast } from '../ui/ui.tsx';
import { DataTable, EntityList } from '../ui/data.tsx';
import { RichText } from '../ui/fields.tsx';

const PLACEHOLDERS = [
  ['{{today}}', 'Сегодняшняя дата'], ['{{company.name}}', 'Компания клиента'], ['{{company.legal_name}}', 'Полное наименование клиента'], ['{{company.inn}}', 'ИНН клиента'],
  ['{{contact.name}}', 'Контакт'], ['{{deal.title}}', 'Название сделки'], ['{{deal.amount}}', 'Сумма сделки'], ['{{deal.amount_words}}', 'Сумма прописью'],
  ['{{products_table}}', 'Таблица товаров'], ['{{responsible.name}}', 'Ответственный'], ['{{our.name}}', 'Наше юрлицо'], ['{{our.inn}}', 'Наш ИНН'], ['{{our.director}}', 'Наш директор'],
];

export default function Documents() {
  const [tab, setTab] = useState<'docs' | 'templates'>('docs');
  const { can } = useAuth();
  const [edit, setEdit] = useState<any>(null);
  return (
    <div>
      <PageHeader title="Документы" subtitle="Договоры, коммерческие предложения и письма из шаблонов — поля подставляются из CRM"
        actions={can('documents', 'write') && tab === 'templates' && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ name: '', entity_type: 'deals', kind: 'contract', body: '<h2>Заголовок</h2><p>Текст с полями {{company.name}}</p>' })}>Шаблон</Button>} />
      <Tabs value={tab} onChange={setTab} className="mb-4" tabs={[{ value: 'docs', label: 'Сформированные документы' }, { value: 'templates', label: 'Шаблоны' }]} />
      {tab === 'docs' ? (
        <EntityList entity="documents" onRowClick={(r) => openPrint(`/api/print/document/${r.id}`)} onCreate={() => setTab('templates')} createLabel="Из шаблона"
          columns={['name', 'template_id', 'company_id', 'status', { key: 'created_at', label: 'Создан', render: (r: any) => date(r.created_at) }, { key: 'print', label: '', render: () => <Printer className="size-4 text-faint" />, sortable: false }]}
          empty={<EmptyState title="Документов пока нет" text="Откройте сделку или компанию и нажмите «Сформировать документ»." />} />
      ) : <Templates onEdit={setEdit} />}
      {edit && <TemplateEditor tpl={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function Templates({ onEdit }: { onEdit: (t: any) => void }) {
  const { data } = useList('doc_templates', { limit: 200 });
  return (
    <Card padded={false}>
      <DataTable entity="doc_templates" rows={data?.items ?? []} onRowClick={onEdit} columns={['name', 'kind', 'entity_type']} empty={<EmptyState compact title="Шаблонов нет" />} />
    </Card>
  );
}

function TemplateEditor({ tpl, onClose }: { tpl: any; onClose: () => void }) {
  const [t, setT] = useState<any>(tpl);
  const { field } = useMeta();
  const toast = useToast();
  const inv = useInvalidate();
  const save = async () => {
    try {
      const d = { name: t.name, entity_type: t.entity_type, kind: t.kind, body: t.body };
      if (t.id) await api.patch(`/api/e/doc_templates/${t.id}`, d); else await api.post('/api/e/doc_templates', d);
      inv('doc_templates');
      toast.success('Шаблон сохранён');
      onClose();
    } catch (e) { toast.error(e); }
  };
  return (
    <Modal open onClose={onClose} size="xl" title={t.id ? 'Шаблон документа' : 'Новый шаблон'}
      footer={<>{t.id && <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { await api.del(`/api/e/doc_templates/${t.id}`); inv('doc_templates'); onClose(); }}>Удалить</Button>}<Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormRow label="Название" className="sm:col-span-1"><Input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></FormRow>
            <FormRow label="Вид"><Select value={t.kind} onChange={(e) => setT({ ...t, kind: e.target.value })}>{field('doc_templates', 'kind')?.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormRow>
            <FormRow label="Для объекта"><Select value={t.entity_type} onChange={(e) => setT({ ...t, entity_type: e.target.value })}>{field('doc_templates', 'entity_type')?.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormRow>
          </div>
          <RichText value={t.body} onChange={(v) => setT({ ...t, body: v })} minHeight={380} />
        </div>
        <Card title="Поля для подстановки" className="h-fit">
          <ul className="space-y-1.5 text-xs">
            {PLACEHOLDERS.map(([k, l]) => (
              <li key={k}><button type="button" className="w-full rounded-md px-1.5 py-1 text-left hover:bg-surface-2" onClick={() => { navigator.clipboard?.writeText(k); toast.info(`Скопировано: ${k}`); }}>
                <code className="font-semibold text-primary">{k}</code><span className="block text-muted">{l}</span>
              </button></li>
            ))}
          </ul>
        </Card>
      </div>
    </Modal>
  );
}
