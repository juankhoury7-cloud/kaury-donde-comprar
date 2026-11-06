// GET /api/admin/mins -> último chequeo diario de compra mínima y precios de los mayoristas. Pide PANEL_PASSWORD.
import { db, json } from '../../../lib/db.js';
import { adminCheck } from '../../../lib/admin.js';
import stores from '../../../data/stores.json';
export async function onRequestGet({ request, env }) {
  const deny = await adminCheck(request, env); if (deny) return deny;
  const row = await (await db(env)).prepare("SELECT v FROM kv WHERE k='mins'").first();
  const m = row ? JSON.parse(row.v) : {};
  const names = {};
  for (const r of stores) { if (!r[15]) continue; try { const h = new URL(r[15]).host; (names[h] = names[h] || new Set()).add(String(r[0]).trim()); } catch {} }
  const hosts = Object.entries(m.hosts || {}).map(([h, o]) => ({ host: h, names: [...(names[h] || [])], ...o }));
  return json({ ts: m.ts || null, hosts, moves: m.moves || {}, log: m.log || [] }, 200, { 'Cache-Control': 'no-store' });
}
