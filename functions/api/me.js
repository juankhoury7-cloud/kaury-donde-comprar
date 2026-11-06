// GET /api/me -> cuenta actual y sus avisos · POST /api/me {tipo, news, prov} -> actualiza la cuenta
import { db, json } from '../../lib/db.js';
import { allow, ipOf, sameOrigin, tooMany } from '../../lib/guard.js';
import { currentUser, pub } from '../../lib/auth.js';
const H = { 'Cache-Control': 'no-store' };
export async function onRequestGet({ request, env }) {
  if (!allow('me:' + ipOf(request), 60, 60e3)) return tooMany();
  const DB = await db(env), u = await currentUser(DB, request);
  if (!u) return json({ user: null }, 200, H);
  const { results } = await DB.prepare('SELECT id,a,c,z,p,m,created,sent,active FROM alerts WHERE uid=?1 ORDER BY created DESC LIMIT 50').bind(u.id).all();
  return json({ user: pub(u), alerts: results }, 200, H);
}
export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'origen no permitido' }, 403);
  const DB = await db(env), u = await currentUser(DB, request);
  if (!u) return json({ error: 'entrá con Google' }, 401);
  let b; try { b = await request.json(); } catch { return json({ error: 'json inválido' }, 400); }
  const tipo = ['min', 'rev'].includes(b.tipo) ? b.tipo : u.tipo, news = b.news === undefined ? u.news : (b.news ? 1 : 0), prov = b.prov === undefined ? u.prov : String(b.prov || '').slice(0, 40);
  await DB.prepare('UPDATE users SET tipo=?1, news=?2, prov=?3, seen=?4 WHERE id=?5').bind(tipo, news, prov, Date.now(), u.id).run();
  return json({ user: pub({ ...u, tipo, news, prov }) }, 200, H);
}
export async function onRequestDelete({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'origen no permitido' }, 403);
  const DB = await db(env), u = await currentUser(DB, request);
  if (!u) return json({ error: 'entrá con Google' }, 401);
  await DB.batch([DB.prepare('DELETE FROM alerts WHERE uid=?1').bind(u.id), DB.prepare('DELETE FROM sessions WHERE uid=?1').bind(u.id), DB.prepare('DELETE FROM users WHERE id=?1').bind(u.id)]);
  return json({ ok: true }, 200, { 'Set-Cookie': 'ks=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0', 'Cache-Control': 'no-store' });
}
