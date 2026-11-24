// Lectura de artículos Kaury y su stock en las tiendas online de los clientes.
// Misma lógica que se usó a mano en la beta: listados de cada tienda -> link de cada
// artículo -> variantes con stock (Tiendanube, WooCommerce, Empretienda).
import { parse } from 'node-html-parser';

export const UA = 'Mozilla/5.0 (compatible; KauryDondeComprar/1.0; +https://github.com/juankhoury7-cloud/kaury-donde-comprar)';

export const lastErr = {};
export async function get(url, { timeout = 20000, tries = 4 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'es-AR,es;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
      if (r.status === 404) return { status: 404, html: null };
      if (r.status === 429 || r.status >= 500) { // la tienda pide ir más despacio: esperar y reintentar
        const ra = +r.headers.get('retry-after');
        if (i + 1 < tries) { await sleep(Math.min(20000, (ra > 0 ? ra * 1000 : 2500 * (i + 1)) + Math.random() * 800)); continue; }
      }
      if (!r.ok) { if (i + 1 < tries && r.status !== 403) { await sleep(1500); continue; } return { status: r.status, html: null }; }
      return { status: r.status, html: await r.text(), url: r.url };
    } catch (e) {
      if (i + 1 < tries) { await sleep(1500); continue; }
      return { status: 0, html: null, err: String(e && e.name || e) };
    }
  }
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const BAD = /search|[?&]s=|\/page\/|cart|carrito|wishlist|login|cuenta|account|whatsapp|instagram|facebook|javascript:|mailto:|tel:|^#/i;
const core = h => h.replace(/^(www|tienda|store|shop)\./, '');
const CODE_RE = /(?:\b|(?<=\bkau?))\d{3,4}(?=k?\b)/gi;
// Muchas tiendas rellenan con ceros: "0153" = art. 153, "0018" = art. 18 (se quitan los ceros de adelante).
export const nc = c => String(c).replace(/^0+(?=\d{2})/, '');
const KR = /kaury|kau\d|-kau|-kai|-kam|\bka\d|-ka\d|art-ka|\b[pm]-?\d{2,3}-?ka\b/i;
// Intimates "P110", "P-31", "p110ka" y Summer "M650" (el número se valida contra su línea con pcode)
const PCODE_RE = /(?<![a-z\d])[pm]-?\d{2,3}(?=(?:ka?)?(?![a-z\d]))/gi;

/** Recorre los listados de una tienda y devuelve {codigo: url} de los artículos Kaury del catálogo. */
export async function listProducts(shop, CAT) {
  const O = shop.origin, host = new URL(O).host;
  const prod = {}, cnt = {};
  let pagesOk = 0, firstErr = null;
  // opciones por tienda (data/shops.json):
  //   hosts:   otras direcciones donde la tienda publica sus artículos (p. ej. gtlenceria.com.ar para gtmayorista.com)
  //   codeRe:  de dónde sale el número de artículo en el link (p. ej. "/ka(\\d{3,4})-"); si está, es la única fuente
  //   pairRe:  para tiendas que escriben el número al lado de la foto y no en el link: regex sobre el HTML con (link, número)
  //   pairBase: dirección base para los links de pairRe cuando la página usa <base href> (Pedix)
  //   listing "sitemap:/sitemap.xml": toma los links del índice para Google (webs armadas con JavaScript)
  const okHost = h => [host, ...(shop.hosts || [])].some(x => core(x) === core(h));
  const cre = shop.codeRe ? new RegExp(shop.codeRe, 'i') : null;
  const add = (c, url) => { c = String(c).replace(/^0+(?=\d{2})/, ''); const k = c + '|' + url; cnt[k] = (cnt[k] || 0) + 1; if (!prod[c] || cnt[k] > cnt[c + '|' + prod[c]]) prod[c] = url; };
  //   pageCodeRe + linkRe: el número solo figura dentro de cada producto ("Código KAU8248"): se juntan los links de los
  //   listados y se abre cada producto una vez (run.mjs lo hace una vez por día y reutiliza el resultado)
  if (shop.pageCodeRe) {
    const lre = new RegExp(shop.linkRe || '/product', 'i'), pre = new RegExp(shop.pageCodeRe, 'i'), links = new Set();
    for (const T of shop.listings) for (let p = 1; p < 16; p++) {
      const u = O + T.replace('{p}', p), r = await get(u);
      if (!r.html) { if (p === 1 && !firstErr) firstErr = r.status || r.err; break; }
      pagesOk++; const n = links.size;
      for (const a of parse(r.html).querySelectorAll('a[href]')) { let abs; try { abs = new URL(a.getAttribute('href'), u); } catch { continue; } if (okHost(abs.host) && lre.test(abs.pathname)) links.add(abs.origin + abs.pathname); }
      if (links.size === n || !T.includes('{p}')) break;
    }
    await pool([...links], 2, async url => { await sleep(250 + Math.random() * 300); const r = await get(url); if (!r.html) return; const m = parse(r.html).text.match(pre); if (m && CAT.has(String(m[1]).replace(/^0+(?=\d{2})/, ''))) add(m[1], url); });
    return { prods: Object.fromEntries(Object.entries(prod).filter(([k]) => CAT.has(k))), pagesOk, err: pagesOk ? null : (firstErr || 'sin respuesta') };
  }
  for (const T of shop.listings) {
    if (T.startsWith('sitemap:')) {
      const urls = [], todo = [O + T.slice(8)], seen = new Set();
      while (todo.length && seen.size < 12) {
        const u = todo.shift(); if (seen.has(u)) continue; seen.add(u);
        const r = await get(u); if (!r.html) { if (!firstErr) firstErr = r.status || r.err; continue; }
        pagesOk++;
        for (const m of r.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) { const x = m[1].replace(/&amp;/g, '&'); if (/\.xml(\?|$)/i.test(x)) todo.push(x); else urls.push(x); }
      }
      for (const url of urls) {
        let abs; try { abs = new URL(url); } catch { continue; }
        if (!okHost(abs.host) || /avril|marcela|kaury-?men|kaury-int/i.test(abs.pathname)) continue;
        const m = cre ? (abs.pathname + abs.search).match(cre) : abs.pathname.match(/(?:kaury|art|ka)-?p?-?(\d{3,4})(?=[-\/k]|$)|(?<![\d])(\d{3,4})-kaury\b/i);
        const base = core(abs.host) === core(host) ? O.replace(/\/$/, '') : abs.origin;
        const pc = !cre && !m && /kaury|\bka\b|-ka\b|ka-/i.test(abs.pathname) && [...abs.pathname.matchAll(PCODE_RE)].map(x => pcode(x[0], CAT)).find(Boolean);
        if (m) add(m[1] || m[2], base + abs.pathname + (cre && /\?/.test(shop.codeRe) ? abs.search : ''));
        else if (pc) add(pc, base + abs.pathname);
      }
      continue;
    }
    for (let p = 1; p < 16; p++) {
      const u = O + T.replace('{p}', p);
      const r = await get(u);
      if (!r.html) { if (p === 1 && !firstErr) firstErr = r.status || r.err; break; }
      pagesOk++;
      const n = Object.keys(prod).length;
      if (shop.pairRe) {
        for (const m of r.html.matchAll(new RegExp(shop.pairRe, 'gi'))) { let abs; try { abs = new URL(m[1].replace(/&amp;/g, '&'), shop.pairBase || u); } catch { continue; } add(m[2], abs.href); }
        if (Object.keys(prod).length === n || !T.includes('{p}')) break; else continue;
      }
      const d = parse(r.html);
      for (const a of d.querySelectorAll('a[href]')) {
        const hr = a.getAttribute('href');
        if (!hr || BAD.test(hr)) continue;
        let abs; try { abs = new URL(hr, u); } catch { continue; }
        if (!okHost(abs.host)) continue;
        if (cre) { const m = (abs.pathname + abs.search).match(cre); if (m && !/avril|marcela/i.test(abs.pathname)) add(m[1], abs.origin + abs.pathname + (/\?/.test(shop.codeRe) ? abs.search : '')); continue; }
        let t = (a.textContent + ' ' + (a.getAttribute('title') || '') + ' ' + a.querySelectorAll('img').map(i => i.getAttribute('alt') || '').join(' '))
          .replace(/\$\s?[\d.,]+|\d+[.,]\d+/g, ' ');
        if (/avril|kaury men/i.test(t)) continue;
        const cs = t.match(CODE_RE) || [];
        for (const m of t.matchAll(PCODE_RE)) { const c = pcode(m[0], CAT); if (c) cs.push(c); }
        if (/kaury/i.test(abs.pathname)) { const m = abs.pathname.match(/(?:kaury|art|ka)-?p?-?(\d{3,4})(?=[-\/k]|$)/i); if (m) cs.push(m[1]); }
        for (const m of abs.pathname.matchAll(PCODE_RE)) { const c = pcode(m[0], CAT); if (c) cs.push(c); }
        if (!cs.length) continue;
        const url = abs.origin + abs.pathname;
        for (const c of cs) add(c, url); // add() quita los ceros de adelante; repetidos suman (el link que más lo nombra gana)
      }
      if (Object.keys(prod).length === n || !T.includes('{p}')) break;
    }
  }
  const vals = Object.values(prod);
  let pairs = Object.entries(prod).filter(([k, v]) => CAT.has(k) && (v.includes(k) || vals.filter(x => x === v).length === 1));
  if (shop.codeRe || shop.pairRe) pairs = Object.entries(prod).filter(([k]) => CAT.has(k));
  // si la mayoría de los links dicen "kaury", descartar los que no
  else if (pairs.filter(([, v]) => KR.test(v)).length >= pairs.length * 0.5) pairs = pairs.filter(([, v]) => KR.test(v));
  // descartar links cuyo path tiene otro número de artículo
  // si el link dice explícitamente el artículo ("kaury-art-8194", "art-4030", "kaury-8248"), tiene que ser ese:
  // evita que "talles 85 al 100" se tome como art. 100
  if (!shop.codeRe && !shop.pairRe) pairs = pairs.filter(([c, v]) => { const m = new URL(v).pathname.match(/(?:kaury|art)[-_]?(?:art[-_]?)?(\d{3,4})(?!\d)/i); return !m || nc(m[1]) === c; });
  if (!shop.codeRe && !shop.pairRe) pairs = pairs.filter(([c, v]) => { const path = new URL(v).pathname; if (path.includes(c)) return true; return !(path.match(/(?<!\d)\d{2,4}(?!\d)/g) || []).some(n => n !== c); });
  return { prods: Object.fromEntries(pairs), pagesOk, err: pagesOk ? null : (firstErr || 'sin respuesta') };
}

const SZ = /^(\d{2,3}|\d|xxs|xs|s|m|l|xl|xxl|xxxl|[sml]\s*[-\/]\s*[mlx]+l?|t\.?\s?\d|talle\s*\d+|[uú]nico|un|u)$/i;
const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
const unesc = s => s.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

function pack(rows) { // rows: [color, talle, hayStock, sufijoLink] -> {ent:{color:[talles]}|0|'?', vars:[[color,talle,sufijo]]}
  if (!rows.length) return { ent: '?', vars: [] };
  const m = {}, vars = [];
  rows.forEach(([c, z, ok, sx]) => { if (!ok) return; c = c || '-'; z = z || 'u'; (m[c] = m[c] || []).includes(z) || m[c].push(z); if (sx) vars.push([c, z, sx]); });
  return { ent: Object.keys(m).length ? m : 0, vars };
}
function attr(d, name) { const el = d.querySelector('[' + name + ']'); return el ? el.getAttribute(name) : null; }
// Tiendanube: las variantes del artículo están en la ficha (#single-product / .js-product-detail). Los demás
// [data-variants] de la página son productos relacionados o sugeridos. Cuando la tienda da de baja un artículo,
// la página responde 200 con "Error - 404" y solo trae sugeridos: en ese caso el artículo no está (no se toman
// los talles de otro producto).
const TN_ITEM = '.js-item-product, .js-product-item-private, .item-product';
function tiendanube(d) {
  const all = d.querySelectorAll('[data-variants]'); if (!all.length) return null;
  const el = d.querySelector('#single-product[data-variants], #single-product-container[data-variants]') || d.querySelector('.js-product-detail[data-variants]')
    || all.find(e => !e.closest(TN_ITEM));
  if (!el) return 'gone';
  const raw = el.getAttribute('data-variants'); if (raw == null) return null;
  let v; try { v = JSON.parse(unesc(raw)); } catch { try { v = JSON.parse(raw); } catch { return null; } }
  if (!Array.isArray(v) || !v.length) return null;
  const opts = [0, 1, 2].filter(i => v.some(x => x['option' + i] != null && x['option' + i] !== ''));
  const si = opts.find(i => v.filter(x => SZ.test(norm(x['option' + i]).replace(/^talle\s*/, ''))).length >= v.length * 0.6);
  const ci = opts.find(i => i !== si);
  return v.map(x => [ci != null ? norm(x['option' + ci]) : '', si != null ? norm(x['option' + si]).replace(/^talle\s*/, '') : '', x.available !== false && (x.stock == null || x.stock > 0), x.id ? 'variant=' + x.id : '']);
}
function woo(d) {
  const raw = attr(d, 'data-product_variations'); if (raw == null) return null;
  if (raw === 'false') return 'ajax';
  let v; try { v = JSON.parse(unesc(raw)); } catch { try { v = JSON.parse(raw); } catch { return null; } }
  if (!Array.isArray(v)) return null;
  // variaciones con un atributo vacío = "cualquiera": se abren en todas las opciones del selector (para poder armar el link)
  const opts = {}; for (const sel of d.querySelectorAll('select[name^="attribute_"]')) opts[sel.getAttribute('name')] = sel.querySelectorAll('option').map(o => o.getAttribute('value')).filter(Boolean);
  if (v.some(x => Object.values(x.attributes || {}).some(a => !a))) {
    const exp = [];
    for (const x of v) { let combos = [{}]; for (const [k, val] of Object.entries(x.attributes || {})) { const vals = val ? [val] : (opts[k] && opts[k].length ? opts[k] : ['']); combos = combos.flatMap(c => vals.map(w => ({ ...c, [k]: w }))); } combos.slice(0, 400).forEach(at => exp.push({ ...x, attributes: at })); }
    v = exp.slice(0, 800);
  }
  return v.map(x => { const at = Object.entries(x.attributes || {}), vals = at.map(([, a]) => norm(a));
    // primero por el nombre del atributo (talle/size, color); si no, por el formato del valor
    let z = norm((at.find(([k]) => /talle|size|tama/i.test(k)) || [])[1]), c = norm((at.find(([k]) => /colou?r/i.test(k)) || [])[1]);
    if (!z) z = vals.find(a => SZ.test(a)) || ''; if (!c) c = vals.find(a => a !== z) || ''; const sx = Object.entries(x.attributes || {}).filter(([, v]) => v).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'); return [c.replace(/-/g, ' '), z, !!x.is_in_stock && x.is_purchasable !== false, sx]; });
}
// Tiendas Cygnus (lenceriamayorista.com.ar): una casilla por talle y color, con el stock en "max"
// Wix (Casa Kiko): la página del producto trae "options" (talle/color con ids) y "productItems" (cada combinación,
// con su estado de inventario). Hay stock si la combinación está visible y "in_stock" (con cantidad > 0 cuando se lleva stock).
export function jsonArrayAt(t, key) {
  const i = t.indexOf('"' + key + '":['); if (i < 0) return null;
  let k = i + key.length + 3, depth = 0, inStr = false;
  for (let j = k; j < t.length; j++) {
    const ch = t[j];
    if (inStr) { if (ch === '\\') j++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '[') depth++; else if (ch === ']') { depth--; if (depth === 0) { try { return JSON.parse(t.slice(k, j + 1)); } catch { return null; } } }
  }
  return null;
}
export function wix(h) {
  if (!/wixstatic|wix\.com/.test(h) || !h.includes('"productItems":[')) return null;
  const items = jsonArrayAt(h, 'productItems'), opts = jsonArrayAt(h, 'options');
  if (!items || !opts) return null;
  const sel = {}; for (const o of opts) for (const x of o.selections || []) sel[x.id] = { t: o.title || o.key || '', v: x.description || x.value || '' };
  return items.map(it => {
    const ss = (it.optionsSelections || []).map(id => sel[id]).filter(Boolean);
    const c = (ss.find(x => /colou?r/i.test(x.t)) || {}).v || '', z = (ss.find(x => /talle|size|tama/i.test(x.t)) || {}).v || '';
    const inv = it.inventory || {}, ok = it.isVisible !== false && inv.status === 'in_stock' && !(it.isTrackingInventory && !(inv.quantity > 0));
    return [c, z, ok];
  });
}

function cygnus(d) {
  const ins = d.querySelectorAll('input[data-variation-description]'); if (!ins.length) return null;
  return ins.map(i => { const t = i.getAttribute('data-variation-description') || '', z = (t.match(/talle:\s*([^/]+)/i) || [])[1] || '', c = (t.match(/color:\s*(.+)$/i) || [])[1] || '';
    return [norm(c), norm(z), +(i.getAttribute('max') || 0) > 0]; });
}
function empretienda(h) {
  const m = h.match(/var stock = (\[[\s\S]*?\]);\s*\n?\s*var /); if (!m) return null;
  let v; try { v = JSON.parse(m[1]); } catch { return null; }
  return v.map(x => { let c = '', z = ''; (x.valoratributo || []).forEach(a => { const val = norm(a.valor && a.valor.vat_valor); if (/talle/i.test(a.at_nombre) || SZ.test(val)) z = val; else c = val; }); return [c, z, x.s_ilimitado == 1 || x.s_cantidad > 0]; });
}
/** Lee el stock de la página de un artículo.
 *  Devuelve {ent, vars}: ent = {color:[talles]} | 0 (sin stock) | '?' (no se ve); vars = [[color, talle, sufijo de link]]
 *  o 'E' si la página no respondió. El sufijo abre el artículo con ese color y talle ya elegidos
 *  (Tiendanube: variant=ID · WooCommerce: attribute_pa_color=..&attribute_pa_talle=..; Empretienda no lo admite). */
// Woo con tabla de compra por cantidades (Casa Ari): filas = colores, columnas = talles; la celda con casillero de
// cantidad está disponible, la que dice "Sin stock" no.
function matrix(d) {
  const tb = d.querySelector('table.variations-table'); if (!tb) return null;
  const heads = tb.querySelectorAll('thead th').map(e => e.text.trim()).slice(1), rows = [];
  for (const tr of tb.querySelectorAll('tbody tr')) {
    const color = (tr.querySelector('th') || { text: '' }).text.trim();
    tr.querySelectorAll('td').forEach((td, i) => { if (heads[i]) rows.push([color, heads[i], !!td.querySelector('input.variation_qty')]); });
  }
  return rows.length ? rows : null;
}

export async function readStock(url) {
  const r = await get(url);
  if (!r.html) { if (r.status === 404) return { ent: 0, vars: [] }; const k = r.status || r.err || '?'; lastErr[k] = (lastErr[k] || 0) + 1; return 'E'; }
  const h = r.html, d = parse(h), px = price(d, h);
  const done = o => (px ? Object.assign(o, { price: px }) : o);
  let rows = tiendanube(d); if (rows === 'gone') return { ent: 0, vars: [] }; if (rows) return done(pack(rows));
  rows = matrix(d); if (rows) return done(pack(rows));
  rows = woo(d); if (rows === 'ajax') return done({ ent: '?', vars: [] }); if (rows) return done(pack(rows));
  rows = empretienda(h); if (rows) return done(pack(rows.map(x => x.slice(0, 3))));
  rows = cygnus(d); if (rows) return done(pack(rows));
  rows = wix(h); if (rows) return done(pack(rows));
  if (/agotado|sin stock|out of stock/i.test(d.text || '')) return { ent: 0, vars: [] };
  return done({ ent: '?', vars: [] });
}

// Precio de la página de un artículo (el más bajo publicado): datos estructurados, meta de precio o variantes de Tiendanube.
export function price(d, h) {
  const vals = [];
  const add = v => { const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.,]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); if (n > 50 && n < 1e8) vals.push(n); };
  for (const sc of d.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const walk = o => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(walk);
        if (o.offers) [].concat(o.offers).forEach(f => { if (f && (f.price || f.lowPrice)) add(f.lowPrice || f.price); });
        if (o['@graph']) walk(o['@graph']); };
      walk(JSON.parse(sc.text));
    } catch {}
  }
  if (!vals.length) for (const m of d.querySelectorAll('meta[property="product:price:amount"],meta[property="og:price:amount"],meta[itemprop="price"]')) add(m.getAttribute('content'));
  if (!vals.length) { const el = d.querySelector('[data-variants]'); if (el) { try { JSON.parse(el.getAttribute('data-variants')).forEach(v => v.price_number && add(v.price_number)); } catch {} } }
  return vals.length ? Math.min(...vals) : null;
}

// ---------- normalización de colores y talles contra el catálogo ----------
const nz = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\bfluor\b/g, 'fluo').replace(/\bvinta\b/g, 'vintage').replace(/\s+/g, ' ').trim();
const SYN = { 'banco': 'blanco', 'rosa viejo': 'rosa vintage', 'amafl': 'amarillo fluo', 'amari fluo': 'amarillo fluo', 'amarilla fluo': 'amarillo fluo', 'verde mili': 'verde militar', 'negro nude': 'negro - nude', 'piel': 'nude', 'piel - nude': 'nude', 'humo': 'gris humo', 'militar': 'verde militar', 'verde mil': 'verde militar', 'verde ingl': 'verde ingles', 'gris melan': 'gris melange', 'ciru': 'ciruela', 'fucsia': 'fucsia fluo', 'amarillo': 'amarillo fluo', 'amarillo fluo': 'amarillo fluo', 'bordo': 'bordo' };
const PACK = new Set(['varios', 'surtido', 'colores varios', 'un', 'unico', '-', 'u']);

export function makeNormalizer(catalog, sizes) {
  const GL = {}, CATC = {};
  for (const r of catalog) {
    const names = r[3].split('|').map(x => x.slice(0, x.lastIndexOf(':')));
    CATC[r[0]] = names;
    for (const n of names) { const k = nz(n); if (!(k in GL)) GL[k] = n; }
  }
  const pref = (st, k) => { const ks = k.split(' '); return st.length <= ks.length && st.every((b, i) => ks[i].startsWith(b)); };
  function color(code, raw) {
    const s = nz(raw);
    // la tienda no deja elegir color ("único", "surtido", "-"): si el artículo oficial tiene un solo color (p. ej. "Pack"), es ese
    if (PACK.has(s)) { const cs = CATC[code] || []; if (cs.length === 1) return cs[0]; return ['varios', 'surtido', 'colores varios'].includes(s) ? 'Surtido' : 'Único'; }
    const cn = {}; (CATC[code] || []).forEach(c => cn[nz(c)] = c);
    if (s in cn) return cn[s];
    const t = SYN[s];
    if (t && t in cn) return cn[t];
    const st = s.split(' ');
    let cand = Object.entries(cn).filter(([k]) => pref(st, k)).map(([, c]) => c);
    if (cand.length === 1) return cand[0];
    if (s === 'borravino' && 'bordo' in cn) return cn['bordo'];
    if (t && t in GL) return GL[t];
    if (s in GL) return GL[s];
    cand = Object.entries(GL).filter(([k]) => st.length === k.split(' ').length && pref(st, k)).map(([, c]) => c);
    if (cand.length === 1) return cand[0];
    const r = String(raw).trim(); return r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();
  }
  function size(z) {
    let s = nz(z).replace(/^talle[\s-]*/, '').trim();
    if (/^(u|un|nun|unico|unicos|unico max|talle unico)$/.test(s) || /unic|^nun$/.test(s)) return 'Único';
    return s.replace(/\//g, '-').replace(/\s*-\s*/g, '-').toUpperCase();
  }
  // Talle oficial de kaury.com: algunas tiendas numeran a su manera ("1-2-3-4" en corpiños = 85-90-95-100, "T2", "02").
  function official(code, Z) {
    const order = sizes[code]; if (!order || !order.length || order.includes(Z)) return Z;
    const z2 = Z.replace(/^T\.?\s?/, '').replace(/^0+(\d)/, '$1');
    if (order.includes(z2)) return z2;
    const n = /^\d$/.test(z2) ? +z2 : 0;
    if (n && order.every(x => /^\d{2,3}$/.test(x) && +x >= 80)) { const v = String(80 + 5 * n); if (order.includes(v)) return v; }
    if (n && order.every(x => /^[A-Z]{1,3}(-[A-Z]{1,3})?$/.test(x)) && n <= order.length) return order[n - 1];
    return Z;
  }
  // Algunas tiendas cargan talle y color juntos en una sola opción ("100 Rojo", "95 Gris humo"): se separan.
  const SZ1 = /^(\d{1,3}|xxs|xs|s|m|l|xl|xxl|xxxl|[sml]-[mlx]+l?)\s+([a-záéíóúñ].*)$/i;
  function split(c, z) {
    const m = SZ1.exec(String(z).trim());
    if (m && (!c || ['-', 'u', 'unico', 'único'].includes(nz(c)))) return [m[2], m[1]];
    if (m) return [c, m[1]];
    return [c, z];
  }
  /** [[colorCrudo, talleCrudo, sufijo]] -> {"Color|Talle": sufijo} con los nombres del catálogo */
  function normVars(code, vars) {
    const o = {}; for (const [c0, z0, sx] of vars || []) { const [c, z] = split(c0, z0), k = color(code, c) + '|' + official(code, size(z)); if (!(k in o)) o[k] = sx; }
    return Object.keys(o).length ? o : null;
  }
  /** {colorCrudo:[tallesCrudos]} -> {ColorCatálogo:[Talles ordenados]} */
  function normalize(code, ent) {
    if (ent === '?' || ent === 0) return ent;
    const out = {};
    for (const [c0, zs] of Object.entries(ent)) {
      for (const z0 of zs) {
        const [c, z] = split(c0, z0), lab = color(code, c), Z = official(code, size(z));
        (out[lab] = out[lab] || []).includes(Z) || out[lab].push(Z);
      }
    }
    const order = sizes[code] || [];
    for (const k in out) out[k].sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return ((ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)) || (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0); });
    return out;
  }
  normalize.vars = normVars;
  return normalize;
}

/** Tiendas que publican sus productos en un servicio de datos (Kaury MDP: kaury-api.vercel.app).
 *  Devuelve {prods:{código:link}, ent:{código:{color:[talles]}}, err}. */
export async function apiShop(shop, CAT) {
  const prods = {}, ent = {}; let err = null;
  for (let p = 1; p <= 40; p++) {
    const r = await get(shop.api + 'products?page=' + p + '&limit=20', { timeout: 25000 });
    if (!r.html) { err = r.status || r.err || 'sin respuesta'; break; }
    let j; try { j = JSON.parse(r.html); } catch { err = 'json'; break; }
    const list = (j.data && j.data.products) || [];
    for (const x of list) {
      const name = (x.name && x.name.es) || '', cats = (x.categories || []).map(c => (c.name && c.name.es) || '').join(' ');
      if (/^match|segunda selec/i.test(name) || /avril|match|boxer/i.test(cats)) continue;
      const code = (name.match(/\b\d{3,4}\b/g) || []).map(nc).find(c => CAT.has(c)); if (!code || prods[code]) continue;
      prods[code] = shop.origin + '/producto/' + x.id;
      const e = {};
      for (const v of x.variants || []) {
        // cuenta solo lo que tiene unidades: algunas variantes vienen marcadas "sin control" pero con stock 0 y la tienda no las vende
        if (!(+v.stock > 0)) continue;
        const a = v.attr || {}, z = Object.entries(a).find(([k]) => /talle/i.test(k) && !/boxer/i.test(k)), c = a.color || a.Color || '';
        const zz = norm(z ? z[1] : 'u'), cc = norm(c) || '-'; (e[cc] = e[cc] || []).includes(zz) || e[cc].push(zz);
      }
      ent[code] = Object.keys(e).length ? e : 0;
    }
    const pg = j.data && j.data.pagination; if (!pg || p >= pg.totalPages || !list.length) break;
    await sleep(300);
  }
  return { prods, ent, err: Object.keys(prods).length ? null : err };
}

// ---------- Tiendas con lector propio (shops.json "kind"): devuelven {prods, ent, err} como apiShop ----------
async function post(url, params, { timeout = 20000 } = {}) {
  try {
    const r = await fetch(url, { method: 'POST', body: new URLSearchParams(params), headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(timeout) });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}
/** Códigos como salen de fábrica: "P110"/"P110KA" = art. 110 de Intimates, "M650" = art. 650 de Summer.
 *  Solo valen si ese número es de esa línea (CAT.int / CAT.sum, armados en run.mjs). */
export const pcode = (c, CAT) => { const m = String(c).match(/^([pm])-?0*(\d{2,3})(?![\d])/i); if (!m) return null; const L = m[1].toLowerCase() === 'p' ? CAT.int : CAT.sum; return L && L.has(m[2]) ? m[2] : null; };
const digits = (c, CAT) => { const m = String(c).match(/^\d{2,4}/); if (m && CAT.has(m[0].replace(/^0+(?=\d{2})/, ''))) return m[0].replace(/^0+(?=\d{2})/, ''); return pcode(c, CAT); };

// VTEX (Coppel): catálogo público en JSON con stock por talle. Cada color es un producto aparte, así que el botón lleva
// a la búsqueda del artículo en la tienda (muestra todos sus colores). El número sale del link o de "Modelo / Código".
export async function vtexShop(shop, CAT, catalog) {
  const prods = {}, ent = {}; let err = null, n = 0;
  const colorsOf = Object.fromEntries(catalog.map(r => [r[0], r[3].split('|').map(x => x.slice(0, x.lastIndexOf(':')))]));
  for (let from = 0; from < 1000; from += 50) {
    const r = await get(`${shop.origin}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(shop.ft || 'kaury')}&_from=${from}&_to=${from + 49}`, { timeout: 25000 });
    if (!r.html) { err = r.status || r.err || 'sin respuesta'; break; }
    let list; try { list = JSON.parse(r.html); } catch { err = 'json'; break; }
    if (!Array.isArray(list) || !list.length) break; n += list.length;
    for (const p of list) {
      if (!/kaury/i.test(p.brand || '') || /avril|men\b/i.test(p.brand || '')) continue;
      const path = String(p.link || '').replace(/^https?:\/\/[^/]+/, ''), txt = (p.description || '') + ' ' + ((p.items || [])[0] || {}).complementName;
      let code = (path.match(/(?:kaury|art|ka)[-_]?(\d{3,4})(?!\d)/i) || [])[1] || (txt.match(/Modelo[^0-9<]{0,40}(\d{3,4})(?!\d)/i) || [])[1] || (txt.match(/Modelo\s*\(?\s*(\d{3,4})/i) || [])[1];
      if (code) code = nc(code);
      if (!code || !CAT.has(code)) continue;
      const name = nz(p.productName || ''), cols = (colorsOf[code] || []).slice().sort((a, b) => b.length - a.length);
      const color = cols.find(c => name.includes(nz(c))) || 'Único';
      prods[code] = `${shop.origin}/kaury%20${code}?_q=kaury%20${code}&map=ft`;
      const e = ent[code] || (ent[code] = {});
      for (const it of p.items || []) {
        const q = +((((it.sellers || [])[0] || {}).commertialOffer || {}).AvailableQuantity || 0), z = (it.Talle || it.talle || ['u'])[0];
        if (q > 0) { (e[color] = e[color] || []).includes(z) || e[color].push(z); }
      }
    }
    if (list.length < 50) break;
    await sleep(300);
  }
  for (const c of Object.keys(ent)) if (!Object.keys(ent[c]).length) ent[c] = 0;
  return { prods, ent, err: Object.keys(prods).length ? null : (err || (n ? 'sin artículos Kaury' : 'sin respuesta')) };
}

// Dulce Camila: catálogo propio en PHP. Cada artículo lista sus talles; los colores con stock de cada talle salen de
// actualizar_colores.php (lo mismo que usa la página al elegir un talle).
export async function dulceShop(shop, CAT) {
  const prods = {}, ent = {};
  const list = shop.origin + (shop.listing || '/catalogo2024.php?id_marca=7&id_rubro=0&ptalle=todos&id_color=0');
  const r = await get(list); if (!r.html) return { prods, ent, err: 'listado: ' + (r.status || r.err) };
  const jobs = [];
  // cada artículo es un <form action="procesa_pedido.php?pcodigo=XXXX"> con su lista de talles
  for (const m of r.html.matchAll(/<form[^>]*action="procesa_pedido\.php\?pcodigo=([^"&]+)"[^>]*>([\s\S]*?)<\/form>/g)) {
    const raw = m[1], code = digits(raw, CAT); if (!code || prods[code]) continue;
    const sel = (m[2].match(/<select[^>]*name="talle_prod"[^>]*>([\s\S]*?)<\/select>/) || [])[1] || '';
    const tal = [...sel.matchAll(/<option value="([^"]+)"/g)].map(x => x[1]).filter(Boolean);
    prods[code] = list + '#banners-' + raw; ent[code] = {};
    tal.forEach(t => jobs.push([code, raw, t]));
  }
  await pool(jobs, 2, async ([code, raw, t]) => {
    await sleep(200 + Math.random() * 300);
    const x = await get(`${shop.origin}/actualizar_colores.php?ptalle=${encodeURIComponent(t)}&pcodigo=${encodeURIComponent(raw)}`); if (!x.html) return;
    for (const m of x.html.matchAll(/<option value="\d+">([^<]+)</g)) { const c = m[1].trim(); (ent[code][c] = ent[code][c] || []).includes(t) || ent[code][c].push(t); }
  });
  for (const c of Object.keys(ent)) if (!Object.keys(ent[c]).length) ent[c] = 0;
  return { prods, ent, err: Object.keys(prods).length ? null : 'sin artículos' };
}

// Lencería PM: la grilla de la marca se pide por POST (productos-grilla.php, de a 16); en cada producto, los colores
// con stock de cada talle salen de ajax/producto_colores.php.
export async function pmShop(shop, CAT) {
  const prods = {}, ent = {}, marca = shop.marca || 'KAUR', O = shop.origin, codes = new Map(); // catálogo -> código de la tienda (P110 -> 110)
  for (let ini = 0; ini < 640; ini += 16) {
    const t = await post(O + '/productos-grilla.php', { colname_tipo_menu: 'marca', colname_categoria_raiz: '1', id_categoria_seleccionada: marca, colname_marca_default: marca, colname_referencia_default: '', colname_talle: '', colname_color: '', colname_marca: '', colname_orden: '', inicio: String(ini) });
    if (!t) { if (!ini) return { prods, ent, err: 'listado' }; break; }
    const n = codes.size; for (const m of t.matchAll(/producto\.php\?marca=\w+&(?:amp;)?codigo=(\w+)/g)) { const c = digits(m[1], CAT); if (c && (m[1] === c || pcode(m[1], CAT) === c) && !codes.has(c)) codes.set(c, m[1]); }
    if (codes.size === n && ini) break;
    await sleep(250);
  }
  await pool([...codes], 2, async ([code, raw]) => {
    await sleep(250 + Math.random() * 300);
    const url = `${O}/producto.php?marca=${marca}&codigo=${raw}`, r = await get(url); if (!r.html) return;
    const suc = (r.html.match(/id="suc_cod"[^>]*value="([^"]*)"/) || r.html.match(/value="([^"]*)"[^>]*id="suc_cod"/) || [])[1] || '1';
    const tal = [...new Set([...r.html.matchAll(/id="talle_([^"]+)"[^>]*onclick="establecerTalle\('([^']+)'/g)].map(m => m[2]))];
    prods[code] = url; const e = ent[code] = {};
    for (const t of tal) {
      const x = await post(O + '/ajax/producto_colores.php', { suc_cod: suc, cod_spro: raw, marca_cod: marca, tal_cod: t }); if (!x) continue;
      for (const m of x.matchAll(/class="color_disponible"[^>]*>([^<]+)</g)) { const c = m[1].trim(); (e[c] = e[c] || []).includes(t) || e[c].push(t); }
      await sleep(150);
    }
  });
  for (const c of Object.keys(ent)) if (!Object.keys(ent[c]).length) ent[c] = 0;
  return { prods, ent, err: Object.keys(prods).length ? null : 'sin artículos' };
}

// Eben Ezer (web propia): las marcas se listan por su API (products?brandId=..., de a 50) y cada producto trae sus
// variantes (color/talle) con el stock por depósito; se cuenta solo el depósito de la tienda online (shop.deposito),
// que es el que muestra la web ("Últimas 5", "Sin stock"). shop.colorMap traduce sus abreviaturas (BCO, FUX, RSA VINT).
export async function ebenShop(shop, CAT) {
  const O = shop.origin, prods = {}, ent = {}, slugs = new Map(), cm = shop.colorMap || {};
  for (const b of shop.brands || []) for (let p = 1; p <= 10; p++) {
    const r = await get(`${O}/main/api/products?page=${p}&limit=50&search=&brandId=${b}`);
    if (!r.html) { if (p === 1 && !slugs.size) return { prods, ent, err: 'listado: ' + (r.status || r.err) }; break; }
    let j; try { j = JSON.parse(r.html); } catch { break; }
    const list = j.products || [];
    for (const x of list) { const m = String(x.nombre || '').trim().match(/(\d{2,4})$/), c = m && nc(m[1]); if (c && CAT.has(c) && x.slug && !slugs.has(c)) slugs.set(c, x.slug); }
    if (list.length < 50 || p * 50 >= (j.total || 0)) break;
    await sleep(200);
  }
  await pool([...slugs], 2, async ([c, slug]) => {
    await sleep(200 + Math.random() * 300);
    const r = await get(`${O}/main/api/ficha-producto?slug=${encodeURIComponent(slug)}`); if (!r.html) return;
    let j; try { j = JSON.parse(r.html); } catch { return; }
    prods[c] = `${O}/productos/${slug}`; const e = ent[c] = {};
    for (const v of j.variants || []) {
      const st = v.stock || {}, n = shop.deposito ? +st[shop.deposito] || 0 : Object.values(st).reduce((a, x) => a + (+x || 0), 0);
      if (n <= 0) continue;
      const a = Object.fromEntries((v.attributes || []).map(x => [String(x.name).toLowerCase(), String(x.value).trim()]));
      const raw = (a.color || '-').toUpperCase(), col = cm[raw] || a.color || '-', tal = (a.talle || 'u').replace(/^unico$/i, 'u');
      (e[col] = e[col] || []).includes(tal) || e[col].push(tal);
    }
  });
  for (const c of Object.keys(ent)) if (!Object.keys(ent[c]).length) ent[c] = 0;
  return { prods, ent, err: Object.keys(prods).length ? null : 'sin artículos' };
}

// Tiendas que publican los artículos sin informar stock (Pedix): se listan y quedan como "publicado, stock no confirmado".
export async function listOnlyShop(shop, CAT) {
  const L = await listProducts(shop, CAT);
  return { prods: L.prods, ent: Object.fromEntries(Object.keys(L.prods).map(c => [c, '?'])), err: L.err };
}
