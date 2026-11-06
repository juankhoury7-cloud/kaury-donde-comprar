// Arma site/index.html (mapa público) y site/panel/index.html (panel con contraseña)
// a partir de templates/app.html y los datos de data/. Uso: node scripts/build-site.mjs
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const r = p => readFile(new URL('../' + p, import.meta.url), 'utf8');
const J = async p => JSON.parse(await r(p));
const [tpl, map, stores, cat, sizes, snap, cfg] = await Promise.all([r('templates/app.html'), J('data/map.json'), J('data/stores.json'), J('data/catalog.json'), J('data/sizes.json'), J('data/snapshot.json'), J('data/config.json')]);
const js = x => JSON.stringify(x).replace(/</g, '\\u003c');
const fmt = ts => { const o = { timeZone: 'America/Argentina/Buenos_Aires' }; const d = new Date(ts); return d.toLocaleDateString('es-AR', { ...o, day: 'numeric', month: 'numeric', year: 'numeric' }) + ' a las ' + d.toLocaleTimeString('es-AR', { ...o, hour: '2-digit', minute: '2-digit', hour12: false }); };
function build(mode) {
  const V = {
    __NEIGH__: map.neigh, __ARG__: map.arg, __MALV__: map.malv,
    __SCALE__: String(map.scale), __TX__: String(map.translate[0]), __TY__: String(map.translate[1]),
    __STORES__: js(stores), __CAT__: js(cat), __PRODS__: js(snap.prods), __STOCK__: js(snap.stock), __VARS__: js(snap.vars || {}), __SIZES__: js(sizes),
    __STOCKAT__: fmt(snap.ts), __STOCKTS__: String(snap.ts), __CRAWLED__: '5/11/2026', __MODE__: mode, __GCID__: cfg.googleClientId || '',
    __TITLE__: mode === 'panel' ? 'Kaury · Panel de datos' : 'Kaury · Dónde comprar · Por unidad y por mayor',
    __ROBOTS__: mode === 'panel' ? '<meta name="robots" content="noindex, nofollow">' : '',
  };
  let t = tpl;
  for (const [k, v] of Object.entries(V)) t = t.split(k).join(v);
  const left = t.match(/__[A-Z]{3,}__/g); if (left) throw new Error('Faltan reemplazos: ' + [...new Set(left)].join(', '));
  // Política de contenido: solo corre el script propio de esta página (por su huella) y el de "Entrar con Google".
  const m = t.match(/<script>([\s\S]*?)<\/script>/); if (!m || t.split('<script>').length !== 2) throw new Error('se esperaba un solo <script> en línea');
  const hash = createHash('sha256').update(m[1], 'utf8').digest('base64');
  const csp = [`default-src 'self'`, `script-src 'sha256-${hash}' https://accounts.google.com/gsi/client`, `style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style`,
    `img-src 'self' data: https:`, `connect-src 'self' https://accounts.google.com/gsi/`, `frame-src https://accounts.google.com/gsi/`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`].join('; ');
  t = t.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
  if (!t.includes('Content-Security-Policy')) throw new Error('no pude agregar la política de contenido');
  return t;
}
await mkdir(new URL('../site/panel/', import.meta.url), { recursive: true });
await writeFile(new URL('../site/index.html', import.meta.url), build('public'));
await writeFile(new URL('../site/panel/index.html', import.meta.url), build('panel'));
const priv = (await r('templates/privacidad.html')).replace('__FECHA__', new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }))
  .replace('__CONTACTO__', cfg.contactEmail ? `También podés escribirnos a <a href="mailto:${cfg.contactEmail}">${cfg.contactEmail}</a>.` : '');
await writeFile(new URL('../site/privacidad.html', import.meta.url), priv);
for (const f of ['og.png', 'icon.png']) await copyFile(new URL('../data/' + f, import.meta.url), new URL('../site/' + f, import.meta.url));
console.log('Listo: site/index.html y site/panel/index.html');
