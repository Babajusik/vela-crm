import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { openDb } from '../server/db.ts';
import { init, handle, type Deps } from '../src/core/index.ts';
import type { Integrations } from '../src/core/types.ts';
import * as mail from '../server/mail.ts';
import { genericEvent, mangoEvent, mangoSign, parseHook, zadarmaEvent } from '../server/telephony.ts';
import type { TelephonySettings } from '../src/core/services/telephony.ts';

const db = openDb(':memory:');
const deps: Deps = { db, mode: 'server', log: () => {} };
await init(db, { demo: true });

async function as(email: string) {
  const r = await handle(deps, { method: 'POST', path: '/api/auth/login', query: {}, body: { email, password: 'demo1234' } });
  return r.body.token as string;
}
const admin = await as('admin@vela.demo');
const orlov = await as('orlov@vela.demo');
const vetrova = await as('vetrova@vela.demo');

async function req(token: string, method: string, path: string, body?: unknown, query: Record<string, string> = {}) {
  return handle(deps, { method, path, query, body, token });
}
async function call(token: string, method: string, path: string, body?: unknown, query: Record<string, string> = {}) {
  const res = await req(token, method, path, body, query);
  if (res.status !== 200) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}
const orlovId = db.get(`SELECT id, phone_ext FROM users WHERE email = 'orlov@vela.demo'`);

// ---------------- telephony ----------------
test('incoming call from a known client shows the card and lands in the deal feed', async () => {
  const contact = db.get(`SELECT c.id, c.phone, c.company_id FROM contacts c JOIN deals d ON d.company_id = c.company_id JOIN stages s ON s.id = d.stage_id
    WHERE s.kind = 'open' AND c.phone IS NOT NULL ORDER BY c.id LIMIT 1`);
  const digits = '8' + String(contact.phone).replace(/\D/g, '').slice(-10);
  const { callEvent } = await import('../src/core/services/telephony.ts');
  const ctx = { db, user: { id: orlovId.id, perms: {} } as any, deps, system: true };
  callEvent(ctx, { provider: 'test', call_id: 'c1', event: 'start', direction: 'in', phone: digits, ext: orlovId.phone_ext });
  const active = await call(orlov, 'GET', '/api/telephony/active');
  assert.equal(active.length, 1);
  assert.equal(active[0].contact.id, contact.id);
  assert.ok(active[0].deals.length >= 1, 'open deals of the client are shown');
  callEvent(ctx, { provider: 'test', call_id: 'c1', event: 'answer', ext: orlovId.phone_ext });
  const ended = callEvent(ctx, { provider: 'test', call_id: 'c1', event: 'end', duration: 125, status: 'answered' })!;
  assert.equal(ended.status, 'answered');
  assert.equal(ended.user_id, orlovId.id);
  assert.equal((await call(orlov, 'GET', '/api/telephony/active')).length, 0, 'card disappears after the call');
  const feed = db.get(`SELECT text FROM activities WHERE entity_type = 'deals' AND entity_id = ? AND kind = 'call' ORDER BY id DESC LIMIT 1`, [ended.deal_id]);
  assert.match(feed.text, /Входящий звонок .* 2 мин 5 с/);
});

test('missed call from an unknown number creates a lead and a call-back activity', async () => {
  const { callEvent } = await import('../src/core/services/telephony.ts');
  const ctx = { db, user: { id: orlovId.id, perms: {} } as any, deps, system: true };
  callEvent(ctx, { provider: 'test', call_id: 'c2', event: 'start', direction: 'in', phone: '+7 (999) 000-11-22', ext: orlovId.phone_ext });
  const c = callEvent(ctx, { provider: 'test', call_id: 'c2', event: 'end', duration: 0 })!;
  assert.equal(c.status, 'missed');
  assert.ok(c.contact_id && c.deal_id, 'contact and deal created');
  const deal = db.get(`SELECT title, source FROM deals WHERE id = ?`, [c.deal_id]);
  assert.equal(deal.source, 'call');
  const act = db.get(`SELECT subject, responsible_id, is_done FROM crm_activities WHERE deal_id = ? ORDER BY id DESC LIMIT 1`, [c.deal_id]);
  assert.match(act.subject, /^Перезвонить/);
  assert.equal(act.responsible_id, orlovId.id);
  // a repeated end event does not duplicate anything
  callEvent(ctx, { provider: 'test', call_id: 'c2', event: 'end', duration: 0 });
  assert.equal(db.get(`SELECT COUNT(*) AS n FROM crm_activities WHERE deal_id = ?`, [c.deal_id]).n, 1);
});

test('telephony settings hide the secret and click-to-call needs an extension', async () => {
  const s = await call(admin, 'PUT', '/api/telephony/settings', { provider: 'zadarma', api_key: 'k1', api_secret: 'topsecret' });
  assert.equal(s.api_secret, '••••••');
  assert.match(s.hook_path, /^\/api\/telephony\/hook\/[\w-]{20,}$/);
  const again = await call(admin, 'PUT', '/api/telephony/settings', { api_secret: '••••••' });
  assert.equal(again.hook_path, s.hook_path, 'saving with the mask keeps the secret and the address');
  assert.equal(JSON.parse(db.get(`SELECT value FROM settings WHERE key = 'telephony'`).value).api_secret, 'topsecret');
  assert.equal((await req(orlov, 'GET', '/api/telephony/settings')).status, 403);
  // no integrations in this test environment
  db.run(`UPDATE users SET phone_ext = NULL WHERE id = ?`, [orlovId.id]);
  const r = await req(orlov, 'POST', '/api/telephony/call', { phone: '+7 900 111-22-33' });
  assert.equal(r.status, 422);
  db.run(`UPDATE users SET phone_ext = ? WHERE id = ?`, [orlovId.phone_ext, orlovId.id]);
  let dialed = '';
  deps.integrations = { callTo: async (_s: unknown, ext: string, phone: string) => { dialed = `${ext}->${phone}`; } } as unknown as Integrations;
  await call(orlov, 'POST', '/api/telephony/call', { phone: '+7 900 111-22-33' });
  assert.equal(dialed, `${orlovId.phone_ext}->+7 900 111-22-33`);
  deps.integrations = undefined;
  await call(admin, 'PUT', '/api/telephony/settings', { provider: 'demo' });
});

test('Zadarma, Mango and generic hooks become call events', () => {
  const z = zadarmaEvent('zadarma', new URLSearchParams('event=NOTIFY_START&pbx_call_id=in_1&caller_id=79161234567&called_did=74951204500&call_start=2026-10-22 10:00:00'));
  assert.deepEqual([z?.event, z?.direction, z?.phone], ['start', 'in', '79161234567']);
  const ze = zadarmaEvent('zadarma', new URLSearchParams('event=NOTIFY_END&pbx_call_id=in_1&caller_id=79161234567&internal=101&duration=42&disposition=answered'));
  assert.deepEqual([ze?.event, ze?.duration, ze?.status, ze?.ext], ['end', 42, 'answered', '101']);
  const zo = zadarmaEvent('zadarma', new URLSearchParams('event=NOTIFY_OUT_END&pbx_call_id=out_1&destination=79160000000&internal=101&duration=0&disposition=no answer'));
  assert.deepEqual([zo?.direction, zo?.phone, zo?.status], ['out', '79160000000', 'failed']);

  const call = mangoEvent('/events/call', { entry_id: 'E1', call_state: 'Appeared', from: { number: '79161234567' }, to: { extension: '102', line_number: '74951204500' } });
  assert.deepEqual([call?.event, call?.direction, call?.ext], ['start', 'in', '102']);
  const sum = mangoEvent('/events/summary', { entry_id: 'E1', call_direction: 1, from: { number: '79161234567' }, to: { extension: '102' }, talk_time: 1000, end_time: 1090, entry_result: 1 });
  assert.deepEqual([sum?.event, sum?.duration, sum?.status], ['end', 90, 'answered']);

  assert.equal(genericEvent({ call_id: 'x', event: 'nope' }), null);
  assert.equal(genericEvent({ call_id: 'x', event: 'end', record_url: 'javascript:alert(1)' })?.record_url, undefined);

  const s: TelephonySettings = { provider: 'zadarma', api_key: '', api_secret: '', hook_token: 't', unknown_to_lead: true, missed_to_activity: true };
  assert.equal(parseHook(fetch, s, 'GET', '/', new URLSearchParams('zd_echo=abc123'), '').body, 'abc123');
  const mango: TelephonySettings = { ...s, provider: 'mango', api_key: 'key', api_secret: 'salt' };
  const json = JSON.stringify({ entry_id: 'E2', call_state: 'Connected', from: { number: '7916' }, to: { extension: '101' } });
  const good = new URLSearchParams({ vpbx_api_key: 'key', sign: mangoSign('key', json, 'salt'), json }).toString();
  assert.equal(parseHook(fetch, mango, 'POST', '/events/call', new URLSearchParams(), good).events[0].event, 'answer');
  const bad = new URLSearchParams({ vpbx_api_key: 'key', sign: 'forged', json }).toString();
  assert.equal(parseHook(fetch, mango, 'POST', '/events/call', new URLSearchParams(), bad).status, 403);
});

test('demo: simulated call, answer and hang up', async () => {
  const c = await call(vetrova, 'POST', '/api/telephony/simulate');
  assert.equal(c.status, 'ringing', 'the demo provider rings the current employee');
  const active = await call(vetrova, 'GET', '/api/telephony/active');
  assert.equal(active[0].id, c.id);
  await call(vetrova, 'POST', `/api/telephony/demo/${c.id}/answer`);
  const done = await call(vetrova, 'POST', `/api/telephony/demo/${c.id}/end`);
  assert.equal(done.status, 'answered');
});

// ---------------- mail ----------------
test('mailboxes: password never returned, personal letters stay private', async () => {
  const box = await call(orlov, 'POST', '/api/mail/mailboxes', { email: 'orlov@company.example', imap_host: 'imap.example', smtp_host: 'smtp.example', password: 'app-pass', user_id: null });
  assert.equal(box.has_password, true);
  assert.equal(box.password, undefined);
  assert.equal(box.user_id, db.get(`SELECT id FROM users WHERE email = 'orlov@vela.demo'`).id, 'a manager connects only a personal box');
  const { incomingMail } = await import('../src/core/services/comms.ts');
  const ctx = { db, user: { id: 0, perms: {} } as any, deps, system: true };
  const m = incomingMail(ctx, box.id, { message_id: '<p1@x>', from_addr: 'client@private.example', subject: 'Личное письмо', body: 'Только для Орлова' })!;
  assert.ok((await call(orlov, 'GET', `/api/e/mails/${m.id}`)).id);
  assert.equal((await req(vetrova, 'GET', `/api/e/mails/${m.id}`)).status, 404);
  const list = await call(vetrova, 'GET', '/api/e/mails', undefined, { limit: '500' });
  assert.ok(!list.items.some((x: any) => x.id === m.id));
  assert.equal((await req(vetrova, 'PUT', `/api/mail/mailboxes/${box.id}`, { name: 'x' })).status, 403);
  const shared = db.get(`SELECT id FROM mailboxes WHERE user_id IS NULL LIMIT 1`).id;
  assert.equal((await req(orlov, 'PUT', `/api/mail/mailboxes/${shared}`, { name: 'Мой' })).status, 403, 'a shared box does not become personal');
  assert.equal(db.get(`SELECT user_id FROM mailboxes WHERE id = ?`, [shared]).user_id, null);
});

test('incoming letter is linked to the client by address and domain, once', async () => {
  const company = db.get(`SELECT c.id, c.email FROM companies c JOIN deals d ON d.company_id = c.id JOIN stages s ON s.id = d.stage_id
    WHERE s.kind = 'open' AND c.email LIKE '%@%' ORDER BY c.id LIMIT 1`);
  const domain = String(company.email).split('@')[1];
  const shared = db.get(`SELECT id FROM mailboxes WHERE user_id IS NULL LIMIT 1`).id;
  const { incomingMail } = await import('../src/core/services/comms.ts');
  const ctx = { db, user: { id: 0, perms: {} } as any, deps, system: true };
  const m = incomingMail(ctx, shared, { message_id: '<d1@x>', from_addr: `new.person@${domain}`, from_name: 'Новый Сотрудник', subject: 'Вопрос по договору', body: '...' })!;
  assert.equal(m.company_id, company.id, 'matched by the corporate domain');
  assert.ok(m.deal_id, 'open deal of the company');
  assert.ok(db.get(`SELECT id FROM activities WHERE entity_type = 'deals' AND entity_id = ? AND kind = 'email' AND text LIKE '%Вопрос по договору%'`, [m.deal_id]));
  assert.equal(incomingMail(ctx, shared, { message_id: '<d1@x>', from_addr: `new.person@${domain}`, subject: 'Вопрос по договору' }), null, 'no duplicates');
  const reply = incomingMail(ctx, shared, { message_id: '<d2@x>', in_reply_to: '<d1@x>', from_addr: 'someone@gmail.com', subject: 'Re: Вопрос' })!;
  assert.equal(reply.deal_id, m.deal_id, 'a reply stays in the same deal');
});

test('sending: SMTP delivers, failure keeps the letter in drafts', async () => {
  const shared = db.get(`SELECT id FROM mailboxes WHERE user_id IS NULL LIMIT 1`).id;
  await call(admin, 'PUT', `/api/mail/mailboxes/${shared}`, { password: 'secret' });
  let sent: any = null;
  deps.integrations = { sendMail: async (_b: unknown, m: any) => { sent = m; return { messageId: '<out1@vela.demo>' }; } } as unknown as Integrations;
  const ok = await call(admin, 'POST', '/api/mail/send', { mailbox_id: shared, to: 'client@example.com', subject: 'КП', body: 'Добрый день' });
  assert.equal(ok.delivered, true);
  assert.equal(sent.subject, 'КП');
  assert.equal(db.get(`SELECT message_id FROM mails WHERE id = ?`, [ok.mail.id]).message_id, '<out1@vela.demo>');
  deps.integrations = { sendMail: async () => { throw new Error('Сервер не принял логин или пароль'); } } as unknown as Integrations;
  const bad = await req(admin, 'POST', '/api/mail/send', { mailbox_id: shared, to: 'client@example.com', subject: 'Счёт', body: '...' });
  assert.equal(bad.status, 502);
  const draft = db.get(`SELECT folder, send_error FROM mails WHERE subject = 'Счёт' ORDER BY id DESC LIMIT 1`);
  assert.equal(draft.folder, 'drafts');
  assert.match(draft.send_error, /логин/);
  deps.integrations = undefined;
});

test('SMTP: a real letter with an attachment reaches the server', async () => {
  const received: Buffer[] = [];
  const server = new SMTPServer({
    secure: false, allowInsecureAuth: true, disabledCommands: ['STARTTLS'], logger: false,
    onAuth(auth, _s, cb) { cb(auth.username === 'u@test.local' && auth.password === 'pw' ? null : new Error('bad'), { user: auth.username }); },
    onData(stream, _s, cb) { const parts: Buffer[] = []; stream.on('data', (c) => parts.push(c)); stream.on('end', () => { received.push(Buffer.concat(parts)); cb(); }); },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.server.address() as any).port;
  try {
    const box = { email: 'u@test.local', name: 'Отдел продаж', smtp_host: '127.0.0.1', smtp_port: port, login: 'u@test.local', password: 'pw' };
    const res = await mail.sendMail(box, { from: box.email, fromName: box.name, to: 'client@example.com', subject: 'Счёт № 15', text: 'Счёт во вложении', inReplyTo: '<q1@client>', attachments: [{ name: 'счёт.txt', fileId: 1 }] },
      () => ({ name: 'счёт.txt', mime: 'text/plain', content: Buffer.from('Итого: 1000 ₽') }));
    assert.match(res.messageId, /@test\.local>$/);
    const parsed = await simpleParser(received[0]);
    assert.equal(parsed.subject, 'Счёт № 15');
    assert.equal(parsed.inReplyTo, '<q1@client>');
    assert.equal(parsed.attachments[0].filename, 'счёт.txt');
    await assert.rejects(mail.sendMail({ ...box, password: 'wrong' }, { from: box.email, to: 'a@b.c', subject: 's', text: 't' }, () => null), /логин или пароль/);
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
  }
});

test('IMAP letters are parsed with attachments saved to disk', async () => {
  const raw = [
    'From: "Елена Смирнова" <e.smirnova@vector.example>', 'To: sales@vela.demo', 'Subject: =?UTF-8?B?0JfQsNC/0YDQvtGBINCa0J8=?=',
    'Message-ID: <abc@vector.example>', 'In-Reply-To: <out1@vela.demo>', 'Date: Thu, 22 Oct 2026 10:00:00 +0300', 'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b1"', '', '--b1', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '',
    'Добрый день! Реквизиты во вложении.', '--b1', 'Content-Type: application/pdf; name="rekv.pdf"', 'Content-Disposition: attachment; filename="rekv.pdf"',
    'Content-Transfer-Encoding: base64', '', Buffer.from('%PDF-1.4 test').toString('base64'), '--b1--', '',
  ].join('\r\n');
  const dir = mkdtempSync(join(tmpdir(), 'vela-mail-'));
  const m = mail.toIncoming(await simpleParser(Buffer.from(raw)), 'inbox', dir);
  assert.equal(m.subject, 'Запрос КП');
  assert.equal(m.from_name, 'Елена Смирнова');
  assert.equal(m.in_reply_to, '<out1@vela.demo>');
  assert.match(m.body!, /Реквизиты во вложении/);
  assert.equal(m.attachments?.[0].name, 'rekv.pdf');
  const stored = readdirSync(dir)[0];
  assert.equal(readFileSync(join(dir, stored), 'utf8'), '%PDF-1.4 test');
});

// ---------------- channels ----------------
test('channel tokens are never returned, replies go through the messenger', async () => {
  const ch = await call(admin, 'POST', '/api/channels', { kind: 'telegram', name: 'Бот', settings: { bot_token: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12345' } });
  assert.equal(ch.settings, undefined);
  const listed = await call(admin, 'GET', '/api/e/channels', undefined, { limit: '100' });
  assert.ok(listed.items.every((c: any) => c.settings === undefined));
  assert.equal((await call(admin, 'GET', `/api/channels/${ch.id}/settings`)).bot_token, '••••••');
  assert.equal((await req(orlov, 'GET', `/api/channels/${ch.id}/settings`)).status, 403);

  const { incomingMessage } = await import('../src/core/services/misc.ts');
  const ctx = { db, user: { id: 0, perms: {} } as any, deps, system: true };
  const conv = incomingMessage(ctx, { channel_id: ch.id, client_name: 'Иван', client_handle: 'tg:555', text: 'Привет', ext_id: '555:1' })!;
  assert.equal(incomingMessage(ctx, { channel_id: ch.id, client_name: 'Иван', client_handle: 'tg:555', text: 'Привет', ext_id: '555:1' }), null, 'duplicates skipped');
  let delivered: any = null;
  deps.integrations = { sendToChannel: async (c: any, handle: string, text: string) => { delivered = { token: JSON.parse(c.settings).bot_token, handle, text }; return { extId: '555:2' }; } } as unknown as Integrations;
  const ok = await call(admin, 'POST', `/api/conversations/${conv.id}/reply`, { text: 'Здравствуйте!' });
  assert.equal(ok.delivered, true);
  assert.equal(ok.channel, undefined, 'channel secrets are not sent to the browser');
  assert.deepEqual(delivered, { token: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12345', handle: 'tg:555', text: 'Здравствуйте!' });
  deps.integrations = { sendToChannel: async () => { throw new Error('Telegram: bot was blocked by the user'); } } as unknown as Integrations;
  const bad = await call(admin, 'POST', `/api/conversations/${conv.id}/reply`, { text: 'Вы тут?' });
  assert.equal(bad.delivered, false);
  assert.match(db.get(`SELECT send_error FROM conv_messages WHERE id = ?`, [bad.message.id]).send_error, /blocked/);
  deps.integrations = undefined;
});

test('WhatsApp message from a known phone is linked to the contact', async () => {
  const contact = db.get(`SELECT id, phone FROM contacts WHERE phone IS NOT NULL ORDER BY id DESC LIMIT 1`);
  const wa = db.get(`SELECT id FROM channels WHERE kind = 'whatsapp' LIMIT 1`).id;
  const { incomingMessage } = await import('../src/core/services/misc.ts');
  const ctx = { db, user: { id: 0, perms: {} } as any, deps, system: true };
  const phone = '7' + String(contact.phone).replace(/\D/g, '').slice(-10);
  const conv = incomingMessage(ctx, { channel_id: wa, client_name: 'Клиент', client_handle: `wa:${phone}`, text: 'Добрый день', phone, ext_id: 'wa-1' })!;
  assert.equal(conv.contact_id, contact.id);
});

test('website chat: visitor writes, operator answers, limits apply', async () => {
  const key = 'demo-site-chat-key';
  const visitor = 'v0123456789abcdef';
  const info = await handle(deps, { method: 'GET', path: `/api/public/chat/${key}`, query: {} });
  assert.equal(info.status, 200);
  const post = (text: string) => handle(deps, { method: 'POST', path: `/api/public/chat/${key}/messages`, query: {}, body: { visitor, name: 'Мария', text, page: 'https://site.example/prices' } });
  assert.equal((await post('Сколько стоит?')).status, 200);
  const conv = db.get(`SELECT id, client_name FROM conversations WHERE client_handle = ?`, [`web:${visitor}`]);
  assert.equal(conv.client_name, 'Мария');
  const r = await call(admin, 'POST', `/api/conversations/${conv.id}/reply`, { text: 'От 990 ₽ за пользователя' });
  assert.equal(r.delivered, true);
  const poll = await handle(deps, { method: 'GET', path: `/api/public/chat/${key}/messages`, query: { visitor, after: '0' } });
  assert.deepEqual(poll.body.messages.map((m: any) => m.direction), ['in', 'out']);
  assert.match(poll.body.messages[0].text, /Страница: https:\/\/site\.example\/prices/);
  assert.equal(poll.body.messages[1].operator, 'Алексей');
  const other = await handle(deps, { method: 'GET', path: `/api/public/chat/${key}/messages`, query: { visitor: 'zzzzzzzzzzzzzzzz', after: '0' } });
  assert.equal(other.body.messages.length, 0, 'another visitor sees nothing');
  assert.equal((await handle(deps, { method: 'GET', path: '/api/public/chat/wrong-key-123/messages', query: { visitor } })).status, 404);
  for (let i = 0; i < 9; i++) await post(`спам ${i}`);
  assert.equal((await post('ещё')).status, 429);
});
