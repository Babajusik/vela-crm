// Telephony providers: call events from Zadarma / Novofon and Mango Office, a plain JSON hook for any PBX
// (Asterisk, FreePBX, a provider without a ready adapter), and click-to-call.
// The hook address carries a long secret token; Mango requests are also checked by their signature.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CallEvent, TelephonySettings } from '../src/core/services/telephony.ts';

type Fetch = typeof fetch;
const API: Record<string, string> = { zadarma: 'https://api.zadarma.com', novofon: 'https://api.novofon.com' };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

// ---------------- Zadarma / Novofon ----------------
/** Signed API request: Authorization "key:base64(hex(hmac_sha1(method + params + md5(params))))". */
async function zadarmaApi(f: Fetch, s: TelephonySettings, method: string, params: Record<string, string>) {
  const qs = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString();
  const md5 = createHash('md5').update(qs).digest('hex');
  const sign = Buffer.from(createHmac('sha1', s.api_secret).update(method + qs + md5).digest('hex')).toString('base64');
  const res = await f(`${API[s.provider] ?? API.zadarma}${method}${qs ? `?${qs}` : ''}`, { headers: { Authorization: `${s.api_key}:${sign}` } });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || data?.status !== 'success') throw new Error(data?.message ?? `HTTP ${res.status}`);
  return data;
}

function zadarmaStatus(disposition: string, out: boolean): CallEvent['status'] {
  if (disposition === 'answered') return 'answered';
  if (disposition === 'busy') return 'busy';
  return out ? 'failed' : 'missed';
}

export function zadarmaEvent(provider: string, p: URLSearchParams): CallEvent | null {
  const ev = p.get('event') ?? '';
  const id = p.get('pbx_call_id') ?? '';
  const out = ev.startsWith('NOTIFY_OUT');
  switch (ev) {
    case 'NOTIFY_START': return { provider, call_id: id, event: 'start', direction: 'in', phone: p.get('caller_id') ?? '', line: p.get('called_did') ?? '' };
    case 'NOTIFY_INTERNAL': return { provider, call_id: id, event: 'start', direction: 'in', phone: p.get('caller_id') ?? '', ext: p.get('internal') ?? '' };
    case 'NOTIFY_ANSWER': return { provider, call_id: id, event: 'answer', phone: p.get('caller_id') ?? '', ext: p.get('internal') ?? '' };
    case 'NOTIFY_END': case 'NOTIFY_OUT_END':
      return { provider, call_id: id, event: 'end', direction: out ? 'out' : 'in', phone: (out ? p.get('destination') : p.get('caller_id')) ?? '',
        ext: p.get('internal') ?? undefined, duration: Number(p.get('duration') ?? 0), status: zadarmaStatus(p.get('disposition') ?? '', out) };
    case 'NOTIFY_OUT_START': return { provider, call_id: id, event: 'start', direction: 'out', phone: p.get('destination') ?? '', ext: p.get('internal') ?? '' };
    default: return null;
  }
}

// ---------------- Mango Office ----------------
const MANGO = 'https://app.mango-office.ru/vpbx';

/** Every Mango request is signed with sha256(api key + json + api salt). */
export function mangoSign(key: string, json: string, salt: string) { return sha256(key + json + salt); }

export function mangoEvent(path: string, data: any): CallEvent | null {
  const id = String(data.entry_id ?? '');
  if (!id) return null;
  if (path.endsWith('/events/call')) {
    const out = !!data.from?.extension;
    const phone = out ? data.to?.number : data.from?.number;
    const ext = out ? data.from?.extension : data.to?.extension;
    if (data.call_state === 'Appeared') return { provider: 'mango', call_id: id, event: 'start', direction: out ? 'out' : 'in', phone, ext, line: data.to?.line_number };
    if (data.call_state === 'Connected') return { provider: 'mango', call_id: id, event: 'answer', phone, ext };
    return null;
  }
  if (path.endsWith('/events/summary')) {
    const out = Number(data.call_direction) === 2;
    const talk = Number(data.talk_time ?? 0);
    const duration = talk > 0 ? Math.max(0, Number(data.end_time ?? 0) - talk) : 0;
    return { provider: 'mango', call_id: id, event: 'end', direction: out ? 'out' : 'in', phone: out ? data.to?.number : data.from?.number,
      ext: out ? data.from?.extension : data.to?.extension, line: data.line_number, duration,
      status: Number(data.entry_result) === 1 ? 'answered' : out ? 'failed' : 'missed' };
  }
  return null;
}

// ---------------- generic JSON ----------------
export function genericEvent(b: any): CallEvent | null {
  if (!b?.call_id || !['start', 'answer', 'end', 'record'].includes(b.event)) return null;
  return {
    provider: 'generic', call_id: String(b.call_id), event: b.event, direction: b.direction === 'out' ? 'out' : 'in',
    phone: b.phone ? String(b.phone) : undefined, line: b.line ? String(b.line) : undefined, ext: b.ext ? String(b.ext) : undefined,
    duration: b.duration != null ? Number(b.duration) : undefined,
    status: ['answered', 'missed', 'busy', 'failed'].includes(b.status) ? b.status : undefined,
    record_url: typeof b.record_url === 'string' && /^https?:\/\//.test(b.record_url) ? b.record_url : undefined,
  };
}

// ---------------- incoming hook ----------------
export interface HookResult { status: number; body: string; events: CallEvent[]; after?: () => Promise<CallEvent[]> }

/**
 * Parses a provider request to /api/telephony/hook/<token>[/...]. The caller has already checked the token.
 * `after` fetches what comes separately (Zadarma record links) once the reply is sent.
 */
export function parseHook(f: Fetch, s: TelephonySettings, method: string, subPath: string, query: URLSearchParams, raw: string): HookResult {
  const ok = (events: CallEvent[] = [], after?: HookResult['after']): HookResult => ({ status: 200, body: 'ok', events, after });
  if (s.provider === 'zadarma' || s.provider === 'novofon') {
    // the provider checks the address with an echo request when the hook is saved
    const echo = query.get('zd_echo');
    if (echo) return { status: 200, body: echo, events: [] };
    const p = new URLSearchParams(raw);
    if (p.get('event') === 'NOTIFY_RECORD' || (p.get('event') === 'NOTIFY_END' && p.get('is_recorded') === '1')) {
      const callId = p.get('pbx_call_id') ?? '';
      const recId = p.get('call_id_with_rec') ?? '';
      const base = zadarmaEvent(s.provider, p);
      return ok(base ? [base] : [], recId && s.api_key ? async () => {
        const r = await zadarmaApi(f, s, '/v1/pbx/record/request/', { call_id: recId, lifetime: '5184000' });
        const link = r.link ?? r.links?.[0];
        return link ? [{ provider: s.provider, call_id: callId, event: 'record', record_url: link }] : [];
      } : undefined);
    }
    const ev = zadarmaEvent(s.provider, p);
    return ok(ev ? [ev] : []);
  }
  if (s.provider === 'mango') {
    const p = new URLSearchParams(raw);
    const json = p.get('json') ?? '';
    if (s.api_secret && !safeEqual(mangoSign(p.get('vpbx_api_key') ?? '', json, s.api_secret), p.get('sign') ?? '')) return { status: 403, body: 'bad sign', events: [] };
    let data: any = null;
    try { data = JSON.parse(json); } catch { return { status: 400, body: 'bad json', events: [] }; }
    const ev = mangoEvent(subPath, data);
    return ok(ev ? [ev] : []);
  }
  if (s.provider === 'generic') {
    if (method !== 'POST') return { status: 405, body: 'POST only', events: [] };
    let b: any = null;
    try { b = JSON.parse(raw); } catch { return { status: 400, body: 'bad json', events: [] }; }
    const list = (Array.isArray(b) ? b : [b]).map(genericEvent).filter(Boolean) as CallEvent[];
    return ok(list);
  }
  return { status: 404, body: 'telephony is off', events: [] };
}

// ---------------- click to call ----------------
export async function callTo(f: Fetch, s: TelephonySettings, ext: string, phone: string) {
  const to = phone.replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');
  if (s.provider === 'zadarma' || s.provider === 'novofon') {
    await zadarmaApi(f, s, '/v1/request/callback/', { from: ext, to });
    return;
  }
  if (s.provider === 'mango') {
    const json = JSON.stringify({ command_id: `vela-${randomBytes(6).toString('hex')}`, from: { extension: ext }, to_number: to });
    const res = await f(`${MANGO}/commands/callback`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ vpbx_api_key: s.api_key, sign: mangoSign(s.api_key, json, s.api_secret), json }),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || (data?.result && Number(data.result) !== 1000)) throw new Error(`Mango Office: код ${data?.result ?? res.status}`);
    return;
  }
  throw new Error('Для этой АТС звонок из CRM не настроен: позвоните с телефона, звонок всё равно попадёт в CRM');
}
