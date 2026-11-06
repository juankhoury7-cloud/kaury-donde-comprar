// POST /api/ingest -> lo llama el lector de stock (GitHub Actions) con la clave INGEST_TOKEN
import { db, json, bearer, same, secret } from '../../lib/db.js';
export async function onRequestPost({ request, env }) {
  if (!same(bearer(request), secret(env.INGEST_TOKEN))) return json({ error: 'no autorizado' }, 401);
  let d; try { d = await request.json(); } catch { return json({ error: 'json inválido' }, 400); }
  if (!d || d.v !== 1 || typeof d.ts !== 'number' || typeof d.prods !== 'object' || typeof d.stock !== 'object') return json({ error: 'formato inválido' }, 400);
  const v = JSON.stringify(d);
  if (v.length > 1.5e6) return json({ error: 'demasiado grande' }, 413);
  const DB = await db(env);
  await DB.prepare("INSERT INTO kv (k,v,at) VALUES ('stock',?1,?2) ON CONFLICT(k) DO UPDATE SET v=excluded.v, at=excluded.at").bind(v, Date.now()).run();
  return json({ ok: true, tiendas: Object.keys(d.stock).length, bytes: v.length });
}
