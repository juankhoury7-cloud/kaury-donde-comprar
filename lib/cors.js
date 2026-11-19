// Webs que pueden leer los datos del mapa desde el navegador (CORS). Solo kaury.com;
// localhost (cualquier puerto) sirve para probar la web de kaury.com en una compu (los datos son públicos igual).
export const KAURY_ORIGINS = ['https://www.kaury.com', 'https://kaury.com'];
const DEV = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/;
export function corsHeaders(request, { dev = true } = {}) {
  const o = request.headers.get('Origin') || '';
  if (!KAURY_ORIGINS.includes(o) && !(dev && DEV.test(o))) return {};
  return { 'Access-Control-Allow-Origin': o, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
}
