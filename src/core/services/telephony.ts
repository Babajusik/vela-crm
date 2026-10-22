// Telephony: call log, client lookup by number, incoming call card, missed calls and leads from unknown numbers.
// Providers (Zadarma / Novofon, Mango Office, any PBX via a simple JSON hook) are parsed by the server
// and turned into CallEvent; everything else lives here so the browser demo behaves the same.
import { create, getRaw, logActivity, notify, requirePerm, update, type Ctx } from '../crud.ts';
import { fail, localDateTime, nowIso, parseJson, randomToken } from '../util.ts';

export interface TelephonySettings {
  /** none | demo | zadarma | novofon | mango | generic */
  provider: string;
  api_key: string;
  api_secret: string;
  /** secret part of the webhook address */
  hook_token: string;
  unknown_to_lead: boolean;
  missed_to_activity: boolean;
}

const DEFAULTS: TelephonySettings = { provider: 'none', api_key: '', api_secret: '', hook_token: '', unknown_to_lead: true, missed_to_activity: true };
const MASK = '••••••';

export function telephonySettings(ctx: Ctx): TelephonySettings {
  return { ...DEFAULTS, ...parseJson<Partial<TelephonySettings>>(ctx.db.get(`SELECT value FROM settings WHERE key = 'telephony'`)?.value, {}) };
}

export function publicTelephonySettings(ctx: Ctx) {
  requirePerm(ctx, 'settings', 'read');
  const s = telephonySettings(ctx);
  return { ...s, api_secret: s.api_secret ? MASK : '', hook_path: s.hook_token ? `/api/telephony/hook/${s.hook_token}` : '' };
}

export function saveTelephonySettings(ctx: Ctx, body: Partial<TelephonySettings>) {
  requirePerm(ctx, 'settings', 'admin');
  const cur = telephonySettings(ctx);
  const next: TelephonySettings = { ...cur, ...body };
  if (body.api_secret === MASK) next.api_secret = cur.api_secret;
  // the hook address is the only secret a provider sends with its events: keep it long and random
  if (!next.hook_token || next.hook_token.length < 20 || (body as any).new_hook_token) next.hook_token = randomToken(18);
  delete (next as any).new_hook_token;
  ctx.db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('telephony', ?)`, [JSON.stringify(next)]);
  ctx.deps.onWrite?.();
  return publicTelephonySettings(ctx);
}

export function telephonyEnabled(ctx: Ctx) {
  return telephonySettings(ctx).provider !== 'none';
}

// ---------------- numbers ----------------
/** Last 10 digits: +7 916 555-12-90, 8 (916) 555 12 90 and 79165551290 are the same number. */
export function phoneKey(v: unknown): string {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

export function prettyPhone(v: unknown): string {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 11 && /^[78]/.test(d)) return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  if (d.length === 10) return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
  return String(v ?? '');
}

export interface ClientMatch { contact_id: number | null; company_id: number | null; deal_id: number | null; responsible_id: number | null; name: string | null }

/** Finds a contact or a company by phone number and their latest open deal. */
export function findByPhone(ctx: Ctx, phone: unknown): ClientMatch {
  const key = phoneKey(phone);
  const none: ClientMatch = { contact_id: null, company_id: null, deal_id: null, responsible_id: null, name: null };
  if (key.length < 6) return none;
  const tail = `%${key.slice(-2)}%`;
  const contact = ctx.db.all(`SELECT id, name, company_id, responsible_id, phone FROM contacts WHERE phone LIKE ? ORDER BY updated_at DESC`, [tail])
    .find((c) => phoneKey(c.phone) === key);
  const company = contact?.company_id
    ? ctx.db.get(`SELECT id, name, responsible_id FROM companies WHERE id = ?`, [contact.company_id])
    : ctx.db.all(`SELECT id, name, responsible_id, phone FROM companies WHERE phone LIKE ? ORDER BY updated_at DESC`, [tail]).find((c) => phoneKey(c.phone) === key);
  if (!contact && !company) return none;
  const deal = ctx.db.get(`SELECT d.id, d.responsible_id FROM deals d JOIN stages s ON s.id = d.stage_id
    WHERE s.kind = 'open' AND COALESCE(d.is_archived, 0) = 0 AND (d.contact_id = ? OR d.company_id = ?) ORDER BY d.updated_at DESC LIMIT 1`,
  [contact?.id ?? -1, company?.id ?? -1]);
  return {
    contact_id: contact?.id ?? null, company_id: company?.id ?? null, deal_id: deal?.id ?? null,
    responsible_id: deal?.responsible_id ?? contact?.responsible_id ?? company?.responsible_id ?? null,
    name: contact?.name ?? company?.name ?? null,
  };
}

function userByExt(ctx: Ctx, ext: unknown): number | null {
  const e = String(ext ?? '').trim();
  if (!e) return null;
  return ctx.db.get(`SELECT id FROM users WHERE phone_ext = ? AND is_active = 1`, [e])?.id ?? null;
}

// ---------------- events ----------------
export interface CallEvent {
  provider: string;
  call_id: string;
  event: 'start' | 'answer' | 'end' | 'record';
  direction?: 'in' | 'out';
  /** client number */
  phone?: string;
  /** our number the client called */
  line?: string;
  ext?: string;
  user_id?: number;
  duration?: number;
  status?: 'answered' | 'missed' | 'busy' | 'failed';
  record_url?: string;
  at?: string;
}

const FINAL = new Set(['answered', 'missed', 'busy', 'failed']);

export function callEvent(ctx: Ctx, ev: CallEvent) {
  const sys: Ctx = { ...ctx, system: true };
  if (!ev.call_id) fail(422, 'Нет идентификатора звонка');
  let call = ctx.db.get(`SELECT * FROM calls WHERE ext_id = ? AND provider = ? ORDER BY id DESC LIMIT 1`, [String(ev.call_id), ev.provider]);
  const extUser = ev.user_id ?? userByExt(ctx, ev.ext);
  if (!call) {
    if (ev.event === 'record' && !ev.phone) return null;
    const m = findByPhone(ctx, ev.phone);
    const finished = ev.event === 'end';
    call = getRaw(ctx.db, 'calls', create(sys, 'calls', {
      direction: ev.direction ?? 'in', status: finished ? ev.status ?? ((ev.duration ?? 0) > 0 ? 'answered' : 'missed') : ev.event === 'answer' ? 'active' : 'ringing',
      phone: prettyPhone(ev.phone), line: ev.line ? prettyPhone(ev.line) : null, user_id: extUser ?? m.responsible_id, ext: ev.ext ?? null,
      started_at: ev.at ?? nowIso(), duration: finished ? ev.duration ?? 0 : null, record_url: ev.record_url ?? null,
      contact_id: m.contact_id, company_id: m.company_id, deal_id: m.deal_id, ext_id: String(ev.call_id), provider: ev.provider, is_processed: 0,
    }).id)!;
  } else {
    const patch: Record<string, unknown> = {};
    if (ev.event === 'answer' && !FINAL.has(call.status)) patch.status = 'active';
    // the card goes to the employee whose phone is ringing or who picked up
    if (extUser && ev.event !== 'end') patch.user_id = extUser;
    else if (extUser && !call.user_id) patch.user_id = extUser;
    if (ev.ext && ev.event === 'answer') patch.ext = ev.ext;
    if (ev.event === 'end') {
      patch.duration = ev.duration ?? call.duration ?? 0;
      patch.status = ev.status ?? (Number(patch.duration) > 0 ? 'answered' : 'missed');
    }
    if (ev.record_url) patch.record_url = ev.record_url;
    if (Object.keys(patch).length) call = getRaw(ctx.db, 'calls', update(sys, 'calls', call.id, patch).id)!;
  }
  if (FINAL.has(call!.status) && !call!.is_processed) finishCall(sys, call!);
  else if (ev.event === 'record' && call!.is_processed && ev.record_url) attachRecord(sys, call!, ev.record_url);
  ctx.deps.onWrite?.();
  return getRaw(ctx.db, 'calls', call!.id);
}

function durationText(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m} мин ${s} с` : `${s} с`;
}

/** Feed entry, lead from an unknown number, «call back» for a missed call. Runs once per call. */
function finishCall(ctx: Ctx, call: Record<string, any>) {
  const s = telephonySettings(ctx);
  let { contact_id, deal_id } = call;
  const inbound = call.direction === 'in';
  if (inbound && !contact_id && !call.company_id && s.unknown_to_lead) {
    contact_id = create(ctx, 'contacts', { name: `Новый клиент ${call.phone}`, phone: call.phone, source: 'call', responsible_id: call.user_id }).id;
    deal_id = create(ctx, 'deals', { title: `Звонок с номера ${call.phone}`, contact_id, source: 'call', responsible_id: call.user_id }).id;
  }
  const missed = call.status !== 'answered';
  const text = inbound
    ? (missed ? `Пропущенный входящий звонок с ${call.phone}` : `Входящий звонок с ${call.phone} · ${durationText(Number(call.duration ?? 0))}`)
    : (missed ? `Исходящий звонок на ${call.phone}: не дозвонились` : `Исходящий звонок на ${call.phone} · ${durationText(Number(call.duration ?? 0))}`);
  const meta = { call_id: call.id, record_url: call.record_url ?? undefined };
  const author: Ctx = call.user_id ? { ...ctx, user: { ...ctx.user, id: call.user_id } } : ctx;
  if (deal_id) logActivity(author, 'deals', deal_id, 'call', text, meta);
  else if (contact_id) logActivity(author, 'contacts', contact_id, 'call', text, meta);
  else if (call.company_id) logActivity(author, 'companies', call.company_id, 'call', text, meta);
  if (inbound && missed) {
    const who = findByPhone(ctx, call.phone).name ?? call.phone;
    if (s.missed_to_activity) {
      create(ctx, 'crm_activities', { kind: 'call', subject: `Перезвонить: ${who}`, due_at: localDateTime(new Date(Date.now() + 15 * 60000)),
        responsible_id: call.user_id, deal_id, company_id: call.company_id, contact_id });
    }
    notify(ctx, call.user_id, `Пропущенный звонок: ${who}`, deal_id ? `/crm/deals/${deal_id}` : '/communications/calls', 'system');
  }
  ctx.db.run(`UPDATE calls SET is_processed = 1, contact_id = ?, deal_id = ? WHERE id = ?`, [contact_id ?? null, deal_id ?? null, call.id]);
}

function attachRecord(ctx: Ctx, call: Record<string, any>, url: string) {
  const row = ctx.db.get(`SELECT id, meta FROM activities WHERE kind = 'call' AND meta LIKE ? ORDER BY id DESC LIMIT 1`, [`%"call_id":${call.id}%`]);
  if (row) ctx.db.run(`UPDATE activities SET meta = ? WHERE id = ?`, [JSON.stringify({ ...parseJson(row.meta, {}), record_url: url }), row.id]);
}

// ---------------- incoming call card ----------------
/** Calls ringing or in progress for the current employee, with what we know about the client. */
export function activeCalls(ctx: Ctx) {
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const rows = ctx.db.all(`SELECT * FROM calls WHERE status IN ('ringing','active') AND (user_id = ? OR user_id IS NULL) AND started_at >= ? ORDER BY id DESC LIMIT 3`,
    [ctx.user.id, since]);
  return rows.map((c) => {
    const contact = c.contact_id ? ctx.db.get(`SELECT id, name, position FROM contacts WHERE id = ?`, [c.contact_id]) : null;
    const company = c.company_id ? ctx.db.get(`SELECT id, name FROM companies WHERE id = ?`, [c.company_id]) : null;
    const deals = (c.contact_id || c.company_id) ? ctx.db.all(`SELECT d.id, d.title, d.amount, s.name AS stage, s.color AS stage_color FROM deals d JOIN stages s ON s.id = d.stage_id
      WHERE s.kind = 'open' AND (d.contact_id = ? OR d.company_id = ?) ORDER BY d.updated_at DESC LIMIT 3`, [c.contact_id ?? -1, c.company_id ?? -1]) : [];
    const resp = c.deal_id ? ctx.db.get(`SELECT u.name FROM deals d JOIN users u ON u.id = d.responsible_id WHERE d.id = ?`, [c.deal_id]) : null;
    return { ...c, contact, company, deals, responsible: resp?.name ?? null };
  });
}

// ---------------- click to call ----------------
export async function requestCall(ctx: Ctx, phone: string) {
  requirePerm(ctx, 'crm', 'read');
  if (phoneKey(phone).length < 6) fail(422, 'Укажите номер телефона');
  const s = telephonySettings(ctx);
  if (s.provider === 'demo' || ctx.deps.mode === 'demo') return demoOutgoing(ctx, phone);
  if (s.provider === 'none') fail(422, 'Телефония не подключена: Настройки → Телефония');
  const ext = String(ctx.db.get(`SELECT phone_ext FROM users WHERE id = ?`, [ctx.user.id])?.phone_ext ?? '').trim();
  if (!ext) fail(422, 'Укажите свой внутренний номер в профиле сотрудника — АТС сначала позвонит на него');
  if (!ctx.deps.integrations) fail(501, 'Звонки из CRM работают в серверной версии');
  try { await ctx.deps.integrations!.callTo(s, ext, phone); } catch (e) { fail(502, `АТС не приняла запрос: ${(e as Error).message}`); }
  return { ok: true, message: 'Сейчас зазвонит ваш телефон — снимите трубку, и АТС соединит с клиентом' };
}

// ---------------- demo ----------------
const DEMO_UNKNOWN = ['+7 903 418-27-65', '+7 925 771-04-39', '+7 912 640-58-12'];

function demoOutgoing(ctx: Ctx, phone: string) {
  const id = `demo-${Date.now()}`;
  callEvent(ctx, { provider: 'demo', call_id: id, event: 'start', direction: 'out', phone, user_id: ctx.user.id });
  const call = callEvent(ctx, { provider: 'demo', call_id: id, event: 'end', direction: 'out', phone, user_id: ctx.user.id, duration: 60 + Math.floor(Math.random() * 240), status: 'answered' });
  return { ok: true, demo: true, call, message: 'В демо звонок не совершается: в ленту записан разговор, как его запишет АТС' };
}

/** Rings the current employee: a known client most of the time, sometimes a new number. */
export function simulateCall(ctx: Ctx) {
  const s = telephonySettings(ctx);
  if (ctx.deps.mode !== 'demo' && s.provider !== 'demo') fail(403, 'Имитация звонка доступна только в демо-режиме');
  const known = ctx.db.all(`SELECT phone FROM contacts WHERE phone IS NOT NULL AND phone != '' ORDER BY id LIMIT 40`);
  const phone = known.length && Math.random() < 0.7 ? known[Math.floor(Math.random() * known.length)].phone : DEMO_UNKNOWN[Math.floor(Math.random() * DEMO_UNKNOWN.length)];
  return callEvent(ctx, { provider: 'demo', call_id: `demo-${Date.now()}`, event: 'start', direction: 'in', phone, line: '+7 495 120-45-00', user_id: ctx.user.id });
}

/** Demo only: the employee answers, hangs up or misses the simulated call. */
export function demoCallAction(ctx: Ctx, id: number, action: 'answer' | 'end' | 'miss') {
  const call = getRaw(ctx.db, 'calls', id);
  if (!call || call.provider !== 'demo') fail(404, 'Звонок не найден');
  if (action === 'answer') return callEvent(ctx, { provider: 'demo', call_id: call!.ext_id, event: 'answer', user_id: ctx.user.id });
  const started = Date.parse(call!.updated_at ?? call!.started_at);
  const duration = action === 'miss' ? 0 : Math.max(5, Math.round((Date.now() - started) / 1000));
  return callEvent(ctx, { provider: 'demo', call_id: call!.ext_id, event: 'end', duration, status: action === 'miss' ? 'missed' : 'answered' });
}
