// Mailbox connections: ready settings for popular providers, login check, receiving now.
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Pencil, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, IS_DEMO } from '../../api.ts';
import { relative } from '../../lib/format.ts';
import { useApi, useAuth, useInvalidate } from '../../lib/state.tsx';
import { Badge, Button, FormRow, Input, Modal, Select, Switch, useToast } from '../../ui/ui.tsx';
import { UserSelect } from '../../ui/fields.tsx';

const PRESETS: { id: string; label: string; imap: string; smtp: string; smtpPort: number; hint?: string }[] = [
  { id: 'yandex', label: 'Яндекс Почта / Яндекс 360', imap: 'imap.yandex.ru', smtp: 'smtp.yandex.ru', smtpPort: 465, hint: 'Нужен пароль приложения: id.yandex.ru → Безопасность → Пароли приложений → Почта. В настройках почты включите доступ по IMAP.' },
  { id: 'mailru', label: 'Mail.ru / VK WorkMail', imap: 'imap.mail.ru', smtp: 'smtp.mail.ru', smtpPort: 465, hint: 'Нужен пароль для внешнего приложения: Настройки → Безопасность → Пароли для внешних приложений.' },
  { id: 'gmail', label: 'Gmail / Google Workspace', imap: 'imap.gmail.com', smtp: 'smtp.gmail.com', smtpPort: 465, hint: 'Включите двухэтапную проверку и создайте пароль приложения в аккаунте Google.' },
  { id: 'beget', label: 'Beget', imap: 'imap.beget.com', smtp: 'smtp.beget.com', smtpPort: 465 },
  { id: 'timeweb', label: 'Timeweb', imap: 'imap.timeweb.ru', smtp: 'smtp.timeweb.ru', smtpPort: 465 },
  { id: 'reg', label: 'REG.RU', imap: 'mail.hosting.reg.ru', smtp: 'mail.hosting.reg.ru', smtpPort: 465 },
  { id: 'custom', label: 'Свой почтовый сервер', imap: '', smtp: '', smtpPort: 465 },
];

function guessPreset(email: string) {
  const d = email.split('@')[1]?.toLowerCase() ?? '';
  if (/^(yandex\.|ya\.ru)/.test(d)) return 'yandex';
  if (/^(mail\.ru|inbox\.ru|list\.ru|bk\.ru|internet\.ru)$/.test(d)) return 'mailru';
  if (d === 'gmail.com') return 'gmail';
  return '';
}

export function MailboxesManager() {
  const { data } = useApi<any[]>(['mailboxes', 'mine'], '/api/mail/mailboxes');
  const [edit, setEdit] = useState<any>(null);
  const toast = useToast();
  const inv = useInvalidate();
  const [busy, setBusy] = useState<number | null>(null);
  const sync = async (id: number) => {
    setBusy(id);
    try { const r = await api.post(`/api/mail/mailboxes/${id}/sync`); toast.success(r.count ? `Новых писем: ${r.count}` : 'Новых писем нет'); }
    catch (e) { toast.error(e); } finally { setBusy(null); inv('mails', 'mailboxes'); }
  };
  return (
    <div className="space-y-4">
      <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({})}>Подключить ящик</Button>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {(data ?? []).map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{b.email}{b.name && <span className="font-normal text-muted"> · {b.name}</span>}</p>
              {b.sync_error
                ? <p className="flex items-center gap-1 text-xs text-danger"><AlertTriangle className="size-3.5 shrink-0" />{b.sync_error}</p>
                : b.last_sync_at ? <p className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="size-3.5" />Проверено {relative(b.last_sync_at)}</p>
                  : <p className="text-xs text-faint">{b.has_password ? 'Ещё не проверялся' : 'Пароль не указан'}</p>}
            </div>
            <Badge color={b.user_id ? '#6366F1' : '#0FA596'}>{b.user_id ? 'Личный' : 'Общий'}</Badge>
            {!IS_DEMO && b.has_password && <Button size="sm" variant="ghost" loading={busy === b.id} icon={<RefreshCw className="size-4" />} onClick={() => sync(b.id)}>Получить</Button>}
            <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit(b)}>Настроить</Button>
          </li>
        ))}
        {!data?.length && <li className="px-4 py-8 text-center text-sm text-faint">Ящики не подключены</li>}
      </ul>
      <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        Личный ящик и его письма видит только владелец. Пароль хранится на вашем сервере и никогда не возвращается в браузер. Письма проверяются каждые 2 минуты; при первом подключении загружаются письма за последние 2 недели.</p>
      {edit && <MailboxForm box={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function MailboxForm({ box, onClose }: { box: any; onClose: () => void }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const inv = useInvalidate();
  const admin = can('settings', 'admin');
  const [f, setF] = useState<any>({ email: '', name: user?.name ?? '', imap_host: '', imap_port: 993, smtp_host: '', smtp_port: 465, login: '', password: box.has_password ? '••••••' : '', user_id: user?.id, is_active: 1, ...box, ...(box.has_password ? { password: '••••••' } : {}) });
  const [preset, setPreset] = useState(box.id ? 'custom' : '');
  const [saving, setSaving] = useState(false);
  const p = PRESETS.find((x) => x.id === preset);
  const applyPreset = (id: string) => {
    setPreset(id);
    const x = PRESETS.find((y) => y.id === id);
    if (x && id !== 'custom') setF((cur: any) => ({ ...cur, imap_host: x.imap, imap_port: 993, smtp_host: x.smtp, smtp_port: x.smtpPort }));
  };
  const save = async (andTest: boolean) => {
    setSaving(true);
    try {
      const saved = box.id ? await api.put(`/api/mail/mailboxes/${box.id}`, f) : await api.post('/api/mail/mailboxes', f);
      inv('mailboxes');
      if (andTest && !IS_DEMO) {
        const r = await api.post(`/api/mail/mailboxes/${saved.id}/test`);
        toast.success(r.text);
        api.post(`/api/mail/mailboxes/${saved.id}/sync`).then(() => inv('mails', 'mailboxes')).catch(() => inv('mailboxes'));
      } else toast.success(IS_DEMO ? 'Ящик сохранён. Получение и отправка писем работают в серверной версии' : 'Ящик сохранён');
      onClose();
    } catch (e) { toast.error(e); inv('mailboxes'); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={box.id ? `Ящик ${box.email}` : 'Подключить почтовый ящик'}
      footer={<><Button onClick={onClose}>Отмена</Button><Button onClick={() => save(false)} loading={saving}>Сохранить</Button>{!IS_DEMO && <Button variant="primary" loading={saving} onClick={() => save(true)}>Сохранить и проверить</Button>}</>}>
      <div className="grid gap-4 md:grid-cols-2">
        <FormRow label="Адрес" required className="md:col-span-2">
          <Input type="email" value={f.email} placeholder="sales@company.ru" onChange={(e) => { const email = e.target.value; setF({ ...f, email, login: f.login && f.login !== f.email ? f.login : email }); if (!box.id && !preset) { const g = guessPreset(email); if (g) applyPreset(g); } }} />
        </FormRow>
        <FormRow label="Почтовый сервис" className="md:col-span-2" hint={p?.hint}>
          <Select value={preset} onChange={(e) => applyPreset(e.target.value)}>
            <option value="">Выберите…</option>
            {PRESETS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </Select>
        </FormRow>
        <FormRow label="Имя отправителя"><Input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormRow>
        <FormRow label="Логин"><Input value={f.login ?? ''} onChange={(e) => setF({ ...f, login: e.target.value })} autoComplete="off" /></FormRow>
        <FormRow label="Пароль (пароль приложения)" className="md:col-span-2"><Input type="password" value={f.password ?? ''} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></FormRow>
        <FormRow label="IMAP сервер"><Input value={f.imap_host ?? ''} onChange={(e) => setF({ ...f, imap_host: e.target.value })} placeholder="imap.company.ru" /></FormRow>
        <FormRow label="IMAP порт"><Input type="number" value={f.imap_port ?? 993} onChange={(e) => setF({ ...f, imap_port: Number(e.target.value) })} /></FormRow>
        <FormRow label="SMTP сервер"><Input value={f.smtp_host ?? ''} onChange={(e) => setF({ ...f, smtp_host: e.target.value })} placeholder="smtp.company.ru" /></FormRow>
        <FormRow label="SMTP порт" hint="465 — SSL, 587 — STARTTLS"><Input type="number" value={f.smtp_port ?? 465} onChange={(e) => setF({ ...f, smtp_port: Number(e.target.value) })} /></FormRow>
        {admin && (
          <FormRow label="Владелец" hint="Пусто — общий ящик отдела: его видят все, у кого есть доступ к почте" className="md:col-span-2">
            <UserSelect value={f.user_id} onChange={(v) => setF({ ...f, user_id: v })} placeholder="Общий ящик" />
          </FormRow>
        )}
        <div className="md:col-span-2"><Switch checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v ? 1 : 0 })} label="Получать и отправлять письма" /></div>
      </div>
    </Modal>
  );
}
