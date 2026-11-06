// Avisos de stock: después de cada lectura (cada 5 min) se revisan los avisos activos;
// si alguno ya tiene stock, se manda un mail (Brevo, plan gratis) y el aviso se da por cumplido.
// Sin la clave BREVO_KEY no se manda nada y los avisos siguen esperando.
import { matches, ART } from './match.js';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PER_RUN = 20, PER_DAY = 250;
const day = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
export function describe(al) {
  const a = ART[al.a], cs = al.c ? al.c.split('+') : [], zs = al.z ? al.z.split('+') : [];
  const o = l => (l.length < 2 ? l[0] || '' : l.slice(0, -1).join(', ') + ' o ' + l[l.length - 1]);
  return 'Kaury ' + al.a + (cs.length ? ' en ' + o(cs).toLowerCase() : '') + (zs.length ? ', talle ' + o(zs) : '') + (al.p ? ' (' + al.p + ')' : '') + (a ? ' · ' + a.name : '');
}
function mailHtml(user, al, found, site) {
  const shops = found.map(s => `<tr><td style="padding:12px 0;border-bottom:1px solid #eee"><b style="font-size:15px">${esc(s.tienda)}</b><br><span style="color:#666;font-size:13px">${s.locales.slice(0, 3).map(esc).join('<br>')}</span><br><a href="${esc(s.url)}" style="display:inline-block;margin-top:8px;background:#db0032;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:700;font-size:14px">Comprar en su tienda online →</a></td></tr>`).join('');
  const hash = '#a=' + encodeURIComponent(al.a) + (al.c ? '&c=' + encodeURIComponent(al.c.split('+').join(',')) : '') + (al.z ? '&z=' + encodeURIComponent(al.z.split('+').join(',')) : '') + (al.p ? '&p=' + encodeURIComponent(al.p) : '');
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0a0a0a">
  <p style="color:#db0032;font-weight:700;letter-spacing:.08em;font-size:12px;text-transform:uppercase;margin:0 0 6px">Kaury · Dónde comprar</p>
  <h1 style="font-size:22px;margin:0 0 10px">¡Ya hay stock de lo que buscabas!</h1>
  <p style="font-size:15px;line-height:1.5;margin:0 0 6px">Hola${user.name ? ' ' + esc(user.name.split(' ')[0]) : ''}, el <b>${esc(describe(al))}</b> ya está disponible en ${found.length === 1 ? 'esta tienda online' : 'estas tiendas online'}:</p>
  <table style="width:100%;border-collapse:collapse">${shops}</table>
  <p style="font-size:13px;color:#666;line-height:1.5;margin:16px 0 0">El stock puede agotarse rápido. <a href="${site}/${hash}" style="color:#db0032">Ver en el mapa</a></p>
  <p style="font-size:11.5px;color:#999;line-height:1.5;margin:22px 0 0">Recibiste este mail porque pediste un aviso en ${esc(site.replace(/^https?:\/\//, ''))}. Este aviso ya se cumplió y no se repite. Para ver o borrar tus avisos: <a href="${site}/#cuenta" style="color:#999">tu cuenta</a>.</p></div>`;
}
async function send(env, to, name, subject, html) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': env.BREVO_KEY.trim(), 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ sender: { email: env.MAIL_FROM.trim(), name: 'Kaury · Dónde comprar' }, to: [{ email: to, name: name || undefined }], subject, htmlContent: html }),
  });
  if (!r.ok) throw new Error('Brevo ' + r.status + ': ' + (await r.text()).slice(0, 200));
}
export async function runAlerts(DB, env, snap, site) {
  const now = Date.now();
  await DB.prepare('UPDATE alerts SET active=0 WHERE active=1 AND created < ?1').bind(now - 120 * 864e5).run(); // vencen a los 4 meses
  if (!env.BREVO_KEY || !env.MAIL_FROM) return { skipped: 'sin BREVO_KEY / MAIL_FROM' };
  const sentToday = +((await DB.prepare('SELECT v FROM kv WHERE k=?1').bind('mail:' + day()).first()) || { v: 0 }).v;
  if (sentToday >= PER_DAY) return { skipped: 'tope diario' };
  const { results } = await DB.prepare('SELECT al.id,al.a,al.c,al.z,al.p,u.email,u.name FROM alerts al JOIN users u ON u.id=al.uid WHERE al.active=1 ORDER BY al.created LIMIT 400').all();
  let n = 0; const errors = [];
  for (const al of results) {
    if (n >= PER_RUN || sentToday + n >= PER_DAY) break;
    const found = matches(snap, al); if (!found.length) continue;
    try {
      await send(env, al.email, al.name, '¡Llegó el Kaury ' + al.a + '! Ya hay stock', mailHtml(al, al, found, site));
      await DB.prepare('UPDATE alerts SET active=0, sent=?1 WHERE id=?2').bind(now, al.id).run(); n++;
    } catch (e) { errors.push(String(e.message || e)); break; }
  }
  if (n) await DB.prepare("INSERT INTO kv (k,v,at) VALUES (?1,?2,?3) ON CONFLICT(k) DO UPDATE SET v=CAST(v AS INTEGER)+?2, at=?3").bind('mail:' + day(), String(n), now).run();
  return { sent: n, errors };
}
