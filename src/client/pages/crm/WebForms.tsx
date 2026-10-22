import { useEffect, useState } from 'react';
import { Copy, ExternalLink, GripVertical, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api.ts';
import { useAuth, useInvalidate, useList } from '../../lib/state.tsx';
import { Badge, Button, Card, Checkbox, EmptyState, FormRow, IconButton, Input, Loading, Modal, Select, Switch, Textarea, useToast } from '../../ui/ui.tsx';
import { RefSelect, UserSelect } from '../../ui/fields.tsx';
import { CrmHeader } from './Crm.tsx';

interface FF { key: string; label: string; type: string; required?: boolean }
const TYPES = [{ value: 'text', label: 'Строка' }, { value: 'phone', label: 'Телефон' }, { value: 'email', label: 'Email' }, { value: 'textarea', label: 'Текст' }];
const KEYS = [{ value: 'name', label: 'Имя → ФИО контакта' }, { value: 'phone', label: 'Телефон → контакт' }, { value: 'email', label: 'Email → контакт' }, { value: 'company', label: 'Компания → компания' }];

export function formUrl(id: number) {
  return `${location.origin}${location.pathname}#/f/${id}`;
}

export default function WebForms() {
  const { data, isLoading } = useList('web_forms', { limit: 100 });
  const { can } = useAuth();
  const [edit, setEdit] = useState<any>(null);
  const toast = useToast();
  return (
    <div>
      <CrmHeader title="Веб-формы" subtitle="Заявки с сайта сразу становятся сделками"
        actions={can('crm', 'write') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ name: 'Новая форма', title: 'Оставьте заявку', is_active: 1, fields: [{ key: 'name', label: 'Ваше имя', type: 'text', required: true }, { key: 'phone', label: 'Телефон', type: 'phone', required: true }] })}>Форма</Button>} />
      {isLoading ? <Loading /> : !data?.items.length ? <EmptyState title="Форм пока нет" text="Создайте форму и вставьте ссылку на сайт или в соцсети." /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((f: any) => (
            <Card key={f.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-base font-bold">{f.name}</p>
                  <p className="truncate text-sm text-muted">{f.title}</p>
                </div>
                <Badge color={f.is_active ? '#10b981' : '#94a3b8'}>{f.is_active ? 'Активна' : 'Выключена'}</Badge>
              </div>
              <p className="mt-3 text-sm text-muted">Заявок: <b className="text-fg tabular">{f.submissions ?? 0}</b> · полей: {(f.fields ?? []).length}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" icon={<ExternalLink className="size-4" />} onClick={() => window.open(formUrl(f.id), '_blank')}>Открыть</Button>
                <Button size="sm" icon={<Copy className="size-4" />} onClick={() => { navigator.clipboard?.writeText(formUrl(f.id)); toast.success('Ссылка скопирована'); }}>Ссылка</Button>
                {can('crm', 'write') && <Button size="sm" variant="ghost" onClick={() => setEdit(f)}>Настроить</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && <FormEditor form={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function FormEditor({ form, onClose }: { form: any; onClose: () => void }) {
  const [f, setF] = useState<any>(form);
  const toast = useToast();
  const inv = useInvalidate();
  const pipelines = useList('pipelines', { limit: 20 }).data?.items ?? [];
  useEffect(() => { if (!f.pipeline_id && pipelines[0]) setF((x: any) => ({ ...x, pipeline_id: pipelines[0].id })); }, [pipelines.length]);
  const fields: FF[] = f.fields ?? [];
  const setFields = (fs: FF[]) => setF({ ...f, fields: fs });
  const save = async () => {
    try {
      const payload = { name: f.name, title: f.title, subtitle: f.subtitle, fields: f.fields, pipeline_id: f.pipeline_id, stage_id: f.stage_id, responsible_id: f.responsible_id, success_message: f.success_message, is_active: f.is_active };
      if (f.id) await api.patch(`/api/e/web_forms/${f.id}`, payload); else await api.post('/api/e/web_forms', payload);
      inv('web_forms');
      toast.success('Форма сохранена');
      onClose();
    } catch (e) { toast.error(e); }
  };
  const embed = f.id ? `<iframe src="${formUrl(f.id)}" width="100%" height="640" style="border:0"></iframe>` : '';
  return (
    <Modal open onClose={onClose} size="lg" title={f.id ? `Форма «${form.name}»` : 'Новая веб-форма'}
      footer={<>{f.id && <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { await api.del(`/api/e/web_forms/${f.id}`); inv('web_forms'); onClose(); }}>Удалить</Button>}<Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormRow label="Название (для вас)"><Input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormRow>
          <FormRow label="Заголовок формы"><Input value={f.title ?? ''} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormRow>
          <FormRow label="Подзаголовок" className="sm:col-span-2"><Input value={f.subtitle ?? ''} onChange={(e) => setF({ ...f, subtitle: e.target.value })} /></FormRow>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-semibold text-muted">Поля формы</p>
          <div className="space-y-2">
            {fields.map((fl, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
                <GripVertical className="size-4 text-faint" />
                <Input value={fl.label} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="min-w-40 flex-1" />
                <Select value={KEYS.some((k) => k.value === fl.key) ? fl.key : 'custom'} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, key: e.target.value === 'custom' ? `field_${i}` : e.target.value } : x)))} className="w-auto">
                  {KEYS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}<option value="custom">Другое → в ленту сделки</option>
                </Select>
                <Select value={fl.type} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} className="w-auto">{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
                <Checkbox checked={!!fl.required} label="Обяз." onChange={(v) => setFields(fields.map((x, j) => (j === i ? { ...x, required: v } : x)))} />
                <IconButton label="Удалить поле" onClick={() => setFields(fields.filter((_, j) => j !== i))}><Trash2 className="size-4" /></IconButton>
              </div>
            ))}
          </div>
          <Button size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setFields([...fields, { key: `field_${Date.now() % 10000}`, label: 'Новое поле', type: 'text' }])}>Поле</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormRow label="Воронка"><Select value={f.pipeline_id ?? ''} onChange={(e) => setF({ ...f, pipeline_id: Number(e.target.value), stage_id: null })}>{pipelines.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FormRow>
          <FormRow label="Стадия"><RefSelect entity="stages" value={f.stage_id} onChange={(v) => setF({ ...f, stage_id: v })} filter={{ pipeline_id: f.pipeline_id }} placeholder="Первая стадия" /></FormRow>
          <FormRow label="Ответственный"><UserSelect value={f.responsible_id} onChange={(v) => setF({ ...f, responsible_id: v })} /></FormRow>
        </div>
        <FormRow label="Сообщение после отправки"><Textarea rows={2} value={f.success_message ?? ''} onChange={(e) => setF({ ...f, success_message: e.target.value })} /></FormRow>
        <Switch checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v ? 1 : 0 })} label="Форма принимает заявки" />
        {embed && (
          <FormRow label="Код для вставки на сайт" hint="Вставьте в HTML страницы сайта или в конструктор (Tilda, WordPress)">
            <Textarea readOnly rows={3} value={embed} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          </FormRow>
        )}
      </div>
    </Modal>
  );
}
