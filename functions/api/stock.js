// GET /api/stock -> último stock leído de las tiendas (lo usa el mapa cada 5 minutos).
// Se guarda 30 s en memoria para que muchas visitas juntas no lean la base cada vez.
import { db, json } from '../../lib/db.js';
import { allow, ipOf, tooMany } from '../../lib/guard.js';
let mem = null, memAt = 0;
export async function onRequestGet({ request, env }) {
  if (!allow('st:' + ipOf(request), 30, 60e3)) return tooMany();
  try {
    if (!mem || Date.now() - memAt > 30e3) {
      const row = await (await db(env)).prepare("SELECT v FROM kv WHERE k='stock'").first();
      if (!row) return json({ error: 'todavía sin datos' }, 404, { 'Cache-Control': 'no-store' });
      mem = row.v; memAt = Date.now();
    }
    return new Response(mem, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=60' } });
  } catch (e) { return mem ? new Response(mem, { headers: { 'Content-Type': 'application/json; charset=utf-8' } }) : json({ error: 'no disponible' }, 503); }
}
export const invalidate = () => { mem = null; };
