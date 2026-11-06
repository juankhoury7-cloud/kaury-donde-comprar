// Qué locales tienen un artículo en los colores/talles/zona pedidos (misma regla que el mapa).
import stores from '../data/stores.json';
import catalog from '../data/catalog.json';
import SIZES from '../data/sizes.json';
const SMALL = { de: 1, del: 1, la: 1, las: 1, los: 1, y: 1, e: 1 };
const tc = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().split(' ').map((w, i) => (i && SMALL[w]) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
export const provName = p => (p === 'CAPITAL FEDERAL' ? 'CABA' : tc(p));
const nameFix = n => { n = String(n).replace(/\s+/g, ' ').trim(); return n !== n.toUpperCase() ? n : tc(n); };
export const ART = Object.fromEntries(catalog.map(r => [r[0], { code: r[0], name: r[1] }]));
export const PROVS = new Set(stores.map(r => provName(r[4])));
function matchEnt(ent, colors, sizes) {
  if (!ent) return false; if (ent === '?') return !colors.length && !sizes.length;
  return (colors.length ? colors : Object.keys(ent)).some(c => ent[c] && (!sizes.length || sizes.some(z => ent[c].includes(z))));
}
function variant(ent, vm, colors, sizes) {
  if (!vm || !ent || ent === '?' || (!colors.length && !sizes.length)) return null;
  const m = [];
  (colors.length ? colors : Object.keys(ent)).forEach(c => (ent[c] || []).forEach(z => { if ((!sizes.length || sizes.includes(z)) && vm[c + '|' + z]) m.push(vm[c + '|' + z]); }));
  return m.length && ((colors.length && sizes.length) || m.length === 1) ? m[0] : null;
}
/** Locales con stock para el aviso {a, c:"Fresa+Negro", z:"95", p:"Salta"} -> [{tienda, locales:[...], url}] agrupado por tienda */
export function matches(snap, al) {
  const may = al.m === 'may', curva = al.z === 'curva', colors = al.c ? al.c.split('+') : [], sizes = al.z && !curva ? al.z.split('+') : [], byShop = {};
  const allSizes = SIZES[al.a] || [];
  for (const r of stores) {
    const canal = r[12] || 'min';
    if (may ? !(canal === 'may' || canal === 'both') : !(canal === 'min' || canal === 'both')) continue;
    const key = (may ? r[16] : r[10]) || '', sk = key.replace(/^www\./, ''), pm = (snap.prods || {})[key] || {}, ent = ((snap.stock || {})[sk] || {})[al.a];
    if (!key) continue;
    if (!pm[al.a] || ent === undefined) continue;
    if (al.p && provName(r[4]) !== al.p) continue;
    if (curva ? !(ent && ent !== '?' && allSizes.length && (colors.length ? colors : Object.keys(ent)).some(c => ent[c] && allSizes.every(z => ent[c].includes(z)))) : !matchEnt(ent, colors, sizes)) continue;
    const sx = may ? null : variant(ent, ((snap.vars || {})[sk] || {})[al.a], colors, sizes), u = pm[al.a];
    const s = byShop[sk] || (byShop[sk] = { tienda: sk, url: sx ? u + (u.includes('?') ? '&' : '?') + sx : u, locales: [], min: may ? (r[13] === 0 ? 'sin mínimo' : r[14] || '') : '' });
    s.locales.push(nameFix(r[0]) + ' · ' + tc(r[3]) + (provName(r[4]) !== tc(r[3]) ? ', ' + provName(r[4]) : ''));
  }
  return Object.values(byShop);
}
