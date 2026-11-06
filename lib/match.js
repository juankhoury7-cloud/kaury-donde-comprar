// Qué locales tienen un artículo en los colores/talles/zona pedidos (misma regla que el mapa).
import stores from '../data/stores.json';
import catalog from '../data/catalog.json';
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
  const colors = al.c ? al.c.split('+') : [], sizes = al.z ? al.z.split('+') : [], byShop = {};
  for (const r of stores) {
    const key = r[10], sk = key.replace(/^www\./, ''), pm = (snap.prods || {})[key] || {}, ent = ((snap.stock || {})[sk] || {})[al.a];
    if (!pm[al.a] || ent === undefined) continue;
    if (al.p && provName(r[4]) !== al.p) continue;
    if (!matchEnt(ent, colors, sizes)) continue;
    const sx = variant(ent, ((snap.vars || {})[sk] || {})[al.a], colors, sizes), u = pm[al.a];
    const s = byShop[sk] || (byShop[sk] = { tienda: sk, url: sx ? u + (u.includes('?') ? '&' : '?') + sx : u, locales: [] });
    s.locales.push(nameFix(r[0]) + ' · ' + tc(r[3]) + (provName(r[4]) !== tc(r[3]) ? ', ' + provName(r[4]) : ''));
  }
  return Object.values(byShop);
}
