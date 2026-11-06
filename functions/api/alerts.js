// POST /api/alerts {a,c,z,p} -> crea un aviso "Avisame cuando haya" · DELETE /api/alerts?id= -> lo borra
import { db, json } from '../../lib/db.js';
import { allow, sameOrigin, tooMany } from '../../lib/guard.js';
import { currentUser } from '../../lib/auth.js';
import { ART, PROVS } from '../../lib/match.js';
const list = (x, n) => String(x || '').split(/[+,]/).map(s => s.trim().slice(0, 30)).filter(Boolean).slice(0, n).join('+');
export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'origen no permitido' }, 403);
  const DB = await db(env), u = await currentUser(DB, request);
  if (!u) return json({ error: 'entrá con Google para recibir avisos' }, 401);
  if (!allow('al:' + u.id, 20, 60e3)) return tooMany();
  let b; try { b = await request.json(); } catch { return json({ error: 'json inválido' }, 400); }
  const a = String(b.a || ''); if (!ART[a]) return json({ error: 'artículo inexistente' }, 400);
  const c = list(b.c, 8), z = b.z === 'curva' ? 'curva' : list(b.z, 8), p = PROVS.has(b.p) ? b.p : '', m = b.m === 'may' ? 'may' : b.m === 'all' ? 'all' : 'min';
  const act = await DB.prepare('SELECT id,a,c,z,p,m FROM alerts WHERE uid=?1 AND active=1').bind(u.id).all();
  const dup = act.results.find(x => x.a === a && x.c === c && x.z === z && x.p === p && (x.m || 'min') === m);
  if (dup) return json({ ok: true, id: dup.id, dup: true });
  if (act.results.length >= 30) return json({ error: 'llegaste al máximo de 30 avisos activos' }, 429);
  const r = await DB.prepare('INSERT INTO alerts (uid,a,c,z,p,m,created) VALUES (?1,?2,?3,?4,?5,?6,?7) RETURNING id').bind(u.id, a, c, z, p, m, Date.now()).first();
  return json({ ok: true, id: r.id });
}
export async function onRequestDelete({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'origen no permitido' }, 403);
  const DB = await db(env), u = await currentUser(DB, request);
  if (!u) return json({ error: 'entrá con Google' }, 401);
  const id = +new URL(request.url).searchParams.get('id');
  await DB.prepare('UPDATE alerts SET active=0 WHERE id=?1 AND uid=?2').bind(id, u.id).run();
  return json({ ok: true });
}
