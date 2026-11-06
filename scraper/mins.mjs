// Chequeo diario de la compra mínima de cada mayorista con tienda web, y de cambios fuertes de precio.
// Lee la página principal y las de "cómo comprar" / preguntas frecuentes, busca la compra mínima publicada
// y la compara con la que tenemos. Los cambios claros se aplican solos; los dudosos quedan para revisar en el panel.
import { parse } from 'node-html-parser';
import { get, pool, sleep } from './lib.mjs';

const nz = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const HIT = /(compra|pedido|monto|importe)s?\s+minim[oa]s?|minimo\s+(de\s+)?(compra|pedido)|sin\s+(compra\s+)?minimo|no\s+(hay|tenemos|pedimos)\s+(compra\s+|monto\s+)?minimo/g;
const NONE = /sin\s+(compra\s+)?minimo|no\s+(hay|tenemos|pedimos)\s+(compra\s+|monto\s+)?minimo/;
const TEMP = /cyber|black\s*(friday|week)|hot\s*sale|solo\s+por\s+hoy|por\s+tiempo\s+limitado|hasta\s+el\s+\d|promo(cion)?\b|esta\s+semana|este\s+fin\s+de\s+semana/;
const MONEY = /\$\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,7})(?![\d.,]*\s*(?:%|off))|(\d{1,3}(?:\.\d{3})+)\s*(?:pesos|ars)/g;
const QTY = /(\d{1,3})\s*(prendas|unidades|articulos|productos|docenas?)/;

/** Busca la compra mínima en el texto de una página. -> {amts:[...], none:bool, qty:'6 prendas'|null, temp:bool, snip:'...'} */
export function readMin(text) {
  const t = nz(text).replace(/\s+/g, ' ');
  const out = { amts: [], none: false, qty: null, temp: false, snip: '' };
  for (const m of t.matchAll(HIT)) {
    const w = t.slice(Math.max(0, m.index - 70), m.index + m[0].length + 110);
    if (!out.snip) out.snip = w.trim();
    if (NONE.test(m[0])) { out.none = true; if (TEMP.test(w)) out.temp = true; continue; }
    // la frase de la compra mínima: hasta el próximo punto, signo o separador (el primer monto que aparece es el mínimo)
    const after = t.slice(m.index, m.index + m[0].length + 110).split(/[.!?|•]\s|\n/)[0], before = t.slice(Math.max(0, m.index - 45), m.index).split(/[.!?|•]\s|\n/).pop();
    let found = false;
    for (const zone of [after, before]) {
      const all = [...zone.matchAll(MONEY)].map(a => +String(a[1] || a[2]).replace(/[.,]/g, '')).filter(n => n >= 1000 && n <= 5e6);
      if (all.length) { out.amts.push(zone === after ? all[0] : all[all.length - 1]); found = true; break; }
    }
    if (!found) { const q = after.match(QTY); if (q && !out.qty) out.qty = q[1] + ' ' + q[2]; }
    if (TEMP.test(w)) out.temp = true;
  }
  out.amts = [...new Set(out.amts)];
  return out;
}

const LINK = /como\s+comprar|compra\s+minima|preguntas|frecuentes|faq|condiciones|mayoris|ventas?\s+por\s+mayor|envios\s+y\s+pagos|terminos/;
const money = n => '$' + n.toLocaleString('es-AR');

async function readHost(origin) {
  const home = await get(origin + '/', { tries: 2 });
  if (!home.html) return { err: String(home.status || home.err || 'sin respuesta') };
  const d = parse(home.html), pages = [d.text + ' ' + (d.querySelector('meta[name="description"]')?.getAttribute('content') || '')];
  // la web puede redirigir (p. ej. a www.): los links se resuelven contra la dirección final y se aceptan con o sin www
  const base = home.url || origin + '/', bare = h => h.replace(/^www\./, ''), host = bare(new URL(base).host), seen = new Set();
  const links = d.querySelectorAll('a[href]').map(a => ({ h: a.getAttribute('href'), t: nz(a.text) + ' ' + nz(a.getAttribute('href')) }))
    .filter(x => LINK.test(x.t)).map(x => { try { return new URL(x.h, base).href.split('#')[0]; } catch { return null; } })
    .filter(u => u && bare(new URL(u).host) === host && !seen.has(u) && seen.add(u)).slice(0, 4);
  for (const u of links) { await sleep(400); const r = await get(u, { tries: 2 }); if (r.html) pages.push(parse(r.html).text); }
  const all = pages.join(' \n ');
  return Object.assign(readMin(all), { len: all.replace(/\s+/g, ' ').trim().length });
}

/**
 * hosts: {host: {origin, base, baseTxt, names}}  prev: estado anterior del chequeo
 * -> {hosts:{host:{st, base, amt, txt, temp, seen, snip, ts, chTs, err}}, changes:[...]}
 */
export async function checkMins(hosts, prev = {}) {
  const now = Date.now(), res = {}, changes = [];
  await pool(Object.entries(hosts), 4, async ([host, h]) => {
    const p = (prev.hosts || {})[host] || {};
    const cur = p.amt !== undefined && p.amt !== null ? p.amt : h.base;   // lo que hoy muestra el mapa
    const o = { st: 'ok', base: h.base, amt: p.amt ?? null, q: !!p.q, txt: p.txt || '', temp: !!p.temp, ts: now, chTs: p.chTs || null, seen: '', snip: '' };
    let r;
    try { r = await readHost(h.origin); } catch (e) { r = { err: String(e.message || e) }; }
    if (r.err) { Object.assign(o, { st: 'error', err: r.err }); res[host] = o; return; }
    o.snip = r.snip.slice(0, 240);
    // si la web muestra varios montos: si uno es el que ya teníamos, se mantiene; si no, se toma el más bajo
    const pick = r.amts.includes(h.base) ? h.base : r.amts.includes(cur) ? cur : Math.min(...r.amts);
    const vals = r.none ? [0] : r.amts.length ? [pick] : [];
    o.seen = r.none ? 'sin mínimo' : r.amts.length ? r.amts.map(money).join(' / ') : r.qty ? 'mínimo ' + r.qty : '';
    const set = (amt, txt, temp, why) => {
      const was = cur;
      o.q = false;
      if (amt === h.base && !temp) { o.amt = null; o.txt = ''; o.temp = false; } else { o.amt = amt; o.txt = txt; o.temp = temp; }
      if (amt !== was) { o.chTs = now; changes.push({ host, names: h.names, de: was, a: amt, temp, why, ts: now }); }
    };
    if (vals.length === 1) {
      const v = vals[0];
      if (v === cur && !!r.temp === o.temp) o.st = 'ok';
      else if (!prev.ts) { o.st = 'dudoso'; o.why = 'primera lectura: su web dice ' + (v ? money(v) : 'sin mínimo') + '; si mañana sigue igual se actualiza solo'; }
      else { set(v, v ? money(v) + (r.temp ? ' (promo)' : '') : 'Sin compra mínima' + (r.temp ? ' (promo)' : ''), !!r.temp, 'leído en su web'); o.st = 'cambio'; }
    } else if (r.qty) {
      // mínimo por cantidad de prendas: se muestra tal cual ("3 prendas")
      const same = nz(h.baseTxt).replace(/\s+/g, ' ').includes(r.qty) && h.base === null;
      if (same && !o.q) o.st = 'ok';
      else if (o.q && o.txt === r.qty) o.st = 'ok';
      else if (!prev.ts) { o.st = 'dudoso'; o.why = 'primera lectura: su web pide mínimo ' + r.qty + '; si mañana sigue igual se actualiza solo'; }
      else { if (cur !== null || !same) changes.push({ host, names: h.names, de: cur, a: r.qty, why: 'leído en su web', ts: now }); Object.assign(o, { amt: null, q: !same, txt: same ? '' : r.qty, temp: false, chTs: now, st: 'cambio' }); }
    } else {
      // no publica el mínimo: si teníamos una promo temporal, se vuelve al de siempre; si no, queda para revisar
      if (o.temp) { set(h.base, '', false, 'terminó la promo'); o.st = 'cambio'; }
      else if (cur === 0) o.st = 'ok';   // ya figuraba sin mínimo y su web no menciona ninguno
      else { o.st = 'no'; o.why = r.len < 600 ? 'su web se arma con JavaScript y no se puede leer sola: queda el valor cargado a mano' : 'no encontré la compra mínima en su web'; }
    }
    res[host] = o;
  });
  return { hosts: res, changes };
}

/** Compara precios de hoy con los anteriores por tienda: mediana del cambio en los artículos que están en los dos días. */
export function priceMoves(prevPx = {}, px = {}) {
  const out = {};
  for (const [sk, cur] of Object.entries(px)) {
    const old = prevPx[sk]; if (!old) continue;
    const r = Object.keys(cur).filter(c => old[c] && cur[c]).map(c => cur[c] / old[c]).sort((a, b) => a - b);
    if (r.length < 3) continue;
    const med = r[Math.floor(r.length / 2)], pct = Math.round((med - 1) * 100);
    if (Math.abs(pct) >= 15) out[sk] = { pct, n: r.length };
  }
  return out;
}
