// Channel connections: Telegram, VK, Avito, WhatsApp and the website chat.
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Pencil, Plus, RefreshCw } from 'lucide-react';
import { api, IS_DEMO } from '../../api.ts';
import { relative } from '../../lib/format.ts';
import { useAuth, useInvalidate, useList, useMeta } from '../../lib/state.tsx';
import { Badge, Button, FormRow, Input, Modal, Switch, Textarea, useToast } from '../../ui/ui.tsx';
import { UserSelect } from '../../ui/fields.tsx';

interface KindInfo { label: string; fields: { key: string; label: string; secret?: boolean; placeholder?: string; optional?: boolean }[]; steps: string[]; note?: string }

const KINDS: Record<string, KindInfo> = {
  telegram: {
    label: 'Telegram', fields: [{ key: 'bot_token', label: 'Токен бота', secret: true, placeholder: '123456789:AA…' }],
    steps: ['Откройте @BotFather в Telegram, отправьте /newbot и придумайте имя бота.', 'Скопируйте токен, который пришлёт BotFather, и вставьте сюда.', 'Дайте клиентам ссылку на бота (t.me/имя_бота) — сообщения появятся в «Коммуникациях».'],
  },
  vk: {
    label: 'ВКонтакте', fields: [{ key: 'group_id', label: 'ID сообщества', placeholder: '123456789' }, { key: 'access_token', label: 'Ключ доступа сообщества', secret: true, placeholder: 'vk1.a.…' }],
    steps: ['В сообществе откройте «Управление → Сообщения» и включите сообщения сообщества.', '«Управление → Работа с API → Ключи доступа»: создайте ключ с правами «Сообщения сообщества» и «Управление сообществом».', 'Там же, на вкладке Long Poll API, включите его и отметьте событие «Входящее сообщение».', 'ID сообщества — число из адреса vk.com/club123456789 или из раздела «Работа с API».'],
  },
  avito: {
    label: 'Авито', fields: [{ key: 'client_id', label: 'Client ID' }, { key: 'client_secret', label: 'Client Secret', secret: true }],
    steps: ['Нужен тариф Авито с доступом к API (для бизнеса).', 'На avito.ru/professionals/api получите Client ID и Client Secret.', 'Новые сообщения от покупателей придут в CRM в течение 30 секунд, ответы уйдут в чат Авито.'],
  },
  whatsapp: {
    label: 'WhatsApp', fields: [{ key: 'api_url', label: 'apiUrl', placeholder: 'https://1234.api.greenapi.com', optional: true }, { key: 'id_instance', label: 'idInstance' }, { key: 'api_token', label: 'apiTokenInstance', secret: true }],
    steps: ['Зарегистрируйтесь в Green API (green-api.com) и создайте инстанс.', 'Отсканируйте QR-код телефоном с WhatsApp, который будет отвечать клиентам.', 'Скопируйте apiUrl, idInstance и apiTokenInstance из консоли Green API.'],
    note: 'Green API — неофициальный шлюз: WhatsApp может ограничить номер за массовые рассылки. Для крупных объёмов используйте официальный WhatsApp Business API через партнёра Meta.',
  },
  webchat: {
    label: 'Чат на сайте', fields: [],
    steps: ['Сохраните канал — появится код для сайта.', 'Вставьте код перед закрывающим тегом </body> на всех страницах сайта.', 'На сайте появится кнопка чата; сообщения посетителей придут сюда, ответы — сразу в окно чата на сайте.'],
  },
};

export function ChannelsManager() {
  const { data } = useList('channels', { limit: 100, sort: 'id', dir: 'asc' });
  const { field } = useMeta();
  const { can } = useAuth();
  const [edit, setEdit] = useState<{ id?: number; kind: string } | null>(null);
  const kinds = field('channels', 'kind')?.options ?? [];
  const admin = can('communications', 'admin');
  return (
    <div className="space-y-4">
      {admin && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(KINDS).map(([k, info]) => (
            <Button key={k} size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit({ kind: k })}>{info.label}</Button>
          ))}
        </div>
      )}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {(data?.items ?? []).map((ch: any) => {
          const kind = kinds.find((o) => o.value === ch.kind);
          return (
            <li key={ch.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Badge color={kind?.color}>{kind?.label ?? ch.kind}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{ch.name}{ch.account && <span className="font-normal text-muted"> · {ch.account}</span>}</p>
                {ch.sync_error
                  ? <p className="flex items-center gap-1 text-xs text-danger"><AlertTriangle className="size-3.5 shrink-0" />{ch.sync_error}</p>
                  : ch.last_sync_at ? <p className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="size-3.5" />Работает · проверено {relative(ch.last_sync_at)}</p>
                    : <p className="text-xs text-faint">{ch._ref?.responsible_id ? `Ответственный: ${ch._ref.responsible_id.title}` : 'Ответственный не назначен'}</p>}
              </div>
              {!ch.is_active && <Badge color="#94a3b8">Выключен</Badge>}
              {admin && KINDS[ch.kind] && <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit({ id: ch.id, kind: ch.kind })}>Настроить</Button>}
            </li>
          );
        })}
        {!data?.items?.length && <li className="px-4 py-8 text-center text-sm text-faint">Каналы не подключены</li>}
      </ul>
      {IS_DEMO && <p className="text-xs text-muted">В демо-версии CRM работает в браузере и не может ходить в API мессенджеров: каналы сохраняются, а сообщения принимает серверная версия. Для проверки нажмите «Имитировать сообщение клиента».</p>}
      {edit && <ChannelForm id={edit.id} kind={edit.kind} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ChannelForm({ id, kind, onClose }: { id?: number; kind: string; onClose: () => void }) {
  const info = KINDS[kind];
  const toast = useToast();
  const inv = useInvalidate();
  const existing = useList('channels', { id: id ?? 0, limit: 1 }, { enabled: !!id }).data?.items?.[0];
  const [f, setF] = useState<any>({ name: info.label, responsible_id: null, is_active: 1, settings: {} });
  const [saving, setSaving] = useState(false);
  // secrets come masked: saving the mask keeps the stored value
  useEffect(() => {
    if (!id || !existing) return;
    api.get(`/api/channels/${id}/settings`)
      .then((settings) => setF({ name: existing.name, responsible_id: existing.responsible_id, is_active: existing.is_active, settings }))
      .catch((e) => toast.error(e));
  }, [id, existing?.id]);
  const save = async () => {
    setSaving(true);
    try {
      const ch = id ? await api.put(`/api/channels/${id}`, f) : await api.post('/api/channels', { ...f, kind });
      inv('channels');
      if (ch.sync_error) toast.error(`Канал сохранён, но не отвечает: ${ch.sync_error}`);
      else toast.success(ch.account ? `Подключено: ${ch.account}` : 'Канал сохранён');
      if (kind === 'webchat' && !id) { const s = await api.get(`/api/channels/${ch.id}/settings`); setF({ ...f, settings: s }); return; }
      onClose();
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  };
  const check = async () => {
    try { const ch = await api.post(`/api/channels/${id}/test`); inv('channels'); ch.sync_error ? toast.error(ch.sync_error) : toast.success(ch.account ? `Работает: ${ch.account}` : 'Работает'); }
    catch (e) { toast.error(e); }
  };
  const origin = IS_DEMO ? 'https://crm.ваша-компания.ru' : location.origin;
  const snippet = f.settings?.widget_key ? `<script src="${origin}/widget.js" data-key="${f.settings.widget_key}" async></script>` : '';
  return (
    <Modal open onClose={onClose} size="lg" title={id ? `Канал: ${info.label}` : `Подключить: ${info.label}`}
      footer={<>
        {id && kind !== 'webchat' && <Button icon={<RefreshCw className="size-4" />} onClick={check}>Проверить</Button>}
        <Button onClick={onClose}>Закрыть</Button>
        <Button variant="primary" loading={saving} onClick={save}>Сохранить</Button>
      </>}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <FormRow label="Название" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormRow>
          {info.fields.map((fl) => (
            <FormRow key={fl.key} label={fl.label} required={!fl.optional}>
              <Input type={fl.secret ? 'password' : 'text'} autoComplete={fl.secret ? 'new-password' : 'off'} placeholder={fl.placeholder} className="font-mono text-sm"
                value={f.settings?.[fl.key] ?? ''} onChange={(e) => setF({ ...f, settings: { ...f.settings, [fl.key]: e.target.value } })} />
            </FormRow>
          ))}
          <FormRow label="Ответственный" hint="Новые диалоги назначаются ему"><UserSelect value={f.responsible_id} onChange={(v) => setF({ ...f, responsible_id: v })} /></FormRow>
          <Switch checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v ? 1 : 0 })} label="Канал включён" />
        </div>
        <div className="space-y-3 text-sm">
          <p className="font-bold">Как подключить</p>
          <ol className="list-decimal space-y-1.5 pl-5 text-muted">{info.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          {info.note && <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs">{info.note}</p>}
          {snippet && (
            <div>
              <p className="mb-1 font-semibold">Код для сайта</p>
              <Textarea readOnly rows={3} value={snippet} className="font-mono text-xs" />
              <Button size="sm" className="mt-2" icon={<Copy className="size-4" />} onClick={() => { navigator.clipboard?.writeText(snippet); toast.success('Код скопирован'); }}>Копировать код</Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
