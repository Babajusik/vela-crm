// Business processes: sequential steps with approvals
import { create, getRaw, notify, onEvent, update, requirePerm, type Ctx } from '../crud.ts';
import { ENTITIES } from '../schema.ts';
import { fail, localDateTime, nowIso, parseJson } from '../util.ts';

export interface BpStep {
  type: 'approval' | 'task' | 'notify' | 'set_field';
  title?: string;
  /** user id, or 'starter' | 'responsible' | 'manager' (head of starter's department) */
  user?: string | number;
  text?: string;
  field?: string;
  value?: unknown;
  days?: number;
  on_reject?: { field: string; value: unknown };
}

interface LogEntry { at: string; text: string; user?: string }

function resolveUser(ctx: Ctx, inst: Record<string, any>, who: unknown): number | null {
  if (who === 'starter' || who == null || who === '') return inst.started_by;
  if (who === 'responsible' && inst.entity_type && inst.entity_id) {
    const e = getRaw(ctx.db, inst.entity_type, inst.entity_id);
    return e?.responsible_id ?? e?.manager_id ?? e?.user_id ?? inst.started_by;
  }
  if (who === 'manager') {
    const u = getRaw(ctx.db, 'users', inst.started_by);
    const dep = u?.department_id ? getRaw(ctx.db, 'departments', u.department_id) : null;
    return dep?.head_id ?? ctx.db.get(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'Администратор' ORDER BY u.id LIMIT 1`)?.id ?? inst.started_by;
  }
  return Number(who) || inst.started_by;
}

function entityTitle(ctx: Ctx, type: string | null, id: number | null): string {
  if (!type || !id || !ENTITIES[type]) return '';
  const e = getRaw(ctx.db, type, id);
  return e ? String(e[ENTITIES[type].titleField] ?? `#${id}`) : '';
}

function saveInst(ctx: Ctx, inst: Record<string, any>, log: LogEntry[], data: Record<string, any>) {
  ctx.db.run(`UPDATE bp_instances SET status = ?, current_step = ?, log = ?, data = ?, updated_at = ? WHERE id = ?`,
    [inst.status, inst.current_step, JSON.stringify(log), JSON.stringify(data), nowIso(), inst.id]);
}

function advance(ctx: Ctx, instId: number) {
  const inst = getRaw(ctx.db, 'bp_instances', instId)!;
  const tpl = getRaw(ctx.db, 'bp_templates', inst.template_id);
  const steps = parseJson<BpStep[]>(tpl?.steps, []);
  const log = parseJson<LogEntry[]>(inst.log, []);
  const data = parseJson<Record<string, any>>(inst.data, {});
  const sys: Ctx = { ...ctx, system: true };
  while (inst.current_step < steps.length) {
    const s = steps[inst.current_step];
    const uid = resolveUser(ctx, inst, s.user);
    const uname = uid ? getRaw(ctx.db, 'users', uid)?.name : '';
    if (s.type === 'approval') {
      const due = new Date(Date.now() + (s.days ?? 2) * 864e5);
      due.setHours(18, 0, 0, 0);
      const task = create(sys, 'tasks', {
        title: `Согласовать: ${s.title || inst.name}`, assignee_id: uid, author_id: inst.started_by, priority: 'high', deadline: localDateTime(due),
        description: `${s.text ?? ''}\nПроцесс «${inst.name}». Решение принимается в разделе «Бизнес-процессы → Мои согласования».`.trim(),
        tags: ['согласование'],
      });
      data.pending = { step: inst.current_step, user_id: uid, task_id: task.id, title: s.title ?? inst.name };
      log.push({ at: nowIso(), text: `Отправлено на согласование: ${uname}` });
      notify(sys, uid, `Требуется согласование: ${s.title || inst.name}`, `/bp`, 'bp');
      saveInst(ctx, inst, log, data);
      return;
    }
    if (s.type === 'task') {
      const due = new Date(Date.now() + (s.days ?? 3) * 864e5);
      due.setHours(18, 0, 0, 0);
      create(sys, 'tasks', { title: s.title || 'Задача процесса', description: s.text ?? '', assignee_id: uid, author_id: inst.started_by, deadline: localDateTime(due) });
      log.push({ at: nowIso(), text: `Поставлена задача «${s.title}» → ${uname}` });
    } else if (s.type === 'notify') {
      notify(sys, uid, s.text || `Процесс «${inst.name}»`, '/bp', 'bp');
      log.push({ at: nowIso(), text: `Уведомление → ${uname}` });
    } else if (s.type === 'set_field' && inst.entity_type && inst.entity_id && s.field) {
      update(sys, inst.entity_type, inst.entity_id, { [s.field]: s.value });
      log.push({ at: nowIso(), text: `Поле «${s.field}» = ${String(s.value)}` });
    }
    inst.current_step++;
  }
  inst.status = 'completed';
  delete data.pending;
  log.push({ at: nowIso(), text: 'Процесс завершён' });
  saveInst(ctx, inst, log, data);
  notify(sys, inst.started_by, `Процесс «${inst.name}» завершён`, '/bp', 'bp');
}

export function startProcess(ctx: Ctx, body: { template_id: number; entity_type?: string; entity_id?: number; comment?: string }) {
  if (!ctx.system) requirePerm(ctx, 'bp', 'read');
  const tpl = getRaw(ctx.db, 'bp_templates', body.template_id);
  if (!tpl || !tpl.is_active) fail(404, 'Шаблон процесса не найден или выключен');
  const etype = tpl!.entity_type && tpl!.entity_type !== 'none' ? tpl!.entity_type : body.entity_type ?? null;
  const title = entityTitle(ctx, etype, body.entity_id ?? null);
  const inst = create({ ...ctx, system: true }, 'bp_instances', {
    template_id: tpl!.id, name: title ? `${tpl!.name}: ${title}` : tpl!.name, entity_type: etype, entity_id: body.entity_id ?? null,
    status: 'running', current_step: 0, started_by: ctx.user.id,
    log: [{ at: nowIso(), text: `Запущен${body.comment ? ': ' + body.comment : ''}`, user: ctx.user.name }], data: { comment: body.comment ?? '' },
  });
  ctx.db.run(`UPDATE bp_instances SET current_step = 0 WHERE id = ?`, [inst.id]);
  advance(ctx, inst.id);
  ctx.deps.onWrite?.();
  return getRaw(ctx.db, 'bp_instances', inst.id);
}

export function decide(ctx: Ctx, instId: number, body: { decision: 'approve' | 'reject'; comment?: string }) {
  const inst = getRaw(ctx.db, 'bp_instances', instId);
  if (!inst || inst.status !== 'running') fail(404, 'Процесс не найден или уже завершён');
  const data = parseJson<Record<string, any>>(inst!.data, {});
  const pending = data.pending;
  if (!pending) fail(422, 'Процесс не ждёт решения');
  const isAdmin = ctx.user.perms['*'] === 'admin' || ctx.user.perms.bp === 'admin';
  if (pending.user_id !== ctx.user.id && !isAdmin) fail(403, 'Решение принимает назначенный согласующий');
  const log = parseJson<LogEntry[]>(inst!.log, []);
  const sys: Ctx = { ...ctx, system: true };
  if (pending.task_id) {
    ctx.db.run(`UPDATE tasks SET status = 'done', completed_at = ?, result = ? WHERE id = ?`,
      [nowIso(), `${body.decision === 'approve' ? 'Согласовано' : 'Отклонено'}${body.comment ? ': ' + body.comment : ''}`, pending.task_id]);
  }
  if (body.decision === 'reject') {
    const tpl = getRaw(ctx.db, 'bp_templates', inst!.template_id);
    const step = parseJson<BpStep[]>(tpl?.steps, [])[pending.step];
    if (step?.on_reject && inst!.entity_type && inst!.entity_id) update(sys, inst!.entity_type, inst!.entity_id, { [step.on_reject.field]: step.on_reject.value });
    log.push({ at: nowIso(), text: `Отклонено${body.comment ? ': ' + body.comment : ''}`, user: ctx.user.name });
    delete data.pending;
    ctx.db.run(`UPDATE bp_instances SET status = 'rejected', log = ?, data = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(log), JSON.stringify(data), nowIso(), instId]);
    notify(sys, inst!.started_by, `Процесс «${inst!.name}» отклонён`, '/bp', 'bp');
  } else {
    log.push({ at: nowIso(), text: `Согласовано${body.comment ? ': ' + body.comment : ''}`, user: ctx.user.name });
    delete data.pending;
    ctx.db.run(`UPDATE bp_instances SET current_step = current_step + 1, log = ?, data = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(log), JSON.stringify(data), nowIso(), instId]);
    advance(ctx, instId);
  }
  ctx.deps.onWrite?.();
  return getRaw(ctx.db, 'bp_instances', instId);
}

export function myApprovals(ctx: Ctx) {
  return ctx.db.all(`SELECT * FROM bp_instances WHERE status = 'running' ORDER BY id DESC`)
    .map((r) => ({ ...r, data: parseJson<Record<string, any>>(r.data, {}), log: parseJson(r.log, []) }))
    .filter((r) => r.data.pending?.user_id === ctx.user.id);
}

export function cancelProcess(ctx: Ctx, instId: number) {
  const inst = getRaw(ctx.db, 'bp_instances', instId);
  if (!inst) fail(404, 'Процесс не найден');
  if (inst!.started_by !== ctx.user.id && ctx.user.perms['*'] !== 'admin') fail(403, 'Отменить может только инициатор');
  const log = parseJson<LogEntry[]>(inst!.log, []);
  log.push({ at: nowIso(), text: 'Отменён', user: ctx.user.name });
  ctx.db.run(`UPDATE bp_instances SET status = 'cancelled', log = ? WHERE id = ?`, [JSON.stringify(log), instId]);
  ctx.deps.onWrite?.();
  return { ok: true };
}

// auto-start on create
onEvent((ctx, event, payload) => {
  if (event === 'bp.start') { startProcess({ ...ctx, system: true }, payload as any); return; }
  const m = /^(\w+)\.created$/.exec(event);
  if (!m || m[1] === 'bp_instances' || m[1] === 'tasks' || m[1] === 'activities') return;
  const tpls = ctx.db.all(`SELECT id FROM bp_templates WHERE trigger = 'on_create' AND entity_type = ? AND is_active = 1`, [m[1]]);
  for (const t of tpls) startProcess({ ...ctx, system: true }, { template_id: t.id, entity_type: m[1], entity_id: payload.id });
});
