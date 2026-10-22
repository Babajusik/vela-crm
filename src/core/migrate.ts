import { ENTITY_LIST } from './schema.ts';
import type { DB, FieldType } from './types.ts';

export const SCHEMA_VERSION = 1;

function sqlType(t: FieldType): string {
  switch (t) {
    case 'int': case 'ref': case 'user': case 'bool': return 'INTEGER';
    case 'number': case 'money': return 'REAL';
    default: return 'TEXT';
  }
}

/** Creates every table from the schema. Safe to run on an existing database: adds missing columns. */
export function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT, expires_at TEXT);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  `);
  for (const e of ENTITY_LIST) {
    const cols = e.fields.map((f) => `"${f.key}" ${sqlType(f.type)}`);
    db.exec(`CREATE TABLE IF NOT EXISTS "${e.key}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${cols.join(',\n      ')},
      extra TEXT,
      created_by INTEGER,
      created_at TEXT,
      updated_at TEXT
    )`);
    const existing = new Set(db.all<{ name: string }>(`PRAGMA table_info("${e.key}")`).map((r) => r.name));
    for (const f of e.fields) {
      if (!existing.has(f.key)) db.exec(`ALTER TABLE "${e.key}" ADD COLUMN "${f.key}" ${sqlType(f.type)}`);
    }
    for (const f of e.fields) {
      if (f.type === 'ref' || f.type === 'user' || f.key === 'onec_guid' || f.key === 'entity_id') {
        db.exec(`CREATE INDEX IF NOT EXISTS "ix_${e.key}_${f.key}" ON "${e.key}" ("${f.key}")`);
      }
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS ix_activities_entity ON activities (entity_type, entity_id)`);
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version', ?)`, [String(SCHEMA_VERSION)]);
}
