import { migrate } from './migrate.ts';
import { seed } from './seed.ts';
import type { DB } from './types.ts';

export { handle, systemUser, drainWebhooks } from './router.ts';
export { migrate, seed };
export type { DB, Deps, Req, Res } from './types.ts';

/** Prepare a database: create/upgrade tables, fill demo data when empty and asked to. */
export async function init(db: DB, opts: { demo: boolean }) {
  migrate(db);
  if (opts.demo) await seed(db);
}

/** Converts values for SQLite drivers: booleans to 0/1, undefined to null, objects to JSON. */
export function normalizeParams(params: unknown[] = []): (string | number | null | Uint8Array)[] {
  return params.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number' || typeof v === 'string') return v;
    if (typeof v === 'bigint') return Number(v);
    if (v instanceof Uint8Array) return v;
    return JSON.stringify(v);
  });
}
