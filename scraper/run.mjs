// Corre cada 5 minutos en GitHub Actions: lee el stock de las tiendas y lo sube a la página.
//   SITE_URL      p. ej. https://kaury-donde-comprar.pages.dev  (de ahí lee el estado anterior y ahí lo sube)
//   INGEST_TOKEN  clave secreta compartida con Cloudflare
//   FULL=1        fuerza a revisar de nuevo qué artículos tiene cada tienda (si no, se hace 1 vez por hora)
//   OUT           archivo donde guardar el resultado (opcional)
import { readFile, writeFile } from 'node:fs/promises';
import { listProducts, readStock, makeNormalizer, pool, sleep, lastErr } from './lib.mjs';

const here = p => new URL('../data/' + p, import.meta.url);
const json = async p => JSON.parse(await readFile(here(p), 'utf8'));
const SITE = (process.env.SITE_URL || '').replace(/\/$/, '');
const TOKEN = process.env.INGEST_TOKEN || '';
const LIST_EVERY = 60 * 60e3;

const [shops, catalog, sizes] = await Promise.all([json('shops.json'), json('catalog.json'), json('sizes.json')]);
const CAT = new Set(catalog.map(r => r[0]));
const normalize = makeNormalizer(catalog, sizes);

let prev = null;
if (SITE) {
  try { const r = await fetch(SITE + '/api/stock', { cache: 'no-store', signal: AbortSignal.timeout(20000) }); if (r.ok) prev = await r.json(); } catch (e) { console.log('No pude leer el estado anterior:', e.message); }
}
if (!prev || !prev.prods) prev = await json('snapshot.json');

const now = Date.now();
const relist = process.env.FULL === '1' || !prev.prodsTs || now - prev.prodsTs > LIST_EVERY;
const out = { v: 1, ts: now, prodsTs: relist ? now : prev.prodsTs, prods: {}, stock: {}, status: {} };
console.log(relist ? 'Revisando listados y stock' : 'Revisando stock', '·', new Date(now).toISOString());

await pool(Object.entries(shops), 13, async ([key, shop]) => {
  const t0 = Date.now(), sk = key.replace(/^www\./, '');
  const pProds = (prev.prods || {})[key] || {}, pStock = (prev.stock || {})[sk] || {};
  const status = { ok: true };
  let prods = pProds;
  if (relist) {
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
    if (s === 'E') { errs++; return c in pStock ? pStock[c] : (c in pProds ? 0 : '?'); }
    return normalize(c, s);
  });
  const stock = {};
  codes.forEach((c, i) => { if (res[i] !== 0) stock[c] = res[i]; });
  if (codes.length && errs === codes.length) { status.ok = false; status.err = (status.err ? status.err + '; ' : '') + 'no respondió ninguna página de artículo'; out.stock[sk] = pStock; }
  else out.stock[sk] = stock;
  out.prods[key] = prods;
  Object.assign(status, { arts: codes.length, conStock: Object.keys(out.stock[sk]).length, errores: errs, seg: Math.round((Date.now() - t0) / 1000) });
  out.status[key] = status;
});

const keys = Object.keys(out.status), okN = keys.filter(k => out.status[k].ok).length;
for (const k of keys) { const s = out.status[k]; console.log((s.ok ? 'OK ' : 'ERR') + ' ' + k.padEnd(40) + ` ${s.conStock}/${s.arts} con stock · ${s.errores} errores · ${s.seg}s` + (s.err ? ' · ' + s.err : '') + (s.warn ? ' · ' + s.warn : '')); }
console.log(`${okN}/${keys.length} tiendas OK` + (Object.keys(lastErr).length ? ' · errores de páginas por código: ' + JSON.stringify(lastErr) : ''));

const body = JSON.stringify(out);
if (process.env.OUT) await writeFile(process.env.OUT, body);
if (okN < Math.ceil(keys.length / 2)) { console.log('Menos de la mitad de las tiendas respondió: no subo nada para no borrar datos buenos.'); process.exit(1); }
if (SITE && TOKEN) {
  const r = await fetch(SITE + '/api/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN }, body, signal: AbortSignal.timeout(30000) });
  console.log('Subida:', r.status, await r.text());
  if (!r.ok) process.exit(1);
} else console.log('Sin SITE_URL/INGEST_TOKEN: no se sube (prueba local).');
