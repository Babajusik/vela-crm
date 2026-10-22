// Telephony in the interface: incoming call card, click-to-call, call log and PBX settings.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing, RefreshCw, Save } from 'lucide-react';
import { api, IS_DEMO } from '../../api.ts';
import { useApi, useAuth, useInvalidate, useList } from '../../lib/state.tsx';
import { Avatar, Badge, Button, Card, Checkbox, FormRow, Input, Loading, Select, useToast } from '../../ui/ui.tsx';
import { EntityList } from '../../ui/data.tsx';
import { SettingsHeader } from '../settings/Settings.tsx';
import { duration } from '../../ui/phone.tsx';

// ---------------- call log ----------------
const STATUS_ICON: Record<string, React.ReactNode> = {
  answered: <PhoneCall className="size-4 text-success" />, missed: <PhoneMissed className="size-4 text-danger" />,
  busy: <PhoneOff className="size-4 text-faint" />, failed: <PhoneOff className="size-4 text-faint" />,
  ringing: <PhoneIncoming className="size-4 text-warning" />, active: <PhoneCall className="size-4 text-primary" />,
};

export function Calls() {
  const { settings } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const missedToday = useList('calls', { status: 'missed', direction: 'in', started_at__gte: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(), limit: 1, expand: 0 }).data?.total ?? 0;
  const simulate = async () => {
    try { await api.post('/api/telephony/simulate'); inv('telephony'); toast.info('Звонит телефон — карточка клиента справа внизу'); }
    catch (e) { toast.error(e); }
  };
  const demo = IS_DEMO || settings.telephony?.provider === 'demo';
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-extrabold">Звонки</h2>
          <p className="text-sm text-muted">{settings.telephony?.enabled ? 'Все звонки через АТС: кто звонил, кто ответил, сколько длился разговор и запись.' : 'Телефония не подключена: Настройки → Телефония.'}</p>
        </div>
        {missedToday > 0 && <Badge color="#ef4444">Пропущено сегодня: {missedToday}</Badge>}
        {demo && <Button variant="primary" icon={<PhoneIncoming className="size-4" />} onClick={simulate}>Имитировать входящий</Button>}
      </div>
      <EntityList entity="calls" canExport
        columns={[
          { key: 'direction', label: '', render: (r: any) => <span className="flex items-center gap-1.5">{STATUS_ICON[r.status]}{r.direction === 'out' ? <PhoneOutgoing className="size-3.5 text-faint" /> : null}</span> },
          'phone',
          { key: 'contact_id', label: 'Клиент', render: (r: any) => r._ref?.contact_id?.title ?? r._ref?.company_id?.title ?? <span className="text-faint">новый номер</span> },
          'status', 'user_id', 'started_at',
          { key: 'duration', label: 'Разговор', render: (r: any) => <span className="tabular">{duration(r.duration)}</span> },
          { key: 'record_url', label: 'Запись', render: (r: any) => r.record_url ? <audio controls preload="none" src={r.record_url} className="h-8 max-w-56" onClick={(e) => e.stopPropagation()} /> : <span className="text-faint">—</span> },
        ]}
        onRowClick={(r: any) => {
          if (r.deal_id) nav(`/crm/deals/${r.deal_id}`);
          else if (r.contact_id) nav(`/crm/contacts/${r.contact_id}`);
          else if (r.company_id) nav(`/crm/companies/${r.company_id}`);
        }}
        filters={[
          { key: 'status', label: 'Статус', options: [{ value: 'answered', label: 'Состоялся' }, { value: 'missed', label: 'Пропущен' }, { value: 'busy', label: 'Занято' }, { value: 'failed', label: 'Не дозвонились' }] },
          { key: 'direction', label: 'Направление', options: [{ value: 'in', label: 'Входящие' }, { value: 'out', label: 'Исходящие' }] },
          { key: 'user_id', label: 'Сотрудник', type: 'user' },
        ]}
        formFields={['comment', 'deal_id', 'contact_id', 'company_id']} />
    </div>
  );
}

// ---------------- settings ----------------
const PROVIDERS = [
  { value: 'none', label: 'Не подключена' },
  { value: 'zadarma', label: 'Zadarma' },
  { value: 'novofon', label: 'Новофон' },
  { value: 'mango', label: 'Mango Office' },
  { value: 'generic', label: 'Другая АТС (Asterisk, FreePBX, любой провайдер)' },
  { value: 'demo', label: 'Демо-режим (имитация звонков)' },
];

const HOWTO: Record<string, { key?: string; secret?: string; steps: string[] }> = {
  zadarma: { key: 'Key (ключ API)', secret: 'Secret (секрет API)', steps: [
    'В личном кабинете Zadarma откройте «Настройки → API и интеграции», скопируйте Key и Secret сюда.',
    'В разделе уведомлений о звонках вставьте адрес ниже во все события: NOTIFY_START, NOTIFY_INTERNAL, NOTIFY_ANSWER, NOTIFY_END, NOTIFY_OUT_START, NOTIFY_OUT_END, NOTIFY_RECORD.',
    'Каждому сотруднику укажите внутренний номер АТС (100, 101…) в таблице ниже.',
  ] },
  novofon: { key: 'Key (ключ API)', secret: 'Secret (секрет API)', steps: [
    'В личном кабинете Новофон откройте «Интеграции → API», скопируйте Key и Secret.',
    'В настройках уведомлений о звонках укажите адрес ниже для всех событий звонков и записей.',
    'Каждому сотруднику укажите внутренний номер АТС в таблице ниже.',
  ] },
  mango: { key: 'Уникальный код АТС (vpbx_api_key)', secret: 'Ключ для подписи (vpbx_api_salt)', steps: [
    'В Mango Office подключите «Интеграции → API коннектор», скопируйте уникальный код АТС и ключ для подписи.',
    'В поле «Внешняя система» укажите адрес ниже — Mango сам добавит к нему /events/call и /events/summary.',
    'Каждому сотруднику укажите добавочный номер в таблице ниже.',
  ] },
  generic: { steps: [
    'АТС или скрипт отправляет POST с JSON на адрес ниже: {"call_id": "…", "event": "start|answer|end|record", "direction": "in|out", "phone": "+7…", "ext": "101", "duration": 42, "status": "answered|missed|busy|failed", "record_url": "https://…"}.',
    'Для Asterisk и FreePBX — вызов curl из диалплана или AMI-скрипта на события начала, ответа и завершения звонка.',
    'Каждому сотруднику укажите внутренний номер в таблице ниже.',
  ] },
};

export function TelephonySettingsPage() {
  const { data, isLoading } = useApi<any>(['telephony', 'settings'], '/api/telephony/settings');
  return (
    <div>
      <SettingsHeader title="Телефония" subtitle="Карточка клиента при входящем звонке, журнал и записи разговоров, звонок из CRM в один клик" />
      {isLoading || !data ? <Loading /> : <TelephonyForm initial={data} />}
    </div>
  );
}

function TelephonyForm({ initial }: { initial: any }) {
  const [s, setS] = useState<any>(initial);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const inv = useInvalidate();
  const { refresh } = useAuth();
  useEffect(() => setS(initial), [initial]);
  const howto = HOWTO[s.provider];
  const hookUrl = s.hook_path ? `${IS_DEMO ? 'https://ваш-сервер' : location.origin}${s.hook_path}` : '';
  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    try {
      const r = await api.put('/api/telephony/settings', { ...s, ...extra });
      setS(r);
      inv('telephony');
      await refresh();
      toast.success('Настройки телефонии сохранены');
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title="Подключение">
        <div className="space-y-4">
          <FormRow label="АТС / провайдер">
            <Select value={s.provider} onChange={(e) => setS({ ...s, provider: e.target.value })}>
              {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </FormRow>
          {howto?.key && <FormRow label={howto.key}><Input value={s.api_key ?? ''} onChange={(e) => setS({ ...s, api_key: e.target.value })} autoComplete="off" /></FormRow>}
          {howto?.secret && <FormRow label={howto.secret}><Input type="password" value={s.api_secret ?? ''} onChange={(e) => setS({ ...s, api_secret: e.target.value })} autoComplete="new-password" /></FormRow>}
          {s.provider !== 'none' && s.provider !== 'demo' && (
            <FormRow label="Адрес для событий АТС" hint={hookUrl ? 'Секретный адрес: по нему АТС сообщает о звонках. Если он попал в чужие руки — выпустите новый.' : 'Появится после сохранения'}>
              <div className="flex gap-2">
                <Input readOnly value={hookUrl} className="font-mono text-xs" />
                <Button icon={<Copy className="size-4" />} disabled={!hookUrl} onClick={() => { navigator.clipboard?.writeText(hookUrl); toast.success('Адрес скопирован'); }}>Копировать</Button>
                <Button variant="ghost" icon={<RefreshCw className="size-4" />} disabled={!hookUrl} onClick={() => save({ new_hook_token: true })} title="Выпустить новый адрес" aria-label="Выпустить новый адрес" />
              </div>
            </FormRow>
          )}
          <div className="flex flex-col gap-2.5">
            <Checkbox checked={!!s.unknown_to_lead} onChange={(v) => setS({ ...s, unknown_to_lead: v })} label="Звонок с нового номера — создать контакт и сделку" />
            <Checkbox checked={!!s.missed_to_activity} onChange={(v) => setS({ ...s, missed_to_activity: v })} label="Пропущенный звонок — поставить дело «Перезвонить» ответственному" />
          </div>
          <div><Button variant="primary" icon={<Save className="size-4" />} loading={saving} onClick={() => save()}>Сохранить</Button></div>
        </div>
      </Card>
      <div className="space-y-5">
        {howto && (
          <Card title="Как подключить">
            <ol className="list-decimal space-y-2 pl-5 text-sm">{howto.steps.map((x) => <li key={x}>{x}</li>)}</ol>
            {IS_DEMO && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">В демо-версии CRM работает в браузере, и АТС некуда отправлять события. На своём сервере адрес будет вида https://crm.компания.ru/api/telephony/hook/…</p>}
          </Card>
        )}
        {s.provider === 'demo' && (
          <Card title="Демо-режим">
            <p className="text-sm text-muted">Звонки имитируются: откройте «Коммуникации → Звонки» и нажмите «Имитировать входящий». Появится карточка клиента — так она выглядит при настоящем звонке.</p>
          </Card>
        )}
        <Extensions />
      </div>
    </div>
  );
}

function Extensions() {
  const { data } = useList('users', { is_active: 1, limit: 200, sort: 'name', dir: 'asc', expand: 0 });
  const inv = useInvalidate();
  const toast = useToast();
  const save = async (id: number, phone_ext: string) => {
    try { await api.patch(`/api/e/users/${id}`, { phone_ext }); inv('users'); toast.success('Внутренний номер сохранён'); } catch (e) { toast.error(e); }
  };
  return (
    <Card title="Внутренние номера сотрудников" subtitle="Входящий звонок на этот номер покажет карточку клиента сотруднику; с него же CRM звонит клиентам">
      <ul className="divide-y divide-line">
        {(data?.items ?? []).map((u: any) => (
          <li key={u.id} className="flex items-center gap-3 py-2">
            <Avatar name={u.name} color={u.color} size={28} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{u.name}<span className="block truncate text-xs font-normal text-muted">{u.position}</span></span>
            <Input defaultValue={u.phone_ext ?? ''} className="!w-20 shrink-0 text-center tabular" aria-label={`Внутренний номер: ${u.name}`} placeholder="—"
              onBlur={(e) => { if (e.target.value !== (u.phone_ext ?? '')) save(u.id, e.target.value.trim()); }} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
