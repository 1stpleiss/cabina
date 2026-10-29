// Actualizaciones de la app (solo de la app: los cambios de la web llegan solos al abrirla).
// Cada compilación publica en la release "app" la versión nueva y un latest.yml / latest-mac.yml
// con su número y su huella. La app los mira al abrirse y cada pocas horas, descarga en segundo plano
// y pregunta si reiniciar ya o al cerrar.
// Solo se aceptan versiones firmadas con la llave propia (herramientas/firmar.mjs app sube latest*.yml.sig):
// sin firma válida no se descarga nada, así que quien entrara en la cuenta de GitHub no podría colar una
// versión. Nada se instala sin que se pida (Reiniciar ahora / Al cerrar Cabina).
//  - Windows: electron-updater (instalador NSIS en silencio), y antes de instalar se comprueba que el
//    instalador descargado tiene la huella del latest.yml firmado.
//  - Mac: a mano, porque el actualizador de Electron en Mac exige firma de Apple. Se descarga el .zip,
//    se comprueba la huella del latest-mac.yml firmado, se descomprime y un script cambia Cabina.app por la nueva.
const { app, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { execFile, spawn } = require('child_process');
const firma = require('./firma');

// Cambiar el origen de las actualizaciones con CABINA_FEED solo vale en desarrollo
const FEED = (!app.isPackaged && process.env.CABINA_FEED) || 'https://github.com/1stpleiss/cabina/releases/download/app/';
const EVERY = 6 * 60 * 60 * 1000;

let getWin = () => null;
let state = 'idle';        // idle · checking · downloading · ready
let pending = null;        // Mac: { app: ruta de la Cabina.app nueva, version }
let asked = false;
let onQuit = false;        // "Al cerrar Cabina": instalar al salir
let expected = null;       // Windows: { version, sha512 } del latest.yml firmado

// Lee latest.yml o latest-mac.yml y su firma. Sin firma válida, no hay actualización.
async function signedYml(name){
  const [y, s] = await Promise.all([name, name + '.sig'].map(f => net.fetch(FEED + f + '?t=' + Date.now(), { cache: 'no-store' })));
  if (!y.ok) throw new Error(name + ': ' + y.status);
  if (!s.ok) throw new Error(name + ' sin firmar todavía');
  const text = await y.text();
  if (!firma.valida(text, await s.text())) throw new Error(name + ': la firma no es válida');
  return text;
}

const newer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

function tell(title, detail){
  const w = getWin();
  return dialog.showMessageBox(w, { type: 'info', message: title, detail, buttons: ['Vale'] });
}

async function offer(version){
  if (asked) return;
  asked = true;
  const w = getWin();
  const { response } = await dialog.showMessageBox(w, {
    type: 'info',
    message: `Hay una versión nueva de Cabina (${version})`,
    detail: 'Ya está descargada. Si estás en una sala, puedes dejarlo para cuando cierres la app.',
    buttons: ['Reiniciar ahora', 'Al cerrar Cabina'], defaultId: 0, cancelId: 1,
  });
  if (response === 0) install(true);
  else { onQuit = true; if (winUpdater) winUpdater.autoInstallOnAppQuit = true; }
}

// ---------- Windows ----------
let winUpdater = null;
function windows(){
  winUpdater = require('electron-updater').autoUpdater;
  winUpdater.setFeedURL({ provider: 'generic', url: FEED });
  winUpdater.autoDownload = true;
  winUpdater.autoInstallOnAppQuit = false; // solo si se elige "Al cerrar Cabina" (offer)
  winUpdater.on('update-downloaded', info => {
    // El instalador descargado tiene que ser el del latest.yml firmado
    let ok = false;
    try {
      ok = !!expected && info.version === expected.version
        && firma.huella(fs.readFileSync(info.downloadedFile), 'sha512') === expected.sha512;
    } catch {}
    if (!ok) {
      console.error('[actualizar] el instalador descargado no es el firmado: no se instala');
      try { fs.rmSync(info.downloadedFile, { force: true }); } catch {}
      state = 'idle'; return;
    }
    state = 'ready'; offer(info.version);
  });
  winUpdater.on('error', e => { console.error('[actualizar]', e && e.message); if (state !== 'ready') state = 'idle'; });
}

// ---------- Mac ----------
// Dónde está la app instalada. Si se abre desde el .dmg o desde Descargas sin moverla, macOS la ejecuta
// desde una carpeta de solo lectura y no se puede sustituir: en ese caso no se actualiza.
function bundle(){
  const b = path.resolve(process.execPath, '../../..');
  if (!b.endsWith('.app') || b.startsWith('/Volumes/') || b.includes('/AppTranslocation/')) return null;
  try { fs.accessSync(path.dirname(b), fs.constants.W_OK); return b; } catch { return null; }
}

async function macCheck(){
  const yml = await signedYml('latest-mac.yml');
  const version = (yml.match(/^version:\s*'?([\d.]+)/m) || [])[1];
  const file = yml.match(/-\s*url:\s*(\S+\.zip)\s*\n\s*sha512:\s*(\S+)/);
  if (!version || !file) throw new Error('latest-mac.yml sin versión o sin .zip');
  if (!newer(version, app.getVersion())) return false;
  if (pending && pending.version === version) return true;

  const dir = path.join(app.getPath('temp'), 'cabina-actualizacion');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, 'Cabina.zip');
  state = 'downloading';
  const dl = await net.fetch(FEED + file[1], { cache: 'no-store' });
  if (!dl.ok) throw new Error(file[1] + ': ' + dl.status);
  const hash = crypto.createHash('sha512');
  const body = Readable.fromWeb(dl.body);
  body.on('data', c => hash.update(c));
  await pipeline(body, fs.createWriteStream(zip));
  if (hash.digest('base64') !== file[2]) throw new Error('la huella del .zip no coincide');

  await new Promise((ok, ko) => execFile('/usr/bin/ditto', ['-x', '-k', zip, dir], e => e ? ko(e) : ok()));
  fs.rmSync(zip, { force: true });
  const found = fs.readdirSync(dir).find(f => f.endsWith('.app'));
  if (!found) throw new Error('el .zip no trae la app');
  pending = { app: path.join(dir, found), version };
  return true;
}

// Cambia la app al cerrar: espera a que este proceso termine, aparta la vieja, pone la nueva y, si
// se pide, la vuelve a abrir. Si algo falla, deja la vieja donde estaba.
function macSwap(relaunch){
  const old = bundle();
  if (!pending || !old) return;
  const q = s => "'" + s.replace(/'/g, "'\\''") + "'";
  const script = [
    `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done`,
    `rm -rf ${q(old + '.vieja')}`,
    `mv ${q(old)} ${q(old + '.vieja')} || exit 1`,
    `if mv ${q(pending.app)} ${q(old)}; then rm -rf ${q(old + '.vieja')}; else mv ${q(old + '.vieja')} ${q(old)}; fi`,
    relaunch ? `open ${q(old)}` : '',
  ].join('\n');
  spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref();
  pending = null;
}

// ---------- Común ----------
async function check(manual){
  if (state === 'checking' || state === 'downloading') {
    if (manual) tell('Ya se está buscando o descargando una versión nueva.');
    return;
  }
  if (state === 'ready') { asked = false; return offer(pending ? pending.version : 'nueva'); }
  if (process.platform === 'darwin' && !bundle()) {
    if (manual) tell('Mueve Cabina a la carpeta Aplicaciones para que pueda actualizarse sola.',
      'Ahora se está abriendo desde el disco de instalación o desde Descargas.');
    return;
  }
  state = 'checking';
  try {
    if (process.platform === 'darwin') {
      if (await macCheck()) { state = 'ready'; offer(pending.version); }
      else { state = 'idle'; if (manual) tell('Cabina está al día', 'Versión ' + app.getVersion()); }
    } else {
      const yml = await signedYml('latest.yml');
      const version = (yml.match(/^version:\s*'?([\d.]+)/m) || [])[1];
      const file = yml.match(/-\s*url:\s*(\S+\.exe)\s*\n\s*sha512:\s*(\S+)/);
      if (!version || !file) throw new Error('latest.yml sin versión o sin instalador');
      expected = { version, sha512: file[2] };
      const r = await winUpdater.checkForUpdates();
      const v = r && r.updateInfo && r.updateInfo.version;
      if (v && newer(v, app.getVersion())) state = 'downloading';
      else { state = 'idle'; if (manual) tell('Cabina está al día', 'Versión ' + app.getVersion()); }
    }
  } catch (e) {
    console.error('[actualizar]', e && e.message);
    state = 'idle';
    if (manual) tell('No se ha podido buscar actualizaciones', String(e && e.message || e));
  }
}

function install(relaunch){
  if (state !== 'ready') return;
  if (process.platform === 'darwin') { macSwap(relaunch); if (relaunch) app.quit(); }
  else winUpdater.quitAndInstall(true, relaunch);
}

function start(win){
  getWin = win;
  if (!app.isPackaged || !['darwin', 'win32'].includes(process.platform)) return;
  if (process.platform === 'win32') windows();
  // Si se eligió "Al cerrar Cabina", en Mac se cambia al salir sin volver a abrir (en Windows lo hace electron-updater)
  if (process.platform === 'darwin') app.on('will-quit', () => { if (pending && onQuit) macSwap(false); });
  setTimeout(() => check(false), 10e3);
  setInterval(() => check(false), EVERY);
}

module.exports = { start, check };
