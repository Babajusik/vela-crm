// Demo engine: the whole CRM core runs in the browser on SQLite (WebAssembly).
// Data is kept in IndexedDB of this browser only.
import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { handle, init, normalizeParams, type DB, type Deps, type Req, type Res } from '../core/index.ts';

const IDB_NAME = 'vela-demo';
const IDB_KEY = 'db-v2'; // bump when demo data changes: old copies are dropped
const OLD_KEYS = ['db-v1'];

function idb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

async function idbGet(key: string): Promise<Uint8Array | undefined> {
  try {
    const d = await idb();
    return await new Promise((ok) => {
      const r = d.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => ok(r.result as Uint8Array | undefined);
      r.onerror = () => ok(undefined);
    });
  } catch {
    return undefined;
  }
}

async function idbSet(key: string, value: Uint8Array | null): Promise<void> {
  try {
    const d = await idb();
    await new Promise<void>((ok) => {
      const tx = d.transaction('kv', 'readwrite');
      if (value) tx.objectStore('kv').put(value, key);
      else tx.objectStore('kv').delete(key);
      tx.oncomplete = () => ok();
      tx.onerror = () => ok();
    });
  } catch {
    /* storage unavailable (private mode): the demo still works in memory */
  }
}

function wrap(raw: Database): DB {
  let depth = 0;
  const rows = (sql: string, params?: unknown[]) => {
    const st = raw.prepare(sql);
    try {
      st.bind(normalizeParams(params) as any);
      const out: any[] = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally {
      st.free();
    }
  };
  return {
    all: (sql, params) => rows(sql, params),
    get: (sql, params) => rows(sql, params)[0],
    run: (sql, params) => {
      raw.run(sql, normalizeParams(params) as any);
      const changes = raw.getRowsModified();
      const id = raw.exec('SELECT last_insert_rowid()')[0]?.values[0][0];
      return { changes, lastId: Number(id ?? 0) };
    },
    exec: (sql) => { raw.exec(sql); },
    tx: (fn) => {
      if (depth > 0) { depth++; try { return fn(); } finally { depth--; } }
      depth++;
      raw.exec('BEGIN');
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
  };
}

let ready: Promise<Deps> | null = null;
let rawDb: Database | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function persistSoon() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { if (rawDb) idbSet(IDB_KEY, rawDb.export()); }, 500);
}

export function startEngine(): Promise<Deps> {
  ready ??= (async () => {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    for (const k of OLD_KEYS) idbSet(k, null);
    const saved = await idbGet(IDB_KEY);
    rawDb = saved ? new SQL.Database(saved) : new SQL.Database();
    rawDb.create_function('lower', (v: unknown) => (v == null ? null : String(v).toLowerCase()));
    const db = wrap(rawDb);
    const deps: Deps = { db, mode: 'demo', onWrite: persistSoon, log: (...a) => console.warn(...a) };
    await init(db, { demo: true });
    persistSoon();
    window.addEventListener('beforeunload', () => { if (rawDb) idbSet(IDB_KEY, rawDb.export()); });
    return deps;
  })();
  return ready;
}

export async function localRequest(req: Req): Promise<Res> {
  const deps = await startEngine();
  return handle(deps, req);
}

export async function resetDemo() {
  await idbSet(IDB_KEY, null);
  localStorage.removeItem('vela-token');
  location.reload();
}
