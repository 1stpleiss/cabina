// La app solo carga la web de Cabina si está firmada con la llave propia. La web dice qué archivos tiene y la
// huella de cada uno en firma.json, firmado (herramientas/firmar.mjs web). Cada petición a la web pasa por aquí:
// se descarga el archivo, se comprueba su huella con la lista firmada y solo entonces se entrega a la página.
// Si algo no cuadra (archivo cambiado, lista sin firmar o con otra firma), no se carga.
// Así, quien entrara en la cuenta de GitHub o en GitHub Pages podría cambiar la web, pero la app no la usaría:
// micro, cámara, pantalla y control remoto quedan fuera de su alcance. Las demás direcciones pasan tal cual.
const { net } = require('electron');
const firma = require('./firma');

function setup(ses, WEB){
  const base = new URL(WEB), scheme = base.protocol.slice(0, -1);
  let lista = null, listaT = 0;
  const verificados = new Map(); // ruta → { huella, cuerpo, tipo }
  const pasar = req => net.fetch(req, { bypassCustomProtocolHandlers: true });
  const traer = url => net.fetch(url, { bypassCustomProtocolHandlers: true, cache: 'no-store' });

  async function cargarLista(nueva){
    if (lista && !nueva && Date.now() - listaT < 10 * 60e3) return lista;
    const r = await traer(new URL('firma.json?t=' + Date.now(), WEB).href);
    if (!r.ok) throw new Error('firma.json: ' + r.status);
    const j = await r.json();
    if (!firma.valida(j.datos, j.firma)) throw new Error('la firma de la web no es válida');
    lista = JSON.parse(j.datos).archivos; listaT = Date.now();
    return lista;
  }
  async function archivo(rel, nueva){
    const l = await cargarLista(nueva);
    const quiere = l[rel];
    if (!quiere) return { error: 404 };
    const v = verificados.get(rel);
    if (v && v.huella === quiere) return v;
    // Con la versión en la dirección para no recibir una copia vieja de la caché de GitHub
    const r = await traer(new URL(encodeURI(rel) + '?v=' + encodeURIComponent(quiere.slice(0, 12)), WEB).href);
    if (!r.ok) return { error: r.status };
    const cuerpo = Buffer.from(await r.arrayBuffer());
    if (firma.huella(cuerpo) !== quiere) return { error: 'huella' };
    const ok = { huella: quiere, cuerpo, tipo: r.headers.get('content-type') || 'application/octet-stream' };
    verificados.set(rel, ok);
    return ok;
  }
  const aviso = texto => new Response(`<!doctype html><meta charset="utf-8"><title>Cabina</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0d0e10;color:#8d929a;font:14px system-ui,sans-serif;text-align:center"><div><h1 style="color:#ebe8e3;font-size:18px;margin:0 0 6px">No se ha podido cargar Cabina</h1><p>${texto}</p><button onclick="location.reload()" style="margin-top:14px;background:#213ACE;border:0;color:#fff;border-radius:8px;padding:8px 16px;font:600 14px system-ui,sans-serif;cursor:pointer">Reintentar</button></div>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

  ses.protocol.handle(scheme, async req => {
    const u = new URL(req.url);
    if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname) || req.method !== 'GET') return pasar(req);
    let rel = decodeURIComponent(u.pathname.slice(base.pathname.length));
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const doc = rel === 'index.html';
    try {
      let a = await archivo(rel, doc);
      // Recién publicada, la caché de GitHub puede dar aún la lista o el archivo anterior: se reintenta una vez
      if (a.error === 'huella') { verificados.delete(rel); a = await archivo(rel, true); }
      if (a.error) {
        console.error('[web-segura]', rel, a.error);
        return doc ? aviso(a.error === 'huella' ? 'La web no coincide con la firmada. Prueba en unos minutos; si sigue, avisa a quien hace Cabina.' : 'Comprueba la conexión a internet.')
          : new Response(null, { status: a.error === 'huella' ? 403 : a.error });
      }
      return new Response(a.cuerpo, { status: 200, headers: { 'content-type': a.tipo, 'cache-control': 'no-store' } });
    } catch (e) {
      console.error('[web-segura]', rel, e.message);
      return doc ? aviso(/firma/.test(e.message) ? 'La web no está firmada por Cabina, así que no se carga por seguridad.' : 'Comprueba la conexión a internet.')
        : new Response(null, { status: 502 });
    }
  });
}

module.exports = { setup };
