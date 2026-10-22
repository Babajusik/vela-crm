import { can, create, getRaw, logActivity, onEvent, requirePerm, update, type Ctx } from '../crud.ts';
import { ENTITIES, ENTITY_LIST, entity } from '../schema.ts';
import { addDays, fail, localDate, nowIso, parseJson, round2, today } from '../util.ts';
import { balances, monthRange } from './finance.ts';

// ---------------- dashboard ----------------
export function dashboard(ctx: Ctx) {
  const uid = ctx.user.id;
  const now = new Date().toISOString().slice(0, 16);
  const t = today();
  const weekAgo = addDays(t, -7);
  const tasks = {
    open: ctx.db.get(`SELECT COUNT(*) c FROM tasks WHERE assignee_id = ? AND status NOT IN ('done','deferred')`, [uid])?.c ?? 0,
    overdue: ctx.db.get(`SELECT COUNT(*) c FROM tasks WHERE assignee_id = ? AND status != 'done' AND deadline IS NOT NULL AND deadline < ?`, [uid, now])?.c ?? 0,
    today: ctx.db.get(`SELECT COUNT(*) c FROM tasks WHERE assignee_id = ? AND status != 'done' AND substr(deadline,1,10) = ?`, [uid, t])?.c ?? 0,
    done_week: ctx.db.get(`SELECT COUNT(*) c FROM tasks WHERE assignee_id = ? AND status = 'done' AND completed_at >= ?`, [uid, weekAgo])?.c ?? 0,
    assigned_by_me: ctx.db.get(`SELECT COUNT(*) c FROM tasks WHERE author_id = ? AND assignee_id != ? AND status != 'done'`, [uid, uid])?.c ?? 0,
    list: ctx.db.all(`SELECT t.id, t.title, t.deadline, t.priority, t.status, p.name AS project FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.assignee_id = ? AND t.status NOT IN ('done','deferred') ORDER BY CASE WHEN t.deadline IS NULL THEN 1 ELSE 0 END, t.deadline LIMIT 8`, [uid]),
    team: ctx.db.all(`SELECT u.id, u.name, u.color,
        SUM(CASE WHEN t.status NOT IN ('done','deferred') THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN t.status != 'done' AND t.deadline < ? THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN t.status = 'done' AND t.completed_at >= ? THEN 1 ELSE 0 END) AS done_week
      FROM users u LEFT JOIN tasks t ON t.assignee_id = u.id WHERE u.is_active = 1 GROUP BY u.id ORDER BY open DESC LIMIT 10`, [now, weekAgo]),
  };
  const out: Record<string, any> = { tasks };
  if (can(ctx.user, 'crm', 'read')) {
    const pipe = ctx.db.get(`SELECT id, name FROM pipelines ORDER BY is_default DESC, sort, id LIMIT 1`);
    const funnel = pipe ? ctx.db.all(`SELECT s.id, s.name, s.color, s.kind, COUNT(d.id) AS count, COALESCE(SUM(d.amount),0) AS amount
      FROM stages s LEFT JOIN deals d ON d.stage_id = s.id WHERE s.pipeline_id = ? GROUP BY s.id ORDER BY s.sort, s.id`, [pipe.id]) : [];
    const range = monthRange(6);
    const wonByMonth = ctx.db.all(`SELECT substr(d.closed_at,1,7) AS month, COUNT(*) AS count, SUM(d.amount) AS amount FROM deals d JOIN stages s ON s.id = d.stage_id
      WHERE s.kind = 'won' AND d.closed_at >= ? GROUP BY month ORDER BY month`, [range.from]);
    const monthStart = t.slice(0, 8) + '01';
    const won = ctx.db.get(`SELECT COUNT(*) c, COALESCE(SUM(d.amount),0) s FROM deals d JOIN stages s ON s.id = d.stage_id WHERE s.kind='won' AND d.closed_at >= ?`, [monthStart]);
    const lost = ctx.db.get(`SELECT COUNT(*) c FROM deals d JOIN stages s ON s.id = d.stage_id WHERE s.kind='lost' AND d.closed_at >= ?`, [monthStart]);
    const open = ctx.db.get(`SELECT COUNT(*) c, COALESCE(SUM(d.amount),0) s FROM deals d JOIN stages s ON s.id = d.stage_id WHERE s.kind='open'`);
    const byManager = ctx.db.all(`SELECT u.id, u.name, u.color, COUNT(d.id) AS count, COALESCE(SUM(d.amount),0) AS amount FROM deals d JOIN stages s ON s.id = d.stage_id
      JOIN users u ON u.id = d.responsible_id WHERE s.kind='won' AND d.closed_at >= ? GROUP BY u.id ORDER BY amount DESC LIMIT 8`, [range.from]);
    const sources = ctx.db.all(`SELECT COALESCE(source,'other') AS source, COUNT(*) AS count FROM deals WHERE created_at >= ? GROUP BY source ORDER BY count DESC`, [range.from]);
    const invoices = {
      unpaid: ctx.db.get(`SELECT COUNT(*) c, COALESCE(SUM(total - COALESCE(paid_amount,0)),0) s FROM invoices WHERE status IN ('sent','partially_paid')`),
      overdue: ctx.db.get(`SELECT COUNT(*) c, COALESCE(SUM(total - COALESCE(paid_amount,0)),0) s FROM invoices WHERE status IN ('sent','partially_paid') AND due_date < ?`, [t]),
      paid_month: ctx.db.get(`SELECT COALESCE(SUM(o.amount),0) s FROM fin_operations o WHERE o.invoice_id IS NOT NULL AND o.kind='income' AND o.status='fact' AND o.date >= ?`, [monthStart]),
      draft: ctx.db.get(`SELECT COUNT(*) c FROM invoices WHERE status = 'draft'`),
      list: ctx.db.all(`SELECT i.id, i.number, i.date, i.due_date, i.total, i.paid_amount, i.status, c.name AS company FROM invoices i LEFT JOIN companies c ON c.id = i.company_id
        WHERE i.status IN ('sent','partially_paid') ORDER BY i.due_date LIMIT 8`),
      byStatus: ctx.db.all(`SELECT status, COUNT(*) AS count, COALESCE(SUM(total),0) AS amount FROM invoices GROUP BY status`),
    };
    const closed = (won?.c ?? 0) + (lost?.c ?? 0);
    out.sales = {
      pipeline: pipe, funnel, wonByMonth, byManager, sources,
      won_month: { count: won?.c ?? 0, amount: round2(won?.s ?? 0) }, open: { count: open?.c ?? 0, amount: round2(open?.s ?? 0) },
      conversion: closed ? Math.round(((won?.c ?? 0) / closed) * 100) : null,
    };
    out.invoices = invoices;
  }
  if (can(ctx.user, 'finance', 'read')) {
    const range = monthRange(6);
    const series = ctx.db.all(`SELECT substr(date,1,7) AS month, SUM(CASE WHEN kind='income' THEN amount ELSE 0 END) AS income, SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END) AS expense
      FROM fin_operations WHERE status='fact' AND date >= ? GROUP BY month ORDER BY month`, [range.from]);
    const acc = balances(ctx).filter((a) => !a.is_archived);
    const monthStart = t.slice(0, 8) + '01';
    const m = ctx.db.get(`SELECT SUM(CASE WHEN kind='income' THEN amount ELSE 0 END) i, SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END) e FROM fin_operations WHERE status='fact' AND date >= ?`, [monthStart]);
    out.finance = { accounts: acc, balance: round2(acc.reduce((s, a) => s + a.balance, 0)), series, income_month: round2(m?.i ?? 0), expense_month: round2(m?.e ?? 0) };
  }
  out.events = ctx.db.all(`SELECT * FROM events WHERE substr(start,1,10) = ? AND (owner_id = ? OR attendees LIKE ?) ORDER BY start`, [t, uid, `%${uid}%`]);
  const md = t.slice(5);
  out.birthdays = ctx.db.all(`SELECT id, name, birthday, color FROM users WHERE is_active = 1 AND birthday IS NOT NULL AND substr(birthday,6,5) >= ? ORDER BY substr(birthday,6,5) LIMIT 5`, [md]);
  out.absent = ctx.db.all(`SELECT a.*, u.name, u.color FROM absences a JOIN users u ON u.id = a.user_id WHERE a.date_from <= ? AND a.date_to >= ? AND a.status != 'rejected'`, [t, t]);
  out.activity = ctx.db.all(`SELECT a.*, u.name AS user_name, u.color AS user_color FROM activities a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 12`).map((a) => ({
    ...a, title: entityTitle(ctx, a.entity_type, a.entity_id),
  }));
  out.approvals = ctx.db.all(`SELECT id, name, data FROM bp_instances WHERE status='running'`).filter((r) => parseJson<any>(r.data, {}).pending?.user_id === uid).length;
  return out;
}

function entityTitle(ctx: Ctx, type: string, id: number): string {
  const e = ENTITIES[type];
  if (!e) return '';
  const r = ctx.db.get(`SELECT "${e.titleField}" AS t FROM "${type}" WHERE id = ?`, [id]);
  return r?.t != null ? String(r.t) : '';
}

// ---------------- search ----------------
const SEARCH_IN: [string, string, string, string][] = [
  ['companies', 'crm', '/crm/companies/', 'inn'], ['contacts', 'crm', '/crm/contacts/', 'phone'], ['deals', 'crm', '/crm/deals/', 'amount'],
  ['tasks', 'tasks', '/tasks/', 'status'], ['projects', 'projects', '/projects/', 'status'], ['invoices', 'crm', '/crm/invoices/', 'total'],
  ['products', 'catalog', '/catalog?product=', 'sku'], ['kb_articles', 'kb', '/kb/', 'title'], ['users', 'team', '/team/', 'position'],
];

export function search(ctx: Ctx, q: string) {
  const s = String(q ?? '').trim().toLowerCase();
  if (s.length < 2) return [];
  const out: { entity: string; label: string; id: number; title: string; sub: string; link: string }[] = [];
  for (const [key, mod, link, subField] of SEARCH_IN) {
    if (key !== 'users' && !can(ctx.user, mod, 'read')) continue;
    const e = ENTITIES[key];
    const sf = e.fields.filter((f) => f.search);
    if (key === 'invoices') sf.push({ key: 'number', label: '', type: 'text' });
    const where = sf.map((f) => `lower(COALESCE("${f.key}",'')) LIKE ?`).join(' OR ');
    const rows = ctx.db.all(`SELECT id, "${e.titleField}" AS title, "${subField}" AS sub FROM "${key}" WHERE ${where} LIMIT 5`, sf.map(() => `%${s}%`));
    for (const r of rows) {
      out.push({ entity: key, label: e.label, id: r.id, title: key === 'invoices' ? `Счёт № ${r.title}` : String(r.title ?? ''), sub: r.sub == null ? '' : String(r.sub), link: link + r.id });
    }
  }
  return out;
}

// ---------------- communications ----------------
export function replyConversation(ctx: Ctx, id: number, text: string) {
  requirePerm(ctx, 'communications', 'write');
  const conv = getRaw(ctx.db, 'conversations', id);
  if (!conv) fail(404, 'Диалог не найден');
  if (!String(text ?? '').trim()) fail(422, 'Введите текст сообщения');
  const msg = create({ ...ctx, system: true }, 'conv_messages', { conversation_id: id, direction: 'out', text, user_id: ctx.user.id });
  ctx.db.run(`UPDATE conversations SET last_message_at = ?, last_text = ?, status = CASE WHEN status = 'new' THEN 'open' ELSE status END,
    assignee_id = COALESCE(assignee_id, ?), unread = 0 WHERE id = ?`, [nowIso(), text, ctx.user.id, id]);
  const ch = conv!.channel_id ? getRaw(ctx.db, 'channels', conv!.channel_id) : null;
  return { message: msg, channel: ch ? { kind: ch.kind, settings: parseJson(ch.settings, {}) } : null, handle: conv!.client_handle };
}

export function incomingMessage(ctx: Ctx, body: { channel_id: number; client_name: string; client_handle: string; text: string }) {
  const sys: Ctx = { ...ctx, system: true };
  let conv = ctx.db.get(`SELECT * FROM conversations WHERE channel_id = ? AND client_handle = ? AND status != 'closed' ORDER BY id DESC LIMIT 1`, [body.channel_id, body.client_handle]);
  const ch = getRaw(ctx.db, 'channels', body.channel_id);
  if (!conv) {
    const contact = ctx.db.get(`SELECT id, company_id FROM contacts WHERE telegram = ? OR phone = ? LIMIT 1`, [body.client_handle, body.client_handle]);
    conv = create(sys, 'conversations', { channel_id: body.channel_id, client_name: body.client_name, client_handle: body.client_handle, status: 'new',
      contact_id: contact?.id ?? null, company_id: contact?.company_id ?? null, assignee_id: ch?.responsible_id ?? null, unread: 0 });
  }
  create(sys, 'conv_messages', { conversation_id: conv!.id, direction: 'in', text: body.text });
  ctx.db.run(`UPDATE conversations SET last_message_at = ?, last_text = ?, unread = COALESCE(unread,0) + 1 WHERE id = ?`, [nowIso(), body.text, conv!.id]);
  if (conv!.assignee_id) {
    ctx.db.run(`INSERT INTO notifications (user_id, text, link, is_read, kind, created_at, updated_at) VALUES (?,?,?,0,'system',?,?)`,
      [conv!.assignee_id, `Новое сообщение от ${body.client_name}`, `/communications?c=${conv!.id}`, nowIso(), nowIso()]);
  }
  ctx.deps.onWrite?.();
  return getRaw(ctx.db, 'conversations', conv!.id);
}

const DEMO_CLIENTS = [
  ['Ирина Белова', '@irina_b', 'Добрый день! Подскажите, сколько стоит внедрение для 15 сотрудников?'],
  ['Олег Карпов', '+7 916 555-12-90', 'Здравствуйте, можно счёт на продление на ООО «Вектор»?'],
  ['Мария Соколова', '@msokolova', 'А у вас есть интеграция с 1С:УНФ?'],
  ['Денис Литвинов', 'denis@techsnab.ru', 'Пришлите, пожалуйста, акт сверки за квартал'],
  ['Анна Крылова', '@anna_kr', 'Хотим демо на следующей неделе, когда удобно?'],
];

export function simulateIncoming(ctx: Ctx) {
  const channels = ctx.db.all(`SELECT id FROM channels WHERE is_active = 1`);
  if (!channels.length) fail(422, 'Подключите хотя бы один канал');
  const i = Math.floor(Math.random() * DEMO_CLIENTS.length);
  const [name, handle, text] = DEMO_CLIENTS[i];
  return incomingMessage(ctx, { channel_id: channels[i % channels.length].id, client_name: name, client_handle: handle, text });
}

export function conversationToDeal(ctx: Ctx, id: number) {
  requirePerm(ctx, 'crm', 'write');
  const conv = getRaw(ctx.db, 'conversations', id);
  if (!conv) fail(404, 'Диалог не найден');
  let contactId = conv!.contact_id;
  if (!contactId) {
    const isTg = String(conv!.client_handle ?? '').startsWith('@');
    contactId = create(ctx, 'contacts', { name: conv!.client_name, telegram: isTg ? conv!.client_handle : null, phone: !isTg ? conv!.client_handle : null, source: 'messenger', responsible_id: ctx.user.id }).id;
  }
  const deal = create(ctx, 'deals', { title: `Обращение: ${conv!.client_name}`, contact_id: contactId, company_id: conv!.company_id, source: 'messenger', responsible_id: ctx.user.id });
  const msgs = ctx.db.all(`SELECT * FROM conv_messages WHERE conversation_id = ? ORDER BY id`, [id]);
  logActivity(ctx, 'deals', deal.id, 'comment', 'Переписка из диалога:\n' + msgs.map((m) => `${m.direction === 'in' ? conv!.client_name : 'Мы'}: ${m.text}`).join('\n'));
  ctx.db.run(`UPDATE conversations SET deal_id = ?, contact_id = ? WHERE id = ?`, [deal.id, contactId, id]);
  ctx.deps.onWrite?.();
  return deal;
}

// ---------------- mail ----------------
export function sendMail(ctx: Ctx, body: { mailbox_id?: number; to: string; cc?: string; subject: string; body: string; company_id?: number; contact_id?: number; deal_id?: number }) {
  requirePerm(ctx, 'mail', 'write');
  if (!body.to || !/@/.test(body.to)) fail(422, 'Укажите адрес получателя');
  const box = body.mailbox_id ? getRaw(ctx.db, 'mailboxes', body.mailbox_id) : ctx.db.get(`SELECT * FROM mailboxes WHERE user_id = ? OR user_id IS NULL ORDER BY user_id DESC LIMIT 1`, [ctx.user.id]);
  const m = create({ ...ctx, system: true }, 'mails', {
    mailbox_id: box?.id ?? null, folder: 'sent', from_addr: box?.email ?? ctx.user.email, from_name: box?.name ?? ctx.user.name, to_addr: body.to, cc: body.cc,
    subject: body.subject, body: body.body, date: nowIso(), is_read: 1, company_id: body.company_id, contact_id: body.contact_id, deal_id: body.deal_id,
  });
  if (body.deal_id) logActivity(ctx, 'deals', body.deal_id, 'email', `Письмо «${body.subject}» → ${body.to}`);
  if (body.company_id) logActivity(ctx, 'companies', body.company_id, 'email', `Письмо «${body.subject}» → ${body.to}`);
  return { mail: m, mailbox: box ? { ...box } : null };
}

// ---------------- CSV import / export ----------------
export function importRows(ctx: Ctx, body: { entity: string; rows: Record<string, unknown>[]; dedupe?: string }) {
  const ent = entity(body.entity);
  requirePerm(ctx, ent.module, 'write');
  if (!Array.isArray(body.rows) || !body.rows.length) fail(422, 'Нет строк для загрузки');
  let created = 0, updated = 0;
  const errors: { row: number; error: string }[] = [];
  const refs = ent.fields.filter((f) => f.type === 'ref' || f.type === 'user');
  ctx.db.tx(() => {
    body.rows.forEach((raw, i) => {
      try {
        const data: Record<string, unknown> = { ...raw };
        // resolve references given as titles
        for (const f of refs) {
          const v = data[f.key];
          if (v == null || v === '' || /^\d+$/.test(String(v))) continue;
          const t = ENTITIES[f.ref!];
          const r = ctx.db.get(`SELECT id FROM "${t.key}" WHERE lower("${t.titleField}") = lower(?)`, [String(v).trim()]);
          data[f.key] = r?.id ?? null;
        }
        for (const f of ent.fields) {
          if (f.type === 'select' && data[f.key] != null) {
            const v = String(data[f.key]).trim();
            const opt = f.options?.find((o) => o.value === v || o.label.toLowerCase() === v.toLowerCase());
            data[f.key] = opt?.value ?? null;
          }
        }
        const dk = body.dedupe;
        const existing = dk && data[dk] ? ctx.db.get(`SELECT id FROM "${ent.key}" WHERE "${dk}" = ?`, [data[dk]]) : null;
        if (existing) {
          const fields = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== '' && v != null));
          update(ctx, ent.key, existing.id, fields);
          updated++;
        } else {
          create(ctx, ent.key, data);
          created++;
        }
      } catch (e) {
        errors.push({ row: i + 1, error: (e as Error).message });
      }
    });
  });
  ctx.deps.onWrite?.();
  return { created, updated, errors: errors.slice(0, 50), errorCount: errors.length };
}

export function exportCsv(ctx: Ctx, entityKey: string, rows: Record<string, any>[]): { filename: string; content: string } {
  const ent = entity(entityKey);
  const fields = ent.fields.filter((f) => !f.internal && f.type !== 'json');
  const esc = (v: unknown) => {
    const s = v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['ID', ...fields.map((f) => f.label)].map(esc).join(';');
  const lines = rows.map((r) => [r.id, ...fields.map((f) => {
    const v = r[f.key];
    if ((f.type === 'ref' || f.type === 'user') && r._ref?.[f.key]) return r._ref[f.key].title;
    if (f.type === 'users' && Array.isArray(r._ref?.[f.key])) return r._ref[f.key].map((x: any) => x.title).join(', ');
    if (f.type === 'select') return f.options?.find((o) => o.value === String(v))?.label ?? v;
    if (f.type === 'bool') return v ? 'Да' : 'Нет';
    return v;
  })].map(esc).join(';'));
  return { filename: `${ent.key}-${today()}.csv`, content: '﻿' + [head, ...lines].join('\r\n') };
}

// ---------------- backup ----------------
export function backupExport(ctx: Ctx) {
  requirePerm(ctx, 'settings', 'admin');
  const tables: Record<string, unknown[]> = {};
  for (const e of ENTITY_LIST) tables[e.key] = ctx.db.all(`SELECT * FROM "${e.key}"`);
  tables.settings = ctx.db.all(`SELECT * FROM settings`);
  return { app: 'vela-crm', version: 1, exported_at: nowIso(), tables };
}

export function backupRestore(ctx: Ctx, dump: { app?: string; tables?: Record<string, Record<string, unknown>[]> }) {
  requirePerm(ctx, 'settings', 'admin');
  if (dump?.app !== 'vela-crm' || !dump.tables) fail(422, 'Это не резервная копия Vela CRM');
  ctx.db.tx(() => {
    for (const [table, rows] of Object.entries(dump.tables!)) {
      if (table !== 'settings' && !ENTITIES[table]) continue;
      ctx.db.run(`DELETE FROM "${table}"`);
      const cols = new Set(ctx.db.all<{ name: string }>(`PRAGMA table_info("${table}")`).map((c) => c.name));
      for (const r of rows) {
        const keys = Object.keys(r).filter((k) => cols.has(k));
        ctx.db.run(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map((k) => r[k] as any));
      }
    }
  });
  ctx.deps.onWrite?.();
  return { ok: true };
}

// ---------------- settings ----------------
const PUBLIC_SETTINGS = new Set(['company', 'appearance', 'lost_reasons', 'dashboard', 'modules']);

export function getSetting(ctx: Ctx, key: string): unknown {
  return parseJson(ctx.db.get(`SELECT value FROM settings WHERE key = ?`, [key])?.value, null);
}

export function setSetting(ctx: Ctx, key: string, value: unknown) {
  if (!PUBLIC_SETTINGS.has(key) && key !== 'onec') fail(404, 'Неизвестная настройка');
  requirePerm(ctx, 'settings', 'admin');
  ctx.db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, JSON.stringify(value)]);
  ctx.deps.onWrite?.();
  return value;
}

export function readSettings(ctx: Ctx) {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_SETTINGS) out[k] = getSetting(ctx, k);
  return out;
}

// ---------------- calendar feed ----------------
export function calendarFeed(ctx: Ctx, q: { from: string; to: string; user_id?: string }) {
  const from = q.from ?? addDays(today(), -31), to = q.to ?? addDays(today(), 62);
  const uid = Number(q.user_id) || null;
  const events = ctx.db.all(`SELECT e.*, u.name AS owner_name FROM events e LEFT JOIN users u ON u.id = e.owner_id
    WHERE substr(e.start,1,10) <= ? AND substr(COALESCE(e.end, e.start),1,10) >= ? ${uid ? 'AND (e.owner_id = ? OR e.attendees LIKE ?)' : ''} ORDER BY e.start`,
    uid ? [to, from, uid, `%${uid}%`] : [to, from]).map((e) => ({ ...e, attendees: parseJson(e.attendees, []), type: 'event' }));
  const tasks = ctx.db.all(`SELECT id, title, deadline, status, priority FROM tasks WHERE deadline IS NOT NULL AND substr(deadline,1,10) BETWEEN ? AND ? ${uid ? 'AND assignee_id = ?' : ''}`,
    uid ? [from, to, uid] : [from, to]).map((t) => ({ id: t.id, title: t.title, start: t.deadline, end: t.deadline, type: 'task', status: t.status, priority: t.priority }));
  const absences = ctx.db.all(`SELECT a.*, u.name FROM absences a JOIN users u ON u.id = a.user_id WHERE a.date_from <= ? AND a.date_to >= ? AND a.status != 'rejected'`, [to, from]);
  return { from, to, events, tasks, absences };
}

// ---------------- notifications ----------------
export function notificationsFor(ctx: Ctx) {
  const items = ctx.db.all(`SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 40`, [ctx.user.id]);
  const unread = ctx.db.get(`SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0`, [ctx.user.id])?.c ?? 0;
  return { items, unread };
}

export function readAllNotifications(ctx: Ctx) {
  ctx.db.run(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [ctx.user.id]);
  ctx.deps.onWrite?.();
  return { ok: true };
}

// ---------------- webhooks ----------------
const pendingHooks: { url: string; secret?: string; body: string }[] = [];
export function drainWebhooks() { return pendingHooks.splice(0, pendingHooks.length); }

onEvent((ctx, event, payload) => {
  if (ctx.deps.mode !== 'server') return;
  if (event === 'webhook.direct') {
    pendingHooks.push({ url: payload.url, body: JSON.stringify({ event: payload.event, data: payload.data, sent_at: nowIso() }) });
    return;
  }
  const hooks = ctx.db.all(`SELECT * FROM webhooks WHERE is_active = 1`);
  for (const h of hooks) {
    const events = parseJson<string[]>(h.events, []);
    if (events.length && !events.includes(event) && !events.includes('*')) continue;
    pendingHooks.push({ url: h.url, secret: h.secret, body: JSON.stringify({ event, data: payload, sent_at: nowIso() }) });
    ctx.db.run(`UPDATE webhooks SET last_sent_at = ? WHERE id = ?`, [nowIso(), h.id]);
  }
});

export { localDate };

// keep chat order fresh when someone writes
import { hook as registerHook } from '../crud.ts';
registerHook('messages', {
  beforeSave(ctx, data, old) { if (!old && !data.user_id) data.user_id = ctx.user?.id ?? null; },
  afterCreate(ctx, row) { ctx.db.run(`UPDATE chats SET last_message_at = ? WHERE id = ?`, [nowIso(), row.chat_id]); },
});

// stock moves change product balances
registerHook('stock_moves', {
  afterCreate(ctx, row) {
    const q = Number(row.qty) || 0;
    if (row.kind === 'adjust') ctx.db.run(`UPDATE products SET stock = ? WHERE id = ?`, [q, row.product_id]);
    else ctx.db.run(`UPDATE products SET stock = COALESCE(stock,0) + ? WHERE id = ?`, [row.kind === 'out' ? -q : q, row.product_id]);
  },
  afterDelete(ctx, row) {
    const q = Number(row.qty) || 0;
    if (row.kind !== 'adjust') ctx.db.run(`UPDATE products SET stock = COALESCE(stock,0) - ? WHERE id = ?`, [row.kind === 'out' ? -q : q, row.product_id]);
  },
});
