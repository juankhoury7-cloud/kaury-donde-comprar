// Prueba local con páginas de ejemplo (mismo formato que las tiendas reales).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const enc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const tnVariants = [
  { id: 111, stock: 3, available: true, option0: 'Nude', option1: '90', option2: null, installments_data: '{"Pago Nube":{"2":{"x":1}}}' },
  { stock: 0, available: false, option0: 'Nude', option1: '100', option2: null },
  { stock: 0, available: false, option0: 'Negro', option1: '90', option2: null },
  { id: 444, stock: 2, available: true, option0: 'Negro', option1: '100', option2: null },
  { stock: null, available: true, option0: 'Rosa Vinta', option1: 'Talle 95', option2: null },
];
const wooVar = [
  { attributes: { attribute_pa_color: 'rosa-viejo', attribute_pa_talle: '2' }, is_in_stock: true, is_purchasable: true },
  { attributes: { attribute_pa_color: 'negro', attribute_pa_talle: '3' }, is_in_stock: false, is_purchasable: true },
  { attributes: { attribute_pa_color: 'amafl', attribute_pa_talle: '3' }, is_in_stock: true, is_purchasable: true },
];
const empStock = [
  { valoratributo: [{ at_nombre: 'Color', valor: { vat_valor: 'Piel' } }, { at_nombre: 'Talle', valor: { vat_valor: 'S/M' } }], s_cantidad: 1, s_ilimitado: 0 },
  { valoratributo: [{ at_nombre: 'Color', valor: { vat_valor: 'Negro' } }, { at_nombre: 'Talle', valor: { vat_valor: 'L/XL' } }], s_cantidad: 0, s_ilimitado: 0 },
];
const pages = {
  'https://a.test/search/?q=kaury&page=1': `<html><body>
   <a href="https://a.test/productos/kaury-articulo-4030/" title="Kaury Artículo 4030"><img alt="Kaury Artículo 4030"></a>
   <a href="https://a.test/productos/kaury-articulo-4030/">Kaury Artículo 4030 $20.600 3 x $6.866,67</a>
   <a href="https://a.test/productos/kaury-articulo-8165/">Kaury Artículo 8165 $19.300</a>
   <a href="https://a.test/productos/avril-1234/">Avril 8199</a>
   <a href="https://a.test/productos/kaury-articulo-9999/">Kaury 9999</a>
   <a href="https://wa.me/5491127039737">5491127039737</a></body></html>`,
  'https://a.test/productos/kaury-articulo-4030/': `<html><body><div id="single-product" data-variants="${enc(JSON.stringify(tnVariants))}" data-store="x"></div></body></html>`,
  'https://a.test/productos/kaury-articulo-8165/': `<html><body><form class="variations_form" data-product_variations="${enc(JSON.stringify(wooVar))}"></form></body></html>`,
  'https://a.test/productos/emp/': `<html><body><script>var stock = ${JSON.stringify(empStock)};\n var otra = 1;</script></body></html>`,
};
globalThis.fetch = async (u) => { const h = pages[String(u)]; return h ? new Response(h, { status: 200 }) : new Response('no', { status: 404 }); };
const { listProducts, readStock, makeNormalizer } = await import('../scraper/lib.mjs');
const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url)));
const sizes = JSON.parse(await readFile(new URL('../data/sizes.json', import.meta.url)));
const CAT = new Set(catalog.map(r => r[0]));
const L = await listProducts({ origin: 'https://a.test', listings: ['/search/?q=kaury&page={p}'] }, CAT);
assert.deepEqual(L.prods, { '4030': 'https://a.test/productos/kaury-articulo-4030/', '8165': 'https://a.test/productos/kaury-articulo-8165/' });
const N = makeNormalizer(catalog, sizes);
const s1 = await readStock('https://a.test/productos/kaury-articulo-4030/');
console.log('tiendanube', s1.ent, N('4030', s1.ent), N.vars('4030', s1.vars));
assert.deepEqual(s1.ent, { nude: ['90'], negro: ['100'], 'rosa vinta': ['95'] });
assert.deepEqual(N.vars('4030', s1.vars), { 'Nude|90': 'variant=111', 'Negro|100': 'variant=444' });
const s2 = await readStock('https://a.test/productos/kaury-articulo-8165/');
console.log('woo', s2.ent, N('8165', s2.ent), N.vars('8165', s2.vars));
assert.deepEqual(s2.ent, { 'rosa viejo': ['2'], amafl: ['3'] });
assert.equal(N.vars('8165', s2.vars)['Rosa vintage|2'], 'attribute_pa_color=rosa-viejo&attribute_pa_talle=2');
const s3 = await readStock('https://a.test/productos/emp/');
console.log('empretienda', s3.ent, N('8165', s3.ent), N.vars('8165', s3.vars));
assert.equal(N.vars('8165', s3.vars), null);
assert.equal((await readStock('https://a.test/nada/')).ent, 0);
console.log('OK');
