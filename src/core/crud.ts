import { ENTITIES, ENTITY_LIST, entity, moduleOf } from './schema.ts';
import type { DB, Deps, Entity, Field, PermLevel, User } from './types.ts';
import { HttpError, fail, nowIso, parseJson, sanitizeHtml } from './util.ts';

export interface Ctx {
  db: DB;
  user: User;
  deps: Deps;
  /** set when the request is made by internal logic (automations, seed) */
  system?: boolean;
}

// ---------------- permissions ----------------
const LEVELS: PermLevel[] = ['none', 'read', 'write', 'admin'];

export function can(user: User, module: string, need: PermLevel): boolean {
  const have = user.perms[module] ?? user.perms['*'] ?? 'none';
  return LEVELS.indexOf(have) >= LEVELS.indexOf(need);
}

export function requirePerm(ctx: Ctx, module: string, need: PermLevel) {
  if (ctx.system) return;
  // everyone can read the directory of colleagues and use the personal modules
  if (need === 'read' && (module === 'team' || module === 'dashboard' || module === 'notes')) return;
  if (module === 'notes' || module === 'dashboard') return;
  if (!can(ctx.user, module, need)) fail(403, 'Недостаточно прав для этого действия');
}

/** entities used as directories by other modules are readable by anyone with any access */
const OPEN_READ = new Set(['users', 'departments', 'pipelines', 'stages', 'products', 'product_categories', 'projects', 'legal_entities',
  'fin_accounts', 'fin_categories', 'companies', 'contacts', 'deals', 'tasks', 'custom_fields', 'milestones', 'sprints', 'folders', 'chats', 'kb_sections', 'roles']);

export function checkEntityPerm(ctx: Ctx, ent: Entity, need: PermLevel) {
  if (ctx.system) return;
  if (need === 'read' && OPEN_READ.has(ent.key)) return;
  // the messenger, notifications and activities are used from everywhere
  if (['activities', 'notifications', 'messages', 'chats', 'checklist_items', 'time_entries', 'files', 'folders', 'events'].includes(ent.key) && need !== 'admin') return;
  requirePerm(ctx, moduleOf(ent.key), need);
}

// ---------------- hooks ----------------
export interface Hooks {
  beforeSave?: (ctx: Ctx, data: Record<string, any>, old: Record<string, any> | null) => void;
  afterCreate?: (ctx: Ctx, row: Record<string, any>) => void;
  afterUpdate?: (ctx: Ctx, row: Record<string, any>, old: Record<string, any>) => void;
  beforeDelete?: (ctx: Ctx, row: Record<string, any>) => void;
  afterDelete?: (ctx: Ctx, row: Record<string, any>) => void;
}
export const HOOKS: Record<string, Hooks> = {};
export function hook(entityKey: string, h: Hooks) {
  HOOKS[entityKey] = { ...HOOKS[entityKey], ...h };
}

export type EventListener = (ctx: Ctx, event: string, payload: Record<string, any>) => void;
const listeners: EventListener[] = [];
export function onEvent(fn: EventListener) { listeners.push(fn); }
export function emit(ctx: Ctx, event: string, payload: Record<string, any>) {
  for (const l of listeners) {
    try { l(ctx, event, payload); } catch (e) { ctx.deps.log?.('event listener failed', event, e); }
  }
}

// ---------------- value coercion ----------------
function toDb(f: Field, v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null || v === '') return f.type === 'bool' ? 0 : null;
  switch (f.type) {
    case 'int': case 'ref': case 'user': {
      const n = Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case 'number': case 'money': {
      const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    case 'bool': return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
    case 'users': case 'tags': case 'json':
      return typeof v === 'string' ? v : JSON.stringify(v);
    case 'richtext': return sanitizeHtml(String(v));
    default: return String(v);
  }
}

function fromDb(f: Field, v: unknown): unknown {
  if (v == null) return f.type === 'users' || f.type === 'tags' ? [] : null;
  switch (f.type) {
    case 'users': case 'tags': return parseJson<unknown[]>(v, []);
    case 'json': return parseJson<unknown>(v, null);
    default: return v;
  }
}

export function serialize(ent: Entity, row: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!row) return row;
  const out: Record<string, any> = { id: row.id };
  for (const f of ent.fields) {
    if (f.internal) continue;
    out[f.key] = fromDb(f, row[f.key]);
  }
  out.extra = parseJson<Record<string, unknown>>(row.extra, {});
  out.created_at = row.created_at;
  out.updated_at = row.updated_at;
  out.created_by = row.created_by;
  return out;
}

/** Validates and converts incoming data. Only known, writable fields pass. */
export function clean(ent: Entity, data: Record<string, any>, opts: { partial: boolean; system?: boolean }): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of ent.fields) {
    if (f.internal && !opts.system) continue;
    if (f.readonly && !opts.system) continue;
    if (!(f.key in data)) continue;
    const v = toDb(f, data[f.key]);
    if (v !== undefined) out[f.key] = v;
  }
  if ('extra' in data && data.extra && typeof data.extra === 'object') out.extra = JSON.stringify(data.extra);
  if (!opts.partial) {
    for (const f of ent.fields) {
      if (out[f.key] === undefined && f.default !== undefined) out[f.key] = toDb(f, f.default);
    }
  }
  return out;
}

/** Runs after hooks, so values a hook fills in (pipeline, author...) count. */
export function requireFields(ent: Entity, data: Record<string, any>, partial: boolean) {
  for (const f of ent.fields) {
    if (!f.required) continue;
    if (partial && !(f.key in data)) continue;
    const v = data[f.key];
    if (v === null || v === undefined || v === '') fail(422, `Заполните поле «${f.label}»`);
  }
}

// ---------------- reference expansion ----------------
const EXTRA_REF_COLS: Record<string, string[]> = {
  stages: ['color', 'kind', 'probability'], users: ['color', 'position'], projects: ['color'], fin_accounts: ['currency'],
  fin_categories: ['kind'], channels: ['kind'], companies: ['inn'], products: ['price', 'unit', 'vat'],
};

export function titleSql(target: Entity): string {
  return `"${target.titleField}"`;
}

export function expand(db: DB, ent: Entity, items: Record<string, any>[]) {
  if (!items.length) return;
  const refFields = ent.fields.filter((f) => (f.type === 'ref' || f.type === 'user' || f.type === 'users') && f.ref && !f.internal);
  for (const f of refFields) {
    const target = ENTITIES[f.ref!];
    if (!target) continue;
    const ids = new Set<number>();
    for (const it of items) {
      const v = it[f.key];
      if (Array.isArray(v)) v.forEach((x) => x && ids.add(Number(x)));
      else if (v) ids.add(Number(v));
    }
    if (!ids.size) continue;
    const extra = (EXTRA_REF_COLS[target.key] ?? []).map((c) => `, "${c}"`).join('');
    const list = [...ids];
    const map = new Map<number, any>();
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      const rows = db.all(`SELECT id, ${titleSql(target)} AS title${extra} FROM "${target.key}" WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
      for (const r of rows) map.set(r.id, { ...r });
    }
    for (const it of items) {
      it._ref ??= {};
      const v = it[f.key];
      if (Array.isArray(v)) it._ref[f.key] = v.map((x) => map.get(Number(x))).filter(Boolean);
      else if (v) it._ref[f.key] = map.get(Number(v)) ?? null;
    }
  }
}

// ---------------- list ----------------
export interface ListResult { items: Record<string, any>[]; total: number }

const OPS: Record<string, string> = { gte: '>=', lte: '<=', gt: '>', lt: '<', ne: '!=' };
const RESERVED_PARAMS = new Set(['q', 'sort', 'dir', 'limit', 'offset', 'expand', 'mine']);

export function buildWhere(ent: Entity, query: Record<string, string>, ctx?: Ctx): { where: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  const fieldMap = new Map(ent.fields.map((f) => [f.key, f]));
  fieldMap.set('id', { key: 'id', label: 'ID', type: 'int' });
  fieldMap.set('created_at', { key: 'created_at', label: 'Создан', type: 'datetime' });
  fieldMap.set('updated_at', { key: 'updated_at', label: 'Изменён', type: 'datetime' });
  fieldMap.set('created_by', { key: 'created_by', label: 'Автор', type: 'user' });
  for (const [rawKey, rawVal] of Object.entries(query)) {
    if (rawVal === undefined || rawVal === '') continue;
    // paging and sorting params are not filters, even when an entity has a field with the same name (e.g. "sort")
    if (RESERVED_PARAMS.has(rawKey)) continue;
    const [key, op] = rawKey.split('__');
    const f = fieldMap.get(key);
    if (!f || f.internal) continue;
    const col = `"${key}"`;
    if (op === 'in') {
      const vals = String(rawVal).split(',').filter(Boolean);
      if (!vals.length) continue;
      conds.push(`${col} IN (${vals.map(() => '?').join(',')})`);
      params.push(...vals);
    } else if (op === 'null') {
      conds.push(rawVal === '1' ? `(${col} IS NULL OR ${col} = '')` : `(${col} IS NOT NULL AND ${col} != '')`);
    } else if (op === 'like') {
      conds.push(`${col} LIKE ?`);
      params.push(`%${rawVal}%`);
    } else if (op === 'has') {
      // JSON array contains value (users, tags)
      conds.push(`${col} LIKE ?`);
      params.push(`%${JSON.stringify(f.type === 'users' ? Number(rawVal) : rawVal)}%`);
    } else if (op && OPS[op]) {
      conds.push(`${col} ${OPS[op]} ?`);
      params.push(rawVal);
    } else if (!op) {
      conds.push(`${col} = ?`);
      params.push(rawVal);
    }
  }
  if (query.q) {
    const sf = ent.fields.filter((f) => f.search);
    if (sf.length) {
      const like = `%${query.q.trim().toLowerCase()}%`;
      conds.push(`(${sf.map((f) => `lower(COALESCE("${f.key}", '')) LIKE ?`).join(' OR ')})`);
      for (let i = 0; i < sf.length; i++) params.push(like);
    }
  }
  if (query.mine === '1' && ctx && ent.ownerField) {
    conds.push(`"${ent.ownerField}" = ?`);
    params.push(ctx.user.id);
  }
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params };
}

export function list(ctx: Ctx, entityKey: string, query: Record<string, string> = {}): ListResult {
  const ent = entity(entityKey);
  checkEntityPerm(ctx, ent, 'read');
  const { where, params } = buildWhere(ent, query, ctx);
  let order = ent.order ?? 'id desc';
  if (query.sort) {
    const known = query.sort === 'id' || query.sort === 'created_at' || query.sort === 'updated_at' || ent.fields.some((f) => f.key === query.sort && !f.internal);
    if (known) order = `"${query.sort}" ${query.dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, id DESC`;
  }
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 5000);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const total = db1(ctx.db, `SELECT COUNT(*) AS c FROM "${ent.key}" ${where}`, params);
  const rows = ctx.db.all(`SELECT * FROM "${ent.key}" ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const items = rows.map((r) => serialize(ent, r)!);
  if (query.expand !== '0') expand(ctx.db, ent, items);
  return { items, total };
}

function db1(db: DB, sql: string, params: unknown[]): number {
  const r = db.get<{ c: number }>(sql, params);
  return Number(r?.c ?? 0);
}

export function getRaw(db: DB, entityKey: string, id: number | string): Record<string, any> | undefined {
  return db.get(`SELECT * FROM "${entityKey}" WHERE id = ?`, [Number(id)]);
}

export function get(ctx: Ctx, entityKey: string, id: number | string): Record<string, any> {
  const ent = entity(entityKey);
  checkEntityPerm(ctx, ent, 'read');
  const row = getRaw(ctx.db, ent.key, id);
  if (!row) fail(404, `${ent.label}: запись не найдена`);
  const item = serialize(ent, row)!;
  expand(ctx.db, ent, [item]);
  return item;
}

// ---------------- write ----------------
const TRACKED = ['status', 'stage_id', 'responsible_id', 'assignee_id', 'amount', 'deadline', 'manager_id', 'priority'];

export function create(ctx: Ctx, entityKey: string, data: Record<string, any>): Record<string, any> {
  const ent = entity(entityKey);
  checkEntityPerm(ctx, ent, 'write');
  const row = clean(ent, data, { partial: false, system: ctx.system });
  HOOKS[ent.key]?.beforeSave?.(ctx, row, null);
  requireFields(ent, row, false);
  const ts = nowIso();
  row.created_at = ts;
  row.updated_at = ts;
  row.created_by = ctx.user?.id ?? null;
  const keys = Object.keys(row);
  const res = ctx.db.run(`INSERT INTO "${ent.key}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map((k) => row[k]));
  const saved = getRaw(ctx.db, ent.key, res.lastId)!;
  if (ent.timeline) logActivity(ctx, ent.key, saved.id, 'system', `${ent.label} создан${suffix(ent)}`);
  HOOKS[ent.key]?.afterCreate?.(ctx, saved);
  emit(ctx, `${ent.key}.created`, saved);
  ctx.deps.onWrite?.();
  return serialize(ent, getRaw(ctx.db, ent.key, res.lastId))!;
}

function suffix(ent: Entity): string {
  // «Сделка создана», «Счёт создан», «Задача создана»
  return /[ая]$/.test(ent.label) ? 'а' : '';
}

export function update(ctx: Ctx, entityKey: string, id: number | string, data: Record<string, any>): Record<string, any> {
  const ent = entity(entityKey);
  checkEntityPerm(ctx, ent, 'write');
  const old = getRaw(ctx.db, ent.key, id);
  if (!old) fail(404, `${ent.label}: запись не найдена`);
  const patch = clean(ent, data, { partial: true, system: ctx.system });
  if (patch.extra) patch.extra = JSON.stringify({ ...parseJson(old!.extra, {}), ...parseJson(patch.extra, {}) });
  HOOKS[ent.key]?.beforeSave?.(ctx, patch, old!);
  requireFields(ent, patch, true);
  const keys = Object.keys(patch);
  if (keys.length) {
    patch.updated_at = nowIso();
    const k2 = Object.keys(patch);
    ctx.db.run(`UPDATE "${ent.key}" SET ${k2.map((k) => `"${k}" = ?`).join(', ')} WHERE id = ?`, [...k2.map((k) => patch[k]), Number(id)]);
  }
  const saved = getRaw(ctx.db, ent.key, id)!;
  if (ent.timeline) {
    for (const k of TRACKED) {
      if (!(k in patch) || String(old![k] ?? '') === String(saved[k] ?? '')) continue;
      const f = ent.fields.find((x) => x.key === k);
      if (!f || k === 'stage_id') continue; // stage changes are logged by the deals service
      logActivity(ctx, ent.key, saved.id, 'system', `${f.label}: ${display(ctx.db, f, old![k])} → ${display(ctx.db, f, saved[k])}`);
    }
  }
  HOOKS[ent.key]?.afterUpdate?.(ctx, saved, old!);
  emit(ctx, `${ent.key}.updated`, saved);
  ctx.deps.onWrite?.();
  return serialize(ent, getRaw(ctx.db, ent.key, id))!;
}

export function display(db: DB, f: Field, v: unknown): string {
  if (v == null || v === '') return '—';
  if (f.type === 'select') return f.options?.find((o) => o.value === String(v))?.label ?? String(v);
  if ((f.type === 'ref' || f.type === 'user') && f.ref) {
    const t = ENTITIES[f.ref];
    const r = db.get(`SELECT ${titleSql(t)} AS title FROM "${t.key}" WHERE id = ?`, [v]);
    return r?.title ?? `#${v}`;
  }
  if (f.type === 'money') return `${Number(v).toLocaleString('ru-RU')} ₽`;
  if (f.type === 'datetime') return String(v).replace('T', ' ').slice(0, 16);
  return String(v);
}

export function remove(ctx: Ctx, entityKey: string, id: number | string): { ok: true } {
  const ent = entity(entityKey);
  checkEntityPerm(ctx, ent, 'write');
  const row = getRaw(ctx.db, ent.key, id);
  if (!row) fail(404, `${ent.label}: запись не найдена`);
  HOOKS[ent.key]?.beforeDelete?.(ctx, row!);
  ctx.db.tx(() => {
    // cascade to child entities
    for (const child of ENTITY_LIST) {
      if (child.parent?.entity === ent.key) ctx.db.run(`DELETE FROM "${child.key}" WHERE "${child.parent.field}" = ?`, [Number(id)]);
    }
    ctx.db.run(`DELETE FROM activities WHERE entity_type = ? AND entity_id = ?`, [ent.key, Number(id)]);
    ctx.db.run(`DELETE FROM "${ent.key}" WHERE id = ?`, [Number(id)]);
  });
  HOOKS[ent.key]?.afterDelete?.(ctx, row!);
  emit(ctx, `${ent.key}.deleted`, row!);
  ctx.deps.onWrite?.();
  return { ok: true };
}

export function logActivity(ctx: Ctx, entityType: string, entityId: number, kind: string, text: string, meta?: unknown) {
  ctx.db.run(`INSERT INTO activities (entity_type, entity_id, kind, text, user_id, meta, created_at, updated_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    [entityType, entityId, kind, text, ctx.user?.id ?? null, meta ? JSON.stringify(meta) : null, nowIso(), nowIso(), ctx.user?.id ?? null]);
}

export function notify(ctx: Ctx, userId: number | null | undefined, text: string, link?: string, kind = 'system') {
  if (!userId) return;
  if (ctx.user && userId === ctx.user.id && !ctx.system) return;
  ctx.db.run(`INSERT INTO notifications (user_id, text, link, is_read, kind, created_at, updated_at) VALUES (?,?,?,0,?,?,?)`,
    [userId, text, link ?? null, kind, nowIso(), nowIso()]);
}

export function isHttpError(e: unknown): e is HttpError {
  return e instanceof HttpError || (typeof e === 'object' && e !== null && 'status' in e);
}
