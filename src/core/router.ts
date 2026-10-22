import { can, create, get, getRaw, isHttpError, list, logActivity, remove, requirePerm, update, type Ctx } from './crud.ts';
import { ENTITY_LIST, MODULES, entity } from './schema.ts';
import type { Deps, Req, Res, User } from './types.ts';
import { fail, nowIso, parseJson } from './util.ts';
import { createApiKey, loadUser, login, logout, setPassword, userByToken } from './services/auth.ts';
import * as crm from './services/crm.ts';
import * as work from './services/work.ts';
import * as fin from './services/finance.ts';
import * as bp from './services/bp.ts';
import * as docs from './services/docs.ts';
import * as misc from './services/misc.ts';
import * as odata from './onec/odata.ts';
import * as parity from './services/parity.ts';
import * as cml from './onec/commerceml.ts';
import { hashPassword } from './util.ts';

type Handler = (c: Ctx, p: Record<string, string>, req: Req) => unknown | Promise<unknown>;
interface Route { method: string; re: RegExp; keys: string[]; h: Handler; pub?: boolean }
const ROUTES: Route[] = [];

function r(method: string, pattern: string, h: Handler, pub = false) {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  ROUTES.push({ method, re, keys, h, pub });
}

const num = (s: string) => Number(s);
const SENSITIVE_USER_FIELDS = ['salary', 'hour_rate'];

function hideSalaries(c: Ctx, items: Record<string, any>[]) {
  if (can(c.user, 'finance', 'read') || can(c.user, 'team', 'admin')) return items;
  for (const it of items) for (const k of SENSITIVE_USER_FIELDS) delete it[k];
  return items;
}

// ---------------- auth ----------------
r('POST', '/api/auth/login', async (c, _p, req) => login(c.db, req.body?.email, req.body?.password), true);
r('POST', '/api/auth/logout', (c, _p, req) => { logout(c.db, req.token); return { ok: true }; });
r('GET', '/api/auth/me', (c) => ({ user: c.user, settings: misc.readSettings(c) }));
r('POST', '/api/auth/password', async (c, _p, req) => {
  const row = c.db.get(`SELECT password_hash FROM users WHERE id = ?`, [c.user.id]);
  const { verifyPassword } = await import('./util.ts');
  if (!(await verifyPassword(String(req.body?.old ?? ''), row?.password_hash))) fail(422, 'Текущий пароль указан неверно');
  await setPassword(c.db, c.user.id, String(req.body?.password ?? ''));
  return { ok: true };
});
r('GET', '/api/health', () => ({ ok: true, app: 'vela-crm', time: nowIso() }), true);

// ---------------- meta ----------------
r('GET', '/api/meta', (c) => ({
  entities: ENTITY_LIST.map((e) => ({ ...e, fields: e.fields.filter((f) => !f.internal) })),
  modules: MODULES,
  customFields: c.db.all(`SELECT * FROM custom_fields ORDER BY entity, sort, id`).map((f) => ({ ...f, options: parseJson(f.options, []) })),
  settings: misc.readSettings(c),
}));

// ---------------- generic CRUD ----------------
r('GET', '/api/e/:entity', (c, p, req) => {
  const res = list(c, p.entity, req.query);
  if (p.entity === 'users') hideSalaries(c, res.items);
  return res;
});
r('GET', '/api/e/:entity/:id', (c, p) => {
  const item = get(c, p.entity, p.id);
  if (p.entity === 'users') hideSalaries(c, [item]);
  if (p.entity === 'kb_articles') c.db.run(`UPDATE kb_articles SET views = COALESCE(views,0) + 1 WHERE id = ?`, [num(p.id)]);
  if (p.entity === 'tasks') parity.markTaskViewed(c, item);
  return item;
});
r('POST', '/api/e/:entity', (c, p, req) => create(c, p.entity, req.body ?? {}));
r('PATCH', '/api/e/:entity/:id', (c, p, req) => update(c, p.entity, p.id, req.body ?? {}));
r('DELETE', '/api/e/:entity/:id', (c, p) => {
  if (p.entity === 'users' && num(p.id) === c.user.id) fail(422, 'Нельзя удалить самого себя');
  return remove(c, p.entity, p.id);
});
r('POST', '/api/e/:entity/bulk', (c, p, req) => {
  const ids: number[] = (req.body?.ids ?? []).map(Number);
  let n = 0;
  c.db.tx(() => {
    for (const id of ids) {
      if (req.body?.action === 'delete') remove(c, p.entity, id);
      else update(c, p.entity, id, req.body?.data ?? {});
      n++;
    }
  });
  return { ok: true, count: n };
});
r('GET', '/api/e/:entity/:id/timeline', (c, p) => {
  const ent = entity(p.entity);
  requirePerm(c, ent.module, 'read');
  const items = c.db.all(`SELECT a.*, u.name AS user_name, u.color AS user_color FROM activities a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.entity_type = ? AND a.entity_id = ? ORDER BY a.id DESC LIMIT 200`, [p.entity, num(p.id)]);
  return items.map((a) => ({ ...a, meta: parseJson(a.meta, null), likes: parseJson(a.likes, []) }));
});
r('POST', '/api/e/:entity/:id/comment', (c, p, req) => {
  const ent = entity(p.entity);
  requirePerm(c, ent.module, 'read');
  const text = String(req.body?.text ?? '').trim();
  if (!text) fail(422, 'Введите текст');
  if (!getRaw(c.db, ent.key, p.id)) fail(404, 'Запись не найдена');
  const kind = ['comment', 'call', 'meeting', 'email'].includes(req.body?.kind) ? req.body.kind : 'comment';
  if (req.body?.parent_id) {
    c.db.run(`INSERT INTO activities (entity_type, entity_id, kind, text, user_id, parent_id, created_at, updated_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
      [ent.key, num(p.id), 'comment', text, c.user.id, Number(req.body.parent_id), nowIso(), nowIso(), c.user.id]);
  } else logActivity(c, ent.key, num(p.id), kind, text);
  // mentions: @Имя Фамилия
  for (const u of c.db.all(`SELECT id, name FROM users WHERE is_active = 1`)) {
    if (text.includes('@' + u.name)) {
      c.db.run(`INSERT INTO notifications (user_id, text, link, is_read, kind, created_at, updated_at) VALUES (?,?,?,0,'mention',?,?)`,
        [u.id, `${c.user.name} упомянул(а) вас: ${text.slice(0, 80)}`, linkFor(ent.key, num(p.id)), nowIso(), nowIso()]);
    }
  }
  c.deps.onWrite?.();
  return { ok: true };
});

function linkFor(entityKey: string, id: number): string {
  const map: Record<string, string> = { deals: '/crm/deals/', companies: '/crm/companies/', contacts: '/crm/contacts/', invoices: '/crm/invoices/', tasks: '/tasks/', projects: '/projects/' };
  return (map[entityKey] ?? '/') + id;
}

// ---------------- dashboard, search, notifications, calendar ----------------
r('GET', '/api/dashboard', (c) => {
  try { parity.processRecurring({ ...c, system: true }); } catch (e) { c.deps.log?.('recurring invoices failed', e); }
  return misc.dashboard(c);
});
r('GET', '/api/search', (c, _p, req) => misc.search(c, req.query.q));
r('GET', '/api/notifications', (c) => misc.notificationsFor(c));
r('POST', '/api/notifications/read-all', (c) => misc.readAllNotifications(c));
r('POST', '/api/notifications/:id/read', (c, p) => { c.db.run(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`, [num(p.id), c.user.id]); c.deps.onWrite?.(); return { ok: true }; });
r('GET', '/api/calendar', (c, _p, req) => misc.calendarFeed(c, req.query as any));

// ---------------- CRM ----------------
r('POST', '/api/deals/:id/move', (c, p, req) => crm.moveDeal(c, num(p.id), Number(req.body?.stage_id), req.body?.lost_reason));
r('POST', '/api/deals/:id/project', (c, p) => crm.projectFromDeal(c, num(p.id)));
r('POST', '/api/deals/:id/invoice', (c, p) => crm.invoiceFromDeal(c, num(p.id)));
r('GET', '/api/crm/duplicates', (c, _p, req) => crm.findDuplicates(c, req.query));
r('POST', '/api/invoices/:id/pay', (c, p, req) => crm.payInvoice(c, num(p.id), req.body ?? {}));
r('POST', '/api/invoices/:id/act', (c, p) => crm.actFromInvoice(c, num(p.id)));
r('GET', '/api/print/invoice/:id', (c, p) => ({ html: docs.printInvoice(c, num(p.id)) }));
r('GET', '/api/print/act/:id', (c, p) => ({ html: docs.printAct(c, num(p.id)) }));
r('GET', '/api/print/document/:id', (c, p) => ({ html: docs.printDocument(c, num(p.id)) }));
r('POST', '/api/documents/generate', (c, _p, req) => docs.generateDocument(c, req.body));
r('GET', '/api/public/forms/:id', (c, p) => crm.publicForm(c, num(p.id)), true);
r('POST', '/api/public/forms/:id', (c, p, req) => crm.submitForm(c, num(p.id), req.body ?? {}), true);

// ---------------- projects & time ----------------
r('GET', '/api/projects/stats', (c, _p, req) => { requirePerm(c, 'projects', 'read'); return work.projectStats(c, req.query.ids ? req.query.ids.split(',').map(Number) : undefined); });
r('GET', '/api/projects/:id/overview', (c, p) => work.projectOverview(c, num(p.id)));
r('GET', '/api/projects/:id/gantt', (c, p) => work.gantt(c, num(p.id)));
r('GET', '/api/time/running', (c) => work.runningTimer(c));
r('POST', '/api/time/start', (c, _p, req) => work.startTimer(c, req.body ?? {}));
r('POST', '/api/time/stop', (c) => work.stopTimer(c));
r('GET', '/api/time/report', (c, _p, req) => work.timeReport(c, req.query));

// ---------------- finance ----------------
r('GET', '/api/finance/summary', (c, _p, req) => fin.summary(c, req.query));
r('GET', '/api/finance/balances', (c) => { requirePerm(c, 'finance', 'read'); return fin.balances(c); });
r('GET', '/api/finance/cashflow', (c, _p, req) => fin.cashflowReport(c, req.query));
r('GET', '/api/finance/pnl', (c, _p, req) => fin.pnlReport(c, req.query));
r('GET', '/api/finance/projects', (c) => fin.projectsReport(c));
r('GET', '/api/finance/calendar', (c, _p, req) => fin.paymentCalendar(c, req.query));
r('GET', '/api/finance/budgets/:id', (c, p) => fin.budgetPlanFact(c, num(p.id)));
r('POST', '/api/finance/import-statement', (c, _p, req) => fin.importStatement(c, req.body ?? {}));
r('POST', '/api/finance/export-payments', (c, _p, req) => ({ content: fin.exportPaymentOrders(c, (req.body?.ids ?? []).map(Number)) }));
r('POST', '/api/payroll/:id/pay', (c, p, req) => fin.payPayroll(c, num(p.id), req.body ?? {}));
r('POST', '/api/payroll/accrue', (c, _p, req) => fin.accruePayroll(c, String(req.body?.period ?? '')));

// ---------------- business processes ----------------
r('POST', '/api/bp/start', (c, _p, req) => bp.startProcess(c, req.body));
r('POST', '/api/bp/:id/decide', (c, p, req) => bp.decide(c, num(p.id), req.body ?? {}));
r('POST', '/api/bp/:id/cancel', (c, p) => bp.cancelProcess(c, num(p.id)));
r('GET', '/api/bp/my', (c) => bp.myApprovals(c));

// ---------------- communications & mail ----------------
r('POST', '/api/conversations/simulate', (c) => misc.simulateIncoming(c));
r('POST', '/api/conversations/:id/reply', (c, p, req) => misc.replyConversation(c, num(p.id), req.body?.text));
r('POST', '/api/conversations/:id/deal', (c, p) => misc.conversationToDeal(c, num(p.id)));
r('POST', '/api/mail/send', (c, _p, req) => misc.sendMail(c, req.body ?? {}));

// ---------------- import / export / backup ----------------
r('POST', '/api/import/:entity', (c, p, req) => misc.importRows(c, { entity: p.entity, rows: req.body?.rows, dedupe: req.body?.dedupe }));
r('GET', '/api/export/:entity', (c, p, req) => misc.exportCsv(c, p.entity, list(c, p.entity, { ...req.query, limit: '5000' }).items));
r('GET', '/api/backup', (c) => misc.backupExport(c));
r('POST', '/api/backup/restore', (c, _p, req) => misc.backupRestore(c, req.body));

// ---------------- settings & users ----------------
r('GET', '/api/settings', (c) => misc.readSettings(c));
r('PUT', '/api/settings/:key', (c, p, req) => misc.setSetting(c, p.key, req.body));
r('POST', '/api/users/invite', async (c, _p, req) => {
  requirePerm(c, 'team', 'admin');
  const b = req.body ?? {};
  if (c.db.get(`SELECT id FROM users WHERE lower(email) = lower(?)`, [b.email ?? ''])) fail(422, 'Сотрудник с таким email уже есть');
  const u = create(c, 'users', { name: b.name, email: b.email, role_id: b.role_id, department_id: b.department_id, position: b.position, phone: b.phone, is_active: 1, color: b.color });
  create({ ...c, system: true }, 'invitations', { email: b.email, name: b.name, role_id: b.role_id, status: 'accepted', invited_by: c.user.id, user_id: u.id });
  await setPassword(c.db, u.id, String(b.password ?? ''));
  return u;
});
r('POST', '/api/users/:id/password', async (c, p, req) => {
  requirePerm(c, 'team', 'admin');
  await setPassword(c.db, num(p.id), String(req.body?.password ?? ''));
  return { ok: true };
});
r('POST', '/api/api-keys', async (c, _p, req) => {
  requirePerm(c, 'settings', 'admin');
  return createApiKey(c.db, String(req.body?.name || 'API-ключ'), Number(req.body?.user_id) || c.user.id);
});

// ---------------- 1C ----------------
r('GET', '/api/onec/settings', (c) => odata.publicOnecSettings(c));
r('PUT', '/api/onec/settings', (c, _p, req) => odata.saveOnecSettings(c, req.body ?? {}));
r('POST', '/api/onec/test', (c) => odata.onecTest(c));
r('POST', '/api/onec/sync', (c, _p, req) => odata.onecSync(c, req.body?.only));
r('POST', '/api/onec/cml-import', (c, _p, req) => { requirePerm(c, 'settings', 'write'); return cml.importAny(c, String(req.body?.xml ?? '')); });
r('GET', '/api/onec/cml-orders', (c) => { requirePerm(c, 'settings', 'read'); return { xml: cml.exportOrders(c) }; });

// ---------------- parity features ----------------
r('POST', '/api/tasks/from-template', (c, _p, req) => parity.taskFromTemplate(c, req.body ?? {}));
r('GET', '/api/crm/activity-flags', (c) => parity.dealActivityFlags(c));
r('GET', '/api/crm/counterparties', (c, _p, req) => parity.counterparties(c, req.query));
r('GET', '/api/crm/report', (c, _p, req) => parity.crmReport(c, req.query));
r('POST', '/api/deals/:id/offer', (c, p) => parity.offerFromDeal(c, num(p.id)));
r('GET', '/api/projects/stages', (c, _p, req) => parity.projectStagesSummary(c, (req.query.ids ?? '').split(',').map(Number).filter(Boolean)));
r('POST', '/api/projects/from-template', (c, _p, req) => parity.projectFromTemplate(c, req.body ?? {}));
r('GET', '/api/finance/balance-sheet', (c, _p, req) => parity.balanceSheet(c, req.query));
r('POST', '/api/finance/recurring/process', (c) => { requirePerm(c, 'finance', 'write'); return parity.processRecurring(c); });
r('POST', '/api/finance/recurring/:id/run', (c, p) => { requirePerm(c, 'finance', 'write'); return parity.runRecurring(c, num(p.id)); });
r('POST', '/api/offers/:id/invoice', (c, p) => parity.invoiceFromOffer(c, num(p.id)));
r('GET', '/api/print/offer/:id', (c, p) => ({ html: parity.printOffer(c, num(p.id)) }));
r('POST', '/api/activities/:id/like', (c, p) => parity.toggleLike(c, num(p.id)));
r('GET', '/api/prefs/:key', (c, p) => parity.getPref(c, p.key));
r('PUT', '/api/prefs/:key', (c, p, req) => parity.setPref(c, p.key, req.body));

// ---------------- dispatcher ----------------
export function systemUser(deps: Deps): User {
  const admin = deps.db.get(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'Администратор' AND u.is_active = 1 ORDER BY u.id LIMIT 1`)
    ?? deps.db.get(`SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1`);
  return (admin ? loadUser(deps.db, admin.id) : null) ?? { id: 0, name: 'Система', email: '', role_id: null, is_active: 1, perms: { '*': 'admin' } };
}

export async function handle(deps: Deps, req: Req): Promise<Res> {
  const path = req.path.replace(/\/+$/, '') || '/';
  let matchedPath = false;
  for (const route of ROUTES) {
    const m = route.re.exec(path);
    if (!m) continue;
    matchedPath = true;
    if (route.method !== req.method) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    try {
      let user: User | null = null;
      if (route.pub) user = systemUser(deps);
      else {
        user = await userByToken(deps.db, req.token);
        if (!user) return { status: 401, body: { error: 'Требуется вход в систему' } };
      }
      const ctx: Ctx = { db: deps.db, user, deps, system: route.pub ? true : undefined };
      const body = await route.h(ctx, params, req);
      return { status: 200, body: body === undefined ? { ok: true } : body };
    } catch (e) {
      if (isHttpError(e)) return { status: (e as any).status, body: { error: (e as Error).message } };
      deps.log?.('API error', req.method, path, e);
      return { status: 500, body: { error: 'Внутренняя ошибка: ' + (e as Error).message } };
    }
  }
  return { status: matchedPath ? 405 : 404, body: { error: matchedPath ? 'Метод не поддерживается' : 'Не найдено' } };
}

export { drainWebhooks } from './services/misc.ts';
export { cml, odata, hashPassword };
