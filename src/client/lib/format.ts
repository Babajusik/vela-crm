const moneyFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const moneyFmt2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export function money(v: unknown, opts: { cents?: boolean; currency?: string } = {}): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const s = (opts.cents ? moneyFmt2 : moneyFmt).format(n);
  const cur = opts.currency ?? 'RUB';
  return `${s} ${cur === 'RUB' ? '₽' : cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'CNY' ? '¥' : cur}`;
}

export function compactMoney(v: unknown): string {
  const n = Number(v ?? 0);
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} млрд ₽`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',')} млн ₽`;
  if (a >= 1e3) return `${Math.round(n / 1e3)} тыс. ₽`;
  return `${Math.round(n)} ₽`;
}

export function num(v: unknown, digits = 0): string {
  const n = Number(v ?? 0);
  return n.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function toLocalDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayIso() { return toLocalDate(new Date()); }

/** Accepts 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm' (local) or full ISO with Z */
export function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return new Date(s + ':00');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function date(v: unknown): string {
  const d = parseDate(v);
  if (!d) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function dateLong(v: unknown): string {
  const d = parseDate(v);
  if (!d) return '—';
  const y = d.getFullYear() === new Date().getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${y}`;
}

export function dateTime(v: unknown): string {
  const d = parseDate(v);
  if (!d) return '—';
  const hasTime = String(v).length > 10;
  const base = dateLong(v);
  return hasTime ? `${base}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : base;
}

export function time(v: unknown): string {
  const d = parseDate(v);
  return d ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
}

export function relative(v: unknown): string {
  const d = parseDate(v);
  if (!d) return '—';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400 && d.getDate() === new Date().getDate()) return `сегодня в ${time(v)}`;
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `вчера в ${time(v)}`;
  return dateTime(v);
}

export function deadlineInfo(v: unknown, done = false): { text: string; tone: 'danger' | 'warning' | 'muted' | 'ok' } {
  const d = parseDate(v);
  if (!d) return { text: 'Без срока', tone: 'muted' };
  if (done) return { text: dateTime(v), tone: 'muted' };
  const now = new Date();
  const hasTime = String(v).length > 10;
  const end = new Date(d);
  if (!hasTime) end.setHours(23, 59, 59);
  if (end < now) return { text: `Просрочено: ${dateTime(v)}`, tone: 'danger' };
  if (end.toDateString() === now.toDateString()) return { text: `Сегодня${hasTime ? ', ' + time(v) : ''}`, tone: 'warning' };
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  if (end.toDateString() === tm.toDateString()) return { text: `Завтра${hasTime ? ', ' + time(v) : ''}`, tone: 'ok' };
  return { text: dateTime(v), tone: 'ok' };
}

export function monthLabel(ym: string, short = false): string {
  const [y, m] = ym.split('-').map(Number);
  return short ? `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}` : `${MONTHS_NOM[m - 1]} ${y}`;
}

export function monthName(m: number) { return MONTHS_NOM[m]; }
export function monthShort(m: number) { return MONTHS_SHORT[m]; }

export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

export function minutes(m: number): string {
  const h = Math.floor(m / 60), mm = Math.round(m % 60);
  if (!h) return `${mm} мин`;
  return mm ? `${h} ч ${mm} мин` : `${h} ч`;
}

export function fileSize(b: number): string {
  if (!b) return '—';
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} КБ`;
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}

export function initials(name: string): string {
  return String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?';
}

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return toLocalDate(d);
}

export function nowLocalDateTime(offsetHours = 0): string {
  const d = new Date(Date.now() + offsetHours * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${toLocalDate(d)}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function hexAlpha(hex: string | undefined, alpha: number): string {
  const h = (hex ?? '#64748b').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
