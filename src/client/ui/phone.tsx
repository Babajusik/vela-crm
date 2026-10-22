// Telephony pieces used everywhere: the incoming call card and phone numbers with a call button.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Handshake, Phone, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing, X } from 'lucide-react';
import { api } from '../api.ts';
import { money } from '../lib/format.ts';
import { useApi, useAuth, useInvalidate } from '../lib/state.tsx';
import { Avatar, Badge, Button, cx, useToast } from './ui.tsx';

export function duration(sec: unknown) {
  const s = Number(sec ?? 0);
  if (!s) return '—';
  const m = Math.floor(s / 60);
  return m ? `${m} мин ${s % 60} с` : `${s} с`;
}

// ---------------- incoming call card ----------------
/** Shows a card while the employee's phone rings or a call is in progress; the PBX reports both. */
export function IncomingCallCard() {
  const { settings } = useAuth();
  const enabled = !!settings.telephony?.enabled;
  const { data } = useApi<any[]>(['telephony', 'active'], '/api/telephony/active', undefined, { enabled, refetchInterval: enabled ? 4000 : undefined });
  const [hidden, setHidden] = useState<number[]>([]);
  const calls = (data ?? []).filter((c) => !hidden.includes(c.id));
  if (!calls.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[70] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-3 max-sm:bottom-20" role="status" aria-live="polite">
      {calls.map((c) => <CallCard key={c.id} c={c} onHide={() => setHidden((h) => [...h, c.id])} />)}
    </div>
  );
}

function CallCard({ c, onHide }: { c: any; onHide: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const ringing = c.status === 'ringing';
  const name = c.contact?.name ?? c.company?.name ?? null;
  const demo = c.provider === 'demo';
  const act = async (action: 'answer' | 'end' | 'miss') => {
    try { await api.post(`/api/telephony/demo/${c.id}/${action}`); inv('telephony', 'calls', 'deals', 'crm_activities', 'contacts'); }
    catch (e) { toast.error(e); }
  };
  const open = (to: string) => { nav(to); };
  const newDeal = async () => {
    try {
      let contactId = c.contact?.id;
      if (!contactId && !c.company?.id) contactId = (await api.post('/api/e/contacts', { name: `Новый клиент ${c.phone}`, phone: c.phone, source: 'call' })).id;
      const d = await api.post('/api/e/deals', { title: `Звонок: ${name ?? c.phone}`, contact_id: contactId ?? null, company_id: c.company?.id ?? null, source: 'call' });
      await api.patch(`/api/e/calls/${c.id}`, { deal_id: d.id, contact_id: contactId ?? null }).catch(() => {});
      inv('deals', 'calls');
      nav(`/crm/deals/${d.id}`);
    } catch (e) { toast.error(e); }
  };
  return (
    <div className="anim-slide-l overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
      <div className={cx('flex items-center gap-3 px-4 py-3 text-white', ringing ? 'bg-primary' : 'bg-success')}>
        <span className={cx('flex size-9 items-center justify-center rounded-full bg-white/20', ringing && 'animate-pulse')}>
          {c.direction === 'out' ? <PhoneOutgoing className="size-5" /> : <PhoneIncoming className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{ringing ? (c.direction === 'out' ? 'Исходящий вызов' : 'Входящий звонок') : 'Идёт разговор'}</p>
          <p className="truncate text-lg font-bold tabular">{c.phone}</p>
        </div>
        <button type="button" onClick={onHide} className="rounded-lg p-1.5 hover:bg-white/15" aria-label="Скрыть карточку"><X className="size-4" /></button>
      </div>
      <div className="space-y-3 p-4">
        {name ? (
          <div className="flex items-start gap-3">
            <Avatar name={name} size={40} />
            <div className="min-w-0">
              <p className="truncate font-bold">{c.contact?.name ?? c.company?.name}</p>
              {c.contact && c.company && <p className="truncate text-sm text-muted">{c.company.name}{c.contact.position ? ` · ${c.contact.position}` : ''}</p>}
              {c.responsible && <p className="text-xs text-faint">Ответственный: {c.responsible}</p>}
            </div>
          </div>
        ) : (
          <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm"><b>Новый номер.</b> Клиента с таким телефоном в CRM нет — после звонка он появится как новый лид.</p>
        )}
        {c.deals?.length > 0 && (
          <ul className="space-y-1.5">
            {c.deals.map((d: any) => (
              <li key={d.id}>
                <button type="button" onClick={() => open(`/crm/deals/${d.id}`)} className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-primary">
                  <span className="min-w-0 flex-1 truncate font-semibold">{d.title}</span>
                  <Badge color={d.stage_color}>{d.stage}</Badge>
                  <span className="tabular text-muted">{money(d.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {c.contact && <Button size="sm" onClick={() => open(`/crm/contacts/${c.contact.id}`)}>Карточка клиента</Button>}
          {!c.contact && c.company && <Button size="sm" onClick={() => open(`/crm/companies/${c.company.id}`)}>Карточка компании</Button>}
          {!c.deals?.length && <Button size="sm" variant="primary" icon={<Handshake className="size-4" />} onClick={newDeal}>Создать сделку</Button>}
        </div>
        {demo && (
          <div className="flex gap-2 border-t border-line pt-3">
            {ringing && <Button size="sm" variant="primary" icon={<PhoneCall className="size-4" />} onClick={() => act('answer')}>Ответить</Button>}
            {ringing && <Button size="sm" icon={<PhoneMissed className="size-4" />} onClick={() => act('miss')}>Не брать</Button>}
            {!ringing && <Button size="sm" variant="danger" icon={<PhoneOff className="size-4" />} onClick={() => act('end')}>Завершить</Button>}
            <span className="self-center text-xs text-faint">демо: так ведёт себя АТС</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- click to call ----------------
/** Phone number with a call button: the PBX rings the employee first, then connects the client. */
export function PhoneLink({ value }: { value: string }) {
  const { settings } = useAuth();
  const toast = useToast();
  const inv = useInvalidate();
  const [busy, setBusy] = useState(false);
  const enabled = !!settings.telephony?.enabled;
  const callNow = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      const r = await api.post('/api/telephony/call', { phone: value });
      toast.success(r.message ?? 'Соединяем');
      inv('calls', 'timeline', 'deals');
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <a href={`tel:${value.replace(/[^\d+]/g, '')}`} className="hover:text-primary" onClick={(e) => e.stopPropagation()}>{value}</a>
      {enabled && (
        <button type="button" onClick={callNow} disabled={busy} title="Позвонить через АТС" aria-label={`Позвонить ${value}`}
          className="inline-flex size-6 items-center justify-center rounded-full bg-primary-soft text-primary hover:bg-primary hover:text-primary-fg disabled:opacity-50">
          <Phone className="size-3.5" />
        </button>
      )}
    </span>
  );
}
