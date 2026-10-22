import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Archive, ArrowLeft, Inbox, Paperclip, PenSquare, Reply, Send, Settings2, Star, Trash2, X } from 'lucide-react';
import { api, downloadFile, IS_DEMO, uploadFile } from '../api.ts';
import { dateTime, relative } from '../lib/format.ts';
import { useApi, useInvalidate, useList } from '../lib/state.tsx';
import { Avatar, Button, Card, EmptyState, FormRow, IconButton, Input, Modal, PageHeader, Select, Textarea, cx, useMediaQuery, useToast } from '../ui/ui.tsx';
import { RefSelect } from '../ui/fields.tsx';
import { MailboxesManager } from './comms/Mailboxes.tsx';

const FOLDERS = [{ v: 'inbox', l: 'Входящие', i: <Inbox className="size-4" /> }, { v: 'sent', l: 'Отправленные', i: <Send className="size-4" /> },
  { v: 'drafts', l: 'Черновики', i: <PenSquare className="size-4" /> }, { v: 'spam', l: 'Спам', i: <Archive className="size-4" /> }, { v: 'trash', l: 'Корзина', i: <Trash2 className="size-4" /> }];

export default function Mail() {
  const [sp, setSp] = useSearchParams();
  const [folder, setFolder] = useState('inbox');
  const [compose, setCompose] = useState<any>(null);
  const [boxesOpen, setBoxesOpen] = useState(false);
  const narrow = useMediaQuery('(max-width: 1023px)');
  const inv = useInvalidate();
  const sel = Number(sp.get('m')) || null;
  const setSel = (id: number | null) => setSp(id ? { m: String(id) } : {}, { replace: !id });
  const { data } = useList('mails', { folder, limit: 200, sort: 'date', dir: 'desc' });
  const unread = useList('mails', { folder: 'inbox', is_read: 0, limit: 1, expand: 0 }).data?.total ?? 0;
  const drafts = useList('mails', { folder: 'drafts', limit: 1, expand: 0 }).data?.total ?? 0;
  const boxes = useApi<any[]>(['mailboxes', 'mine'], '/api/mail/mailboxes').data ?? [];
  const opened = useApi<any>(['mails', 'one', sel], `/api/e/mails/${sel}`, undefined, { enabled: !!sel }).data;
  const mails = data?.items ?? [];
  const m = sel ? mails.find((x: any) => x.id === sel) ?? (opened?.id === sel ? opened : null) : null;
  // new letters are fetched by the server every 2 minutes
  useEffect(() => { const t = setInterval(() => inv('mails'), 60000); return () => clearInterval(t); }, [inv]);
  // a link from a notification opens the letter in its folder
  useEffect(() => { if (opened?.folder && opened.folder !== folder && !mails.some((x: any) => x.id === opened.id)) setFolder(opened.folder); }, [opened?.id]);
  useEffect(() => {
    if (m && !m.is_read) api.patch(`/api/e/mails/${m.id}`, { is_read: 1 }).then(() => inv('mails'));
  }, [m?.id]);
  const move = async (x: any, to: string) => { await api.patch(`/api/e/mails/${x.id}`, { folder: to }); inv('mails'); setSel(null); };
  const noBoxes = !boxes.length;
  const showList = !narrow || !m;
  const showView = !narrow || !!m;
  return (
    <div>
      <PageHeader title="Почта"
        subtitle={IS_DEMO ? 'В демо письма не уходят наружу. На своём сервере подключите ящик — письма будут приходить и уходить по-настоящему.' : 'Письма клиентов сами привязываются к компаниям, контактам и сделкам'}
        actions={<>
          <Button icon={<Settings2 className="size-4" />} onClick={() => setBoxesOpen(true)}>Ящики</Button>
          <Button variant="primary" icon={<PenSquare className="size-4" />} onClick={() => setCompose({})}>Написать</Button>
        </>} />
      {noBoxes && !IS_DEMO && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary-soft px-4 py-3 text-sm">
          <span className="flex-1">Подключите рабочий ящик — письма клиентов будут попадать в CRM и в карточки сделок.</span>
          <Button size="sm" variant="primary" onClick={() => setBoxesOpen(true)}>Подключить ящик</Button>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,380px)_1fr]">
        {showList && (
          <nav className="flex gap-1 overflow-x-auto lg:block lg:space-y-0.5">
            {FOLDERS.map((f) => (
              <button key={f.v} type="button" onClick={() => { setFolder(f.v); setSel(null); }}
                className={cx('flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold lg:w-full', folder === f.v ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                {f.i}<span className="flex-1 text-left">{f.l}</span>
                {f.v === 'inbox' && unread > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] text-white">{unread}</span>}
                {f.v === 'drafts' && drafts > 0 && <span className="rounded-full bg-surface-2 px-1.5 text-[11px] text-muted">{drafts}</span>}
              </button>
            ))}
          </nav>
        )}
        {showList && (
          <Card padded={false} className="max-h-[calc(100vh-200px)] overflow-y-auto">
            <ul className="divide-y divide-line">
              {mails.map((x: any) => (
                <li key={x.id}>
                  <button type="button" onClick={() => setSel(x.id)} className={cx('block w-full px-4 py-3 text-left', sel === x.id ? 'bg-primary-soft' : 'hover:bg-surface-2')}>
                    <div className="flex items-center gap-2">
                      {!x.is_read && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                      <span className={cx('truncate text-sm', !x.is_read ? 'font-bold' : 'font-semibold')}>{folder === 'sent' || folder === 'drafts' ? x.to_addr : x.from_name || x.from_addr}</span>
                      {x.attachments > 0 && <Paperclip className="size-3.5 shrink-0 text-faint" aria-label="Есть вложения" />}
                      <span className="ml-auto shrink-0 text-[11px] text-faint">{relative(x.date)}</span>
                    </div>
                    <p className={cx('truncate text-sm', !x.is_read ? 'font-semibold' : 'text-fg')}>{x.subject}</p>
                    {x.send_error ? <p className="truncate text-xs text-danger">Не отправлено: {x.send_error}</p> : <p className="truncate text-xs text-muted">{String(x.body ?? '').slice(0, 120)}</p>}
                  </button>
                </li>
              ))}
              {!mails.length && <li className="px-4 py-12 text-center text-sm text-faint">Писем нет</li>}
            </ul>
          </Card>
        )}
        {showView && (
          <Card className="min-h-96">
            {m ? <Letter m={m} onBack={narrow ? () => setSel(null) : undefined} onMove={move} onCompose={setCompose} />
              : <EmptyState title="Выберите письмо" text="Письма клиентов автоматически попадают в ленту их компании и открытой сделки." />}
          </Card>
        )}
      </div>
      {compose && <Compose initial={compose} boxes={boxes} onClose={() => setCompose(null)} />}
      <Modal open={boxesOpen} onClose={() => setBoxesOpen(false)} size="xl" title="Почтовые ящики" subtitle="Подключение по IMAP и SMTP: Яндекс, Mail.ru, Gmail, хостинг или свой сервер">
        <MailboxesManager />
      </Modal>
    </div>
  );
}

function Letter({ m, onBack, onMove, onCompose }: { m: any; onBack?: () => void; onMove: (m: any, to: string) => void; onCompose: (c: any) => void }) {
  const inv = useInvalidate();
  const toast = useToast();
  const files = useList('files', { entity_type: 'mails', entity_id: m.id, limit: 50, expand: 0 }, { enabled: m.attachments > 0 }).data?.items ?? [];
  const reply = () => onCompose({
    to: m.folder === 'sent' ? m.to_addr : m.from_addr, subject: /^re:/i.test(m.subject ?? '') ? m.subject : `Re: ${m.subject}`,
    company_id: m.company_id, contact_id: m.contact_id, deal_id: m.deal_id, mailbox_id: m.mailbox_id, in_reply_to: m.message_id,
    body: `\n\n— ${dateTime(m.date)}, ${m.from_name || m.from_addr}:\n> ${String(m.body ?? '').split('\n').join('\n> ')}`,
  });
  return (
    <div>
      <div className="flex items-start gap-3 border-b border-line pb-4">
        {onBack && <IconButton label="К списку писем" onClick={onBack}><ArrowLeft className="size-4" /></IconButton>}
        <Avatar name={m.from_name || m.from_addr} size={40} color="#6366F1" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">{m.subject}</h2>
          <p className="break-words text-sm text-muted">{m.from_name} &lt;{m.from_addr}&gt; → {m.to_addr}{m.cc ? `, копия: ${m.cc}` : ''}</p>
          <p className="text-xs text-faint">{dateTime(m.date)}
            {m._ref?.company_id && <> · <Link className="text-primary hover:underline" to={`/crm/companies/${m.company_id}`}>{m._ref.company_id.title}</Link></>}
            {m._ref?.deal_id && <> · сделка <Link className="text-primary hover:underline" to={`/crm/deals/${m.deal_id}`}>{m._ref.deal_id.title}</Link></>}
          </p>
        </div>
        <div className="flex gap-1">
          <IconButton label="Важное" onClick={async () => { await api.patch(`/api/e/mails/${m.id}`, { is_starred: m.is_starred ? 0 : 1 }); inv('mails'); }}><Star className={cx('size-4', m.is_starred && 'fill-warning text-warning')} /></IconButton>
          {m.folder !== 'spam' && m.folder === 'inbox' && <IconButton label="В спам" onClick={() => onMove(m, 'spam')}><Archive className="size-4" /></IconButton>}
          <IconButton label="В корзину" onClick={() => onMove(m, 'trash')}><Trash2 className="size-4" /></IconButton>
        </div>
      </div>
      {m.send_error && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-danger" /><span className="flex-1">Письмо не отправлено: {m.send_error}</span>
          <Button size="sm" variant="primary" onClick={() => onCompose({ to: m.to_addr, cc: m.cc, subject: m.subject, body: m.body, mailbox_id: m.mailbox_id, company_id: m.company_id, deal_id: m.deal_id, in_reply_to: m.in_reply_to, draft_id: m.id })}>Исправить и отправить</Button>
        </div>
      )}
      <p className="whitespace-pre-line break-words py-4 text-sm leading-relaxed">{m.body}</p>
      {files.length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-2">
          {files.map((f: any) => (
            <li key={f.id}>
              <button type="button" onClick={() => downloadFile(f).catch((e) => toast.error(e))} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-primary">
                <Paperclip className="size-4 text-faint" />{f.name}{f.size ? <span className="text-xs text-faint">{Math.max(1, Math.round(f.size / 1024))} КБ</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {m.folder !== 'drafts' && <Button icon={<Reply className="size-4" />} onClick={reply}>Ответить</Button>}
    </div>
  );
}

function Compose({ initial, boxes, onClose }: { initial: any; boxes: any[]; onClose: () => void }) {
  const [f, setF] = useState<any>({ to: '', subject: '', body: '', mailbox_id: boxes.find((b) => b.user_id)?.id ?? boxes[0]?.id, ...initial });
  const [files, setFiles] = useState<any[]>([]);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const inv = useInvalidate();
  const attach = async (list: FileList | null) => {
    for (const file of Array.from(list ?? [])) {
      try { const r = await uploadFile(file, { entity_type: 'mail_upload' }); setFiles((x) => [...x, r]); } catch (e) { toast.error(e); }
    }
  };
  const send = async () => {
    setSending(true);
    try {
      const { draft_id, ...body } = f;
      const r = await api.post('/api/mail/send', { ...body, file_ids: files.map((x) => x.id) });
      if (draft_id) await api.del(`/api/e/mails/${draft_id}`).catch(() => {});
      toast.success(r.delivered ? 'Письмо отправлено' : IS_DEMO ? 'Письмо сохранено в «Отправленных» (в демо наружу не уходит)' : 'Письмо сохранено: у ящика не настроен SMTP');
      inv('mails', 'timeline');
      onClose();
    } catch (e) { toast.error(e); inv('mails'); } finally { setSending(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Новое письмо"
      footer={<>
        <Button className="mr-auto" icon={<Paperclip className="size-4" />} onClick={() => input.current?.click()}>Вложить файл</Button>
        <Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={sending} icon={<Send className="size-4" />} onClick={send}>Отправить</Button>
      </>}>
      <div className="space-y-3">
        {boxes.length > 1 && (
          <FormRow label="От кого">
            <Select value={f.mailbox_id ?? ''} onChange={(e) => setF({ ...f, mailbox_id: Number(e.target.value) })}>
              {boxes.map((b) => <option key={b.id} value={b.id}>{b.name ? `${b.name} <${b.email}>` : b.email}</option>)}
            </Select>
          </FormRow>
        )}
        <FormRow label="Кому"><Input type="email" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} placeholder="client@company.ru" /></FormRow>
        <FormRow label="Тема"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></FormRow>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormRow label="Компания"><RefSelect entity="companies" value={f.company_id} onChange={(v) => setF({ ...f, company_id: v })} /></FormRow>
          <FormRow label="Сделка"><RefSelect entity="deals" value={f.deal_id} onChange={(v) => setF({ ...f, deal_id: v })} /></FormRow>
        </div>
        <FormRow label="Текст"><Textarea rows={10} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></FormRow>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => { attach(e.target.files); e.target.value = ''; }} />
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {files.map((x) => (
              <li key={x.id} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-sm">
                <Paperclip className="size-3.5 text-faint" />{x.name}
                <button type="button" aria-label={`Убрать ${x.name}`} onClick={() => setFiles((l) => l.filter((y) => y.id !== x.id))} className="text-faint hover:text-danger"><X className="size-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
