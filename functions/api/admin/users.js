// GET /api/admin/users -> contactos registrados en CSV (para Excel), con lo que pidieron. Pide PANEL_PASSWORD.
import { db } from '../../../lib/db.js';
import { adminCheck } from '../../../lib/admin.js';
import { describe } from '../../../lib/notify.js';
const csv = v => { const s = v == null ? '' : String(v); return /[";\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const fecha = ts => (ts ? new Date(ts - 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '');
export async function onRequestGet({ request, env }) {
  const deny = await adminCheck(request, env); if (deny) return deny;
  const DB = await db(env);
  const { results: us } = await DB.prepare('SELECT id,email,name,tipo,news,prov,created,seen FROM users ORDER BY created DESC').all();
  const { results: al } = await DB.prepare('SELECT uid,a,c,z,p,active,sent FROM alerts ORDER BY created DESC').all();
  const by = {}; for (const x of al) (by[x.uid] = by[x.uid] || []).push(x);
  const head = ['Mail', 'Nombre', 'Tipo', 'Acepta novedades', 'Zona', 'Registrado', 'Última visita', 'Avisos activos', 'Avisos cumplidos', 'Lo que pidió'];
  const rows = us.map(u => { const a = by[u.id] || []; return [u.email, u.name, u.tipo === 'rev' ? 'Revendedora' : u.tipo === 'min' ? 'Consumidora' : '', u.news ? 'Sí' : 'No', u.prov || '', fecha(u.created), fecha(u.seen), a.filter(x => x.active).length, a.filter(x => x.sent).length, a.map(describe).join(' | ')]; });
  const body = '﻿' + [head, ...rows].map(r => r.map(csv).join(';')).join('\r\n');
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="kaury-contactos.csv"', 'Cache-Control': 'no-store' } });
}
