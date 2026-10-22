import type { DB, PermLevel, User } from '../types.ts';
import { fail, nowIso, parseJson, randomToken, sha256Hex, verifyPassword, hashPassword } from '../util.ts';

const SESSION_DAYS = 30;

export function loadUser(db: DB, id: number): User | null {
  const u = db.get(`SELECT u.*, r.permissions AS role_perms FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [id]);
  if (!u || !u.is_active) return null;
  const perms = parseJson<Record<string, PermLevel>>(u.role_perms, {});
  const { password_hash: _ph, role_perms: _rp, ...rest } = u;
  return { ...rest, perms } as User;
}

export async function userByToken(db: DB, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  if (token.startsWith('vk_')) {
    const hash = await sha256Hex(token);
    const key = db.get(`SELECT * FROM api_keys WHERE token_hash = ? AND is_active = 1`, [hash]);
    if (!key) return null;
    db.run(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`, [nowIso(), key.id]);
    return key.user_id ? loadUser(db, key.user_id) : null;
  }
  const s = db.get(`SELECT * FROM sessions WHERE token = ?`, [token]);
  if (!s || (s.expires_at && s.expires_at < nowIso())) return null;
  return loadUser(db, s.user_id);
}

export async function login(db: DB, email: string, password: string): Promise<{ token: string; user: User }> {
  const row = db.get(`SELECT * FROM users WHERE lower(email) = lower(?)`, [String(email ?? '').trim()]);
  if (!row || !row.is_active || !(await verifyPassword(String(password ?? ''), row.password_hash))) {
    fail(401, 'Неверный email или пароль');
  }
  const token = randomToken();
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.run(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)`, [token, row.id, nowIso(), exp]);
  return { token, user: loadUser(db, row.id)! };
}

export function logout(db: DB, token?: string) {
  if (token) db.run(`DELETE FROM sessions WHERE token = ?`, [token]);
}

export async function setPassword(db: DB, userId: number, password: string) {
  if (!password || password.length < 6) fail(422, 'Пароль должен быть не короче 6 символов');
  db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [await hashPassword(password), userId]);
}

export async function createApiKey(db: DB, name: string, userId: number): Promise<{ id: number; token: string }> {
  const token = 'vk_' + randomToken(20);
  const res = db.run(`INSERT INTO api_keys (name, prefix, token_hash, user_id, is_active, created_at, updated_at) VALUES (?,?,?,?,1,?,?)`,
    [name, token.slice(0, 10) + '…', await sha256Hex(token), userId, nowIso(), nowIso()]);
  return { id: res.lastId, token };
}
