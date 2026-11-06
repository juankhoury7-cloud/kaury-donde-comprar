// POST /api/ev -> búsquedas y clics anónimos del mapa público
import { db, json } from '../../lib/db.js';
const S = (x, n = 60) => (x == null ? '' : String(x)).slice(0, n);
const I = x => (Number.isFinite(+x) ? Math.trunc(+x) : null);
export async function onRequestPost({ request, env }) {
  let d; try { const txt = await request.text(); if (txt.length > 40000) return json({ error: 'grande' }, 413); d = JSON.parse(txt); } catch { return json({ error: 'json inválido' }, 400); }
  const ev = Array.isArray(d && d.ev) ? d.ev.slice(0, 50) : [];
  const sid = S(d && d.sid, 16), now = Date.now();
  const rows = ev.filter(e => e && ['s', 'c', 'sh'].includes(e.t));
  if (!rows.length) return json({ ok: true, n: 0 });
  const DB = await db(env);
  const st = DB.prepare('INSERT INTO ev (ts,sid,t,a,c,z,p,r,st,k) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)');
  await DB.batch(rows.map(e => { let ts = I(e.ts); if (!ts || Math.abs(ts - now) > 864e5) ts = now;
    return st.bind(ts, sid, e.t, S(e.a, 24), S(e.c, 120), S(e.z, 60), S(e.p, 40), I(e.r), I(e.st), S(e.k, 8)); }));
  return json({ ok: true, n: rows.length });
}
