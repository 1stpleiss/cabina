// Actualizaciones de la app (solo de la app: los cambios de la web llegan solos al abrirla).
// Cada compilación publica en la release "app" la versión nueva y un latest.yml / latest-mac.yml
// con su número y su huella. La app los mira al abrirse y cada pocas horas, descarga en segundo plano
// y pregunta si reiniciar ya o al cerrar.
//  - Windows: electron-updater (instalador NSIS en silencio).
//  - Mac: a mano, porque el actualizador de Electron en Mac exige firma de Apple. Se descarga el .zip,
//    se comprueba la huella, se descomprime y, al cerrar, un script cambia Cabina.app por la nueva.
const { app, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { execFile, spawn } = require('child_process');

const FEED = process.env.CABINA_FEED || 'https://github.com/1stpleiss/cabina/releases/download/app/';
const EVERY = 6 * 60 * 60 * 1000;

let getWin = () => null;
let state = 'idle';        // idle · checking · downloading · ready
let pending = null;        // Mac: { app: ruta de la Cabina.app nueva, version }
let asked = false;

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
}

// ---------- Windows ----------
let winUpdater = null;
function windows(){
  winUpdater = require('electron-updater').autoUpdater;
  winUpdater.setFeedURL({ provider: 'generic', url: FEED });
  winUpdater.autoDownload = true;
  winUpdater.autoInstallOnAppQuit = true;
  winUpdater.on('update-downloaded', info => { state = 'ready'; offer(info.version); });
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
  const res = await net.fetch(FEED + 'latest-mac.yml', { cache: 'no-store' });
  if (!res.ok) throw new Error('latest-mac.yml: ' + res.status);
  const yml = await res.text();
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
    `xattr -dr com.apple.quarantine ${q(old)} 2>/dev/null`,
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
  // Al cerrar con una versión descargada en Mac, se cambia sin volver a abrir (en Windows lo hace electron-updater)
  if (process.platform === 'darwin') app.on('will-quit', () => { if (pending) macSwap(false); });
  setTimeout(() => check(false), 10e3);
  setInterval(() => check(false), EVERY);
}

module.exports = { start, check };
