// Reloj de Cloudflare: cada 5 minutos le pide a GitHub que corra el lector de stock.
// (El horario propio de GitHub no es confiable; el de Cloudflare sí.)
// Necesita el secreto GH_TOKEN: llave de GitHub con permiso "Actions: read and write" solo sobre este repo.
export default {
  async scheduled(event, env, ctx) {
    const full = new Date(event.scheduledTime).getUTCMinutes() < 5; // una vez por hora, revisión completa de artículos
    const r = await fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/stock.yml/dispatches`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.GH_TOKEN}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'kaury-cron' },
      body: JSON.stringify({ ref: 'main', inputs: { full: String(full) } }),
    });
    if (!r.ok) throw new Error(`GitHub respondió ${r.status}: ${await r.text()}`);
  },
};
