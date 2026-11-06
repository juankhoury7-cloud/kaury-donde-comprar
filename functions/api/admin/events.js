// GET /api/admin/events?days=90 -> datos para el panel (pide la contraseña PANEL_PASSWORD)
import { db, json, bearer, same, secret } from '../../../lib/db.js';
import { allow, fails, ipOf, tooMany } from '../../../lib/guard.js';
export async function onRequestGet({ request, env }) {
  if (!secret(env.PANEL_PASSWORD)) return json({ error: 'falta configurar PANEL_PASSWORD en Cloudflare' }, 503);
  const ip = ipOf(request);
  if (fails('pf:' + ip, 15 * 60e3) >= 8) return tooMany('demasiados intentos, esperá 15 minutos');
  if (!same(bearer(request), secret(env.PANEL_PASSWORD))) { allow('pf:' + ip, 1e9, 15 * 60e3); await new Promise(r => setTimeout(r, 600)); return json({ error: 'no autorizado' }, 401); }
  if (!allow('pa:' + ip, 20, 60e3)) return tooMany();
  const days = Math.min(365, Math.max(1, +new URL(request.url).searchParams.get('days') || 90));
  const DB = await db(env);
  const { results } = await DB.prepare('SELECT ts,sid,t,a,c,z,p,r,st,k FROM ev WHERE ts>=?1 ORDER BY ts DESC LIMIT 20000').bind(Date.now() - days * 864e5).all();
  const ev = results.map(x => { const o = { t: x.t, ts: x.ts, a: x.a || '', c: x.c || '', z: x.z || '', p: x.p || '' }; if (x.t === 's') o.r = x.r; if (x.t === 'c') { o.st = x.st; o.k = x.k; } return o; });
  const meta = await DB.prepare("SELECT at FROM kv WHERE k='stock'").first();
  return json({ ev, stockAt: meta ? meta.at : null }, 200, { 'Cache-Control': 'no-store' });
}
