// GET /api/admin/health -> estado técnico para la pestaña Sistema del panel. Pide PANEL_PASSWORD.
// No devuelve ninguna clave: solo si cada configuración está cargada o no.
import { db, json } from '../../../lib/db.js';
import { adminCheck } from '../../../lib/admin.js';
import cfg from '../../../data/config.json';
const day = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const J = (r, def) => { try { return r ? JSON.parse(r.v) : def; } catch { return def; } };
export async function onRequestGet({ request, env }) {
  const deny = await adminCheck(request, env); if (deny) return deny;
  const DB = await db(env), now = Date.now();
  const [runs, mins, hist, alr, evn, stockAt, ev, ev24, us, al, ses] = await Promise.all([
    DB.prepare("SELECT v FROM kv WHERE k='runs'").first(),
    DB.prepare("SELECT v, at FROM kv WHERE k='mins'").first(),
    DB.prepare("SELECT v FROM kv WHERE k='hist'").first(),
    DB.prepare("SELECT v, at FROM kv WHERE k='alertsrun'").first(),
    DB.prepare("SELECT v FROM kv WHERE k=?1").bind('evn:' + day()).first(),
    DB.prepare("SELECT at FROM kv WHERE k='stock'").first(),
    DB.prepare('SELECT COUNT(*) n FROM ev').first(),
    DB.prepare('SELECT COUNT(*) n FROM ev WHERE ts>=?1').bind(now - 864e5).first(),
    DB.prepare('SELECT COUNT(*) n FROM users').first(),
    DB.prepare('SELECT SUM(active=1) a, SUM(sent IS NOT NULL) s FROM alerts').first(),
    DB.prepare('SELECT COUNT(*) n FROM sessions WHERE exp>?1').bind(now).first(),
  ]);
  const m = J(mins, {}), cnt = {}; Object.values(m.hosts || {}).forEach(h => { cnt[h.st] = (cnt[h.st] || 0) + 1; });
  return json({
    now, stockAt: stockAt ? stockAt.at : null, runs: J(runs, []),
    mins: { ts: m.ts || null, counts: cnt, changes: (m.log || []).filter(x => x.ts > now - 7 * 864e5).length },
    histDays: Object.keys(J(hist, {})).length,
    alerts: { at: alr ? alr.at : null, last: J(alr, null), active: (al && al.a) || 0, sent: (al && al.s) || 0 },
    db: { ev: ev.n, ev24: ev24.n, evToday: evn ? +evn.v : 0, evCap: +env.MAX_EV_DAY || 5000, users: us.n, sessions: ses.n },
    config: { ingest: !!env.INGEST_TOKEN, panel: !!env.PANEL_PASSWORD, google: !!cfg.googleClientId, brevo: !!env.BREVO_KEY, mailFrom: !!env.MAIL_FROM, contact: !!cfg.contactEmail, ghTokenExpires: cfg.ghTokenExpires || null },
  }, 200, { 'Cache-Control': 'no-store' });
}
