// GET /api/admin/events?days=90 -> datos para el panel (pide la contraseña PANEL_PASSWORD)
import { db, json } from '../../../lib/db.js';
import { adminCheck } from '../../../lib/admin.js';
export async function onRequestGet({ request, env }) {
  const deny = await adminCheck(request, env); if (deny) return deny;
  const days = Math.min(365, Math.max(1, +new URL(request.url).searchParams.get('days') || 90));
  const DB = await db(env);
  const { results } = await DB.prepare('SELECT ts,sid,t,a,c,z,p,r,st,k FROM ev WHERE ts>=?1 ORDER BY ts DESC LIMIT 20000').bind(Date.now() - days * 864e5).all();
  const ev = results.map(x => { const o = { t: x.t, ts: x.ts, a: x.a || '', c: x.c || '', z: x.z || '', p: x.p || '' }; if (x.t === 's') o.r = x.r; if (x.t === 'c') { o.st = x.st; o.k = x.k; } return o; });
  const meta = await DB.prepare("SELECT at FROM kv WHERE k='stock'").first();
  const acc = await DB.prepare("SELECT COUNT(*) n, SUM(tipo='min') min, SUM(tipo='rev') rev, SUM(news) news, SUM(created>=?1) nuevos FROM users").bind(Date.now() - 7 * 864e5).first();
  const al = await DB.prepare('SELECT SUM(active=1) activos, SUM(sent IS NOT NULL) enviados FROM alerts').first();
  const top = await DB.prepare("SELECT a, c, z, COUNT(*) n FROM alerts WHERE active=1 GROUP BY a,c,z ORDER BY n DESC LIMIT 10").all();
  return json({ ev, stockAt: meta ? meta.at : null, cuentas: { total: acc.n || 0, min: acc.min || 0, rev: acc.rev || 0, news: acc.news || 0, nuevos7d: acc.nuevos || 0, avisosActivos: al.activos || 0, avisosEnviados: al.enviados || 0, topAvisos: top.results } }, 200, { 'Cache-Control': 'no-store' });
}
