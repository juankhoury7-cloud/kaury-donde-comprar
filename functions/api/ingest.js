// POST /api/ingest -> lo llama el lector de stock (GitHub Actions) con la clave INGEST_TOKEN
import { db, json, bearer, same, secret } from '../../lib/db.js';
import { allow, ipOf, tooMany } from '../../lib/guard.js';
import { invalidate } from './stock.js';
export async function onRequestPost({ request, env }) {
  if (!allow('in:' + ipOf(request), 6, 60e3)) return tooMany();
  if (!same(bearer(request), secret(env.INGEST_TOKEN))) return json({ error: 'no autorizado' }, 401);
  let d; try { d = await request.json(); } catch { return json({ error: 'json inválido' }, 400); }
  if (!d || d.v !== 1 || typeof d.ts !== 'number' || typeof d.prods !== 'object' || typeof d.stock !== 'object') return json({ error: 'formato inválido' }, 400);
  const v = JSON.stringify(d);
  if (v.length > 1.5e6) return json({ error: 'demasiado grande' }, 413);
  const DB = await db(env);
  await DB.prepare("INSERT INTO kv (k,v,at) VALUES ('stock',?1,?2) ON CONFLICT(k) DO UPDATE SET v=excluded.v, at=excluded.at").bind(v, Date.now()).run();
  // limpieza: los eventos de más de 13 meses y los contadores diarios viejos se borran
  if (new Date().getUTCMinutes() < 5) await DB.batch([DB.prepare('DELETE FROM ev WHERE ts < ?1').bind(Date.now() - 400 * 864e5), DB.prepare("DELETE FROM kv WHERE k LIKE 'evn:%' AND at < ?1").bind(Date.now() - 7 * 864e5)]);
  invalidate();
  return json({ ok: true, tiendas: Object.keys(d.stock).length, bytes: v.length });
}
