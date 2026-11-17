// Datos del mapa ya armados para otras webs de Kaury (kaury.com): locales con tienda web, su stock por canal
// (por unidad / por mayor), links a cada artículo, variantes para dejar color y talle elegidos, y el catálogo oficial.
// Misma lógica que el mapa propio (templates/app.html: chOf / bindMode / sizesFor): tiendas caídas (down) no se incluyen.
import stores from '../data/stores.json';
import catalog from '../data/catalog.json';
import SIZES from '../data/sizes.json';
import { provName } from './match.js';
const SMALL = { de: 1, del: 1, la: 1, las: 1, los: 1, y: 1, e: 1 };
const tc = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().split(' ').map((w, i) => (i && SMALL[w]) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const nameFix = n => { n = String(n).replace(/\s+/g, ' ').trim(); return n !== n.toUpperCase() ? n : tc(n); };
const hostOf = u => { try { return new URL(u).host; } catch { return ''; } };
function sizesFor(code, name, line) {
  if (SIZES[code]) return SIZES[code].slice();
  const n = name.toLowerCase();
  if (/pijama/.test(n)) return ['S', 'M', 'L', 'XL'];
  if (/medias |media ¾/.test(n)) return ['Único'];
  if (/conjunto|corpiño/.test(n) && line !== 'summer') return ['85', '90', '95', '100', '105'];
  return ['1', '2', '3', '4'];
}
export const CATALOG = catalog.map(([code, name, line, cols]) => ({
  code, name, line,
  colors: cols.split('|').map(c => { const k = c.lastIndexOf(':'); return { n: c.slice(0, k) || 'Único', h: c.slice(k + 1) }; }),
  sizes: sizesFor(code, name, line),
}));
/** Recibe el JSON guardado por el robot (kv 'stock') y devuelve los locales listos para mostrar. */
export function shape(full) {
  const d = typeof full === 'string' ? JSON.parse(full) : full, DOWN = new Set(d.down || []), MO = d.mo || {};
  const ch = (k, web, m) => {
    if (!k && !web) return null; if (k && DOWN.has(k)) return null;
    const sk = k.replace(/^www\./, ''), pm = (d.prods || {})[k] || {}, stk = (d.stock || {})[sk] || {}, vr = (d.vars || {})[sk] || {};
    const prod = {}, st = {}, vars = {};
    if (k) for (const c of Object.keys(stk)) if (pm[c]) { prod[c] = pm[c]; st[c] = stk[c]; if (vr[c]) vars[c] = vr[c]; }
    return { m, web, prod, stk: st, vars };
  };
  const out = [];
  stores.forEach((r, i) => {
    const cn = r[12] || 'min', inMin = (cn === 'min' || cn === 'both') && !!r[10], inMay = cn === 'may' || cn === 'both';
    const chs = []; let c;
    if (inMin && (c = ch(r[10] || '', r[11] || '', 'min'))) chs.push(c);
    if (inMay && (c = ch(r[16] || '', r[15] || '', 'may'))) chs.push(c);
    if (!chs.length || !chs.some(x => x.web)) return;
    const o = r[15] && MO[hostOf(r[15])];
    out.push({ id: 's' + i, name: nameFix(r[0]), online: r[1] === 'ONLINE', addr: r[2] || '', city: tc(r[3]), prov: provName(r[4]), ig: r[5] || '',
      lat: r[8], lng: r[9], inMin, inMay, minAmt: o ? o.a : (r[13] ?? null), minTxt: o ? o.t : (r[14] || ''), minPromo: !!(o && o.p), chs });
  });
  return { v: 1, ts: d.ts || null, stores: out, catalog: CATALOG };
}
