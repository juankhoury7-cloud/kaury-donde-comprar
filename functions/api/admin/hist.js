// GET /api/admin/hist -> historial diario: cuántas tiendas online tienen cada artículo. Pide PANEL_PASSWORD.
import { db, json } from '../../../lib/db.js';
import { adminCheck } from '../../../lib/admin.js';
export async function onRequestGet({ request, env }) {
  const deny = await adminCheck(request, env); if (deny) return deny;
  const row = await (await db(env)).prepare("SELECT v FROM kv WHERE k='hist'").first();
  return new Response(row ? row.v : '{}', { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
