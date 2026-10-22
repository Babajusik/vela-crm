// Mailboxes and incoming mail, channel connections and replies: the core side of real integrations.
// Network work (IMAP, SMTP, messenger APIs) is done by deps.integrations on the server.
import { can, create, getRaw, logActivity, notify, requirePerm, scope, serialize, update, type Ctx } from '../crud.ts';
import { ENTITIES } from '../schema.ts';
import { fail, nowIso, parseJson, randomToken } from '../util.ts';
import { incomingMessage } from './misc.ts';

const MASK = '••••••';

// ---------------- visibility ----------------
// A personal mailbox and its letters are seen by the owner; shared boxes (no owner) by everyone with mail access.
const ownBoxes = 'SELECT id FROM mailboxes WHERE user_id IS NULL OR user_id = ?';
scope('mailboxes', (ctx) => (can(ctx.user, 'mail', 'admin') ? null : { sql: 'user_id IS NULL OR user_id = ?', params: [ctx.user.id] }));
scope('mails', (ctx) => (can(ctx.user, 'mail', 'admin') ? null : { sql: `mailbox_id IS NULL OR mailbox_id IN (${ownBoxes})`, params: [ctx.user.id] }));
scope('files', (ctx) => (can(ctx.user, 'mail', 'admin') ? null : {
  sql: `entity_type IS NULL OR entity_type != 'mails' OR entity_id IN (SELECT id FROM mails WHERE mailbox_id IS NULL OR mailbox_id IN (${ownBoxes}))`,
  params: [ctx.user.id],
}));

// ---------------- mailboxes ----------------
function publicMailbox(row: Record<string, any>) {
  return { ...serialize(ENTITIES.mailboxes, row), has_password: !!row.password };
}

export function myMailboxes(ctx: Ctx) {
  requirePerm(ctx, 'mail', 'read');
  const admin = can(ctx.user, 'mail', 'admin');
  return ctx.db.all(`SELECT * FROM mailboxes ${admin ? '' : 'WHERE user_id IS NULL OR user_id = ?'} ORDER BY id`, admin ? [] : [ctx.user.id]).map(publicMailbox);
}

export function mailboxForUse(ctx: Ctx, id: number) {
  const box = getRaw(ctx.db, 'mailboxes', id);
  if (!box) fail(404, 'Почтовый ящик не найден');
  if (box!.user_id && box!.user_id !== ctx.user.id && !can(ctx.user, 'mail', 'admin') && !ctx.system) fail(403, 'Это личный ящик другого сотрудника');
  return box!;
}

export function saveMailbox(ctx: Ctx, id: number | null, body: Record<string, any>) {
  requirePerm(ctx, 'mail', 'write');
  const old = id ? mailboxForUse(ctx, id) : null;
  const admin = can(ctx.user, 'settings', 'admin');
  if (old && !old.user_id && !admin) fail(403, 'Общий ящик отдела настраивает администратор');
  const email = String(body.email ?? old?.email ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(422, 'Укажите адрес ящика');
  const data: Record<string, unknown> = {
    email, name: body.name ?? old?.name ?? null,
    imap_host: String(body.imap_host ?? old?.imap_host ?? '').trim() || null, imap_port: Number(body.imap_port ?? old?.imap_port ?? 993),
    smtp_host: String(body.smtp_host ?? old?.smtp_host ?? '').trim() || null, smtp_port: Number(body.smtp_port ?? old?.smtp_port ?? 465),
    login: String(body.login ?? old?.login ?? email).trim() || email,
    // only an administrator connects shared boxes or boxes of colleagues
    user_id: admin ? (body.user_id === undefined ? old?.user_id ?? ctx.user.id : body.user_id || null) : ctx.user.id,
    is_active: body.is_active === undefined ? old?.is_active ?? 1 : body.is_active ? 1 : 0,
  };
  if (body.password && body.password !== MASK) data.password = String(body.password);
  if (old && (old.imap_host !== data.imap_host || old.login !== data.login)) data.imap_state = null;
  const sys: Ctx = { ...ctx, system: true };
  const row = old ? update(sys, 'mailboxes', old.id, data) : create(sys, 'mailboxes', data);
  return publicMailbox(getRaw(ctx.db, 'mailboxes', row.id)!);
}

export function markMailboxSync(ctx: Ctx, id: number, error: string | null) {
  ctx.db.run(`UPDATE mailboxes SET last_sync_at = ?, sync_error = ? WHERE id = ?`, [nowIso(), error, id]);
  ctx.deps.onWrite?.();
}

// ---------------- incoming mail ----------------
const PUBLIC_DOMAINS = new Set(['mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'yandex.ru', 'ya.ru', 'yandex.com', 'gmail.com', 'rambler.ru', 'outlook.com', 'hotmail.com', 'icloud.com', 'me.com', 'internet.ru']);

export interface IncomingMail {
  message_id?: string; in_reply_to?: string; references?: string[];
  from_addr: string; from_name?: string; to_addr?: string; cc?: string;
  subject?: string; body?: string; date?: string; folder?: 'inbox' | 'sent' | 'spam';
  attachments?: { name: string; mime?: string; size?: number; path: string }[];
}

function firstAddress(s: unknown) {
  return /[^\s<>,;"]+@[^\s<>,;"]+/.exec(String(s ?? ''))?.[0]?.toLowerCase() ?? '';
}

/** Contact, company and open deal for an email address. The same corporate domain links to the company. */
export function findByEmail(ctx: Ctx, address: string) {
  const addr = firstAddress(address);
  if (!addr) return { contact_id: null, company_id: null, deal_id: null, responsible_id: null };
  const contact = ctx.db.get(`SELECT id, company_id, responsible_id FROM contacts WHERE lower(email) = ? ORDER BY updated_at DESC LIMIT 1`, [addr]);
  let company = contact?.company_id ? ctx.db.get(`SELECT id, responsible_id FROM companies WHERE id = ?`, [contact.company_id])
    : ctx.db.get(`SELECT id, responsible_id FROM companies WHERE lower(email) = ? LIMIT 1`, [addr]);
  const domain = addr.split('@')[1];
  if (!contact && !company && domain && !PUBLIC_DOMAINS.has(domain)) {
    company = ctx.db.get(`SELECT id, responsible_id FROM companies WHERE lower(email) LIKE ? OR lower(website) LIKE ? ORDER BY updated_at DESC LIMIT 1`, [`%@${domain}`, `%${domain}%`]);
  }
  const deal = (contact || company) ? ctx.db.get(`SELECT d.id FROM deals d JOIN stages s ON s.id = d.stage_id WHERE s.kind = 'open' AND COALESCE(d.is_archived,0) = 0
    AND (d.contact_id = ? OR d.company_id = ?) ORDER BY d.updated_at DESC LIMIT 1`, [contact?.id ?? -1, company?.id ?? -1]) : null;
  return { contact_id: contact?.id ?? null, company_id: company?.id ?? null, deal_id: deal?.id ?? null, responsible_id: contact?.responsible_id ?? company?.responsible_id ?? null };
}

/** Stores a letter fetched from the mailbox once (by Message-ID) and links it to the client and the deal. */
export function incomingMail(ctx: Ctx, boxId: number, m: IncomingMail) {
  const sys: Ctx = { ...ctx, system: true };
  const box = getRaw(ctx.db, 'mailboxes', boxId);
  if (!box) fail(404, 'Почтовый ящик не найден');
  if (m.message_id && ctx.db.get(`SELECT id FROM mails WHERE mailbox_id = ? AND message_id = ?`, [boxId, m.message_id])) return null;
  const folder = m.folder ?? 'inbox';
  const outgoing = folder === 'sent';
  const link = findByEmail(ctx, outgoing ? String(m.to_addr ?? '') : m.from_addr);
  // a reply keeps the deal of the letter it answers
  const refs = [m.in_reply_to, ...(m.references ?? [])].filter(Boolean) as string[];
  const thread = refs.length ? ctx.db.get(`SELECT deal_id, company_id, contact_id FROM mails WHERE message_id IN (${refs.map(() => '?').join(',')}) AND mailbox_id = ? ORDER BY id DESC LIMIT 1`, [...refs, boxId]) : null;
  const deal_id = thread?.deal_id ?? link.deal_id;
  const company_id = thread?.company_id ?? link.company_id;
  const contact_id = thread?.contact_id ?? link.contact_id;
  const mail = create(sys, 'mails', {
    mailbox_id: boxId, folder, from_addr: m.from_addr, from_name: m.from_name || null, to_addr: m.to_addr ?? box!.email, cc: m.cc || null,
    subject: m.subject || '(без темы)', body: m.body ?? '', date: m.date ?? nowIso(), is_read: outgoing ? 1 : 0,
    company_id, contact_id, deal_id, message_id: m.message_id ?? null, in_reply_to: m.in_reply_to ?? null, attachments: m.attachments?.length ?? 0,
  });
  for (const a of m.attachments ?? []) {
    const f = create(sys, 'files', { name: a.name, entity_type: 'mails', entity_id: mail.id });
    ctx.db.run(`UPDATE files SET size = ?, mime = ?, path = ? WHERE id = ?`, [a.size ?? null, a.mime ?? 'application/octet-stream', a.path, f.id]);
  }
  if (!outgoing && folder !== 'spam') {
    const text = `Входящее письмо «${mail.subject}» от ${m.from_name || m.from_addr}`;
    const meta = { mail_id: mail.id };
    if (deal_id) logActivity(sys, 'deals', deal_id, 'email', text, meta);
    else if (company_id) logActivity(sys, 'companies', company_id, 'email', text, meta);
    else if (contact_id) logActivity(sys, 'contacts', contact_id, 'email', text, meta);
    notify(sys, box!.user_id ?? link.responsible_id, `Новое письмо: ${mail.subject}`, `/mail?m=${mail.id}`, 'system');
  }
  ctx.deps.onWrite?.();
  return mail;
}

/** Letters were sent through SMTP: keep the Message-ID for threading, or record why it failed. */
export function markMailSent(ctx: Ctx, mailId: number, res: { messageId?: string; error?: string }) {
  if (res.error) ctx.db.run(`UPDATE mails SET folder = 'drafts', send_error = ? WHERE id = ?`, [res.error, mailId]);
  else ctx.db.run(`UPDATE mails SET message_id = COALESCE(?, message_id), send_error = NULL WHERE id = ?`, [res.messageId ?? null, mailId]);
  ctx.deps.onWrite?.();
}

// ---------------- channels ----------------
/** Fields each channel needs; secrets are never returned to the browser. */
export const CHANNEL_FIELDS: Record<string, { key: string; secret?: boolean }[]> = {
  telegram: [{ key: 'bot_token', secret: true }],
  vk: [{ key: 'group_id' }, { key: 'access_token', secret: true }],
  avito: [{ key: 'client_id' }, { key: 'client_secret', secret: true }],
  whatsapp: [{ key: 'api_url' }, { key: 'id_instance' }, { key: 'api_token', secret: true }],
  webchat: [],
  email: [],
};

export function channelSettingsPublic(ctx: Ctx, id: number) {
  requirePerm(ctx, 'communications', 'admin');
  const ch = getRaw(ctx.db, 'channels', id);
  if (!ch) fail(404, 'Канал не найден');
  const s = parseJson<Record<string, string>>(ch!.settings, {});
  const out: Record<string, string> = {};
  for (const f of CHANNEL_FIELDS[ch!.kind] ?? []) out[f.key] = f.secret ? (s[f.key] ? MASK : '') : s[f.key] ?? '';
  if (ch!.kind === 'webchat') out.widget_key = s.widget_key ?? '';
  return out;
}

export function saveChannel(ctx: Ctx, id: number | null, body: Record<string, any>) {
  requirePerm(ctx, 'communications', 'admin');
  const old = id ? getRaw(ctx.db, 'channels', id) : null;
  if (id && !old) fail(404, 'Канал не найден');
  const kind = String(old?.kind ?? body.kind ?? '');
  const fields = CHANNEL_FIELDS[kind];
  if (!fields) fail(422, 'Неизвестный тип канала');
  const cur = parseJson<Record<string, string>>(old?.settings, {});
  const next: Record<string, string> = { ...cur };
  for (const f of fields) {
    const v = body.settings?.[f.key];
    if (v === undefined || (f.secret && v === MASK)) continue;
    next[f.key] = String(v).trim();
  }
  for (const f of fields) if (!next[f.key] && !(kind === 'whatsapp' && f.key === 'api_url')) fail(422, `Заполните поле «${CHANNEL_LABELS[f.key] ?? f.key}»`);
  if (kind === 'telegram' && !/^\d+:[\w-]{30,}$/.test(next.bot_token)) fail(422, 'Токен выглядит неверно. Его выдаёт @BotFather в Telegram, формат 123456:ABC…');
  if (kind === 'webchat' && !next.widget_key) next.widget_key = randomToken(12);
  const data = {
    name: String(body.name ?? old?.name ?? CHANNEL_DEFAULT_NAMES[kind] ?? kind), kind,
    responsible_id: body.responsible_id === undefined ? old?.responsible_id ?? ctx.user.id : body.responsible_id || null,
    is_active: body.is_active === undefined ? old?.is_active ?? 1 : body.is_active ? 1 : 0,
    settings: next,
  };
  const sys: Ctx = { ...ctx, system: true };
  const row = old ? update(sys, 'channels', old.id, data) : create(sys, 'channels', data);
  return row;
}

export function markChannel(ctx: Ctx, id: number, res: { account?: string; error?: string | null }) {
  ctx.db.run(`UPDATE channels SET account = COALESCE(?, account), sync_error = ?, last_sync_at = ? WHERE id = ?`, [res.account ?? null, res.error ?? null, nowIso(), id]);
  ctx.deps.onWrite?.();
}

const CHANNEL_LABELS: Record<string, string> = {
  bot_token: 'Токен бота', group_id: 'ID сообщества', access_token: 'Ключ доступа сообщества', client_id: 'Client ID', client_secret: 'Client Secret',
  id_instance: 'IdInstance', api_token: 'ApiTokenInstance',
};
const CHANNEL_DEFAULT_NAMES: Record<string, string> = {
  telegram: 'Telegram-бот', vk: 'Сообщество ВКонтакте', avito: 'Авито', whatsapp: 'WhatsApp', max: 'MAX', webchat: 'Чат на сайте', email: 'Email',
};

// ---------------- chat on the client's website ----------------
function widgetChannel(ctx: Ctx, key: string) {
  if (!/^[\w-]{8,64}$/.test(key)) fail(404, 'Чат не найден');
  const ch = ctx.db.all(`SELECT * FROM channels WHERE kind = 'webchat' AND is_active = 1 AND settings LIKE ?`, [`%${key}%`])
    .find((c) => parseJson<Record<string, string>>(c.settings, {}).widget_key === key);
  if (!ch) fail(404, 'Чат не найден или выключен');
  return ch!;
}

function visitorHandle(visitor: unknown) {
  const v = String(visitor ?? '');
  if (!/^[a-z0-9]{12,48}$/i.test(v)) fail(422, 'Некорректный идентификатор посетителя');
  return `web:${v}`;
}

export function webchatInfo(ctx: Ctx, key: string) {
  const ch = widgetChannel(ctx, key);
  const company = parseJson<Record<string, string>>(ctx.db.get(`SELECT value FROM settings WHERE key = 'company'`)?.value, {});
  return { title: ch.name, company: company.name ?? '', greeting: 'Здравствуйте! Напишите вопрос — ответим здесь же.' };
}

/** A visitor writes from the website widget. Limited to 10 messages a minute per visitor. */
export function webchatPost(ctx: Ctx, key: string, body: { visitor?: string; name?: string; text?: string; page?: string }) {
  const ch = widgetChannel(ctx, key);
  const handle = visitorHandle(body.visitor);
  const text = String(body.text ?? '').trim().slice(0, 2000);
  if (!text) fail(422, 'Введите сообщение');
  const recent = ctx.db.get(`SELECT COUNT(*) AS n FROM conv_messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.channel_id = ? AND c.client_handle = ? AND m.direction = 'in' AND m.created_at >= ?`, [ch.id, handle, new Date(Date.now() - 60000).toISOString()]);
  if (Number(recent?.n ?? 0) >= 10) fail(429, 'Слишком много сообщений, подождите минуту');
  // a bot changing visitor ids is stopped by the limit for the whole website
  const flood = ctx.db.get(`SELECT COUNT(*) AS n FROM conv_messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.channel_id = ? AND m.direction = 'in' AND m.created_at >= ?`, [ch.id, new Date(Date.now() - 60000).toISOString()]);
  if (Number(flood?.n ?? 0) >= 120) fail(429, 'Чат перегружен, попробуйте через минуту');
  const name = String(body.name ?? '').trim().slice(0, 80) || 'Посетитель сайта';
  const page = String(body.page ?? '').slice(0, 300);
  const isFirst = !ctx.db.get(`SELECT id FROM conversations WHERE channel_id = ? AND client_handle = ? LIMIT 1`, [ch.id, handle]);
  incomingMessage(ctx, { channel_id: ch.id, client_name: name, client_handle: handle, text: isFirst && page ? `${text}\n\nСтраница: ${page}` : text });
  return { ok: true };
}

/** The widget asks for new messages of its conversation, both the visitor's and the operators'. */
export function webchatPoll(ctx: Ctx, key: string, q: { visitor?: string; after?: string }) {
  const ch = widgetChannel(ctx, key);
  const handle = visitorHandle(q.visitor);
  const conv = ctx.db.get(`SELECT id FROM conversations WHERE channel_id = ? AND client_handle = ? ORDER BY id DESC LIMIT 1`, [ch.id, handle]);
  if (!conv) return { messages: [] };
  const msgs = ctx.db.all(`SELECT m.id, m.direction, m.text, m.created_at, u.name AS operator FROM conv_messages m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ? AND m.id > ? ORDER BY m.id LIMIT 200`, [conv.id, Number(q.after) || 0]);
  return { messages: msgs.map((m) => ({ ...m, operator: m.direction === 'out' ? String(m.operator ?? '').split(' ')[0] : undefined })) };
}
