// Webs que pueden leer los datos del mapa desde el navegador (CORS). Solo kaury.com;
// localhost:5173/5179 sirve para que el desarrollador de kaury.com pruebe en su compu (los datos son públicos igual).
export const KAURY_ORIGINS = ['https://www.kaury.com', 'https://kaury.com'];
const DEV = ['http://localhost:5173', 'http://localhost:5179', 'http://127.0.0.1:5173', 'http://127.0.0.1:5179'];
export function corsHeaders(request, { dev = true } = {}) {
  const o = request.headers.get('Origin') || '';
  if (!KAURY_ORIGINS.includes(o) && !(dev && DEV.includes(o))) return {};
  return { 'Access-Control-Allow-Origin': o, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
}
