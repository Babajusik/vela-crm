import { useEffect, useRef, useState } from 'react';
import { Hash, Plus, Send } from 'lucide-react';
import { api } from '../api.ts';
import { relative, time } from '../lib/format.ts';
import { useAuth, useInvalidate, useList, useUsers } from '../lib/state.tsx';
import { Avatar, AvatarStack, Button, Card, EmptyState, Input, Textarea, cx, useToast } from '../ui/ui.tsx';
import { RecordForm } from '../ui/fields.tsx';

export default function Messenger() {
  const { user } = useAuth();
  const { byId } = useUsers();
  const chats = useList('chats', { members__has: user!.id, limit: 200, sort: 'last_message_at', dir: 'desc' }).data?.items ?? [];
  const [active, setActive] = useState<number | null>(null);
  const [form, setForm] = useState<any>(null);
  const [q, setQ] = useState('');
  const chatId = active ?? chats[0]?.id;
  const chat = chats.find((c: any) => c.id === chatId);
  const shown = chats.filter((c: any) => c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="-mx-4 -my-5 flex h-[calc(100vh-3.5rem)] sm:-mx-6 lg:-my-6">
      <aside className="flex w-full max-w-xs shrink-0 flex-col border-r border-line bg-surface max-md:hidden">
        <div className="flex items-center gap-2 border-b border-line p-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск чата" />
          <Button variant="primary" icon={<Plus className="size-4" />} aria-label="Новый чат" onClick={() => setForm({ kind: 'group', members: [user!.id] })} />
        </div>
        <ul className="flex-1 overflow-y-auto p-1.5">
          {shown.map((c: any) => (
            <li key={c.id}>
              <button type="button" onClick={() => setActive(c.id)} className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left', c.id === chatId ? 'bg-primary-soft' : 'hover:bg-surface-2')}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted"><Hash className="size-4" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{c.name}</span><span className="text-xs text-faint">{relative(c.last_message_at)}</span></span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {chat ? <ChatView chat={chat} byId={byId} /> : <EmptyState title="Чатов пока нет" text="Создайте чат для отдела или проекта." action={<Button variant="primary" onClick={() => setForm({ kind: 'group', members: [user!.id] })}>Новый чат</Button>} />}
      </section>
      <RecordForm entity="chats" open={!!form} onClose={() => setForm(null)} initial={form} fields={['name', 'members', 'project_id']} onSaved={(r) => setActive(r.id)} title="Новый чат" size="md" />
    </div>
  );
}

function ChatView({ chat, byId }: { chat: any; byId: Map<number, any> }) {
  const { user } = useAuth();
  const toast = useToast();
  const inv = useInvalidate();
  const { data } = useList('messages', { chat_id: chat.id, limit: 300, sort: 'id', dir: 'asc', expand: 0 });
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const msgs = data?.items ?? [];
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, chat.id]);
  useEffect(() => { const t = setInterval(() => inv('messages'), 8000); return () => clearInterval(t); }, [inv]);
  const send = async () => {
    if (!text.trim()) return;
    try {
      await api.post('/api/e/messages', { chat_id: chat.id, user_id: user!.id, text: text.trim() });
      setText('');
      inv('messages', 'chats');
    } catch (e) { toast.error(e); }
  };
  return (
    <>
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
        <div className="min-w-0"><h2 className="truncate font-bold">{chat.name}</h2><p className="text-xs text-muted">{(chat.members ?? []).length} участников</p></div>
        <AvatarStack users={chat._ref?.members ?? []} max={5} />
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {msgs.map((m: any, i: number) => {
          const u = byId.get(m.user_id);
          const mine = m.user_id === user!.id;
          const sameAsPrev = msgs[i - 1]?.user_id === m.user_id;
          return (
            <div key={m.id} className={cx('flex gap-2.5', mine && 'flex-row-reverse')}>
              <div className="w-8 shrink-0">{!sameAsPrev && <Avatar name={u?.name} color={u?.color} size={32} />}</div>
              <div className={cx('max-w-[75%]', mine && 'text-right')}>
                {!sameAsPrev && <p className="mb-0.5 text-xs text-muted"><span className="font-semibold text-fg">{mine ? 'Вы' : u?.name}</span> · {time(m.created_at)}</p>}
                <p className={cx('inline-block whitespace-pre-line rounded-2xl px-3.5 py-2 text-left text-sm', mine ? 'rounded-tr-sm bg-primary text-primary-fg' : 'rounded-tl-sm border border-line bg-surface')}>{m.text}</p>
              </div>
            </div>
          );
        })}
        {!msgs.length && <p className="py-10 text-center text-sm text-faint">Сообщений пока нет — напишите первым</p>}
        <div ref={end} />
      </div>
      <Card className="m-3 rounded-2xl" padded={false}>
        <div className="flex items-end gap-2 p-2">
          <Textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Сообщение… (Enter — отправить, Shift+Enter — новая строка)" className="max-h-40 border-0 focus:ring-0"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <Button variant="primary" icon={<Send className="size-4" />} onClick={send} aria-label="Отправить" />
        </div>
      </Card>
    </>
  );
}
