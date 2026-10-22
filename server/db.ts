import { DatabaseSync } from 'node:sqlite';
import { normalizeParams, type DB } from '../src/core/index.ts';

export function openDb(file: string): DB {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  // built-in lower() only folds ASCII; Cyrillic search needs Unicode case folding
  (raw as any).function('lower', { deterministic: true }, (v: unknown) => (v == null ? null : String(v).toLowerCase()));
  const cache = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  const stmt = (sql: string) => {
    let s = cache.get(sql);
    if (!s) {
      s = raw.prepare(sql);
      if (cache.size > 500) cache.clear();
      cache.set(sql, s);
    }
    return s;
  };
  let depth = 0;
  const db: DB = {
    all: (sql, params) => stmt(sql).all(...normalizeParams(params)) as any[],
    get: (sql, params) => stmt(sql).get(...normalizeParams(params)) as any,
    run: (sql, params) => {
      const r = stmt(sql).run(...normalizeParams(params));
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    exec: (sql) => raw.exec(sql),
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
  return db;
}
