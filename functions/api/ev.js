// POST /api/ev -> búsquedas y clics anónimos del mapa público.
// Protección contra abuso (alguien que toca "buscar" mil veces o un programa que manda pedidos):
//  · solo desde la propia página · 6 envíos y 60 eventos por minuto por IP (por servidor)
//  · la misma búsqueda o el mismo clic repetido por la misma persona en 30 minutos se cuenta una sola vez
//  · solo artículos y provincias que existen
//  · 500 eventos por día por IP, contados en la base (vale para todos los servidores)
//  · tope global de MAX_EV_DAY eventos por día (por defecto 5.000); al llegar, no se escribe nada más hasta el otro día
//  · EV_OFF=1 en Cloudflare apaga el registro por completo (llave de emergencia)
import { db, json } from '../../lib/db.js';
import { allow, ipOf, ipHash, dbAllow, sameOrigin, tooMany } from '../../lib/guard.js';
import { ART, PROVS } from '../../lib/match.js';
const S = (x, n = 60) => (x == null ? '' : String(x)).slice(0, n);
const I = x => (Number.isFinite(+x) ? Math.trunc(+x) : null);
const day = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // día en hora argentina
// de dónde llegó la visita (se guarda solo la categoría, nunca la dirección completa)
const SRC = ['instagram', 'facebook', 'google', 'whatsapp', 'tiktok', 'kaury', 'directo', 'otro'];
const seen = new Map(); let capDay = '';
const DUP_MS = 30 * 60e3;
function fresh(key, now) {
  const t = seen.get(key); if (t && now - t < DUP_MS) return false;
  seen.set(key, now);
  if (seen.size > 20000) for (const [k, v] of seen) { if (now - v > DUP_MS) seen.delete(k); }
  return true;
}
const okArt = a => !a || !!ART[a] || /^\?[^<>]{1,20}$/.test(a);
export async function onRequestPost({ request, env }) {
  if (env.EV_OFF === '1') return json({ ok: true, n: 0, off: true });
  if (!sameOrigin(request)) return json({ error: 'origen no permitido' }, 403);
  const ip = ipOf(request);
  if (!allow('evr:' + ip, 6, 60e3)) return tooMany();
  if (capDay === day()) return json({ ok: false, error: 'tope diario alcanzado' }, 429);
  let d; try { const txt = await request.text(); if (txt.length > 40000) return json({ error: 'grande' }, 413); d = JSON.parse(txt); } catch { return json({ error: 'json inválido' }, 400); }
  const sid = S(d && d.sid, 16), now = Date.now();
  const rows = (Array.isArray(d && d.ev) ? d.ev.slice(0, 40) : [])
    .filter(e => e && ['s', 'c', 'sh'].includes(e.t) && okArt(S(e.a, 24)) && (!e.p || PROVS.has(String(e.p))))
    .filter(e => fresh([ip, sid, e.t, S(e.a, 24), S(e.c, 120), S(e.z, 60), S(e.p, 40), I(e.st), S(e.k, 8)].join('|'), now));
  if (!rows.length) return json({ ok: true, n: 0 });
  if (!allow('evm:' + ip, 60, 60e3, rows.length)) return tooMany();
  const DB = await db(env), cap = +env.MAX_EV_DAY || 5000;
  if (!(await dbAllow(DB, 'ev:' + (await ipHash(request)), 500, 864e5, rows.length))) return tooMany('llegaste al límite de hoy');
  const c = await DB.prepare("INSERT INTO kv (k,v,at) VALUES (?1,?2,?3) ON CONFLICT(k) DO UPDATE SET v=CAST(v AS INTEGER)+?2, at=?3 RETURNING v")
    .bind('evn:' + day(), String(rows.length), now).first();
  if (c && +c.v > cap) { capDay = day(); return json({ ok: false, error: 'tope diario alcanzado' }, 429); }
  const st = DB.prepare('INSERT INTO ev (ts,sid,t,a,c,z,p,r,st,k,m,o) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)');
  await DB.batch(rows.map(e => { let ts = I(e.ts); if (!ts || Math.abs(ts - now) > 864e5) ts = now;
    return st.bind(ts, sid, e.t, S(e.a, 24), S(e.c, 120), S(e.z, 60), S(e.p, 40), I(e.r), I(e.st), S(e.k, 8), ['may', 'all'].includes(e.m) ? e.m : 'min', SRC.includes(e.o) ? e.o : null); }));
  return json({ ok: true, n: rows.length });
}
