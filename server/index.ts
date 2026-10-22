// Vela CRM server: REST API, static frontend, 1C exchange (CommerceML), files, mail, messengers, telephony, webhooks.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { openDb } from './db.ts';
import { init, handle, systemUser, drainWebhooks, type Deps } from '../src/core/index.ts';
import { bootstrap } from '../src/core/seed.ts';
import { cml, odata } from '../src/core/router.ts';
import * as parity from '../src/core/services/parity.ts';
import { incomingMessage } from '../src/core/services/misc.ts';
import * as comms from '../src/core/services/comms.ts';
import * as tel from '../src/core/services/telephony.ts';
import { userByToken } from '../src/core/services/auth.ts';
import { create, get, getRaw, isHttpError } from '../src/core/crud.ts';
import * as mail from './mail.ts';
import * as channels from './channels.ts';
import * as telephony from './telephony.ts';

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = resolve(process.env.DATA_DIR ?? './data');
const DIST = resolve(process.env.STATIC_DIR ?? './dist');
const DEMO = process.env.DEMO === '1';
const MAX_BODY = 25 * 1024 * 1024;

mkdirSync(join(DATA_DIR, 'files'), { recursive: true });
mkdirSync(join(DATA_DIR, '1c'), { recursive: true });

const db = openDb(join(DATA_DIR, 'vela.db'));
const FILES_DIR = join(DATA_DIR, 'files');
const deps: Deps = { db, mode: 'server', fetch: globalThis.fetch, log: (...a) => console.error(new Date().toISOString(), ...a) };
const sys = () => ({ db, user: systemUser(deps), deps, system: true });

/** Bytes of a stored file, for mail attachments. */
function readStoredFile(id: number) {
  const f = getRaw(db, 'files', id);
  if (!f) return null;
  const path = String(f.path ?? '');
  if (path.startsWith('data:')) {
    const [meta, data] = path.split(',');
    return { name: f.name, mime: f.mime, content: meta.includes(';base64') ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8') };
  }
  const p = join(FILES_DIR, path.replace(/^disk:/, '').replace(/[\\/]/g, ''));
  return existsSync(p) ? { name: f.name, mime: f.mime, content: readFileSync(p) } : null;
}

function syncBox(box: Record<string, any>) {
  return mail.syncMailbox(box, FILES_DIR,
    (m) => { comms.incomingMail(sys(), box.id, m); },
    (state) => { db.run(`UPDATE mailboxes SET imap_state = ? WHERE id = ?`, [JSON.stringify(state), box.id]); });
}

deps.integrations = {
  sendMail: (box, m) => mail.sendMail(box, m, readStoredFile),
  testMailbox: (box) => mail.testMailbox(box),
  syncMailbox: (box) => syncBox(box),
  sendToChannel: (ch, handle, text) => channels.sendToChannel(fetch, ch, handle, text),
  testChannel: (ch) => channels.testChannel(fetch, ch),
  callTo: (s, ext, phone) => telephony.callTo(fetch, s as tel.TelephonySettings, ext, phone),
};
await init(db, { demo: DEMO });
if (!DEMO) {
  const email = process.env.ADMIN_EMAIL ?? 'admin@company.local';
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(9).toString('base64url');
  if (!db.get('SELECT id FROM users LIMIT 1')) {
    await bootstrap(db, { name: process.env.ADMIN_NAME ?? 'Администратор', email, password, company: process.env.COMPANY_NAME ?? 'Моя компания' });
    console.log(`\n  Создан администратор: ${email}\n  Пароль: ${password}\n  Смените пароль после первого входа.\n`);
  }
}

// ---------------- helpers ----------------
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { fail(Object.assign(new Error('Слишком большой запрос'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const isText = typeof body === 'string';
  res.writeHead(status, {
    'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(isText ? body : JSON.stringify(body));
}

function tokenOf(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  return undefined;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (!existsSync(DIST)) return send(res, 404, 'Фронтенд не собран: выполните npm run build');
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([.][.][/\\])+/, '');
  let file = join(DIST, safe);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const ext = extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': file.includes(`${join('assets', '')}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  createReadStream(file).pipe(res);
}

// ---------------- 1C CommerceML exchange ----------------
const cmlSessions = new Map<string, number>();

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function exchange1c(req: IncomingMessage, res: ServerResponse, q: URLSearchParams) {
  const ctx = { db, user: systemUser(deps), deps, system: true };
  const s = odata.onecSettings(ctx);
  const reply = (text: string) => send(res, 200, text);
  if (!s.cml_enabled) return reply('failure\nОбмен CommerceML выключен в настройках Vela CRM');
  const type = q.get('type') ?? '';
  const mode = q.get('mode') ?? '';
  if (mode === 'checkauth') {
    const auth = req.headers.authorization ?? '';
    const [login, password] = Buffer.from(auth.replace(/^Basic\s+/i, ''), 'base64').toString('utf8').split(':');
    if (!s.cml_password || !safeEqual(login ?? '', s.cml_login) || !safeEqual(password ?? '', s.cml_password)) return reply('failure\nНеверный логин или пароль');
    const sid = randomBytes(16).toString('hex');
    cmlSessions.set(sid, Date.now());
    return reply(`success\nvela_cml\n${sid}\n`);
  }
  const sid = /vela_cml=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1] ?? q.get('sessid') ?? '';
  const started = cmlSessions.get(sid);
  if (!started || Date.now() - started > 3600_000) return reply('failure\nСессия обмена не авторизована');
  const dir = join(DATA_DIR, '1c');
  const fname = (q.get('filename') ?? '').replace(/[^\w.\-]/g, '_');
  try {
    if (mode === 'init') {
      if (type === 'catalog') for (const f of ['import.xml', 'offers.xml']) { const p = join(dir, f); if (existsSync(p)) unlinkSync(p); }
      return reply('zip=no\nfile_limit=20971520\n');
    }
    if (mode === 'file') {
      if (!fname) return reply('failure\nНе указано имя файла');
      const body = await readBody(req);
      appendFileSync(join(dir, fname), body);
      if (type === 'sale') {
        const r = cml.importOrders(ctx, readFileSync(join(dir, fname), 'utf8'));
        unlinkSync(join(dir, fname));
        return reply(`success\nОбновлено заказов: ${r.matched}`);
      }
      return reply('success');
    }
    if (mode === 'import') {
      const p = join(dir, fname);
      if (!existsSync(p)) return reply('failure\nФайл не найден: ' + fname);
      const xml = readFileSync(p, 'utf8');
      const kind = cml.detectKind(xml);
      if (kind === 'catalog') cml.importCatalog(ctx, xml);
      else if (kind === 'offers') cml.importOffers(ctx, xml);
      unlinkSync(p);
      return reply('success');
    }
    if (type === 'sale' && mode === 'query') {
      const xml = cml.exportOrders(ctx);
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
      return res.end(xml);
    }
    if (type === 'sale' && mode === 'success') { cml.markOrdersExported(ctx); return reply('success'); }
    if (mode === 'complete' || mode === 'deactivate') return reply('success');
    return reply('failure\nНеизвестный режим обмена: ' + mode);
  } catch (e) {
    deps.log?.('1C exchange failed', e);
    return reply('failure\n' + (e as Error).message);
  }
}

// ---------------- files ----------------
async function uploadFile(req: IncomingMessage, res: ServerResponse, q: URLSearchParams) {
  const user = await userByToken(db, tokenOf(req));
  if (!user) return send(res, 401, { error: 'Требуется вход в систему' });
  const name = (q.get('name') ?? 'file').slice(0, 200);
  const body = await readBody(req);
  const ctx = { db, user, deps };
  const row = create(ctx, 'files', {
    name, folder_id: q.get('folder_id') ? Number(q.get('folder_id')) : null, entity_type: q.get('entity_type'), entity_id: q.get('entity_id') ? Number(q.get('entity_id')) : null,
  });
  const stored = `${row.id}-${randomBytes(6).toString('hex')}`;
  writeFileSync(join(DATA_DIR, 'files', stored), body);
  db.run(`UPDATE files SET size = ?, mime = ?, path = ? WHERE id = ?`, [body.length, String(req.headers['content-type'] ?? 'application/octet-stream'), `disk:${stored}`, row.id]);
  return send(res, 200, getRaw(db, 'files', row.id));
}

async function downloadFile(req: IncomingMessage, res: ServerResponse, id: number, q: URLSearchParams) {
  const user = await userByToken(db, tokenOf(req) ?? q.get('token') ?? undefined);
  if (!user) return send(res, 401, { error: 'Требуется вход в систему' });
  try { get({ db, user, deps }, 'files', id); } catch (e) { return send(res, isHttpError(e) ? (e as any).status : 500, { error: (e as Error).message }); }
  const f = getRaw(db, 'files', id)!;
  if (String(f.path ?? '').startsWith('data:')) {
    const [meta, data] = String(f.path).split(',');
    const buf = meta.includes(';base64') ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
    res.writeHead(200, { 'Content-Type': f.mime ?? 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` });
    return res.end(buf);
  }
  const p = join(DATA_DIR, 'files', String(f.path ?? '').replace(/^disk:/, '').replace(/[\\/]/g, ''));
  if (!existsSync(p)) return send(res, 404, { error: 'Файл отсутствует на диске' });
  res.writeHead(200, { 'Content-Type': f.mime ?? 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'X-Content-Type-Options': 'nosniff' });
  createReadStream(p).pipe(res);
}

// ---------------- telephony hook ----------------
async function telephonyHook(req: IncomingMessage, res: ServerResponse, path: string, q: URLSearchParams) {
  const [, token = '', ...rest] = path.slice('/api/telephony/hook'.length).split('/');
  const s = tel.telephonySettings(sys());
  if (!s.hook_token || !safeEqual(token, s.hook_token)) return send(res, 404, 'not found');
  const raw = req.method === 'POST' ? (await readBody(req)).toString('utf8') : '';
  const out = telephony.parseHook(fetch, s, req.method ?? 'GET', '/' + rest.join('/'), q, raw);
  send(res, out.status, out.body);
  for (const ev of out.events) {
    try { tel.callEvent(sys(), ev); } catch (e) { deps.log?.('call event failed', ev, (e as Error).message); }
  }
  if (out.after) {
    out.after().then((evs) => evs.forEach((ev) => tel.callEvent(sys(), ev))).catch((e) => deps.log?.('call record link failed', e.message));
  }
}

// ---------------- messengers and mail polling ----------------
async function pollChannels() {
  const list = db.all(`SELECT * FROM channels WHERE is_active = 1 AND kind IN ('telegram','vk','avito','whatsapp')`);
  await channels.pollChannels(fetch, list,
    (m) => { incomingMessage(sys(), m); },
    (id, error) => comms.markChannel(sys(), id, { error }),
    (channelId, handle) => !!db.get(`SELECT id FROM conversations WHERE channel_id = ? AND client_handle = ? LIMIT 1`, [channelId, handle]));
}

let mailBusy = false;
async function pollMail() {
  if (mailBusy) return;
  mailBusy = true;
  try {
    for (const box of db.all(`SELECT * FROM mailboxes WHERE is_active = 1 AND imap_host IS NOT NULL AND imap_host != '' AND password IS NOT NULL`)) {
      try {
        await syncBox(box);
        comms.markMailboxSync(sys(), box.id, null);
      } catch (e) {
        comms.markMailboxSync(sys(), box.id, (e as Error).message);
      }
    }
  } finally {
    mailBusy = false;
  }
}

// ---------------- webhooks ----------------
async function flushWebhooks() {
  for (const h of drainWebhooks()) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'VelaCRM-Webhook/1.0' };
    if (h.secret) headers['X-Vela-Signature'] = 'sha256=' + createHmac('sha256', h.secret).update(h.body).digest('hex');
    fetch(h.url, { method: 'POST', headers, body: h.body, signal: AbortSignal.timeout(10000) }).catch((e) => deps.log?.('webhook failed', h.url, e.message));
  }
}

// ---------------- server ----------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  try {
    if (path === '/api/1c/exchange' || path === '/1c_exchange.php' || path === '/bitrix/admin/1c_exchange.php') return await exchange1c(req, res, url.searchParams);
    if (path === '/api/files/upload' && (req.method === 'PUT' || req.method === 'POST')) return await uploadFile(req, res, url.searchParams);
    if (path.startsWith('/api/telephony/hook/')) return await telephonyHook(req, res, path, url.searchParams);
    // the website chat widget runs on the client's site
    if (path.startsWith('/api/public/chat/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    }
    const dl = /^\/api\/files\/(\d+)\/download$/.exec(path);
    if (dl && req.method === 'GET') return await downloadFile(req, res, Number(dl[1]), url.searchParams);
    if (path.startsWith('/api/')) {
      let body: unknown;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const raw = await readBody(req);
        body = raw.length ? JSON.parse(raw.toString('utf8')) : undefined;
      }
      const result = await handle(deps, { method: req.method ?? 'GET', path, query: Object.fromEntries(url.searchParams), body, token: tokenOf(req) });
      send(res, result.status, result.body, result.headers);
      flushWebhooks();
      return;
    }
    return serveStatic(req, res, path);
  } catch (e) {
    const status = (e as any).status ?? (e instanceof SyntaxError ? 400 : 500);
    if (status === 500) deps.log?.('request failed', path, e);
    if (!res.headersSent) send(res, status, { error: status === 400 ? 'Некорректный JSON' : (e as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`Vela CRM запущена: http://localhost:${PORT}${DEMO ? ' (демо-данные, вход admin@vela.demo / demo1234)' : ''}`);
});

setInterval(() => { pollChannels().catch((e) => deps.log?.('channels poll failed', e.message)); }, 5000);
setInterval(() => { pollMail().catch((e) => deps.log?.('mail poll failed', e.message)); }, 120_000);
setTimeout(() => { pollMail().catch(() => {}); }, 10_000);
let lastAutoSync = 0;
setInterval(async () => {
  const ctx = { db, user: systemUser(deps), deps, system: true };
  const s = odata.onecSettings(ctx);
  if (!s.interval_min || !s.url || Date.now() - lastAutoSync < s.interval_min * 60000) return;
  lastAutoSync = Date.now();
  try { await odata.onecSync(ctx); } catch (e) { deps.log?.('scheduled 1C sync failed', (e as Error).message); }
}, 60_000);
setInterval(() => { for (const [k, t] of cmlSessions) if (Date.now() - t > 3600_000) cmlSessions.delete(k); }, 600_000);
// regular invoices are issued once their date comes
setInterval(() => { try { parity.processRecurring({ db, user: systemUser(deps), deps, system: true }); } catch (e) { deps.log?.('recurring invoices failed', e); } }, 3600_000);
