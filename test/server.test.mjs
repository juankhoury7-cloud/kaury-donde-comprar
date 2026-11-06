// Prueba de la lógica del servidor (login de Google, coincidencias de avisos, mail) sin internet.
// Copia lib/ a una carpeta temporal agregando `with { type: 'json' }` a los import de JSON (Node lo exige; Cloudflare no).
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname, tmp = await mkdtemp(join(tmpdir(), 'kt-'));
await mkdir(join(tmp, 'lib')); await symlink(join(root, 'data'), join(tmp, 'data'));
for (const f of await readdir(join(root, 'lib'))) {
  let s = await readFile(join(root, 'lib', f), 'utf8');
  s = s.replace(/import (\w+) from '(\.\.\/data\/[\w.]+\.json)';/g, "import $1 from '$2' with { type: 'json' };");
  if (f === 'auth.js') s = s.replace("export const CLIENT_ID = config.googleClientId;", "export const CLIENT_ID = 'cliente-prueba.apps.googleusercontent.com';");
  await writeFile(join(tmp, 'lib', f), s);
}
// --- login de Google: token firmado con una clave propia, servida como si fuera la de Google
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
globalThis.fetch = async u => { if (String(u).includes('oauth2/v3/certs')) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'max-age=3600' } }); throw new Error('sin red: ' + u); };
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
async function token(p, key = kp.privateKey) { const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' }), b = b64(p); const s = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + b))).toString('base64url'); return `${h}.${b}.${s}`; }
const { verifyGoogle } = await import(join(tmp, 'lib/auth.js'));
const base = { iss: 'https://accounts.google.com', aud: 'cliente-prueba.apps.googleusercontent.com', sub: '123', email: 'Ana@Gmail.com', email_verified: true, name: 'Ana Pérez', exp: Math.floor(Date.now() / 1000) + 600 };
assert.deepEqual(await verifyGoogle(await token(base)), { sub: '123', email: 'ana@gmail.com', name: 'Ana Pérez' });
const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
for (const [why, tk] of [['otra firma', await token(base, other.privateKey)], ['otra app', await token({ ...base, aud: 'otra' })], ['vencido', await token({ ...base, exp: 1000 })], ['otro emisor', await token({ ...base, iss: 'https://malo.com' })], ['mail sin verificar', await token({ ...base, email_verified: false })]])
  await assert.rejects(verifyGoogle(tk), undefined, why);
console.log('login Google: OK (acepta el válido, rechaza 5 falsos)');
// --- coincidencias de avisos y mail
const { matches } = await import(join(tmp, 'lib/match.js'));
const { describe } = await import(join(tmp, 'lib/notify.js'));
const snap = { prods: { 'alevmayorista.com': { '8100': 'https://alevmayorista.com/producto/conjunto-microfibra-art-ka8100/' }, 'casapompi.com.ar': { '8100': 'https://casapompi.com.ar/productos/kaury-deportivo-articulo-8100/' } },
  stock: { 'alevmayorista.com': { '8100': { Fresa: ['85', '95'] } }, 'casapompi.com.ar': { '8100': { Negro: ['95'] } } },
  vars: { 'alevmayorista.com': { '8100': { 'Fresa|95': 'attribute_pa_color=fresa&attribute_pa_talle=95' } } } };
const m = matches(snap, { a: '8100', c: 'Fresa', z: '95', p: '' });
assert.equal(m.length, 1); assert.equal(m[0].tienda, 'alevmayorista.com'); assert.match(m[0].url, /attribute_pa_talle=95$/);
assert.equal(matches(snap, { a: '8100', c: 'Fresa', z: '100', p: '' }).length, 0);
assert.equal(matches(snap, { a: '8100', c: '', z: '95', p: '' }).length, 2);
assert.equal(matches(snap, { a: '8100', c: 'Fresa', z: '95', p: 'CABA' }).length, 0);
console.log('avisos:', describe({ a: '8100', c: 'Fresa+Negro', z: '95', p: 'Salta' }), '→ OK');
await rm(tmp, { recursive: true });
