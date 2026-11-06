// Prueba local con páginas de ejemplo (mismo formato que las tiendas reales).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const enc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const tnVariants = [
  { stock: 3, available: true, option0: 'Nude', option1: '90', option2: null, installments_data: '{"Pago Nube":{"2":{"x":1}}}' },
  { stock: 0, available: false, option0: 'Nude', option1: '100', option2: null },
  { stock: 0, available: false, option0: 'Negro', option1: '90', option2: null },
  { stock: 2, available: true, option0: 'Negro', option1: '100', option2: null },
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
const s1 = await readStock(pages && 'https://a.test/productos/kaury-articulo-4030/');
console.log('tiendanube', s1, N('4030', s1));
assert.deepEqual(s1, { nude: ['90'], negro: ['100'], 'rosa vinta': ['95'] });
const s2 = await readStock('https://a.test/productos/kaury-articulo-8165/');
console.log('woo', s2, N('8165', s2));
assert.deepEqual(s2, { 'rosa viejo': ['2'], amafl: ['3'] });
const s3 = await readStock('https://a.test/productos/emp/');
console.log('empretienda', s3, N('8165', s3));
assert.equal(await readStock('https://a.test/nada/'), 0);
console.log('OK');
