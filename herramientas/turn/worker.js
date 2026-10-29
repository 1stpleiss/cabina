// Servicio que da claves temporales para el relevo (TURN) de Cloudflare a la web de Cabina. Se publica como
// Cloudflare Worker (gratis) y su dirección va en TURN_URL (web/index.html).
// Hace falta, en el panel de Cloudflare: Realtime → TURN → crear una clave; y en el Worker, dos secretos:
//   TURN_KEY_ID     el identificador de esa clave
//   TURN_KEY_TOKEN  su token de API
// Las claves que da duran 24 h. Solo responde a la web de Cabina y a las páginas de los plugins (Origin);
// un programa podría inventarse el Origin y gastar relevo, pero no ver ni oír nada de nadie.
const ORIGENES = new Set(['https://1stpleiss.github.io',
  ...Array.from({ length: 9 }, (_, i) => 'http://127.0.0.1:' + (47800 + i))]);

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    if (!ORIGENES.has(origin)) return new Response('No', { status: 403 });
    const cors = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Cache-Control': 'no-store' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.TURN_KEY_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
    });
    if (!r.ok) return new Response('Error del relevo', { status: 502, headers: cors });
    return new Response(await r.text(), { headers: { ...cors, 'Content-Type': 'application/json' } });
  },
};
