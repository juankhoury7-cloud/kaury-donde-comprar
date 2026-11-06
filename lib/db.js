// Base de datos D1 (Cloudflare). Las tablas se crean solas la primera vez.
let ready = null;
export function db(env) {
  if (!env.DB) throw new Error('Falta conectar la base D1 con el nombre DB');
  if (!ready) ready = env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS ev (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, sid TEXT, t TEXT, a TEXT, c TEXT, z TEXT, p TEXT, r INTEGER, st INTEGER, k TEXT)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS ev_ts ON ev(ts)'),
  ]).catch(e => { ready = null; throw e; });
  return ready.then(() => env.DB);
}
export const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra } });
export function bearer(request) { const h = request.headers.get('Authorization') || ''; if (!h.startsWith('Bearer ')) return ''; const v = h.slice(7).trim(); try { return decodeURIComponent(v).trim(); } catch { return v; } }
export const secret = v => (typeof v === 'string' ? v.trim() : '');
export function same(a, b) { // comparación de claves sin atajos
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
