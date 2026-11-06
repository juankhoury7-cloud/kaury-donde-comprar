// GET /api/stock?m=min|may -> último stock leído de las tiendas de ese canal (minorista o mayorista).
// Sin m devuelve todo. Se guarda 30 s en memoria para que muchas visitas juntas no lean la base cada vez.
import { db, json } from '../../lib/db.js';
import { allow, ipOf, tooMany } from '../../lib/guard.js';
import stores from '../../data/stores.json';
let mem = null, memAt = 0, cut = {};
const KEYS = { min: new Set(), may: new Set() };
for (const r of stores) { const c = r[12] || 'min'; if (r[10] && (c === 'min' || c === 'both')) KEYS.min.add(r[10]); if (r[16] && (c === 'may' || c === 'both')) KEYS.may.add(r[16]); }
function subset(full, m) {
  const d = JSON.parse(full), keep = KEYS[m], o = { v: d.v, ts: d.ts, m, prods: {}, stock: {}, vars: {} };
  for (const k of keep) { const sk = k.replace(/^www\./, ''); if (d.prods[k]) o.prods[k] = d.prods[k]; if (d.stock[sk]) o.stock[sk] = d.stock[sk]; if (d.vars && d.vars[sk]) o.vars[sk] = d.vars[sk]; }
  return JSON.stringify(o);
}
export async function onRequestGet({ request, env }) {
  if (!allow('st:' + ipOf(request), 30, 60e3)) return tooMany();
  const m = new URL(request.url).searchParams.get('m');
  try {
    if (!mem || Date.now() - memAt > 30e3) {
      const row = await (await db(env)).prepare("SELECT v FROM kv WHERE k='stock'").first();
      if (!row) return json({ error: 'todavía sin datos' }, 404, { 'Cache-Control': 'no-store' });
      mem = row.v; memAt = Date.now(); cut = {};
    }
    const body = m === 'min' || m === 'may' ? (cut[m] = cut[m] || subset(mem, m)) : mem;
    return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=60' } });
  } catch (e) { return mem ? new Response(mem, { headers: { 'Content-Type': 'application/json; charset=utf-8' } }) : json({ error: 'no disponible' }, 503); }
}
export const invalidate = () => { mem = null; cut = {}; };
