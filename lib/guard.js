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

// ---- Límites que valen en TODOS los servidores de Cloudflare (los de arriba son por servidor).
// El contador se guarda en la base (tabla kv, claves rl:…) por ventana de tiempo.
// Cuando una clave se pasa, se recuerda en memoria hasta que termine la ventana: no se vuelve a tocar la base.
const blocked = new Map();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
/** Identificador de la IP sin guardarla: resumen SHA-256 recortado. */
export async function ipHash(request) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('kaury|' + ipOf(request)))).slice(0, 16);
}
const win = (key, ms) => { const w = Math.floor(Date.now() / ms); return { k: 'rl:' + key + ':' + w, end: (w + 1) * ms }; };
/** Suma `cost` al contador de `key`; false si en esta ventana ya pasó de `max`. */
export async function dbAllow(DB, key, max, ms, cost = 1) {
  const { k, end } = win(key, ms), now = Date.now();
  if ((blocked.get(k) || 0) > now) return false;
  const r = await DB.prepare('INSERT INTO kv (k,v,at) VALUES (?1,?2,?3) ON CONFLICT(k) DO UPDATE SET v=CAST(v AS INTEGER)+?2, at=?3 RETURNING v').bind(k, String(cost), now).first();
  if (r && +r.v > max) {
    blocked.set(k, end);
    if (blocked.size > 5000) for (const [x, t] of blocked) { if (t < now) blocked.delete(x); }
    return false;
  }
  return true;
}
/** Cuánto lleva el contador de `key` en esta ventana (sin sumar). */
export async function dbCount(DB, key, ms) {
  const { k } = win(key, ms);
  const r = await DB.prepare('SELECT v FROM kv WHERE k=?1').bind(k).first();
  return r ? +r.v : 0;
}
/** Lee el cuerpo como JSON con un tope de tamaño; null si es inválido o muy grande. */
export async function readJson(request, max = 4000) {
  try { const t = await request.text(); if (t.length > max) return null; return JSON.parse(t); } catch { return null; }
}
