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
const KR = /kaury|kau\d|-kau|-kai|-kam|\bka\d|-ka\d|art-ka/i;

/** Recorre los listados de una tienda y devuelve {codigo: url} de los artículos Kaury del catálogo. */
export async function listProducts(shop, CAT) {
  const O = shop.origin, host = new URL(O).host;
  const prod = {}, cnt = {};
  let pagesOk = 0, firstErr = null;
  // opciones por tienda (data/shops.json):
  //   hosts:   otras direcciones donde la tienda publica sus artículos (p. ej. gtlenceria.com.ar para gtmayorista.com)
  //   codeRe:  de dónde sale el número de artículo en el link (p. ej. "/ka(\\d{3,4})-"); si está, es la única fuente
  //   pairRe:  para tiendas que escriben el número al lado de la foto y no en el link: regex sobre el HTML con (link, número)
  //   listing "sitemap:/sitemap.xml": toma los links del índice para Google (webs armadas con JavaScript)
  const okHost = h => [host, ...(shop.hosts || [])].some(x => core(x) === core(h));
  const cre = shop.codeRe ? new RegExp(shop.codeRe, 'i') : null;
  const add = (c, url) => { const k = c + '|' + url; cnt[k] = (cnt[k] || 0) + 1; if (!prod[c] || cnt[k] > cnt[c + '|' + prod[c]]) prod[c] = url; };
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
        if (m) add(m[1] || m[2], abs.origin + abs.pathname + (cre && /\?/.test(shop.codeRe) ? abs.search : ''));
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
        for (const m of r.html.matchAll(new RegExp(shop.pairRe, 'gi'))) { let abs; try { abs = new URL(m[1].replace(/&amp;/g, '&'), u); } catch { continue; } add(m[2], abs.href); }
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
        if (/kaury/i.test(abs.pathname)) { const m = abs.pathname.match(/(?:kaury|art|ka)-?p?-?(\d{3,4})(?=[-\/k]|$)/i); if (m) cs.push(m[1]); }
        if (!cs.length) continue;
        const url = abs.origin + abs.pathname;
        for (const c of cs) { const k = c + '|' + url; cnt[k] = (cnt[k] || 0) + 1; if (!prod[c] || cnt[k] > cnt[c + '|' + prod[c]]) prod[c] = url; }
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
function tiendanube(d) {
  const raw = attr(d, 'data-variants'); if (raw == null) return null;
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
  return v.map(x => { const at = Object.entries(x.attributes || {}), vals = at.map(([, a]) => norm(a));
    // primero por el nombre del atributo (talle/size, color); si no, por el formato del valor
    let z = norm((at.find(([k]) => /talle|size|tama/i.test(k)) || [])[1]), c = norm((at.find(([k]) => /colou?r/i.test(k)) || [])[1]);
    if (!z) z = vals.find(a => SZ.test(a)) || ''; if (!c) c = vals.find(a => a !== z) || ''; const sx = Object.entries(x.attributes || {}).filter(([, v]) => v).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'); return [c.replace(/-/g, ' '), z, !!x.is_in_stock && x.is_purchasable !== false, sx]; });
}
// Tiendas Cygnus (lenceriamayorista.com.ar): una casilla por talle y color, con el stock en "max"
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
export async function readStock(url) {
  const r = await get(url);
  if (!r.html) { if (r.status === 404) return { ent: 0, vars: [] }; const k = r.status || r.err || '?'; lastErr[k] = (lastErr[k] || 0) + 1; return 'E'; }
  const h = r.html, d = parse(h), px = price(d, h);
  const done = o => (px ? Object.assign(o, { price: px }) : o);
  let rows = tiendanube(d); if (rows) return done(pack(rows));
  rows = woo(d); if (rows === 'ajax') return done({ ent: '?', vars: [] }); if (rows) return done(pack(rows));
  rows = empretienda(h); if (rows) return done(pack(rows.map(x => x.slice(0, 3))));
  rows = cygnus(d); if (rows) return done(pack(rows));
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
  for (let p = 1; p <= 30; p++) {
    const r = await get(shop.api + 'products?page=' + p + '&limit=50', { timeout: 25000 });
    if (!r.html) { err = r.status || r.err || 'sin respuesta'; break; }
    let j; try { j = JSON.parse(r.html); } catch { err = 'json'; break; }
    const list = (j.data && j.data.products) || [];
    for (const x of list) {
      const name = (x.name && x.name.es) || '', cats = (x.categories || []).map(c => (c.name && c.name.es) || '').join(' ');
      if (/^match|segunda selec/i.test(name) || /avril|match|boxer/i.test(cats)) continue;
      const code = (name.match(/\b\d{3,4}\b/g) || []).find(c => CAT.has(c)); if (!code || prods[code]) continue;
      prods[code] = shop.origin + '/producto/' + x.id;
      const e = {};
      for (const v of x.variants || []) {
        if (!(v.stock > 0) && v.stockManagement !== false) continue;
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
