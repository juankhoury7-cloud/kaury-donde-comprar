// Acceso al panel: contraseña PANEL_PASSWORD, con bloqueo tras 8 intentos fallidos en 15 minutos.
import { json, bearer, same, secret } from './db.js';
import { allow, fails, ipOf, tooMany } from './guard.js';
export async function adminCheck(request, env) {
  if (!secret(env.PANEL_PASSWORD)) return json({ error: 'falta configurar PANEL_PASSWORD en Cloudflare' }, 503);
  const ip = ipOf(request);
  if (fails('pf:' + ip, 15 * 60e3) >= 8) return tooMany('demasiados intentos, esperá 15 minutos');
  if (!same(bearer(request), secret(env.PANEL_PASSWORD))) { allow('pf:' + ip, 1e9, 15 * 60e3); await new Promise(r => setTimeout(r, 600)); return json({ error: 'no autorizado' }, 401); }
  if (!allow('pa:' + ip, 20, 60e3)) return tooMany();
  return null;
}
