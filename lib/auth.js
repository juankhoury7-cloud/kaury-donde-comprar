// Entrar con Google: se verifica en el servidor el token firmado que entrega Google
// (firma RS256 con las claves públicas de Google, audiencia = nuestro Client ID, vencimiento),
// y se crea una sesión propia guardada en una cookie HttpOnly (180 días).
import config from '../data/config.json';
export const CLIENT_ID = config.googleClientId;
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const dec = s => JSON.parse(new TextDecoder().decode(b64u(s)));
let jwks = null, jwksExp = 0;
async function googleKey(kid) {
  if (!jwks || Date.now() > jwksExp || !jwks[kid]) {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!r.ok) throw new Error('no pude leer las claves de Google');
    const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
    jwksExp = Date.now() + (m ? +m[1] * 1000 : 3600e3);
    jwks = Object.fromEntries((await r.json()).keys.map(k => [k.kid, k]));
  }
  const jwk = jwks[kid]; if (!jwk) throw new Error('clave de Google desconocida');
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}
export async function verifyGoogle(token) {
  if (!CLIENT_ID) throw new Error('falta el Client ID de Google en data/config.json');
  const parts = String(token || '').split('.'); if (parts.length !== 3) throw new Error('token inválido');
  const [h, p, s] = parts, head = dec(h), pay = dec(p);
  if (head.alg !== 'RS256') throw new Error('algoritmo inválido');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await googleKey(head.kid), b64u(s), new TextEncoder().encode(h + '.' + p));
  if (!ok) throw new Error('firma inválida');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(pay.iss)) throw new Error('emisor inválido');
  if (pay.aud !== CLIENT_ID) throw new Error('audiencia inválida');
  if (!pay.exp || pay.exp * 1000 < Date.now() - 60e3) throw new Error('token vencido');
  if (!pay.email || pay.email_verified === false) throw new Error('mail no verificado');
  return { sub: String(pay.sub), email: String(pay.email).toLowerCase(), name: String(pay.name || pay.given_name || '').slice(0, 80) };
}
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const COOKIE = 'ks', DAYS = 180;
export async function newSession(DB, uid) {
  const raw = hex(crypto.getRandomValues(new Uint8Array(32)));
  await DB.prepare('INSERT INTO sessions (h,uid,exp) VALUES (?1,?2,?3)').bind(await sha(raw), uid, Date.now() + DAYS * 864e5).run();
  return `${COOKIE}=${raw}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`;
}
const tokenOf = request => { const m = /(?:^|;\s*)ks=([0-9a-f]{64})/.exec(request.headers.get('Cookie') || ''); return m ? m[1] : null; };
export async function currentUser(DB, request) {
  const raw = tokenOf(request); if (!raw) return null;
  const u = await DB.prepare('SELECT u.id,u.email,u.name,u.tipo,u.news,u.prov FROM sessions s JOIN users u ON u.id=s.uid WHERE s.h=?1 AND s.exp>?2').bind(await sha(raw), Date.now()).first();
  return u || null;
}
export async function endSession(DB, request) {
  const raw = tokenOf(request); if (raw) await DB.prepare('DELETE FROM sessions WHERE h=?1').bind(await sha(raw)).run();
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
export const pub = u => u && ({ email: u.email, name: u.name, tipo: u.tipo || null, news: !!u.news });
