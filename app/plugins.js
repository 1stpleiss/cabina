// Los plugins (Cabina Send y Cabina Retorno) al día desde la app. Cada compilación de los plugins publica en la
// release "plugins" un plugins.yml con su versión y la huella de cada paquete, que quien publica firma en su Mac
// (herramientas/firmar.mjs plugins). La app lo mira al abrirse y cada 6 horas y, si hay versión nueva y la firma y
// la huella cuadran, la instala. Solo si ya hay plugins instalados (a quien solo escucha no se le instala nada);
// la primera instalación, desde el menú.
//  - Mac: en la carpeta del usuario (~/Library/Audio/Plug-Ins), sin contraseña. Si hay una copia del instalador
//    (.pkg) en la del sistema (/Library/Audio/Plug-Ins), se pide permiso una vez para quitarla: si no, el DAW
//    vería los plugins repetidos.
//  - Windows: con el instalador, que necesita permiso de administrador (Windows lo pide) y el DAW cerrado.
// El DAW usa los plugins nuevos al volver a abrirlo.
const { app, dialog, net, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const firma = require('./firma');

// En desarrollo (npm start) se pueden cambiar el origen y las carpetas para probar sin tocar los plugins de verdad
const dev = name => !app.isPackaged && process.env[name];
const FEED = dev('CABINA_PLUGINS_FEED') || 'https://github.com/1stpleiss/cabina/releases/download/plugins/';
const EVERY = 6 * 60 * 60 * 1000;
const NAMES = ['Cabina Send', 'Cabina Retorno'];
const MAC_USER = dev('CABINA_PLUGINS_USER') || path.join(os.homedir(), 'Library', 'Audio', 'Plug-Ins');
const MAC_SYS = dev('CABINA_PLUGINS_SYS') || '/Library/Audio/Plug-Ins';
const WIN_VST3 = path.join(process.env.CommonProgramFiles || 'C:\\Program Files\\Common Files', 'VST3');

let getWin = () => null;
let busy = false;

const STATE = () => path.join(app.getPath('userData'), 'plugins.json');
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')); } catch { return {}; } };
const writeState = st => { try { fs.writeFileSync(STATE(), JSON.stringify(st)); } catch {} };
const newer = (a, b) => {
  const x = a.split('.').map(Number), y = (b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
const fetchFeed = url => net.fetch(url, { cache: 'no-store', bypassCustomProtocolHandlers: true });
const box = opts => dialog.showMessageBox(getWin(), { type: 'info', ...opts });
const run = (cmd, args) => new Promise((ok, ko) => execFile(cmd, args, e => e ? ko(e) : ok()));

// Bundles de los plugins en una carpeta de plugins (VST3 y, en Mac, AU)
const bundles = base => process.platform === 'darwin'
  ? NAMES.flatMap(n => [path.join(base, 'VST3', n + '.vst3'), path.join(base, 'Components', n + '.component')])
  : NAMES.map(n => path.join(base, n + '.vst3'));
const present = list => list.filter(p => fs.existsSync(p));
const installed = () => process.platform === 'darwin'
  ? present([...bundles(MAC_USER), ...bundles(MAC_SYS)]).length > 0
  : present(bundles(WIN_VST3)).length > 0;

// plugins.yml con su firma. Sin firma válida, nada.
async function signedInfo(){
  const [y, s] = await Promise.all(['plugins.yml', 'plugins.yml.sig'].map(f => fetchFeed(FEED + f + '?t=' + Date.now())));
  if (!y.ok) throw new Error('plugins.yml: ' + y.status);
  if (!s.ok) throw new Error('plugins.yml sin firmar todavía');
  const text = await y.text();
  if (!firma.valida(text, await s.text())) throw new Error('plugins.yml: la firma no es válida');
  const version = (text.match(/^version:\s*'?([\d.]+)/m) || [])[1];
  const files = Object.fromEntries([...text.matchAll(/-\s*url:\s*(\S+)\s*\n\s*sha512:\s*(\S+)/g)].map(m => [m[1], m[2]]));
  if (!version) throw new Error('plugins.yml sin versión');
  return { version, files };
}

// Descarga un paquete y comprueba su huella con la del plugins.yml firmado
async function download(name, sha512){
  if (!sha512) throw new Error(name + ' no está en plugins.yml');
  const r = await fetchFeed(FEED + name);
  if (!r.ok) throw new Error(name + ': ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (firma.huella(buf, 'sha512') !== sha512) throw new Error(name + ': la huella no coincide');
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'cabina-plugins-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return { dir, file };
}

function notify(body){
  if (Notification.isSupported()) new Notification({ title: 'Plugins de Cabina', body }).show();
}

// ---------- Mac ----------
// Quita las copias del instalador en la carpeta del sistema (pide la contraseña de administrador)
async function removeSystemCopies(list){
  const sh = list.map(p => "'" + p.replace(/'/g, "'\\''") + "'").join(' ');
  const script = `rm -rf ${sh}; pkgutil --forget com.cabina.plugins >/dev/null 2>&1; true`;
  const as = `do shell script "${script.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges with prompt "Cabina quiere quitar los plugins que instaló el instalador para mantenerlos al día por su cuenta."`;
  await run('/usr/bin/osascript', ['-e', as]);
}

async function installMac(info, manual){
  const sys = present(bundles(MAC_SYS));
  if (sys.length) {
    const st = readState();
    if (!manual && st.declined && Date.now() - st.declined < 7 * 864e5) return false;
    const { response } = await box({
      message: `Hay plugins nuevos de Cabina (${info.version})`,
      detail: 'Para que Cabina los mantenga al día por su cuenta, los instalará en tu carpeta de usuario. Antes hay que quitar los que puso el instalador; macOS te pedirá la contraseña (solo esta vez).',
      buttons: ['Actualizar', 'Ahora no'], defaultId: 0, cancelId: 1,
    });
    if (response !== 0) { writeState({ ...st, declined: Date.now() }); return false; }
    try { await removeSystemCopies(sys); }
    catch { if (manual) box({ message: 'No se han actualizado los plugins', detail: 'Hace falta la contraseña para quitar la copia del instalador.' }); return false; }
  }
  const { dir, file } = await download('Cabina-Mac.zip', info.files['Cabina-Mac.zip']);
  try {
    const out = path.join(dir, 'x');
    await run('/usr/bin/ditto', ['-x', '-k', file, out]);
    for (const n of NAMES) for (const [ext, sub] of [['.vst3', 'VST3'], ['.component', 'Components']]) {
      const src = path.join(out, n + ext); if (!fs.existsSync(src)) continue;
      const dest = path.join(MAC_USER, sub, n + ext);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // Se aparta el viejo y se pone el nuevo; si algo falla, vuelve el viejo
      const old = dest + '.vieja';
      fs.rmSync(old, { recursive: true, force: true });
      if (fs.existsSync(dest)) fs.renameSync(dest, old);
      try { fs.renameSync(src, dest); fs.rmSync(old, { recursive: true, force: true }); }
      catch (e) { if (fs.existsSync(old)) fs.renameSync(old, dest); throw e; }
    }
    // Que el DAW vea el AU nuevo
    spawn('/usr/bin/killall', ['-9', 'AudioComponentRegistrar'], { stdio: 'ignore' }).on('error', () => {});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return true;
}

// ---------- Windows ----------
async function installWin(info, manual){
  const st = readState();
  if (!manual && st.declined && Date.now() - st.declined < 864e5) return false;
  const { response } = await box({
    message: `Hay plugins nuevos de Cabina (${info.version})`,
    detail: 'Cierra tu DAW y pulsa Instalar. Windows te pedirá permiso para instalarlos.',
    buttons: ['Instalar', 'Más tarde'], defaultId: 0, cancelId: 1,
  });
  if (response !== 0) { writeState({ ...st, declined: Date.now() }); return false; }
  const { dir, file } = await download('Cabina-Windows.exe', info.files['Cabina-Windows.exe']);
  try {
    // El instalador, en silencio y como administrador (Windows lo pide); sin cerrar programas por su cuenta
    const ps = `$p = Start-Process -FilePath '${file.replace(/'/g, "''")}' -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOCLOSEAPPLICATIONS' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  } catch {
    box({ message: 'No se han instalado los plugins', detail: 'Comprueba que el DAW está cerrado y que has dado permiso, y vuelve a intentarlo desde el menú Cabina.' });
    return false;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return true;
}

// ---------- Común ----------
async function check(manual){
  if (busy || !['darwin', 'win32'].includes(process.platform)) return;
  busy = true;
  try {
    const info = await signedInfo();
    const st = readState(), had = installed();
    if (!had && !manual) return;
    if (had && st.version && !newer(info.version, st.version)) {
      if (manual) box({ message: 'Los plugins de Cabina están al día', detail: 'Versión ' + st.version });
      return;
    }
    const done = process.platform === 'darwin' ? await installMac(info, manual) : await installWin(info, manual);
    if (!done) return;
    writeState({ version: info.version });
    const msg = `Plugins actualizados a la versión ${info.version}. Vuelve a abrir el DAW (o vuelve a escanear los plugins) para usarlos.`;
    if (manual) box({ message: had ? 'Plugins de Cabina actualizados' : 'Plugins de Cabina instalados', detail: msg }); else notify(msg);
  } catch (e) {
    console.error('[plugins]', e && e.message);
    if (manual) box({ type: 'warning', message: 'No se han podido actualizar los plugins', detail: String(e && e.message || e) });
  } finally { busy = false; }
}

function start(win){
  getWin = win;
  if (!app.isPackaged) return;
  setTimeout(() => check(false), 20e3);
  setInterval(() => check(false), EVERY);
}

module.exports = { start, check };
