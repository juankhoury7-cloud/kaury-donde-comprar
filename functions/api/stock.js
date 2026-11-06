// GET /api/stock -> último stock leído de las tiendas (lo usa el mapa cada 5 minutos)
import { db, json } from '../../lib/db.js';
export async function onRequestGet({ env }) {
  try {
    const row = await (await db(env)).prepare("SELECT v FROM kv WHERE k='stock'").first();
    if (!row) return json({ error: 'todavía sin datos' }, 404, { 'Cache-Control': 'no-store' });
    return new Response(row.v, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
  } catch (e) { return json({ error: String(e.message || e) }, 500); }
}
