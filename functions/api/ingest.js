// POST /api/ingest -> lo llama el lector de stock (GitHub Actions) con la clave INGEST_TOKEN
// GET  /api/ingest -> con la misma clave, devuelve el último chequeo de compra mínima y precios
import { db, json, bearer, same, secret } from '../../lib/db.js';
import { allow, ipOf, tooMany } from '../../lib/guard.js';
import { invalidate } from './stock.js';
import { runAlerts } from '../../lib/notify.js';
import { saveHist } from '../../lib/hist.js';
export async function onRequestPost({ request, env, waitUntil }) {
  if (!allow('in:' + ipOf(request), 6, 60e3)) return tooMany();
  if (!same(bearer(request), secret(env.INGEST_TOKEN))) { await new Promise(r => setTimeout(r, 600)); return json({ error: 'no autorizado' }, 401); }
  let d; try { d = await request.json(); } catch { return json({ error: 'json inválido' }, 400); }
  if (!d || d.v !== 1 || typeof d.ts !== 'number' || typeof d.prods !== 'object' || typeof d.stock !== 'object') return json({ error: 'formato inválido' }, 400);
  // el chequeo diario de compra mínima y precios se guarda aparte: no viaja a los visitantes
  const mins = d.mins && typeof d.mins === 'object' ? JSON.stringify(d.mins) : null; delete d.mins;
  const v = JSON.stringify(d);
  if (v.length > 1.5e6 || (mins && mins.length > 1e6)) return json({ error: 'demasiado grande' }, 413);
  const DB = await db(env);
  await DB.prepare("INSERT INTO kv (k,v,at) VALUES ('stock',?1,?2) ON CONFLICT(k) DO UPDATE SET v=excluded.v, at=excluded.at").bind(v, Date.now()).run();
  if (mins) await DB.prepare("INSERT INTO kv (k,v,at) VALUES ('mins',?1,?2) ON CONFLICT(k) DO UPDATE SET v=excluded.v, at=excluded.at").bind(mins, Date.now()).run();
  // limpieza: los eventos de más de 13 meses y los contadores diarios viejos se borran
  if (new Date().getUTCMinutes() < 5) await DB.batch([DB.prepare('DELETE FROM ev WHERE ts < ?1').bind(Date.now() - 400 * 864e5), DB.prepare("DELETE FROM kv WHERE k LIKE 'evn:%' AND at < ?1").bind(Date.now() - 7 * 864e5), DB.prepare("DELETE FROM kv WHERE k LIKE 'rl:%' AND at < ?1").bind(Date.now() - 2 * 864e5), DB.prepare('DELETE FROM sessions WHERE exp < ?1').bind(Date.now())]);
  invalidate();
  // registro de corridas del robot (últimas 400 ≈ 33 horas) para la pestaña Sistema del panel
  try {
    const S = Object.values(d.status || {}), run = d.run || {};
    const rec = { at: Date.now(), ts: d.ts, n: S.length, ok: S.filter(x => x.ok && x.arts).length, warn: S.filter(x => x.warn).length, dur: run.dur || null, full: run.relist ? 1 : 0, mins: run.daily ? 1 : 0, kb: Math.round(v.length / 1024) };
    const row = await DB.prepare("SELECT v FROM kv WHERE k='runs'").first();
    let runs = []; try { runs = row ? JSON.parse(row.v) : []; } catch { runs = []; }
    runs.push(rec); if (runs.length > 400) runs = runs.slice(-400);
    await DB.prepare("INSERT INTO kv (k,v,at) VALUES ('runs',?1,?2) ON CONFLICT(k) DO UPDATE SET v=excluded.v, at=excluded.at").bind(JSON.stringify(runs), Date.now()).run();
  } catch (e) { console.log('corridas', e && e.message); }
  try { await saveHist(DB, d); } catch (e) { console.log('historial', e && e.message); }
  // avisos de stock: se revisan en segundo plano para no demorar la respuesta
  const site = new URL(request.url).origin.replace(/^http:\/\/(?!127|localhost)/, 'https://');
  const job = runAlerts(DB, env, d, site).then(r => { console.log('avisos', JSON.stringify(r)); return DB.prepare("INSERT INTO kv (k,v,at) VALUES ('alertsrun',?1,?2) ON CONFLICT(k) DO UPDATE SET v=excluded.v, at=excluded.at").bind(JSON.stringify(r || {}), Date.now()).run(); }, e => console.log('avisos error', e && e.message));
  if (waitUntil) waitUntil(job); else await job;
  return json({ ok: true, tiendas: Object.keys(d.stock).length, bytes: v.length });
}

export async function onRequestGet({ request, env }) {
  if (!allow('ig:' + ipOf(request), 6, 60e3)) return tooMany();
  if (!same(bearer(request), secret(env.INGEST_TOKEN))) return json({ error: 'no autorizado' }, 401);
  const row = await (await db(env)).prepare("SELECT v FROM kv WHERE k='mins'").first();
  return new Response(row ? row.v : '{}', { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
