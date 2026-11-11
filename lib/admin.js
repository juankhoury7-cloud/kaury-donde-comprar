// Acceso al panel: contraseña PANEL_PASSWORD.
// Intentos fallidos contados en la base (valen para todos los servidores de Cloudflare):
//  · 10 fallidos por hora desde una misma IP -> esa IP queda bloqueada hasta la hora siguiente
//  · 200 fallidos por hora sumando todas las IPs (ataque repartido) -> el panel se bloquea hasta la hora siguiente
import { db, json, bearer, same, secret } from './db.js';
import { allow, fails, ipOf, ipHash, dbAllow, dbCount, tooMany } from './guard.js';
const H = 3600e3;
export async function adminCheck(request, env) {
  if (!secret(env.PANEL_PASSWORD)) return json({ error: 'falta configurar PANEL_PASSWORD en Cloudflare' }, 503);
  const ip = ipOf(request);
  if (fails('pf:' + ip, 15 * 60e3) >= 8) return tooMany('demasiados intentos, esperá un rato');
  const DB = await db(env), ih = await ipHash(request);
  if ((await dbCount(DB, 'pf:' + ih, H)) >= 10 || (await dbCount(DB, 'pfg', H)) >= 200) return tooMany('demasiados intentos, esperá un rato');
  if (!same(bearer(request), secret(env.PANEL_PASSWORD))) {
    allow('pf:' + ip, 1e9, 15 * 60e3);
    await Promise.all([dbAllow(DB, 'pf:' + ih, 1e9, H), dbAllow(DB, 'pfg', 1e9, H)]);
    await new Promise(r => setTimeout(r, 600));
    return json({ error: 'no autorizado' }, 401);
  }
  if (!allow('pa:' + ip, 20, 60e3)) return tooMany();
  return null;
}
