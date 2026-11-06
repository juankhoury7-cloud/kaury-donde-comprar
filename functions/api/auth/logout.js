// POST /api/auth/logout -> cierra la sesión
import { db, json } from '../../../lib/db.js';
import { sameOrigin } from '../../../lib/guard.js';
import { endSession } from '../../../lib/auth.js';
export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: 'origen no permitido' }, 403);
  const cookie = await endSession(await db(env), request);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' });
}
