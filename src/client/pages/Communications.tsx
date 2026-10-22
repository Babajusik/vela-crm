import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Handshake, Inbox, MessageSquarePlus, Send, Settings2, UserCheck, X } from 'lucide-react';
import { api, IS_DEMO } from '../api.ts';
import { relative, time } from '../lib/format.ts';
import { useAuth, useInvalidate, useList, useMeta } from '../lib/state.tsx';
import { Avatar, Badge, Button, EmptyState, Modal, Segmented, Textarea, cx, useToast } from '../ui/ui.tsx';
import { EntityList } from '../ui/data.tsx';

export default function Communications() {
  const [sp, setSp] = useSearchParams();
  const { field } = useMeta();
  const [status, setStatus] = useState<'active' | 'closed'>('active');
  const [channelsOpen, setChannelsOpen] = useState(false);
  const toast = useToast();
  const inv = useInvalidate();
  const { data } = useList('conversations', { status__in: status === 'active' ? 'new,open' : 'closed', limit: 200, sort: 'last_message_at', dir: 'desc' });
  const convs = data?.items ?? [];
  const active = Number(sp.get('c')) || convs[0]?.id;
  const conv = convs.find((c: any) => c.id === active);
  const kinds = field('channels', 'kind')?.options ?? [];
  useEffect(() => { const t = setInterval(() => inv('conversations', 'conv_messages'), 10000); return () => clearInterval(t); }, [inv]);
  const simulate = async () => {
    try { const c = await api.post('/api/conversations/simulate'); inv('conversations', 'conv_messages', 'notifications'); setSp({ c: String(c.id) }); toast.info('Пришло новое сообщение от клиента'); }
    catch (e) { toast.error(e); }
  };
  return (
    <div className="-mx-4 -my-5 flex h-[calc(100vh-3.5rem)] sm:-mx-6 lg:-my-6">
      <aside className="flex w-full max-w-sm shrink-0 flex-col border-r border-line bg-surface max-md:hidden">
        <div className="space-y-2 border-b border-line p-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-extrabold">Коммуникации</h1>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" icon={<Settings2 className="size-4" />} onClick={() => setChannelsOpen(true)}>Каналы</Button>
            </div>
          </div>
          <Segmented value={status} onChange={setStatus} options={[{ value: 'active', label: 'Активные' }, { value: 'closed', label: 'Закрытые' }]} />
          {IS_DEMO && <Button size="sm" full icon={<MessageSquarePlus className="size-4" />} onClick={simulate}>Имитировать сообщение клиента</Button>}
        </div>
        <ul className="flex-1 overflow-y-auto p-1.5">
          {convs.map((c: any) => {
            const kind = kinds.find((k) => k.value === c._ref?.channel_id?.kind);
            return (
              <li key={c.id}>
                <button type="button" onClick={() => setSp({ c: String(c.id) })} className={cx('flex w-full gap-3 rounded-lg px-2.5 py-2.5 text-left', c.id === active ? 'bg-primary-soft' : 'hover:bg-surface-2')}>
                  <Avatar name={c.client_name} color={kind?.color} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{c.client_name}</span>{c.status === 'new' && <span className="size-2 shrink-0 rounded-full bg-accent" />}<span className="ml-auto shrink-0 text-[11px] text-faint">{relative(c.last_message_at)}</span></span>
                    <span className="block truncate text-xs text-muted">{c.last_text}</span>
                    <span className="mt-1 inline-block"><Badge color={kind?.color}>{kind?.label}</Badge></span>
                  </span>
                </button>
              </li>
            );
          })}
          {!convs.length && <li className="px-3 py-10 text-center text-sm text-faint">Диалогов нет</li>}
        </ul>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {conv ? <Dialog conv={conv} /> : <EmptyState icon={<Inbox />} title="Выберите диалог" text="Здесь собираются сообщения клиентов из Telegram, WhatsApp, ВКонтакте, MAX, Авито и чата на сайте." />}
      </section>
      <Modal open={channelsOpen} onClose={() => setChannelsOpen(false)} size="xl" title="Каналы связи"
        subtitle="Telegram-бот подключается по токену от @BotFather и работает на вашем сервере без внешних сервисов. Остальные каналы — через API провайдера.">
        <TelegramConnect />
        <EntityList entity="channels" columns={['name', 'kind', 'responsible_id', 'is_active']} formFields={['name', 'kind', 'responsible_id', 'is_active']} canExport={false} />
      </Modal>
    </div>
  );
}

function Dialog({ conv }: { conv: any }) {
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const { user } = useAuth();
  const { data } = useList('conv_messages', { conversation_id: conv.id, limit: 500, sort: 'id', dir: 'asc', expand: 0 });
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const msgs = data?.items ?? [];
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, conv.id]);
  useEffect(() => { if (conv.unread) api.patch(`/api/e/conversations/${conv.id}`, { unread: 0 }).then(() => inv('conversations')); }, [conv.id]);
  const send = async () => {
    if (!text.trim()) return;
    try { await api.post(`/api/conversations/${conv.id}/reply`, { text: text.trim() }); setText(''); inv('conv_messages', 'conversations'); }
    catch (e) { toast.error(e); }
  };
  const toDeal = async () => {
    try { const d = await api.post(`/api/conversations/${conv.id}/deal`); inv('deals', 'conversations'); toast.success('Сделка создана, переписка перенесена в ленту'); nav(`/crm/deals/${d.id}`); }
    catch (e) { toast.error(e); }
  };
  const setStatus = async (status: string) => { await api.patch(`/api/e/conversations/${conv.id}`, { status }); inv('conversations'); };
  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-bold">{conv.client_name}</h2>
          <p className="truncate text-xs text-muted">{conv.client_handle} · {conv._ref?.channel_id?.title}{conv._ref?.assignee_id && ` · оператор: ${conv._ref.assignee_id.title}`}</p>
        </div>
        {!conv.assignee_id && <Button size="sm" icon={<UserCheck className="size-4" />} onClick={async () => { await api.patch(`/api/e/conversations/${conv.id}`, { assignee_id: user!.id, status: 'open' }); inv('conversations'); }}>Взять себе</Button>}
        {conv.deal_id ? <Button size="sm" onClick={() => nav(`/crm/deals/${conv.deal_id}`)}>Открыть сделку</Button> : <Button size="sm" variant="primary" icon={<Handshake className="size-4" />} onClick={toDeal}>Создать сделку</Button>}
        {conv.status !== 'closed' ? <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => setStatus('closed')}>Закрыть</Button> : <Button size="sm" onClick={() => setStatus('open')}>Вернуть в работу</Button>}
      </header>
      <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
        {msgs.map((m: any) => (
          <div key={m.id} className={cx('flex', m.direction === 'out' && 'justify-end')}>
            <div className={cx('max-w-[75%] rounded-2xl px-3.5 py-2 text-sm', m.direction === 'out' ? 'rounded-tr-sm bg-primary text-primary-fg' : 'rounded-tl-sm border border-line bg-surface')}>
              <p className="whitespace-pre-line">{m.text}</p>
              <p className={cx('mt-0.5 text-right text-[10px]', m.direction === 'out' ? 'text-primary-fg/70' : 'text-faint')}>{time(m.created_at)}</p>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="flex items-end gap-2 border-t border-line bg-surface p-3">
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ответ клиенту… (Enter — отправить)" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <Button variant="primary" icon={<Send className="size-4" />} onClick={send}>Отправить</Button>
      </div>
    </>
  );
}

function TelegramConnect() {
  const [token, setToken] = useState('');
  const [name, setName] = useState('Telegram-бот');
  const toast = useToast();
  const inv = useInvalidate();
  const connect = async () => {
    if (!/^\d+:[\w-]{30,}$/.test(token.trim())) return toast.error('Токен выглядит неверно. Его выдаёт @BotFather в Telegram, формат 123456:ABC…');
    try {
      await api.post('/api/e/channels', { name, kind: 'telegram', is_active: 1, settings: { bot_token: token.trim() } });
      inv('channels');
      setToken('');
      toast.success(IS_DEMO ? 'Канал добавлен. Сообщения из Telegram принимает серверная версия CRM.' : 'Бот подключён: новые сообщения появятся в течение нескольких секунд');
    } catch (e) { toast.error(e); }
  };
  return (
    <div className="mb-4 rounded-xl border border-line bg-surface-2 p-4">
      <p className="mb-2 text-sm font-bold">Подключить Telegram-бота</p>
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-48 rounded-lg border border-line bg-surface px-3 text-sm" aria-label="Название канала" />
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Токен от @BotFather" className="h-9 min-w-64 flex-1 rounded-lg border border-line bg-surface px-3 font-mono text-sm" aria-label="Токен бота" />
        <Button variant="primary" onClick={connect}>Подключить</Button>
      </div>
    </div>
  );
}
