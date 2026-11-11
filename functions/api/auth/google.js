// POST /api/auth/google {credential} -> verifica el token de Google, crea o actualiza la cuenta y abre sesión
import { db, json } from '../../../lib/db.js';
import { allow, dbAllow, ipHash, ipOf, readJson, sameOrigin, tooMany } from '../../../lib/guard.js';
import { verifyGoogle, newSession, pub } from '../../../lib/auth.js';
export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'origen no permitido' }, 403);
  if (!allow('au:' + ipOf(request), 10, 60e3)) return tooMany();
  const b = await readJson(request, 8000); if (!b) return json({ error: 'json inválido' }, 400);
  let g; try { g = await verifyGoogle(b && b.credential); } catch (e) { return json({ error: String(e.message || e) }, 401); }
  const DB = await db(env), now = Date.now();
  if (!(await dbAllow(DB, 'au:' + (await ipHash(request)), 30, 3600e3))) return tooMany('demasiados ingresos, probá en un rato');
  const u = await DB.prepare('INSERT INTO users (sub,email,name,created,seen) VALUES (?1,?2,?3,?4,?4) ON CONFLICT(sub) DO UPDATE SET email=excluded.email, name=excluded.name, seen=excluded.seen RETURNING id,email,name,tipo,news,prov')
    .bind(g.sub, g.email, g.name, now).first();
  const cookie = await newSession(DB, u.id);
  // como mucho 10 sesiones abiertas por cuenta: las más viejas se cierran
  await DB.prepare('DELETE FROM sessions WHERE uid=?1 AND h NOT IN (SELECT h FROM sessions WHERE uid=?1 ORDER BY exp DESC LIMIT 10)').bind(u.id).run();
  if (Math.random() < 0.05) await DB.prepare('DELETE FROM sessions WHERE exp < ?1').bind(now).run();
  return json({ user: pub(u) }, 200, { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' });
}
