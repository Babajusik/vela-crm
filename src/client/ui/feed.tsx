// Activity feed for record cards: comments with likes and replies, calls, meetings, scheduled CRM activities
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Check, Heart, Mail, MessageSquare, Phone, Reply, Users as UsersIcon, Zap } from 'lucide-react';
import { api } from '../api.ts';
import { dateTime, deadlineInfo, nowLocalDateTime, relative } from '../lib/format.ts';
import { useApi, useAuth, useInvalidate, useList } from '../lib/state.tsx';
import { Avatar, Badge, Button, Input, Loading, Segmented, Select, Textarea, cx, useToast } from './ui.tsx';

const KIND_ICON: Record<string, JSX.Element> = {
  comment: <MessageSquare className="size-3.5" />, call: <Phone className="size-3.5" />, meeting: <UsersIcon className="size-3.5" />, email: <Mail className="size-3.5" />,
  system: <Zap className="size-3.5" />, stage: <Zap className="size-3.5" />,
};
const KIND_LABEL: Record<string, string> = { comment: 'Комментарий', call: 'Звонок', meeting: 'Встреча', email: 'Письмо', system: 'Событие', stage: 'Стадия' };
const ACT_KINDS = [{ value: 'call', label: 'Звонок' }, { value: 'meeting', label: 'Встреча' }, { value: 'task', label: 'Задача' }, { value: 'email', label: 'Письмо' }, { value: 'letter', label: 'Отправить документы' }];

type Mode = 'comment' | 'call' | 'meeting' | 'plan';

export interface ScheduleLink { deal_id?: number; company_id?: number; contact_id?: number }

export function Feed({ entity, id, schedule }: { entity: string; id: number; schedule?: ScheduleLink }) {
  const { user } = useAuth();
  const { data, refetch, isLoading } = useApi<any[]>(['timeline', entity, id], `/api/e/${entity}/${id}/timeline`);
  const acts = useList('crm_activities', { ...(schedule ?? {}), is_done: 0, limit: 50, sort: 'due_at', dir: 'asc' }, { enabled: !!schedule });
  const inv = useInvalidate();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('comment');
  const [text, setText] = useState('');
  const [kind, setKind] = useState('call');
  const [due, setDue] = useState(nowLocalDateTime(24).slice(0, 11) + '11:00');
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [reply, setReply] = useState('');
  const [filter, setFilter] = useState<'all' | 'comments' | 'system'>('all');

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      if (mode === 'plan') {
        await api.post('/api/e/crm_activities', { kind, subject: text.trim(), due_at: due, responsible_id: user!.id, ...(schedule ?? {}) });
        inv('crm_activities');
        toast.success('Дело запланировано');
      } else {
        await api.post(`/api/e/${entity}/${id}/comment`, { text, kind: mode });
      }
      setText('');
      refetch();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const sendReply = async (parent: number) => {
    if (!reply.trim()) return;
    try { await api.post(`/api/e/${entity}/${id}/comment`, { text: reply, parent_id: parent }); setReply(''); setReplyTo(null); refetch(); }
    catch (e) { toast.error(e); }
  };
  const like = async (aid: number) => { await api.post(`/api/activities/${aid}/like`); refetch(); };
  const done = async (a: any) => {
    const result = prompt('Результат (можно оставить пустым)', '') ?? '';
    await api.patch(`/api/e/crm_activities/${a.id}`, { is_done: 1, result });
    inv('crm_activities');
    refetch();
  };

  const all = data ?? [];
  const roots = all.filter((a) => !a.parent_id).filter((a) => filter === 'all' || (filter === 'comments' ? ['comment', 'call', 'meeting', 'email'].includes(a.kind) : ['system', 'stage'].includes(a.kind)));
  const replies = (pid: number) => all.filter((a) => a.parent_id === pid).reverse();
  const open = acts.data?.items ?? [];
  const now = new Date().toISOString().slice(0, 16);
  const overdue = open.filter((a: any) => a.due_at < now);
  const upcoming = open.filter((a: any) => a.due_at >= now);

  const ActRow = ({ a, late }: { a: any; late?: boolean }) => (
    <div className={cx('flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm', late ? 'border-danger/30 bg-danger-soft' : 'border-line bg-surface')}>
      <button type="button" aria-label="Отметить выполненным" onClick={() => done(a)} className="flex size-5 shrink-0 items-center justify-center rounded-md border-2 border-line-strong hover:border-success hover:bg-success hover:text-white"><Check className="size-3" /></button>
      <Avatar name={a._ref?.responsible_id?.title} color={a._ref?.responsible_id?.color} size={24} />
      <span className="min-w-0 flex-1"><span className="font-semibold">{ACT_KINDS.find((k) => k.value === a.kind)?.label}:</span> {a.subject}</span>
      <span className={cx('shrink-0 text-xs font-semibold', late ? 'text-danger' : 'text-muted')}>{deadlineInfo(a.due_at).text.replace('Просрочено: ', '')}</span>
    </div>
  );

  return (
    <div>
      <div className="rounded-2xl border border-line bg-surface p-3">
        <div className="flex gap-2.5">
          <Avatar name={user?.name} color={user?.color} size={32} />
          <div className="min-w-0 flex-1">
            <Segmented value={mode} onChange={setMode} options={[
              { value: 'comment', label: 'Комментарий' }, { value: 'call', label: 'Звонок' }, { value: 'meeting', label: 'Встреча' },
              ...(schedule ? [{ value: 'plan' as Mode, label: 'Запланировать', icon: <CalendarClock className="size-3.5" /> }] : []),
            ]} />
            <Textarea className="mt-2" rows={2} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={mode === 'plan' ? 'Что нужно сделать: позвонить, встретиться, отправить договор…' : mode === 'call' ? 'Итоги звонка…' : mode === 'meeting' ? 'Итоги встречи…' : 'Комментировать… @Имя Фамилия — упомянуть коллегу'}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }} />
            {mode === 'plan' && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto">{ACT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select>
                <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="w-auto" />
              </div>
            )}
            <div className="mt-2 flex items-center justify-between">
              <span className="hidden text-xs text-faint sm:inline">Ctrl + Enter — отправить</span>
              <Button size="sm" variant="primary" loading={busy} onClick={send} disabled={!text.trim()}>{mode === 'plan' ? 'Запланировать' : 'Отправить'}</Button>
            </div>
          </div>
        </div>
      </div>

      {schedule && (overdue.length > 0 || upcoming.length > 0) && (
        <div className="mt-4 space-y-2">
          {overdue.length > 0 && <p className="text-center"><Badge color="#dc3b3b">Просроченные дела</Badge></p>}
          {overdue.map((a: any) => <ActRow key={a.id} a={a} late />)}
          {upcoming.length > 0 && <p className="text-center"><Badge color="#0b8a7a">Запланировано</Badge></p>}
          {upcoming.map((a: any) => <ActRow key={a.id} a={a} />)}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Всё' }, { value: 'comments', label: 'Общение' }, { value: 'system', label: 'История' }]} />
      </div>

      {isLoading ? <Loading /> : (
        <ol className="mt-3 space-y-3">
          {roots.map((a) => {
            const isSystem = a.kind === 'system' || a.kind === 'stage';
            const liked = (a.likes ?? []).includes(user!.id);
            return (
              <li key={a.id} className={cx(isSystem ? 'flex items-start gap-2.5 px-1 text-sm text-muted' : 'rounded-2xl border border-line bg-surface p-3.5')}>
                {isSystem ? (
                  <>
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-faint">{KIND_ICON[a.kind]}</span>
                    <span className="min-w-0 flex-1 whitespace-pre-line">{a.text}<span className="ml-2 text-xs text-faint">{a.user_name ? `${a.user_name} · ` : ''}{relative(a.created_at)}</span></span>
                  </>
                ) : (
                  <>
                    <div className="flex items-start gap-2.5">
                      <Avatar name={a.user_name} color={a.user_color} size={30} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm"><span className="font-semibold">{a.user_name ?? 'Система'}</span> <span className="text-xs text-faint">{dateTime(a.created_at)}</span>
                          {a.kind !== 'comment' && <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-primary">{KIND_ICON[a.kind]}{KIND_LABEL[a.kind]}</span>}</p>
                        <p className="mt-1 whitespace-pre-line text-sm">{a.text}</p>
                        {a.meta?.record_url && <audio controls preload="none" src={a.meta.record_url} className="mt-2 h-9 w-full max-w-sm" aria-label="Запись разговора" />}
                        {a.meta?.mail_id && <Link to={`/mail?m=${a.meta.mail_id}`} className="mt-1 inline-block text-xs font-semibold text-primary hover:underline">Открыть письмо</Link>}
                        <div className="mt-2 flex items-center gap-2">
                          <button type="button" onClick={() => like(a.id)} className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold', liked ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-muted hover:text-fg')}>
                            <Heart className={cx('size-3.5', liked && 'fill-current')} />{(a.likes ?? []).length || ''}
                          </button>
                          <button type="button" onClick={() => { setReplyTo(replyTo === a.id ? null : a.id); setReply(''); }} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold text-muted hover:text-fg"><Reply className="size-3.5" />Ответить</button>
                        </div>
                      </div>
                    </div>
                    {(replies(a.id).length > 0 || replyTo === a.id) && (
                      <div className="ml-10 mt-3 space-y-2.5 border-l-2 border-line pl-3">
                        {replies(a.id).map((r) => (
                          <div key={r.id} className="flex gap-2"><Avatar name={r.user_name} color={r.user_color} size={22} />
                            <div className="min-w-0 text-sm"><span className="font-semibold">{r.user_name}</span> <span className="text-xs text-faint">{relative(r.created_at)}</span><p className="whitespace-pre-line">{r.text}</p></div>
                          </div>
                        ))}
                        {replyTo === a.id && (
                          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); sendReply(a.id); }}>
                            <Input autoFocus value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Ваш ответ" /><Button type="submit" size="sm" variant="primary">Ответить</Button>
                          </form>
                        )}
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
          {!roots.length && <li className="py-6 text-center text-sm text-faint">Событий пока нет</li>}
        </ol>
      )}
    </div>
  );
}
