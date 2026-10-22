export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const fail = (status: number, message: string): never => { throw new HttpError(status, message); };

export const nowIso = () => new Date().toISOString();

export function today(): string {
  return localDate(new Date());
}

export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function localDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${localDate(d)}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return localDate(d);
}

export function addMonths(iso: string, months: number): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00');
  d.setMonth(d.getMonth() + months);
  return localDate(d);
}

export function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v as T;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function randomToken(bytes = 24): string {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

const enc = new TextEncoder();

export async function sha256Hex(s: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', enc.encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** PBKDF2-SHA256, format: pbkdf2$iterations$saltHex$hashHex */
export async function hashPassword(password: string, saltHex?: string, iterations = 120_000): Promise<string> {
  const salt = saltHex ?? randomToken(16);
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, key, 256);
  const hex = Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$${iterations}$${salt}$${hex}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, iter, salt] = stored.split('$');
  if (algo !== 'pbkdf2') return false;
  const again = await hashPassword(password, salt, Number(iter));
  return again === stored;
}

/** deterministic PRNG for demo data */
export function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
  };
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const onesF = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

function plural(n: number, forms: [string, string, string]): string {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
  return forms[2];
}

function triad(n: number, female: boolean): string {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  const out = [hundreds[h]];
  if (t === 1) out.push(teens[u]);
  else { out.push(tens[t]); out.push((female ? onesF : ones)[u]); }
  return out.filter(Boolean).join(' ');
}

/** Сумма прописью: 1250.5 -> «Одна тысяча двести пятьдесят рублей 50 копеек» */
export function amountInWords(amount: number): string {
  const rub = Math.floor(Math.abs(amount));
  const kop = Math.round((Math.abs(amount) - rub) * 100);
  const parts: string[] = [];
  const groups: [number, boolean, [string, string, string]][] = [
    [Math.floor(rub / 1e9) % 1000, false, ['миллиард', 'миллиарда', 'миллиардов']],
    [Math.floor(rub / 1e6) % 1000, false, ['миллион', 'миллиона', 'миллионов']],
    [Math.floor(rub / 1e3) % 1000, true, ['тысяча', 'тысячи', 'тысяч']],
  ];
  for (const [n, female, forms] of groups) if (n) parts.push(triad(n, female), plural(n, forms));
  const r = rub % 1000;
  if (r || !parts.length) parts.push(r ? triad(r, false) : 'ноль');
  parts.push(plural(rub, ['рубль', 'рубля', 'рублей']));
  const s = parts.filter(Boolean).join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1) + ` ${String(kop).padStart(2, '0')} ${plural(kop, ['копейка', 'копейки', 'копеек'])}`;
}

/** Strips scripts, event handlers and javascript: URLs from user HTML (templates, articles). */
export function sanitizeHtml(html: string): string {
  return String(html ?? '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|xlink:href|action)\s*=\s*("|')\s*(javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1="#"');
}
