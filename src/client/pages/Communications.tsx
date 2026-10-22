import { useEffect, useRef, useState } from 'react';
import { NavLink, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Handshake, Inbox, MessageSquarePlus, Send, Settings2, UserCheck, X } from 'lucide-react';
import { api, IS_DEMO } from '../api.ts';
import { relative, time } from '../lib/format.ts';
import { useAuth, useInvalidate, useList, useMeta } from '../lib/state.tsx';
import { Avatar, Badge, Button, EmptyState, IconButton, Modal, Segmented, Textarea, cx, useMediaQuery, useToast } from '../ui/ui.tsx';
import { ChannelsManager } from './comms/Channels.tsx';
import { Calls } from './comms/Telephony.tsx';

export default function Communications() {
  return (
    <div className="-mx-4 -my-5 flex h-[calc(100vh-3.5rem)] flex-col sm:-mx-6 lg:-my-6 max-sm:h-[calc(100vh-3.5rem-4rem)]">
      <nav className="flex shrink-0 gap-1 border-b border-line bg-surface px-3 pt-2" aria-label="Разделы коммуникаций">
        {[{ to: '/communications', label: 'Диалоги', end: true }, { to: '/communications/calls', label: 'Звонки' }].map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('-mb-px border-b-2 px-3 pb-2 text-sm font-semibold', isActive ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg')}>{t.label}</NavLink>
        ))}
      </nav>
      <div className="min-h-0 flex-1">
        <Routes>
          <Route index element={<Dialogs />} />
          <Route path="calls" element={<div className="h-full overflow-y-auto"><Calls /></div>} />
        </Routes>
      </div>
    </div>
  );
}

function Dialogs() {
  const [sp, setSp] = useSearchParams();
  const { field } = useMeta();
  const [status, setStatus] = useState<'active' | 'closed'>('active');
  const [channelsOpen, setChannelsOpen] = useState(false);
  const narrow = useMediaQuery('(max-width: 767px)');
  const toast = useToast();
  const inv = useInvalidate();
  const { data } = useList('conversations', { status__in: status === 'active' ? 'new,open' : 'closed', limit: 200, sort: 'last_message_at', dir: 'desc' });
  const convs = data?.items ?? [];
  const picked = Number(sp.get('c')) || null;
  const active = picked ?? (narrow ? null : convs[0]?.id);
  const conv = convs.find((c: any) => c.id === active);
  const kinds = field('channels', 'kind')?.options ?? [];
  useEffect(() => { const t = setInterval(() => inv('conversations', 'conv_messages'), 10000); return () => clearInterval(t); }, [inv]);
  const simulate = async () => {
    try { const c = await api.post('/api/conversations/simulate'); inv('conversations', 'conv_messages', 'notifications'); setSp({ c: String(c.id) }); toast.info('Пришло новое сообщение от клиента'); }
    catch (e) { toast.error(e); }
  };
  const showList = !narrow || !conv;
  return (
    <div className="flex h-full">
      {showList && (
        <aside className="flex w-full shrink-0 flex-col border-r border-line bg-surface md:max-w-sm">
          <div className="space-y-2 border-b border-line p-3">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-extrabold">Коммуникации</h1>
              <Button size="sm" variant="ghost" icon={<Settings2 className="size-4" />} onClick={() => setChannelsOpen(true)}>Каналы</Button>
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
      )}
      {(!narrow || conv) && (
        <section className="flex min-w-0 flex-1 flex-col">
          {conv ? <Dialog conv={conv} onBack={narrow ? () => setSp({}) : undefined} />
            : <EmptyState icon={<Inbox />} title="Выберите диалог" text="Здесь собираются сообщения клиентов из Telegram, ВКонтакте, Авито, WhatsApp и чата на сайте." />}
        </section>
      )}
      <Modal open={channelsOpen} onClose={() => setChannelsOpen(false)} size="xl" title="Каналы связи"
        subtitle="Сообщения клиентов из мессенджеров и с сайта в одном окне. Все каналы работают на вашем сервере без посредников, кроме WhatsApp (через Green API).">
        <ChannelsManager />
      </Modal>
    </div>
  );
}

function Dialog({ conv, onBack }: { conv: any; onBack?: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const { user } = useAuth();
  const { data } = useList('conv_messages', { conversation_id: conv.id, limit: 500, sort: 'id', dir: 'asc', expand: 0 });
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const msgs = data?.items ?? [];
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, conv.id]);
  useEffect(() => { if (conv.unread) api.patch(`/api/e/conversations/${conv.id}`, { unread: 0 }).then(() => inv('conversations')); }, [conv.id]);
  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const r = await api.post(`/api/conversations/${conv.id}/reply`, { text: text.trim() });
      setText('');
      inv('conv_messages', 'conversations');
      if (r.delivered === false) toast.error(`Сообщение не доставлено: ${r.error}`);
    } catch (e) { toast.error(e); } finally { setSending(false); }
  };
  const toDeal = async () => {
    try { const d = await api.post(`/api/conversations/${conv.id}/deal`); inv('deals', 'conversations'); toast.success('Сделка создана, переписка перенесена в ленту'); nav(`/crm/deals/${d.id}`); }
    catch (e) { toast.error(e); }
  };
  const setStatus = async (status: string) => { await api.patch(`/api/e/conversations/${conv.id}`, { status }); inv('conversations'); };
  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 sm:px-5">
        {onBack && <IconButton label="К списку диалогов" onClick={onBack}><ArrowLeft className="size-4" /></IconButton>}
        <div className="min-w-0 flex-1 max-sm:min-w-[70%]">
          <h2 className="truncate font-bold">{conv.client_name}</h2>
          <p className="truncate text-xs text-muted">{conv._ref?.channel_id?.title}{conv._ref?.assignee_id && ` · оператор: ${conv._ref.assignee_id.title}`}{conv._ref?.contact_id && ` · контакт: ${conv._ref.contact_id.title}`}</p>
        </div>
        {!conv.assignee_id && <Button size="sm" icon={<UserCheck className="size-4" />} onClick={async () => { await api.patch(`/api/e/conversations/${conv.id}`, { assignee_id: user!.id, status: 'open' }); inv('conversations'); }}>Взять себе</Button>}
        {conv.deal_id ? <Button size="sm" onClick={() => nav(`/crm/deals/${conv.deal_id}`)}>Открыть сделку</Button> : <Button size="sm" variant="primary" icon={<Handshake className="size-4" />} onClick={toDeal}>Создать сделку</Button>}
        {conv.status !== 'closed' ? <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => setStatus('closed')}>Закрыть</Button> : <Button size="sm" onClick={() => setStatus('open')}>Вернуть в работу</Button>}
      </header>
      <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4 sm:px-5">
        {msgs.map((m: any) => (
          <div key={m.id} className={cx('flex flex-col', m.direction === 'out' && 'items-end')}>
            <div className={cx('max-w-[85%] rounded-2xl px-3.5 py-2 text-sm sm:max-w-[75%]', m.direction === 'out' ? 'rounded-tr-sm bg-primary text-primary-fg' : 'rounded-tl-sm border border-line bg-surface', m.send_error && 'opacity-70')}>
              <p className="whitespace-pre-line break-words">{m.text}</p>
              <p className={cx('mt-0.5 text-right text-[10px]', m.direction === 'out' ? 'text-primary-fg/70' : 'text-faint')}>{time(m.created_at)}</p>
            </div>
            {m.send_error && <p className="mt-0.5 flex items-center gap-1 text-[11px] text-danger"><AlertTriangle className="size-3" />Не доставлено: {m.send_error}</p>}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="flex items-end gap-2 border-t border-line bg-surface p-3">
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ответ клиенту… (Enter — отправить)" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <Button variant="primary" loading={sending} icon={<Send className="size-4" />} onClick={send}><span className="max-sm:hidden">Отправить</span></Button>
      </div>
    </>
  );
}
