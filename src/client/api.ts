// Transport: the same API either over HTTP (own server) or in-process (browser demo).
export const IS_DEMO = import.meta.env.VITE_ENGINE !== 'http';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let token: string | null = (() => {
  try { return localStorage.getItem('vela-token'); } catch { return null; }
})();

export function getToken() { return token; }
export function setToken(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem('vela-token', t);
    else localStorage.removeItem('vela-token');
  } catch { /* ignore */ }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function cleanQuery(q?: Query): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q ?? {})) if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  return out;
}

const listeners = new Set<() => void>();
export function onUnauthorized(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const q = cleanQuery(query);
  let status: number;
  let data: any;
  if (IS_DEMO) {
    const { localRequest } = await import('./engine.ts');
    // structured clone keeps the in-browser core from mutating UI objects
    const res = await localRequest({ method, path, query: q, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)), token: token ?? undefined });
    status = res.status;
    data = res.body;
  } else {
    const qs = new URLSearchParams(q).toString();
    const res = await fetch(path + (qs ? `?${qs}` : ''), {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    status = res.status;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  }
  if (status === 401 && !path.endsWith('/auth/login')) listeners.forEach((l) => l());
  if (status >= 400) throw new ApiError(status, data?.error ?? `Ошибка ${status}`);
  return data as T;
}

export const api = {
  get: <T = any>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T = any>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T = any>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T = any>(path: string) => request<T>('DELETE', path),
};

/** Upload a file: to disk on the server, into the database in the demo. */
export async function uploadFile(file: File, extra: { folder_id?: number | null; entity_type?: string; entity_id?: number }) {
  if (IS_DEMO) {
    if (file.size > 3 * 1024 * 1024) throw new ApiError(413, 'В демо-версии можно загружать файлы до 3 МБ');
    const dataUrl = await new Promise<string>((ok, fail) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => fail(r.error);
      r.readAsDataURL(file);
    });
    return api.post('/api/e/files', { name: file.name, size: file.size, mime: file.type || 'application/octet-stream', path: dataUrl, ...extra });
  }
  const qs = new URLSearchParams(cleanQuery({ name: file.name, ...extra } as Query)).toString();
  const res = await fetch(`/api/files/upload?${qs}`, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream', Authorization: `Bearer ${token}` }, body: file });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error ?? 'Не удалось загрузить файл');
  return res.json();
}

export async function downloadFile(f: { id: number; name: string; path?: string }) {
  let blob: Blob;
  if (IS_DEMO || String(f.path ?? '').startsWith('data:')) {
    const rec = f.path ? f : await api.get(`/api/e/files/${f.id}`);
    blob = await (await fetch(String(rec.path))).blob();
  } else {
    const res = await fetch(`/api/files/${f.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError(res.status, 'Не удалось скачать файл');
    blob = await res.blob();
  }
  saveBlob(blob, f.name);
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function saveText(content: string, name: string, type = 'text/plain;charset=utf-8') {
  saveBlob(new Blob([content], { type }), name);
}

/** Opens printable HTML produced by the core (invoice, act, document) */
export async function openPrint(path: string) {
  const w = window.open('', '_blank');
  const { html } = await api.get<{ html: string }>(path);
  if (!w) { saveText(html, 'document.html', 'text/html;charset=utf-8'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
