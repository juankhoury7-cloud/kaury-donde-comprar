// POST /api/ev -> búsquedas y clics anónimos del mapa público.
// Límites: solo desde la propia página · 30 envíos y 300 eventos por minuto por IP ·
// 3000 eventos por día por IP (varias personas pueden compartir IP) · tope global de MAX_EV_DAY eventos por día (por defecto 30.000).
import { db, json } from '../../lib/db.js';
import { allow, ipOf, sameOrigin, tooMany } from '../../lib/guard.js';
const S = (x, n = 60) => (x == null ? '' : String(x)).slice(0, n);
const I = x => (Number.isFinite(+x) ? Math.trunc(+x) : null);
const day = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // día en hora argentina
export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'origen no permitido' }, 403);
  const ip = ipOf(request);
  if (!allow('evr:' + ip, 30, 60e3)) return tooMany();
  let d; try { const txt = await request.text(); if (txt.length > 40000) return json({ error: 'grande' }, 413); d = JSON.parse(txt); } catch { return json({ error: 'json inválido' }, 400); }
  const sid = S(d && d.sid, 16), now = Date.now();
  const rows = (Array.isArray(d && d.ev) ? d.ev.slice(0, 50) : []).filter(e => e && ['s', 'c', 'sh'].includes(e.t));
  if (!rows.length) return json({ ok: true, n: 0 });
  if (!allow('evm:' + ip, 300, 60e3, rows.length) || !allow('evd:' + ip, 3000, 864e5, rows.length)) return tooMany();
  const DB = await db(env), cap = +env.MAX_EV_DAY || 30000;
  const c = await DB.prepare("INSERT INTO kv (k,v,at) VALUES (?1,?2,?3) ON CONFLICT(k) DO UPDATE SET v=CAST(v AS INTEGER)+?2, at=?3 RETURNING v")
    .bind('evn:' + day(), String(rows.length), now).first();
  if (c && +c.v > cap) return json({ ok: false, error: 'tope diario alcanzado' }, 429);
  const st = DB.prepare('INSERT INTO ev (ts,sid,t,a,c,z,p,r,st,k) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)');
  await DB.batch(rows.map(e => { let ts = I(e.ts); if (!ts || Math.abs(ts - now) > 864e5) ts = now;
    return st.bind(ts, sid, e.t, S(e.a, 24), S(e.c, 120), S(e.z, 60), S(e.p, 40), I(e.r), I(e.st), S(e.k, 8)); }));
  return json({ ok: true, n: rows.length });
}
