// Protección contra saturación: límites en memoria por IP (por servidor de Cloudflare),
// tope diario global de eventos en la base, y filtro de origen.
const buckets = new Map();
/** true si la clave todavía tiene cupo: como mucho `max` usos cada `ms` milisegundos. */
export function allow(key, max, ms, cost = 1) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.t > ms) { b = { t: now, n: 0 }; buckets.set(key, b); }
  if (b.n + cost > max) return false;
  b.n += cost;
  if (buckets.size > 20000) for (const [k, v] of buckets) { if (now - v.t > 3600e3) buckets.delete(k); }
  return true;
}
export function fails(key, ms) { const b = buckets.get(key); return b && Date.now() - b.t <= ms ? b.n : 0; }
export const ipOf = request => request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'local';
/** Solo acepta pedidos que vienen de la propia página (los navegadores mandan Origin en los POST). */
export function sameOrigin(request) {
  const o = request.headers.get('Origin'); if (!o) return false;
  try { return new URL(o).host === new URL(request.url).host; } catch { return false; }
}
export const tooMany = (msg = 'demasiados pedidos, probá en un rato') => new Response(JSON.stringify({ error: msg }), { status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '60' } });
