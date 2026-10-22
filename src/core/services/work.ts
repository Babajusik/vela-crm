// Tasks, projects and time tracking
import { create, getRaw, hook, logActivity, notify, requirePerm, type Ctx } from '../crud.ts';
import { addDays, addMonths, fail, localDate, nowIso, round2, today } from '../util.ts';

// ---------------- tasks ----------------
hook('tasks', {
  beforeSave(ctx, data, old) {
    if (!old) {
      if (!data.author_id) data.author_id = ctx.user?.id ?? null;
      if (!data.assignee_id) data.assignee_id = ctx.user?.id ?? null;
      if (data.parent_id && !data.project_id) data.project_id = getRaw(ctx.db, 'tasks', data.parent_id)?.project_id ?? null;
    }
    if ('status' in data) {
      if (data.status === 'done' && (!old || old.status !== 'done')) data.completed_at = nowIso();
      if (data.status !== 'done' && old?.status === 'done') data.completed_at = null;
    }
  },
  afterCreate(ctx, row) {
    notify(ctx, row.assignee_id, `Новая задача: ${row.title}`, `/tasks/${row.id}`, 'task');
    if (row.deal_id) logActivity(ctx, 'deals', row.deal_id, 'system', `Поставлена задача «${row.title}»`);
    if (row.company_id) logActivity(ctx, 'companies', row.company_id, 'system', `Поставлена задача «${row.title}»`);
  },
  afterUpdate(ctx, row, old) {
    if (old.assignee_id !== row.assignee_id) notify(ctx, row.assignee_id, `Вам назначена задача: ${row.title}`, `/tasks/${row.id}`, 'task');
    if (row.status === 'done' && old.status !== 'done') {
      notify(ctx, row.author_id, `Задача выполнена: ${row.title}`, `/tasks/${row.id}`, 'task');
      if (row.deal_id) logActivity(ctx, 'deals', row.deal_id, 'system', `Выполнена задача «${row.title}»`);
      if (row.repeat && row.repeat !== 'none') {
        const shift = (d: string | null) => {
          if (!d) return null;
          const datePart = d.slice(0, 10), timePart = d.slice(10);
          const nd = row.repeat === 'daily' ? addDays(datePart, 1) : row.repeat === 'weekly' ? addDays(datePart, 7) : addMonths(datePart, 1);
          return nd + timePart;
        };
        const copy = { ...row };
        for (const k of ['id', 'created_at', 'updated_at', 'completed_at', 'created_by', 'result']) delete copy[k];
        create({ ...ctx, system: true }, 'tasks', { ...copy, status: 'new', deadline: shift(row.deadline), start_date: shift(row.start_date) });
      }
    }
    if (row.status === 'review' && old.status !== 'review') notify(ctx, row.author_id, `Задача ждёт проверки: ${row.title}`, `/tasks/${row.id}`, 'task');
  },
});

// ---------------- projects ----------------
export interface ProjectStats {
  tasks_total: number; tasks_done: number; tasks_overdue: number; progress: number;
  minutes: number; labor_cost: number; income: number; expense: number; profit: number; margin: number | null;
}

export function projectStats(ctx: Ctx, ids?: number[]): Record<number, ProjectStats> {
  const filter = ids?.length ? `WHERE p.id IN (${ids.map(() => '?').join(',')})` : '';
  const params = ids?.length ? ids : [];
  const now = new Date().toISOString().slice(0, 16);
  const rows = ctx.db.all(`
    SELECT p.id,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS tasks_total,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS tasks_done,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.deadline IS NOT NULL AND t.deadline < ?) AS tasks_overdue,
      (SELECT COALESCE(SUM(te.minutes),0) FROM time_entries te WHERE te.project_id = p.id) AS minutes,
      (SELECT COALESCE(SUM(te.minutes * COALESCE(u.hour_rate,0) / 60.0),0) FROM time_entries te LEFT JOIN users u ON u.id = te.user_id WHERE te.project_id = p.id) AS labor_cost,
      (SELECT COALESCE(SUM(o.amount),0) FROM fin_operations o WHERE o.project_id = p.id AND o.kind = 'income' AND o.status = 'fact') AS income,
      (SELECT COALESCE(SUM(o.amount),0) FROM fin_operations o WHERE o.project_id = p.id AND o.kind = 'expense' AND o.status = 'fact') AS expense
    FROM projects p ${filter}`, [now, ...params]);
  const out: Record<number, ProjectStats> = {};
  for (const r of rows) {
    const income = round2(r.income), expense = round2(r.expense + r.labor_cost);
    out[r.id] = {
      tasks_total: r.tasks_total, tasks_done: r.tasks_done, tasks_overdue: r.tasks_overdue,
      progress: r.tasks_total ? Math.round((r.tasks_done / r.tasks_total) * 100) : 0,
      minutes: r.minutes, labor_cost: round2(r.labor_cost), income, expense: round2(r.expense), profit: round2(income - expense),
      margin: income ? Math.round(((income - expense) / income) * 100) : null,
    };
  }
  return out;
}

export function projectOverview(ctx: Ctx, id: number) {
  requirePerm(ctx, 'projects', 'read');
  const p = getRaw(ctx.db, 'projects', id);
  if (!p) fail(404, 'Проект не найден');
  const stats = projectStats(ctx, [id])[id];
  const byStatus = ctx.db.all(`SELECT status, COUNT(*) AS c FROM tasks WHERE project_id = ? GROUP BY status`, [id]);
  const byUser = ctx.db.all(`SELECT u.id, u.name, u.color, COUNT(t.id) AS total, SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) AS done
    FROM tasks t JOIN users u ON u.id = t.assignee_id WHERE t.project_id = ? GROUP BY u.id ORDER BY total DESC`, [id]);
  const time = ctx.db.all(`SELECT u.name, SUM(te.minutes) AS minutes FROM time_entries te JOIN users u ON u.id = te.user_id WHERE te.project_id = ? GROUP BY u.id ORDER BY minutes DESC`, [id]);
  const milestones = ctx.db.all(`SELECT * FROM milestones WHERE project_id = ? ORDER BY date`, [id]);
  const issues = ctx.db.get(`SELECT COUNT(*) AS open FROM project_issues WHERE project_id = ? AND status IN ('open','in_work')`, [id]);
  return { stats, byStatus, byUser, time, milestones, openIssues: issues?.open ?? 0 };
}

export function gantt(ctx: Ctx, projectId: number) {
  requirePerm(ctx, 'projects', 'read');
  const p = getRaw(ctx.db, 'projects', projectId);
  if (!p) fail(404, 'Проект не найден');
  const tasks = ctx.db.all(`SELECT t.id, t.title, t.status, t.start_date, t.deadline, t.parent_id, t.assignee_id, t.milestone_id, u.name AS assignee, u.color
    FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.project_id = ? ORDER BY COALESCE(t.start_date, substr(t.deadline,1,10), t.created_at), t.id`, [projectId]);
  const milestones = ctx.db.all(`SELECT id, name, date, done FROM milestones WHERE project_id = ? ORDER BY date`, [projectId]);
  return {
    project: { id: p!.id, name: p!.name, start_date: p!.start_date, end_date: p!.end_date, color: p!.color },
    tasks: tasks.map((t) => {
      const end = t.deadline ? String(t.deadline).slice(0, 10) : null;
      const start = t.start_date || (end ? addDays(end, -2) : (p!.start_date ?? today()));
      return { ...t, start, end: end ?? addDays(start, 2) };
    }),
    milestones,
  };
}

// ---------------- time tracking ----------------
hook('time_entries', {
  beforeSave(ctx, data, old) {
    if (!old && !data.user_id) data.user_id = ctx.user?.id;
    if (!old && !data.date) data.date = today();
    if (data.task_id && !data.project_id) data.project_id = getRaw(ctx.db, 'tasks', data.task_id)?.project_id ?? null;
  },
});

export function runningTimer(ctx: Ctx) {
  const r = ctx.db.get(`SELECT te.*, t.title AS task_title FROM time_entries te LEFT JOIN tasks t ON t.id = te.task_id WHERE te.user_id = ? AND te.is_running = 1 ORDER BY te.id DESC LIMIT 1`, [ctx.user.id]);
  return r ?? null;
}

export function startTimer(ctx: Ctx, body: { task_id?: number; project_id?: number; comment?: string }) {
  stopTimer(ctx);
  const task = body.task_id ? getRaw(ctx.db, 'tasks', body.task_id) : null;
  const e = create({ ...ctx, system: true }, 'time_entries', {
    user_id: ctx.user.id, date: today(), task_id: body.task_id ?? null, project_id: body.project_id ?? task?.project_id ?? null,
    minutes: 0, comment: body.comment ?? task?.title ?? '', billable: 1, started_at: nowIso(), is_running: 1,
  });
  if (task && task.status === 'new') ctx.db.run(`UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?`, [nowIso(), task.id]);
  return e;
}

export function stopTimer(ctx: Ctx) {
  const r = ctx.db.get(`SELECT * FROM time_entries WHERE user_id = ? AND is_running = 1`, [ctx.user.id]);
  if (!r) return null;
  const minutes = Math.max(1, Math.round((Date.now() - new Date(r.started_at).getTime()) / 60000));
  ctx.db.run(`UPDATE time_entries SET is_running = 0, minutes = COALESCE(minutes,0) + ?, updated_at = ? WHERE id = ?`, [minutes, nowIso(), r.id]);
  ctx.deps.onWrite?.();
  return getRaw(ctx.db, 'time_entries', r.id);
}

export function timeReport(ctx: Ctx, q: { from?: string; to?: string; group?: string; user_id?: string }) {
  const from = q.from ?? addDays(today(), -30), to = q.to ?? today();
  const params: unknown[] = [from, to];
  let userFilter = '';
  if (q.user_id) { userFilter = 'AND te.user_id = ?'; params.push(Number(q.user_id)); }
  const group = q.group === 'project' ? 'project' : q.group === 'task' ? 'task' : 'user';
  const sel = group === 'project' ? `p.id AS key_id, COALESCE(p.name, 'Без проекта') AS label` : group === 'task' ? `t.id AS key_id, COALESCE(t.title, te.comment, 'Без задачи') AS label` : `u.id AS key_id, u.name AS label`;
  const rows = ctx.db.all(`SELECT ${sel}, SUM(te.minutes) AS minutes, SUM(CASE WHEN te.billable = 1 THEN te.minutes ELSE 0 END) AS billable,
      SUM(te.minutes * COALESCE(u.hour_rate,0) / 60.0) AS cost, COUNT(*) AS entries
    FROM time_entries te LEFT JOIN users u ON u.id = te.user_id LEFT JOIN projects p ON p.id = te.project_id LEFT JOIN tasks t ON t.id = te.task_id
    WHERE te.date >= ? AND te.date <= ? ${userFilter} GROUP BY key_id ORDER BY minutes DESC`, params);
  const byDay = ctx.db.all(`SELECT te.date, SUM(te.minutes) AS minutes FROM time_entries te WHERE te.date >= ? AND te.date <= ? ${userFilter} GROUP BY te.date ORDER BY te.date`, params);
  return { from, to, group, rows: rows.map((r) => ({ ...r, cost: round2(r.cost) })), byDay };
}

export function weekStart(d = new Date()): string {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return localDate(x);
}
