import { useState } from 'react';
import { Archive, Inbox, PenSquare, Reply, Send, Star, Trash2 } from 'lucide-react';
import { api, IS_DEMO } from '../api.ts';
import { dateTime, relative } from '../lib/format.ts';
import { useInvalidate, useList } from '../lib/state.tsx';
import { Avatar, Button, Card, EmptyState, FormRow, IconButton, Input, Modal, PageHeader, Textarea, cx, useToast } from '../ui/ui.tsx';
import { RefSelect } from '../ui/fields.tsx';

const FOLDERS = [{ v: 'inbox', l: 'Входящие', i: <Inbox className="size-4" /> }, { v: 'sent', l: 'Отправленные', i: <Send className="size-4" /> },
  { v: 'drafts', l: 'Черновики', i: <PenSquare className="size-4" /> }, { v: 'spam', l: 'Спам', i: <Archive className="size-4" /> }, { v: 'trash', l: 'Корзина', i: <Trash2 className="size-4" /> }];

export default function Mail() {
  const [folder, setFolder] = useState('inbox');
  const [sel, setSel] = useState<number | null>(null);
  const [compose, setCompose] = useState<any>(null);
  const inv = useInvalidate();
  const { data } = useList('mails', { folder, limit: 200, sort: 'date', dir: 'desc' });
  const unread = useList('mails', { folder: 'inbox', is_read: 0, limit: 1, expand: 0 }).data?.total ?? 0;
  const mails = data?.items ?? [];
  const m = mails.find((x: any) => x.id === sel) ?? null;
  const open = async (x: any) => {
    setSel(x.id);
    if (!x.is_read) { await api.patch(`/api/e/mails/${x.id}`, { is_read: 1 }); inv('mails'); }
  };
  const move = async (x: any, to: string) => { await api.patch(`/api/e/mails/${x.id}`, { folder: to }); inv('mails'); setSel(null); };
  return (
    <div>
      <PageHeader title="Почта" subtitle={IS_DEMO ? 'В демо письма не уходят наружу. На своём сервере подключите ящик по IMAP/SMTP.' : 'Корпоративная почта, связанная с клиентами и сделками'}
        actions={<Button variant="primary" icon={<PenSquare className="size-4" />} onClick={() => setCompose({})}>Написать</Button>} />
      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,380px)_1fr]">
        <nav className="space-y-0.5">
          {FOLDERS.map((f) => (
            <button key={f.v} type="button" onClick={() => { setFolder(f.v); setSel(null); }}
              className={cx('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold', folder === f.v ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
              {f.i}<span className="flex-1 text-left">{f.l}</span>{f.v === 'inbox' && unread > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] text-white">{unread}</span>}
            </button>
          ))}
        </nav>
        <Card padded={false} className="max-h-[calc(100vh-200px)] overflow-y-auto">
          <ul className="divide-y divide-line">
            {mails.map((x: any) => (
              <li key={x.id}>
                <button type="button" onClick={() => open(x)} className={cx('block w-full px-4 py-3 text-left', sel === x.id ? 'bg-primary-soft' : 'hover:bg-surface-2')}>
                  <div className="flex items-center gap-2">
                    {!x.is_read && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                    <span className={cx('truncate text-sm', !x.is_read ? 'font-bold' : 'font-semibold')}>{folder === 'sent' ? x.to_addr : x.from_name || x.from_addr}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-faint">{relative(x.date)}</span>
                  </div>
                  <p className={cx('truncate text-sm', !x.is_read ? 'font-semibold' : 'text-fg')}>{x.subject}</p>
                  <p className="truncate text-xs text-muted">{String(x.body ?? '').slice(0, 120)}</p>
                </button>
              </li>
            ))}
            {!mails.length && <li className="px-4 py-12 text-center text-sm text-faint">Писем нет</li>}
          </ul>
        </Card>
        <Card className="min-h-96">
          {m ? (
            <div>
              <div className="flex items-start gap-3 border-b border-line pb-4">
                <Avatar name={m.from_name || m.from_addr} size={40} color="#6366F1" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold">{m.subject}</h2>
                  <p className="text-sm text-muted">{m.from_name} &lt;{m.from_addr}&gt; → {m.to_addr}</p>
                  <p className="text-xs text-faint">{dateTime(m.date)}{m._ref?.company_id && <> · компания: <b>{m._ref.company_id.title}</b></>}</p>
                </div>
                <div className="flex gap-1">
                  <IconButton label="Важное" onClick={async () => { await api.patch(`/api/e/mails/${m.id}`, { is_starred: m.is_starred ? 0 : 1 }); inv('mails'); }}><Star className={cx('size-4', m.is_starred && 'fill-warning text-warning')} /></IconButton>
                  <IconButton label="В корзину" onClick={() => move(m, 'trash')}><Trash2 className="size-4" /></IconButton>
                </div>
              </div>
              <p className="whitespace-pre-line py-4 text-sm leading-relaxed">{m.body}</p>
              <Button icon={<Reply className="size-4" />} onClick={() => setCompose({ to: m.from_addr, subject: m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`, company_id: m.company_id, body: `\n\n— ${dateTime(m.date)}, ${m.from_name}:\n> ${String(m.body ?? '').split('\n').join('\n> ')}` })}>Ответить</Button>
            </div>
          ) : <EmptyState title="Выберите письмо" text="Письма можно привязывать к компаниям и сделкам — они попадут в их ленту." />}
        </Card>
      </div>
      {compose && <Compose initial={compose} onClose={() => setCompose(null)} />}
    </div>
  );
}

function Compose({ initial, onClose }: { initial: any; onClose: () => void }) {
  const [f, setF] = useState<any>({ to: '', subject: '', body: '', ...initial });
  const toast = useToast();
  const inv = useInvalidate();
  const send = async () => {
    try { await api.post('/api/mail/send', f); toast.success(IS_DEMO ? 'Письмо сохранено в «Отправленных» (в демо наружу не уходит)' : 'Письмо отправлено'); inv('mails', 'timeline'); onClose(); }
    catch (e) { toast.error(e); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Новое письмо" footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" icon={<Send className="size-4" />} onClick={send}>Отправить</Button></>}>
      <div className="space-y-3">
        <FormRow label="Кому"><Input type="email" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} placeholder="client@company.ru" /></FormRow>
        <FormRow label="Тема"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></FormRow>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormRow label="Компания"><RefSelect entity="companies" value={f.company_id} onChange={(v) => setF({ ...f, company_id: v })} /></FormRow>
          <FormRow label="Сделка"><RefSelect entity="deals" value={f.deal_id} onChange={(v) => setF({ ...f, deal_id: v })} /></FormRow>
        </div>
        <FormRow label="Текст"><Textarea rows={10} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></FormRow>
      </div>
    </Modal>
  );
}
