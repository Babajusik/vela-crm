import { create, getRaw, hook, logActivity, requirePerm, type Ctx } from '../crud.ts';
import { recalcInvoice } from './crm.ts';
import { addDays, fail, localDate, nowIso, round2, today } from '../util.ts';

// ---------------- hooks ----------------
hook('fin_operations', {
  beforeSave(ctx, data, old) {
    const kind = data.kind ?? old?.kind;
    if (kind === 'transfer') {
      const to = data.to_account_id ?? old?.to_account_id;
      const from = data.account_id ?? old?.account_id;
      if (!to) fail(422, 'Для перемещения укажите счёт получателя');
      if (Number(to) === Number(from)) fail(422, 'Счета списания и зачисления совпадают');
      data.category_id = null;
    }
    if (data.amount != null && Number(data.amount) < 0) fail(422, 'Сумма должна быть положительной');
  },
  afterCreate: (ctx, row) => { if (row.invoice_id) recalcInvoice(ctx, row.invoice_id); },
  afterUpdate: (ctx, row, old) => {
    if (row.invoice_id) recalcInvoice(ctx, row.invoice_id);
    if (old.invoice_id && old.invoice_id !== row.invoice_id) recalcInvoice(ctx, old.invoice_id);
  },
  afterDelete: (ctx, row) => { if (row.invoice_id) recalcInvoice(ctx, row.invoice_id); },
});

hook('payroll', {
  beforeSave(ctx, data, old) {
    const v = (k: string) => Number(data[k] ?? old?.[k] ?? 0);
    data.total = round2(v('base') + v('bonus') - v('deductions'));
    if (!old && data.base == null && data.user_id) data.base = getRaw(ctx.db, 'users', data.user_id)?.salary ?? 0;
    if (!old && data.base != null) data.total = round2(Number(data.base) + v('bonus') - v('deductions'));
  },
});

// ---------------- balances ----------------
export function balances(ctx: Ctx, onDate?: string) {
  const d = onDate ?? '9999-12-31';
  const rows = ctx.db.all(`
    SELECT a.id, a.name, a.kind, a.currency, a.bank_name, a.is_archived,
      COALESCE(a.opening_balance,0)
      + COALESCE((SELECT SUM(amount) FROM fin_operations o WHERE o.account_id = a.id AND o.kind = 'income' AND o.status = 'fact' AND o.date <= ?),0)
      - COALESCE((SELECT SUM(amount) FROM fin_operations o WHERE o.account_id = a.id AND o.kind IN ('expense','transfer') AND o.status = 'fact' AND o.date <= ?),0)
      + COALESCE((SELECT SUM(amount) FROM fin_operations o WHERE o.to_account_id = a.id AND o.kind = 'transfer' AND o.status = 'fact' AND o.date <= ?),0)
      AS balance
    FROM fin_accounts a ORDER BY a.is_archived, a.id`, [d, d, d]);
  return rows.map((r) => ({ ...r, balance: round2(r.balance) }));
}

function totalBalance(ctx: Ctx, onDate: string): number {
  return round2(balances(ctx, onDate).filter((a) => !a.is_archived).reduce((s, a) => s + a.balance, 0));
}

function months(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from.slice(0, 7) + '-01T12:00:00');
  const end = to.slice(0, 7);
  while (localDate(d).slice(0, 7) <= end && out.length < 60) {
    out.push(localDate(d).slice(0, 7));
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

export function monthRange(n: number): { from: string; to: string } {
  const d = new Date();
  const to = localDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const from = localDate(new Date(d.getFullYear(), d.getMonth() - n + 1, 1));
  return { from, to };
}

export function summary(ctx: Ctx, q: { from?: string; to?: string }) {
  requirePerm(ctx, 'finance', 'read');
  const def = monthRange(12);
  const from = q.from ?? def.from, to = q.to ?? def.to;
  const byMonth = ctx.db.all(`SELECT substr(date,1,7) AS month,
      SUM(CASE WHEN kind='income' THEN amount ELSE 0 END) AS income,
      SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END) AS expense
    FROM fin_operations WHERE status='fact' AND date >= ? AND date <= ? GROUP BY month ORDER BY month`, [from, to]);
  const map = new Map(byMonth.map((r) => [r.month, r]));
  const series = months(from, to).map((m) => {
    const r = map.get(m);
    const income = round2(r?.income ?? 0), expense = round2(r?.expense ?? 0);
    return { month: m, income, expense, net: round2(income - expense) };
  });
  const topExpense = ctx.db.all(`SELECT c.name, SUM(o.amount) AS amount FROM fin_lines o LEFT JOIN fin_categories c ON c.id = o.category_id
    WHERE o.kind='expense' AND o.status='fact' AND o.date >= ? AND o.date <= ? GROUP BY o.category_id ORDER BY amount DESC LIMIT 8`, [from, to]);
  const topIncome = ctx.db.all(`SELECT c.name, SUM(o.amount) AS amount FROM fin_lines o LEFT JOIN fin_categories c ON c.id = o.category_id
    WHERE o.kind='income' AND o.status='fact' AND o.date >= ? AND o.date <= ? GROUP BY o.category_id ORDER BY amount DESC LIMIT 8`, [from, to]);
  const accounts = balances(ctx);
  const planned = ctx.db.all(`SELECT kind, SUM(amount) AS amount FROM fin_operations WHERE status='planned' AND date >= ? AND date <= ? GROUP BY kind`, [today(), addDays(today(), 30)]);
  const receivable = ctx.db.get(`SELECT COALESCE(SUM(total - COALESCE(paid_amount,0)),0) AS s, COUNT(*) AS c FROM invoices WHERE status IN ('sent','partially_paid')`);
  const totals = series.reduce((a, s) => ({ income: a.income + s.income, expense: a.expense + s.expense }), { income: 0, expense: 0 });
  return {
    from, to, series, topExpense, topIncome, accounts,
    balance: round2(accounts.filter((a) => !a.is_archived).reduce((s, a) => s + a.balance, 0)),
    income: round2(totals.income), expense: round2(totals.expense), profit: round2(totals.income - totals.expense),
    planned30: { income: round2(planned.find((p) => p.kind === 'income')?.amount ?? 0), expense: round2(planned.find((p) => p.kind === 'expense')?.amount ?? 0) },
    receivable: { amount: round2(receivable?.s ?? 0), count: receivable?.c ?? 0 },
  };
}

// ---------------- reports ----------------
interface ReportRow { id: number | null; name: string; kind: string; activity?: string; values: Record<string, number>; total: number; level?: number }

/** Отчёт о движении денежных средств (ДДС) по месяцам */
export function cashflowReport(ctx: Ctx, q: { from?: string; to?: string; project_id?: string; account_id?: string; direction_id?: string }) {
  requirePerm(ctx, 'finance', 'read');
  const def = monthRange(6);
  const from = q.from ?? def.from, to = q.to ?? def.to;
  const cols = months(from, to);
  const extra: string[] = [];
  const params: unknown[] = [from, to];
  if (q.project_id) { extra.push('o.project_id = ?'); params.push(Number(q.project_id)); }
  if (q.account_id) { extra.push('o.account_id = ?'); params.push(Number(q.account_id)); }
  if (q.direction_id) { extra.push('o.direction_id = ?'); params.push(Number(q.direction_id)); }
  const rows = ctx.db.all(`SELECT o.kind, o.category_id, c.name, c.activity, substr(o.date,1,7) AS month, SUM(o.amount) AS amount
    FROM fin_lines o LEFT JOIN fin_categories c ON c.id = o.category_id
    WHERE o.status='fact' AND o.kind IN ('income','expense') AND o.date >= ? AND o.date <= ? ${extra.length ? 'AND ' + extra.join(' AND ') : ''}
    GROUP BY o.kind, o.category_id, month`, params);
  const acts = [['operating', 'Операционная деятельность'], ['investing', 'Инвестиционная деятельность'], ['financing', 'Финансовая деятельность']];
  const sections = acts.map(([act, title]) => {
    const lines = new Map<string, ReportRow>();
    for (const r of rows.filter((x) => (x.activity ?? 'operating') === act)) {
      const key = `${r.kind}:${r.category_id ?? 0}`;
      const line: ReportRow = lines.get(key) ?? { id: r.category_id, name: r.name ?? (r.kind === 'income' ? 'Поступления без статьи' : 'Выплаты без статьи'), kind: r.kind, values: {}, total: 0 };
      const v = round2(r.kind === 'income' ? r.amount : -r.amount);
      line.values[r.month] = round2((line.values[r.month] ?? 0) + v);
      line.total = round2(line.total + v);
      lines.set(key, line);
    }
    const all = [...lines.values()].sort((a, b) => (a.kind === b.kind ? Math.abs(b.total) - Math.abs(a.total) : a.kind === 'income' ? -1 : 1));
    const net: Record<string, number> = {};
    for (const m of cols) net[m] = round2(all.reduce((s, l) => s + (l.values[m] ?? 0), 0));
    return { activity: act, title, lines: all, net, total: round2(Object.values(net).reduce((s, v) => s + v, 0)) };
  }).filter((s) => s.lines.length);
  const opening: Record<string, number> = {}, closing: Record<string, number> = {}, netAll: Record<string, number> = {};
  for (const m of cols) {
    const start = m + '-01';
    opening[m] = q.account_id || q.project_id || q.direction_id ? 0 : totalBalance(ctx, addDays(start, -1));
    netAll[m] = round2(sections.reduce((s, sec) => s + (sec.net[m] ?? 0), 0));
    closing[m] = round2(opening[m] + netAll[m]);
  }
  return { from, to, months: cols, sections, opening, net: netAll, closing };
}

/** Отчёт о прибылях и убытках (кассовый метод: по оплатам) */
export function pnlReport(ctx: Ctx, q: { from?: string; to?: string; project_id?: string; direction_id?: string }) {
  requirePerm(ctx, 'finance', 'read');
  const def = monthRange(6);
  const from = q.from ?? def.from, to = q.to ?? def.to;
  const cols = months(from, to);
  const params: unknown[] = [from, to];
  let extra = '';
  if (q.project_id) { extra = 'AND o.project_id = ?'; params.push(Number(q.project_id)); }
  if (q.direction_id) { extra += ' AND o.direction_id = ?'; params.push(Number(q.direction_id)); }
  const rows = ctx.db.all(`SELECT o.kind, o.category_id, c.name, substr(o.date,1,7) AS month, SUM(o.amount) AS amount
    FROM fin_lines o LEFT JOIN fin_categories c ON c.id = o.category_id
    WHERE o.status='fact' AND o.kind IN ('income','expense') AND COALESCE(c.in_pnl,1) = 1 AND o.date >= ? AND o.date <= ? ${extra}
    GROUP BY o.kind, o.category_id, month`, params);
  const build = (kind: string) => {
    const m = new Map<number, ReportRow>();
    for (const r of rows.filter((x) => x.kind === kind)) {
      const id = r.category_id ?? 0;
      const line: ReportRow = m.get(id) ?? { id: r.category_id, name: r.name ?? 'Без статьи', kind, values: {}, total: 0 };
      line.values[r.month] = round2((line.values[r.month] ?? 0) + r.amount);
      line.total = round2(line.total + r.amount);
      m.set(id, line);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };
  const revenue = build('income'), expenses = build('expense');
  const sum = (lines: ReportRow[]) => Object.fromEntries(cols.map((c) => [c, round2(lines.reduce((s, l) => s + (l.values[c] ?? 0), 0))]));
  const rev = sum(revenue), exp = sum(expenses);
  const profit = Object.fromEntries(cols.map((c) => [c, round2(rev[c] - exp[c])]));
  const tot = (r: Record<string, number>) => round2(Object.values(r).reduce((s, v) => s + v, 0));
  const totalRevenue = tot(rev), totalProfit = tot(profit);
  return {
    from, to, months: cols, revenue, expenses, totals: { revenue: rev, expenses: exp, profit },
    total: { revenue: totalRevenue, expenses: tot(exp), profit: totalProfit, margin: totalRevenue ? Math.round((totalProfit / totalRevenue) * 100) : null },
  };
}

export function projectsReport(ctx: Ctx) {
  requirePerm(ctx, 'finance', 'read');
  const rows = ctx.db.all(`SELECT p.id, p.name, p.status, p.budget, p.cost_budget, c.name AS company,
      (SELECT COALESCE(SUM(amount),0) FROM fin_operations o WHERE o.project_id = p.id AND o.kind='income' AND o.status='fact') AS income,
      (SELECT COALESCE(SUM(amount),0) FROM fin_operations o WHERE o.project_id = p.id AND o.kind='expense' AND o.status='fact') AS expense,
      (SELECT COALESCE(SUM(te.minutes * COALESCE(u.hour_rate,0) / 60.0),0) FROM time_entries te LEFT JOIN users u ON u.id = te.user_id WHERE te.project_id = p.id) AS labor,
      (SELECT COALESCE(SUM(minutes),0) FROM time_entries te WHERE te.project_id = p.id) AS minutes
    FROM projects p LEFT JOIN companies c ON c.id = p.company_id ORDER BY p.id DESC`);
  return rows.map((r) => {
    const cost = round2(r.expense + r.labor);
    const profit = round2(r.income - cost);
    return { ...r, income: round2(r.income), expense: round2(r.expense), labor: round2(r.labor), cost, profit, margin: r.income ? Math.round((profit / r.income) * 100) : null };
  });
}

/** Платёжный календарь: план по дням + ожидаемые оплаты счетов + обязательства */
export function paymentCalendar(ctx: Ctx, q: { from?: string; to?: string }) {
  requirePerm(ctx, 'finance', 'read');
  const from = q.from ?? today(), to = q.to ?? addDays(today(), 30);
  const items: { date: string; kind: 'income' | 'expense'; amount: number; title: string; source: string; id: number; link?: string }[] = [];
  for (const o of ctx.db.all(`SELECT o.*, c.name AS company FROM fin_operations o LEFT JOIN companies c ON c.id = o.company_id WHERE o.status='planned' AND o.date >= ? AND o.date <= ? AND o.kind IN ('income','expense')`, [addDays(from, -60), to])) {
    items.push({ date: o.date < from ? from : o.date, kind: o.kind, amount: o.amount, title: o.description || o.company || 'Плановая операция', source: o.date < from ? 'overdue_plan' : 'plan', id: o.id, link: `/finance/operations` });
  }
  for (const i of ctx.db.all(`SELECT i.*, c.name AS company FROM invoices i LEFT JOIN companies c ON c.id = i.company_id WHERE i.status IN ('sent','partially_paid') AND COALESCE(i.due_date, i.date) <= ?`, [to])) {
    const due = i.due_date ?? i.date;
    items.push({ date: due < from ? from : due, kind: 'income', amount: round2(i.total - (i.paid_amount || 0)), title: `Счёт № ${i.number} — ${i.company ?? ''}`, source: due < from ? 'overdue_invoice' : 'invoice', id: i.id, link: `/crm/invoices/${i.id}` });
  }
  for (const ob of ctx.db.all(`SELECT ob.*, c.name AS company FROM obligations ob LEFT JOIN companies c ON c.id = ob.company_id WHERE ob.status='open' AND ob.due_date <= ?`, [to])) {
    items.push({ date: ob.due_date < from ? from : ob.due_date, kind: ob.kind === 'payable' ? 'expense' : 'income', amount: round2(ob.amount - (ob.paid_amount || 0)), title: `${ob.description}${ob.company ? ' — ' + ob.company : ''}`, source: 'obligation', id: ob.id, link: '/finance/obligations' });
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  let bal = totalBalance(ctx, addDays(from, -1));
  const startBalance = bal;
  const days: { date: string; income: number; expense: number; balance: number }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const di = items.filter((x) => x.date === d);
    const income = round2(di.filter((x) => x.kind === 'income').reduce((s, x) => s + x.amount, 0));
    const expense = round2(di.filter((x) => x.kind === 'expense').reduce((s, x) => s + x.amount, 0));
    bal = round2(bal + income - expense);
    days.push({ date: d, income, expense, balance: bal });
  }
  return { from, to, startBalance, items, days, gap: days.find((d) => d.balance < 0)?.date ?? null };
}

export function budgetPlanFact(ctx: Ctx, budgetId: number) {
  requirePerm(ctx, 'finance', 'read');
  const b = getRaw(ctx.db, 'budgets', budgetId);
  if (!b) fail(404, 'Бюджет не найден');
  const lines = ctx.db.all(`SELECT bl.*, c.name, c.kind FROM budget_lines bl JOIN fin_categories c ON c.id = bl.category_id WHERE bl.budget_id = ?`, [budgetId]);
  const params: unknown[] = [`${b!.year}-01-01`, `${b!.year}-12-31`];
  let extra = '';
  if (b!.project_id) { extra = 'AND project_id = ?'; params.push(b!.project_id); }
  const facts = ctx.db.all(`SELECT category_id, CAST(substr(date,6,2) AS INTEGER) AS month, SUM(amount) AS amount FROM fin_lines
    WHERE status='fact' AND kind IN ('income','expense') AND date >= ? AND date <= ? ${extra} GROUP BY category_id, month`, params);
  const cats = new Map<number, { id: number; name: string; kind: string; plan: number[]; fact: number[] }>();
  const ensure = (id: number, name: string, kind: string) => {
    if (!cats.has(id)) cats.set(id, { id, name, kind, plan: Array(12).fill(0), fact: Array(12).fill(0) });
    return cats.get(id)!;
  };
  for (const l of lines) ensure(l.category_id, l.name, l.kind).plan[l.month - 1] += l.amount;
  for (const f of facts) {
    if (!f.category_id || !cats.has(f.category_id)) continue;
    cats.get(f.category_id)!.fact[f.month - 1] = round2(f.amount);
  }
  return { budget: b, rows: [...cats.values()].sort((a, b2) => (a.kind === b2.kind ? a.name.localeCompare(b2.name) : a.kind === 'income' ? -1 : 1)) };
}

export function payPayroll(ctx: Ctx, id: number, body: { account_id?: number; date?: string }) {
  requirePerm(ctx, 'finance', 'write');
  const p = getRaw(ctx.db, 'payroll', id);
  if (!p) fail(404, 'Начисление не найдено');
  if (p!.status === 'paid') fail(422, 'Уже выплачено');
  const account = body.account_id ?? ctx.db.get(`SELECT id FROM fin_accounts WHERE kind='bank' ORDER BY id LIMIT 1`)?.id;
  const cat = ctx.db.get(`SELECT id FROM fin_categories WHERE kind='expense' AND name LIKE 'Зарплат%' ORDER BY id LIMIT 1`)?.id;
  const u = getRaw(ctx.db, 'users', p!.user_id);
  create({ ...ctx, system: true }, 'fin_operations', { kind: 'expense', date: body.date ?? today(), amount: p!.total, account_id: account, category_id: cat, employee_id: p!.user_id, status: 'fact', description: `Зарплата за ${p!.period}: ${u?.name ?? ''}` });
  ctx.db.run(`UPDATE payroll SET status='paid', paid_date=?, updated_at=? WHERE id=?`, [body.date ?? today(), nowIso(), id]);
  ctx.deps.onWrite?.();
  return getRaw(ctx.db, 'payroll', id);
}

export function accruePayroll(ctx: Ctx, period: string) {
  requirePerm(ctx, 'finance', 'write');
  if (!/^\d{4}-\d{2}$/.test(period)) fail(422, 'Период в формате ГГГГ-ММ');
  let n = 0;
  for (const u of ctx.db.all(`SELECT id, salary FROM users WHERE is_active = 1 AND COALESCE(salary,0) > 0`)) {
    if (ctx.db.get(`SELECT id FROM payroll WHERE user_id = ? AND period = ?`, [u.id, period])) continue;
    create({ ...ctx, system: true }, 'payroll', { user_id: u.id, period, base: u.salary, bonus: 0, deductions: round2(u.salary * 0.13), status: 'accrued' });
    n++;
  }
  return { created: n };
}

// ---------------- bank statement: 1CClientBankExchange ----------------
export interface StatementDoc {
  kind: string; number: string; date: string; amount: number; payerAccount: string; payerInn: string; payer: string;
  payeeAccount: string; payeeInn: string; payee: string; purpose: string; debitedAt?: string; creditedAt?: string;
}

function ruDate(s: string | undefined): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((s ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

export function parseClientBank(text: string): { header: Record<string, string>; docs: StatementDoc[] } {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines[0]?.startsWith('1CClientBankExchange')) fail(422, 'Это не файл выписки в формате 1С (1CClientBankExchange)');
  const header: Record<string, string> = {};
  const docs: StatementDoc[] = [];
  let cur: Record<string, string> | null = null;
  for (const l of lines) {
    const eq = l.indexOf('=');
    const k = eq >= 0 ? l.slice(0, eq) : l;
    const v = eq >= 0 ? l.slice(eq + 1) : '';
    if (k === 'СекцияДокумент') { cur = { __kind: v }; continue; }
    if (k === 'КонецДокумента') {
      if (cur) {
        docs.push({
          kind: cur.__kind, number: cur['Номер'] ?? '', date: ruDate(cur['Дата']), amount: Number((cur['Сумма'] ?? '0').replace(',', '.')),
          payerAccount: cur['ПлательщикСчет'] ?? cur['ПлательщикРасчСчет'] ?? '', payerInn: cur['ПлательщикИНН'] ?? '',
          payer: cur['Плательщик1'] ?? cur['Плательщик'] ?? '', payeeAccount: cur['ПолучательСчет'] ?? cur['ПолучательРасчСчет'] ?? '',
          payeeInn: cur['ПолучательИНН'] ?? '', payee: cur['Получатель1'] ?? cur['Получатель'] ?? '', purpose: cur['НазначениеПлатежа'] ?? '',
          debitedAt: ruDate(cur['ДатаСписано']) || undefined, creditedAt: ruDate(cur['ДатаПоступило']) || undefined,
        });
      }
      cur = null;
      continue;
    }
    if (cur) cur[k] = v;
    else header[k] = v;
  }
  return { header, docs };
}

const EXPENSE_RULES: [RegExp, string][] = [
  [/аренд/i, 'Аренда'], [/зар(аботн)?.*плат|заработн|аванс сотрудн/i, 'Зарплата'], [/ндфл|страхов.*взнос|енп|единый налог|налог|фнс|уфк/i, 'Налоги и взносы'],
  [/комисси|обслуживан.*сч[её]т|тариф банка/i, 'Банковские комиссии'], [/реклам|яндекс.*директ|продвижен/i, 'Реклама и маркетинг'],
  [/связ|интернет|телефон|мтс|билайн|мегафон|ростелеком/i, 'Связь и интернет'], [/хостинг|сервер|облак|по |програм|лиценз|подписк/i, 'ПО и сервисы'],
  [/канцеляр|хоз.*товар|офис/i, 'Офисные расходы'], [/кредит|займ|процент/i, 'Погашение кредитов и займов'],
];

export function importStatement(ctx: Ctx, body: { text: string; account_id?: number; file_name?: string; dry_run?: boolean; create_companies?: boolean }) {
  requirePerm(ctx, 'finance', 'write');
  const { header, docs } = parseClientBank(body.text ?? '');
  const ourAccounts = new Set<string>();
  if (header['РасчСчет']) ourAccounts.add(header['РасчСчет']);
  const accounts = ctx.db.all(`SELECT * FROM fin_accounts`);
  for (const a of accounts) if (a.number) ourAccounts.add(String(a.number).replace(/\s/g, ''));
  let accountId = body.account_id ?? accounts.find((a) => a.number && String(a.number).replace(/\s/g, '') === header['РасчСчет'])?.id;
  if (!accountId) accountId = accounts.find((a) => a.kind === 'bank')?.id;
  if (!accountId) fail(422, 'Выберите счёт, на который загружается выписка');
  const cats = ctx.db.all(`SELECT id, name, kind FROM fin_categories`);
  const catByName = (kind: string, name: string) => cats.find((c) => c.kind === kind && c.name === name)?.id ?? null;
  const fallbackIncome = cats.find((c) => c.kind === 'income' && c.name.startsWith('Выручка'))?.id ?? null;
  const fallbackExpense = catByName('expense', 'Прочие расходы');
  const preview: Record<string, any>[] = [];
  let created = 0, skipped = 0;
  const sys: Ctx = { ...ctx, system: true };
  for (const d of docs) {
    const isIncome = ourAccounts.has(d.payeeAccount) && !ourAccounts.has(d.payerAccount) ? true
      : ourAccounts.has(d.payerAccount) && !ourAccounts.has(d.payeeAccount) ? false : !!d.creditedAt;
    const inn = isIncome ? d.payerInn : d.payeeInn;
    const cpName = isIncome ? d.payer : d.payee;
    const date = (isIncome ? d.creditedAt : d.debitedAt) || d.date || today();
    const extId = `cb:${date}:${d.number}:${d.amount}:${inn}`;
    const exists = !!ctx.db.get(`SELECT id FROM fin_operations WHERE external_id = ?`, [extId]);
    let company = inn ? ctx.db.get(`SELECT id, name FROM companies WHERE inn = ?`, [inn]) : null;
    let categoryId = isIncome ? fallbackIncome : fallbackExpense;
    if (!isIncome) for (const [re, name] of EXPENSE_RULES) if (re.test(d.purpose)) { categoryId = catByName('expense', name) ?? categoryId; break; }
    // match an open invoice: "счет № 15", "сч. 15", "по счету 15"
    let invoiceId: number | null = null;
    if (isIncome) {
      const m = /сч(?:[её]т(?:у|а)?|\.)\s*(?:на оплату\s*)?№?\s*([\w-]+)/i.exec(d.purpose);
      if (m) {
        const inv = ctx.db.get(`SELECT id, company_id FROM invoices WHERE number = ? AND status IN ('sent','partially_paid','draft')`, [m[1]]);
        if (inv && (!company || inv.company_id === company.id)) invoiceId = inv.id;
      }
    }
    const row = { date, kind: isIncome ? 'income' : 'expense', amount: d.amount, counterparty: cpName, inn, purpose: d.purpose, company: company?.name ?? null,
      category_id: categoryId, invoice_id: invoiceId, duplicate: exists };
    preview.push(row);
    if (body.dry_run) continue;
    if (exists) { skipped++; continue; }
    if (!company && body.create_companies !== false && cpName) {
      const c = create(sys, 'companies', { name: cpName.replace(/^(ИНН\s*\d+\s*)/, ''), inn: inn || null, kind: isIncome ? 'client' : 'supplier', source: 'other' });
      company = { id: c.id, name: c.name };
    }
    create(sys, 'fin_operations', {
      kind: row.kind, date, amount: d.amount, account_id: accountId, category_id: categoryId, company_id: company?.id ?? null,
      invoice_id: invoiceId, description: d.purpose, status: 'fact', source: 'bank', external_id: extId,
    });
    created++;
  }
  if (!body.dry_run) {
    create(sys, 'bank_imports', { file_name: body.file_name ?? 'выписка.txt', account_id: accountId, rows: docs.length, created_ops: created, skipped, log: { header } });
    if (created) logActivity(sys, 'fin_accounts', accountId!, 'system', `Загружена выписка: ${created} операций`);
  }
  return { header, total: docs.length, created, skipped, preview, account_id: accountId };
}

/** Выгрузка платёжных поручений для загрузки в клиент-банк (формат 1CClientBankExchange) */
export function exportPaymentOrders(ctx: Ctx, ids: number[]): string {
  requirePerm(ctx, 'finance', 'read');
  const ops = ids.length ? ctx.db.all(`SELECT o.*, c.name AS cname, c.inn AS cinn, c.kpp AS ckpp, c.account_number AS cacc, c.bik AS cbik, c.bank_name AS cbank,
      a.number AS our_acc FROM fin_operations o LEFT JOIN companies c ON c.id = o.company_id LEFT JOIN fin_accounts a ON a.id = o.account_id
      WHERE o.id IN (${ids.map(() => '?').join(',')}) AND o.kind = 'expense'`, ids) : [];
  const le = ctx.db.get(`SELECT * FROM legal_entities ORDER BY is_default DESC, id LIMIT 1`) ?? {};
  const d = (iso: string) => iso.split('-').reverse().join('.');
  const out = ['1CClientBankExchange', 'ВерсияФормата=1.03', 'Кодировка=Windows', 'Отправитель=Vela CRM', `ДатаСоздания=${d(today())}`,
    `РасчСчет=${le.account_number ?? ''}`];
  let n = 1;
  for (const o of ops) {
    out.push('СекцияДокумент=Платежное поручение', `Номер=${n++}`, `Дата=${d(o.date)}`, `Сумма=${Number(o.amount).toFixed(2)}`,
      `ПлательщикСчет=${o.our_acc ?? le.account_number ?? ''}`, `Плательщик=ИНН ${le.inn ?? ''} ${le.name ?? ''}`, `ПлательщикИНН=${le.inn ?? ''}`,
      `ПлательщикКПП=${le.kpp ?? ''}`, `ПлательщикБИК=${le.bik ?? ''}`, `ПлательщикКорсчет=${le.corr_account ?? ''}`, `ПлательщикБанк1=${le.bank_name ?? ''}`,
      `ПолучательСчет=${o.cacc ?? ''}`, `Получатель=ИНН ${o.cinn ?? ''} ${o.cname ?? ''}`, `ПолучательИНН=${o.cinn ?? ''}`, `ПолучательКПП=${o.ckpp ?? ''}`,
      `ПолучательБИК=${o.cbik ?? ''}`, `ПолучательБанк1=${o.cbank ?? ''}`, 'ВидОплаты=01', 'Очередность=5', `НазначениеПлатежа=${o.description ?? ''}`, 'КонецДокумента');
  }
  out.push('КонецФайла');
  return out.join('\r\n');
}
