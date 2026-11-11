// Corre cada 5 minutos en GitHub Actions: lee el stock de las tiendas y lo sube a la página.
//   SITE_URL      p. ej. https://kaury-donde-comprar.pages.dev  (de ahí lee el estado anterior y ahí lo sube)
//   INGEST_TOKEN  clave secreta compartida con Cloudflare
//   FULL=1        fuerza a revisar de nuevo qué artículos tiene cada tienda (si no, se hace 1 vez por hora)
//   OUT           archivo donde guardar el resultado (opcional)
import { readFile, writeFile } from 'node:fs/promises';
import { listProducts, readStock, makeNormalizer, pool, sleep, lastErr, apiShop } from './lib.mjs';
import { checkMins, priceMoves } from './mins.mjs';

const here = p => new URL('../data/' + p, import.meta.url);
const json = async p => JSON.parse(await readFile(here(p), 'utf8'));
const SITE = (process.env.SITE_URL || '').replace(/\/$/, '');
const TOKEN = process.env.INGEST_TOKEN || '';
const LIST_EVERY = 60 * 60e3;

const [shops, catalog, sizes, stores] = await Promise.all([json('shops.json'), json('catalog.json'), json('sizes.json'), json('stores.json')]);
const CAT = new Set(catalog.map(r => r[0]));
const normalize = makeNormalizer(catalog, sizes);

let prev = null;
if (SITE) {
  try { const r = await fetch(SITE + '/api/stock', { cache: 'no-store', signal: AbortSignal.timeout(20000) }); if (r.ok) prev = await r.json(); } catch (e) { console.log('No pude leer el estado anterior:', e.message); }
}
if (!prev || !prev.prods) prev = await json('snapshot.json');

// Estado del chequeo diario de compra mínima y precios (lo guarda la página; solo se lee con la clave)
let pm = {};
if (SITE && TOKEN) {
  try { const r = await fetch(SITE + '/api/ingest', { headers: { Authorization: 'Bearer ' + TOKEN }, signal: AbortSignal.timeout(20000) }); if (r.ok) pm = await r.json(); } catch (e) { console.log('No pude leer el chequeo anterior:', e.message); }
}
const now = Date.now();
const daily = process.env.MINS === '1' || !pm.ts || now - pm.ts > 23.5 * 3600e3;
const relist = daily || process.env.FULL === '1' || !prev.prodsTs || now - prev.prodsTs > LIST_EVERY;
const out = { v: 1, ts: now, prodsTs: relist ? now : prev.prodsTs, prods: {}, stock: {}, vars: {}, status: {} };
const px = {};
console.log(relist ? 'Revisando listados y stock' : 'Revisando stock', '·', new Date(now).toISOString());

await pool(Object.entries(shops), 13, async ([key, shop]) => {
  const t0 = Date.now(), sk = key.replace(/^www\./, '');
  const pProds = (prev.prods || {})[key] || {}, pStock = (prev.stock || {})[sk] || {}, pVars = (prev.vars || {})[sk] || {};
  const status = { ok: true };
  const may = shop.canal === 'may';
  // mayoristas: su stock se revisa una vez por hora (junto con los listados); en las otras pasadas se mantiene
  if (may && !relist) { out.prods[key] = pProds; out.stock[sk] = pStock; out.vars[sk] = pVars; out.status[key] = { ...((prev.status || {})[key] || { ok: true }), may: true }; return; }
  // tiendas que publican sus datos en un servicio (Kaury MDP): artículos y stock salen de ahí, sin leer páginas
  if (shop.api) {
    const A = await apiShop(shop, CAT);
    if (A.err) { out.prods[key] = pProds; out.stock[sk] = pStock; out.vars[sk] = pVars; out.status[key] = { ok: !!Object.keys(pProds).length, err: 'datos: ' + A.err }; return; }
    const stock = {}; for (const [c, e] of Object.entries(A.ent)) if (e) stock[c] = normalize(c, e);
    out.prods[key] = A.prods; out.stock[sk] = stock; out.vars[sk] = {};
    out.status[key] = { ok: true, arts: Object.keys(A.prods).length, conStock: Object.keys(stock).length, errores: 0, seg: Math.round((Date.now() - t0) / 1000) };
    return;
  }
  let prods = pProds;
  // las tiendas donde hay que abrir cada producto para ver el número se relistan una vez por día
  const pst = (prev.status || {})[key] || {};
  const slow = shop.pageCodeRe && Object.keys(pProds).length && pst.listTs && now - pst.listTs < 23.5 * 3600e3 && process.env.FULL !== '1';
  if (slow) status.listTs = pst.listTs;
  if (relist && !slow) {
    if (shop.pageCodeRe) status.listTs = now;
    const L = await listProducts(shop, CAT);
    const n = Object.keys(L.prods).length, pn = Object.keys(pProds).length;
    if (L.err && !Object.keys(pProds).length) { status.ok = false; status.err = 'listado: ' + L.err; }
    else if (L.err) status.warn = 'no se pudo abrir el listado (' + L.err + '); se mantienen los artículos anteriores';
    else if (pn && n < pn * 0.5) { status.warn = `listado con ${n} artículos (antes ${pn}); se mantiene el anterior`; }
    else prods = L.prods;
  }
  const codes = Object.keys(prods);
  let errs = 0;
  const res = await pool(codes, 2, async c => {
    await sleep(200 + Math.random() * 300);
    let s = await readStock(prods[c]);
    if (s === 'E') { errs++; return { ent: c in pStock ? pStock[c] : (c in pProds ? 0 : '?'), vars: pVars[c] || null }; }
    return { ent: normalize(c, s.ent), vars: normalize.vars(c, s.vars), price: s.price || null };
  });
  const stock = {}, vars = {};
  codes.forEach((c, i) => { if (res[i].ent !== 0) { stock[c] = res[i].ent; if (res[i].vars) vars[c] = res[i].vars; } if (res[i].price) (px[sk] = px[sk] || {})[c] = res[i].price; });
  if (codes.length && errs === codes.length) { status.ok = false; status.err = (status.err ? status.err + '; ' : '') + 'no respondió ninguna página de artículo'; out.stock[sk] = pStock; out.vars[sk] = pVars; }
  else { out.stock[sk] = stock; out.vars[sk] = vars; }
  out.prods[key] = prods;
  Object.assign(status, { arts: codes.length, conStock: Object.keys(out.stock[sk]).length, errores: errs, seg: Math.round((Date.now() - t0) / 1000) });
  out.status[key] = status;
});

const keys = Object.keys(out.status), base = keys.filter(k => shops[k].canal !== 'may'), okN = base.filter(k => out.status[k].ok).length;
for (const k of keys) { const s = out.status[k]; if (s.may && !relist) continue; console.log((s.ok ? 'OK ' : 'ERR') + ' ' + k.padEnd(40) + ` ${s.conStock}/${s.arts} con stock · ${s.errores} errores · ${s.seg}s` + (s.err ? ' · ' + s.err : '') + (s.warn ? ' · ' + s.warn : '')); }
console.log(`${okN}/${base.length} tiendas minoristas OK · ${keys.filter(k => shops[k].canal === 'may' && out.status[k].ok).length}/${keys.length - base.length} mayoristas OK` + (Object.keys(lastErr).length ? ' · errores de páginas por código: ' + JSON.stringify(lastErr) : ''));

// Chequeo diario: compra mínima publicada en la web de cada mayorista y cambios fuertes de precio
let mstate = pm;
if (daily) {
  const hosts = {};
  for (const r of stores) {
    const c = r[12] || 'min'; if (!(c === 'may' || c === 'both') || !r[15]) continue;
    let u; try { u = new URL(r[15]); } catch { continue; }
    const h = hosts[u.host] || (hosts[u.host] = { origin: u.origin, base: r[13] ?? null, baseTxt: r[14] || '', names: [] });
    const n = String(r[0]).trim(); if (!h.names.includes(n)) h.names.push(n);
  }
  const t0 = Date.now(), r = await checkMins(hosts, pm), moves = priceMoves(pm.px || {}, px);
  const log = [...r.changes, ...Object.entries(moves).map(([sk, m]) => ({ host: sk, precio: m.pct, n: m.n, ts: now })), ...(pm.log || [])].slice(0, 80);
  mstate = { ts: now, hosts: r.hosts, px, moves, log };
  const cnt = {}; Object.values(r.hosts).forEach(h => cnt[h.st] = (cnt[h.st] || 0) + 1);
  console.log('Compra mínima:', JSON.stringify(cnt), '·', Math.round((Date.now() - t0) / 1000) + 's');
  for (const [h, o] of Object.entries(r.hosts)) if (o.st !== 'ok') console.log('  ' + o.st.padEnd(7) + h.padEnd(36) + (o.seen ? ' web: ' + o.seen : '') + (o.why ? ' · ' + o.why : '') + (o.err ? ' · ' + o.err : ''));
  for (const c of r.changes) console.log('  CAMBIO ' + c.host + ': ' + c.de + ' → ' + c.a + (c.temp ? ' (promo)' : ''));
  for (const [sk, m] of Object.entries(moves)) console.log('  PRECIOS ' + sk + ': ' + (m.pct > 0 ? '+' : '') + m.pct + '% en ' + m.n + ' artículos');
  out.mins = mstate;
}
// lo que el mapa necesita: la compra mínima vigente de cada web mayorista cuando cambió respecto de la lista
out.mo = {};
for (const [h, o] of Object.entries(mstate.hosts || {})) if ((o.amt !== null && o.amt !== undefined) || o.q) out.mo[h] = { a: o.q ? null : o.amt, t: o.txt, p: o.temp ? 1 : 0 };

const body = JSON.stringify(out);
if (process.env.OUT) await writeFile(process.env.OUT, body);
if (okN < Math.ceil(base.length / 2)) { console.log('Menos de la mitad de las tiendas respondió: no subo nada para no borrar datos buenos.'); process.exit(1); }
if (SITE && TOKEN) {
  const r = await fetch(SITE + '/api/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN }, body, signal: AbortSignal.timeout(30000) });
  console.log('Subida:', r.status, await r.text());
  if (!r.ok) process.exit(1);
} else console.log('Sin SITE_URL/INGEST_TOKEN: no se sube (prueba local).');
