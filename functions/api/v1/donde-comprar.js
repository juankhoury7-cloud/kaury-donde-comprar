// GET /api/v1/donde-comprar -> locales con tienda web, stock por canal y catálogo, ya armados (lib/public.js).
// Lo usa la sección "Encontranos" de kaury.com. Se guarda 30 s en memoria; el navegador lo guarda 60 s.
import { db, json } from '../../../lib/db.js';
import { allow, ipOf, tooMany } from '../../../lib/guard.js';
import { shape } from '../../../lib/public.js';
import { corsHeaders } from '../../../lib/cors.js';
let body = null, at = 0;
export async function onRequestOptions({ request }) { return new Response(null, { status: 204, headers: corsHeaders(request) }); }
export async function onRequestGet({ request, env }) {
  const cors = corsHeaders(request);
  if (!allow('v1:' + ipOf(request), 30, 60e3)) return tooMany();
  try {
    if (!body || Date.now() - at > 30e3) {
      const row = await (await db(env)).prepare("SELECT v FROM kv WHERE k='stock'").first();
      if (!row) return json({ error: 'todavía sin datos' }, 404, { 'Cache-Control': 'no-store', ...cors });
      body = JSON.stringify(shape(row.v)); at = Date.now();
    }
    return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', ...cors } });
  } catch (e) { return body ? new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } }) : json({ error: 'no disponible' }, 503, cors); }
}
