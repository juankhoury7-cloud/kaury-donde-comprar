// Webs que pueden leer los datos del mapa desde el navegador (CORS). Solo kaury.com;
// localhost (cualquier puerto) sirve para probar la web de kaury.com en una compu (los datos son públicos igual).
export const KAURY_ORIGINS = ['https://www.kaury.com', 'https://kaury.com'];
// también la IP de la compu en la red de la casa/oficina (192.168.x.x, 10.x.x.x, 172.16-31.x.x), para probar desde el celular
const DEV = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d{2,5}$/;
export function corsHeaders(request, { dev = true } = {}) {
  const o = request.headers.get('Origin') || '';
  if (!KAURY_ORIGINS.includes(o) && !(dev && DEV.test(o))) return {};
  return { 'Access-Control-Allow-Origin': o, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
}
