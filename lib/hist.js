// Historial del stock en la calle: cuántas tiendas online tienen cada artículo, un dato por día (se guarda 180 días).
// Se actualiza como mucho una vez por hora con la última lectura de stock; el valor del día es el de la última actualización.
const DAY = ts => new Date(ts - 3 * 3600e3).toISOString().slice(0, 10); // fecha de Argentina
export function counts(snap) {
  const out = {};
  for (const [key, pr] of Object.entries(snap.prods || {})) {
    const st = (snap.stock || {})[key.replace(/^www\./, '')] || {};
    for (const code of Object.keys(pr)) { const e = st[code]; if (e && (e === '?' || Object.keys(e).length)) out[code] = (out[code] || 0) + 1; }
  }
  return out;
}
export async function saveHist(DB, snap, now = Date.now()) {
  const row = await DB.prepare("SELECT v, at FROM kv WHERE k='hist'").first();
  if (row && now - row.at < 3600e3) return false;
  let h = {}; try { h = row ? JSON.parse(row.v) : {}; } catch { h = {}; }
  h[DAY(now)] = counts(snap);
  const days = Object.keys(h).sort(); while (days.length > 180) delete h[days.shift()];
  await DB.prepare("INSERT INTO kv (k,v,at) VALUES ('hist',?1,?2) ON CONFLICT(k) DO UPDATE SET v=excluded.v, at=excluded.at").bind(JSON.stringify(h), now).run();
  return true;
}
