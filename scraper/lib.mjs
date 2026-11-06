// Lectura de artículos Kaury y su stock en las tiendas online de los clientes.
// Misma lógica que se usó a mano en la beta: listados de cada tienda -> link de cada
// artículo -> variantes con stock (Tiendanube, WooCommerce, Empretienda).
import { parse } from 'node-html-parser';

export const UA = 'Mozilla/5.0 (compatible; KauryDondeComprar/1.0; +https://github.com/juankhoury7-cloud/kaury-donde-comprar)';

export async function get(url, { timeout = 20000, tries = 2 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'es-AR,es;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
      if (r.status === 404) return { status: 404, html: null };
      if (!r.ok) { if (i + 1 < tries) { await sleep(1500); continue; } return { status: r.status, html: null }; }
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
  for (const T of shop.listings) {
    for (let p = 1; p < 16; p++) {
      const u = O + T.replace('{p}', p);
      const r = await get(u);
      if (!r.html) { if (p === 1 && !firstErr) firstErr = r.status || r.err; break; }
      pagesOk++;
      const n = Object.keys(prod).length;
      const d = parse(r.html);
      for (const a of d.querySelectorAll('a[href]')) {
        const hr = a.getAttribute('href');
        if (!hr || BAD.test(hr)) continue;
        let abs; try { abs = new URL(hr, u); } catch { continue; }
        if (core(abs.host) !== core(host)) continue;
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
  // si la mayoría de los links dicen "kaury", descartar los que no
  if (pairs.filter(([, v]) => KR.test(v)).length >= pairs.length * 0.5) pairs = pairs.filter(([, v]) => KR.test(v));
  // descartar links cuyo path tiene otro número de artículo
  pairs = pairs.filter(([c, v]) => { const path = new URL(v).pathname; if (path.includes(c)) return true; return !(path.match(/(?<!\d)\d{2,4}(?!\d)/g) || []).some(n => n !== c); });
  return { prods: Object.fromEntries(pairs), pagesOk, err: pagesOk ? null : (firstErr || 'sin respuesta') };
}

const SZ = /^(\d{2,3}|\d|xxs|xs|s|m|l|xl|xxl|xxxl|[sml]\s*[-\/]\s*[mlx]+l?|t\.?\s?\d|talle\s*\d+|[uú]nico|u)$/i;
const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
const unesc = s => s.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

function pack(rows) { // rows: [color, talle, hayStock] -> {color:[talles]} | 0 | '?'
  if (!rows.length) return '?';
  const m = {};
  rows.forEach(([c, z, ok]) => { if (!ok) return; c = c || '-'; z = z || 'u'; (m[c] = m[c] || []).includes(z) || m[c].push(z); });
  return Object.keys(m).length ? m : 0;
}
function attr(d, name) { const el = d.querySelector('[' + name + ']'); return el ? el.getAttribute(name) : null; }
function tiendanube(d) {
  const raw = attr(d, 'data-variants'); if (raw == null) return null;
  let v; try { v = JSON.parse(unesc(raw)); } catch { try { v = JSON.parse(raw); } catch { return null; } }
  if (!Array.isArray(v) || !v.length) return null;
  const opts = [0, 1, 2].filter(i => v.some(x => x['option' + i] != null && x['option' + i] !== ''));
  const si = opts.find(i => v.filter(x => SZ.test(norm(x['option' + i]).replace(/^talle\s*/, ''))).length >= v.length * 0.6);
  const ci = opts.find(i => i !== si);
  return v.map(x => [ci != null ? norm(x['option' + ci]) : '', si != null ? norm(x['option' + si]).replace(/^talle\s*/, '') : '', x.available !== false && (x.stock == null || x.stock > 0)]);
}
function woo(d) {
  const raw = attr(d, 'data-product_variations'); if (raw == null) return null;
  if (raw === 'false') return 'ajax';
  let v; try { v = JSON.parse(unesc(raw)); } catch { try { v = JSON.parse(raw); } catch { return null; } }
  if (!Array.isArray(v)) return null;
  return v.map(x => { const vals = Object.values(x.attributes || {}).map(norm); const z = vals.find(a => SZ.test(a)) || ''; const c = vals.find(a => a !== z) || ''; return [c.replace(/-/g, ' '), z, !!x.is_in_stock && x.is_purchasable !== false]; });
}
function empretienda(h) {
  const m = h.match(/var stock = (\[[\s\S]*?\]);\s*\n?\s*var /); if (!m) return null;
  let v; try { v = JSON.parse(m[1]); } catch { return null; }
  return v.map(x => { let c = '', z = ''; (x.valoratributo || []).forEach(a => { const val = norm(a.valor && a.valor.vat_valor); if (/talle/i.test(a.at_nombre) || SZ.test(val)) z = val; else c = val; }); return [c, z, x.s_ilimitado == 1 || x.s_cantidad > 0]; });
}
/** Lee el stock de la página de un artículo: {color:[talles]} | 0 (sin stock) | '?' (no se ve) | 'E' (error) */
export async function readStock(url) {
  const r = await get(url);
  if (!r.html) return r.status === 404 ? 0 : 'E';
  const h = r.html, d = parse(h);
  let rows = tiendanube(d); if (rows) return pack(rows);
  rows = woo(d); if (rows === 'ajax') return '?'; if (rows) return pack(rows);
  rows = empretienda(h); if (rows) return pack(rows);
  if (/agotado|sin stock|out of stock/i.test(d.text || '')) return 0;
  return '?';
}

// ---------- normalización de colores y talles contra el catálogo ----------
const nz = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\bfluor\b/g, 'fluo').replace(/\bvinta\b/g, 'vintage').replace(/\s+/g, ' ').trim();
const SYN = { 'rosa viejo': 'rosa vintage', 'amafl': 'amarillo fluo', 'amari fluo': 'amarillo fluo', 'amarilla fluo': 'amarillo fluo', 'verde mili': 'verde militar', 'negro nude': 'negro - nude', 'piel': 'nude', 'piel - nude': 'nude', 'humo': 'gris humo', 'militar': 'verde militar', 'verde mil': 'verde militar', 'verde ingl': 'verde ingles', 'gris melan': 'gris melange', 'ciru': 'ciruela', 'fucsia': 'fucsia fluo', 'amarillo': 'amarillo fluo', 'amarillo fluo': 'amarillo fluo', 'bordo': 'bordo' };
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
    if (PACK.has(s)) return ['varios', 'surtido', 'colores varios'].includes(s) ? 'Surtido' : 'Único';
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
  function size(z) { const s = nz(z); if (['u', 'un', 'unico'].includes(s)) return 'Único'; return s.replace(/\//g, '-').toUpperCase(); }
  /** {colorCrudo:[tallesCrudos]} -> {ColorCatálogo:[Talles ordenados]} */
  return function normalize(code, ent) {
    if (ent === '?' || ent === 0) return ent;
    const out = {};
    for (const [c, zs] of Object.entries(ent)) {
      const lab = color(code, c); out[lab] = out[lab] || [];
      for (const z of zs) { const Z = size(z); if (!out[lab].includes(Z)) out[lab].push(Z); }
    }
    const order = sizes[code] || [];
    for (const k in out) out[k].sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return ((ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)) || (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0); });
    return out;
  };
}
