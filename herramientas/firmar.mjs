// Firma de Cabina con la llave propia (Ed25519). La llave privada vive solo en el Mac de quien publica
// (~/.cabina-firma/privada.pem), nunca en GitHub: así, aunque alguien entrara en la cuenta de GitHub, no podría
// publicar una web ni una actualización que la app y el plugin acepten. La pública está en firma/publica.txt
// y dentro de la app (app/firma.js) y del plugin (WebSocketServer.cpp).
//
//   node herramientas/firmar.mjs web           Firma web/: escribe web/firma.json (huella SHA-256 de cada archivo)
//   node herramientas/firmar.mjs comprobar     Comprueba web/firma.json con la llave pública (lo hace GitHub al publicar)
//   node herramientas/firmar.mjs app           Firma la última versión de la app publicada en la release "app":
//                                              descarga latest.yml y latest-mac.yml, comprueba que las huellas de
//                                              sus archivos coinciden con lo publicado y sube latest*.yml.sig
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WEB = path.join(RAIZ, 'web');
const PUBLICA = fs.readFileSync(path.join(RAIZ, 'firma', 'publica.txt'), 'utf8').trim();
const publica = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: PUBLICA }, format: 'jwk' });
const privada = () => crypto.createPrivateKey(fs.readFileSync(path.join(os.homedir(), '.cabina-firma', 'privada.pem')));
const firmar = datos => crypto.sign(null, Buffer.from(datos), privada()).toString('base64url');
const valida = (datos, firma) => { try { return crypto.verify(null, Buffer.from(datos), publica, Buffer.from(firma, 'base64url')); } catch { return false; } };
const huella = buf => crypto.createHash('sha256').update(buf).digest('base64');

function archivosWeb(dir = WEB, base = ''){
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.name.startsWith('.') || rel === 'firma.json') return [];
    return e.isDirectory() ? archivosWeb(path.join(dir, e.name), rel) : [rel];
  }).sort();
}
const listaWeb = () => Object.fromEntries(archivosWeb().map(f => [f, huella(fs.readFileSync(path.join(WEB, f)))]));

const orden = process.argv[2];
if (orden === 'web') {
  const datos = JSON.stringify({ fecha: new Date().toISOString(), archivos: listaWeb() });
  fs.writeFileSync(path.join(WEB, 'firma.json'), JSON.stringify({ datos, firma: firmar(datos) }, null, 1) + '\n');
  console.log('web/firma.json firmado:', Object.keys(JSON.parse(datos).archivos).length, 'archivos');
} else if (orden === 'comprobar') {
  const f = JSON.parse(fs.readFileSync(path.join(WEB, 'firma.json'), 'utf8'));
  if (!valida(f.datos, f.firma)) { console.error('La firma de web/firma.json no es válida'); process.exit(1); }
  const firmados = JSON.parse(f.datos).archivos, ahora = listaWeb();
  const mal = [...new Set([...Object.keys(firmados), ...Object.keys(ahora)])].filter(k => firmados[k] !== ahora[k]);
  if (mal.length) { console.error('Archivos sin firmar o cambiados desde la firma:', mal.join(', ')); process.exit(1); }
  console.log('web/firma.json válido:', Object.keys(ahora).length, 'archivos');
} else if (orden === 'app') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cabina-firma-'));
  const gh = (...a) => execFileSync('gh', a, { cwd: RAIZ, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
  for (const yml of ['latest.yml', 'latest-mac.yml']) {
    gh('release', 'download', 'app', '-p', yml, '-D', tmp, '--clobber');
    const texto = fs.readFileSync(path.join(tmp, yml), 'utf8');
    // Cada archivo de la actualización debe tener la huella que dice el yml
    for (const [, url, sha] of texto.matchAll(/-\s*url:\s*(\S+)\s*\n\s*sha512:\s*(\S+)/g)) {
      gh('release', 'download', 'app', '-p', url, '-D', tmp, '--clobber');
      const real = crypto.createHash('sha512').update(fs.readFileSync(path.join(tmp, url))).digest('base64');
      if (real !== sha) { console.error(`${url}: la huella no coincide con ${yml}. No se firma.`); process.exit(1); }
      fs.rmSync(path.join(tmp, url));
    }
    fs.writeFileSync(path.join(tmp, yml + '.sig'), firmar(texto));
    gh('release', 'upload', 'app', path.join(tmp, yml + '.sig'), '--clobber');
    const version = (texto.match(/^version:\s*'?([\d.]+)/m) || [])[1];
    try { gh('release', 'upload', 'app-v' + version, path.join(tmp, yml + '.sig'), '--clobber'); } catch {}
    console.log(`${yml} (versión ${version}) firmado y subido`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
} else {
  console.log('Uso: node herramientas/firmar.mjs web | comprobar | app');
  process.exit(1);
}
