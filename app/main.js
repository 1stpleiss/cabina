// Cabina como app de escritorio (Electron). Carga la web publicada, así que los cambios de la web llegan
// sin reinstalar la app. Lleva Chrome dentro, que es donde Cabina está probada, y evita los límites del
// navegador: Safari no puede hablar con los plugins, y Chrome frena las pestañas en segundo plano.
const { app, BrowserWindow, Menu, session, shell, desktopCapturer, ipcMain } = require('electron');
const path = require('path');
const updater = require('./updater');

const WEB = process.env.CABINA_WEB || 'https://1stpleiss.github.io/cabina/';
const ORIGIN = new URL(WEB).origin;
const ours = url => { try { return new URL(url).origin === ORIGIN || url.startsWith('file://'); } catch { return false; } };

// Que el audio pueda sonar sin esperar a un clic (lo que llega de los demás, el hitmarker...)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow(){
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    title: 'Cabina', backgroundColor: '#0d0e10', show: false,
    // Sin barra de título: los botones de la ventana van dentro de la cabecera de Cabina (la web deja
    // el hueco y marca por dónde se arrastra; ver .app en web/index.html)
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarOverlay: { color: '#0d0e10', symbolColor: '#ebe8e3', height: 46 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Sin esto, con la ventana tapada o minimizada se ralentiza la página y el audio da cortes
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // En pantalla completa de Mac no hay semáforo: la web quita el hueco que le deja
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));

  // Enlaces externos (descargas de los plugins, créditos...) al navegador; Cabina se queda en la app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (ours(url)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });

  // Sin internet: página propia con botón para reintentar
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'), { query: { web: WEB } });
  });

  win.loadURL(WEB);
}

// Permisos (micro, cámara, salida de audio, hablar con los plugins en 127.0.0.1...): solo para Cabina
function permissions(){
  const s = session.defaultSession;
  s.setPermissionRequestHandler((wc, perm, cb, details) => cb(ours(details.requestingUrl || wc.getURL())));
  s.setPermissionCheckHandler((wc, perm, origin) => ours(origin || (wc && wc.getURL()) || ''));

  // Compartir pantalla: ventana para elegir pantalla o ventana (el DAW)
  s.setDisplayMediaRequestHandler(async (req, cb) => {
    const id = await pickSource();
    const src = id && (await desktopCapturer.getSources({ types: ['screen', 'window'] })).find(x => x.id === id);
    // Al cancelar, Electron rechaza la petición (la web recibe un AbortError) y además lanza aquí
    try { src ? cb({ video: src }) : cb({}); } catch {}
  });
}

let picking = null;
async function pickSource(){
  if (picking) return null;
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
  const list = sources
    .filter(x => x.name && !/^Cabina$/.test(x.name))
    .map(x => ({ id: x.id, name: x.name, screen: x.id.startsWith('screen:'), thumb: x.thumbnail.toDataURL() }));
  picking = new BrowserWindow({
    parent: win, modal: true, width: 820, height: 560, resizable: false, minimizable: false,
    title: 'Compartir pantalla', backgroundColor: '#0d0e10', show: false,
    webPreferences: { preload: path.join(__dirname, 'picker-preload.js') },
  });
  const w = picking;
  w.once('ready-to-show', () => w.show());
  return new Promise(resolve => {
    const done = id => { ipcMain.removeHandler('picker:sources'); ipcMain.removeAllListeners('picker:choice'); picking = null; resolve(id); };
    ipcMain.handle('picker:sources', () => list);
    ipcMain.once('picker:choice', (e, id) => { done(list.some(x => x.id === id) ? id : null); w.close(); });
    w.on('closed', () => { if (picking === w) done(null); });
    w.loadFile(path.join(__dirname, 'picker.html'));
  });
}

function menu(){
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ label: 'Cabina', submenu: [
      { role: 'about', label: 'Acerca de Cabina' },
      { label: 'Buscar actualizaciones…', click: () => updater.check(true) },
      { type: 'separator' },
      { role: 'hide', label: 'Ocultar Cabina' }, { role: 'hideOthers', label: 'Ocultar otros' }, { role: 'unhide', label: 'Mostrar todo' },
      { type: 'separator' },
      { role: 'quit', label: 'Salir de Cabina' },
    ] }] : [{ label: 'Cabina', submenu: [
      { label: 'Buscar actualizaciones…', click: () => updater.check(true) },
      { type: 'separator' },
      { role: 'quit', label: 'Salir' },
    ] }]),
    { role: 'editMenu' },
    { label: 'Ver', submenu: [
      { label: 'Volver a cargar', accelerator: 'CmdOrCtrl+R', click: () => win && win.loadURL(WEB) },
      { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Tamaño real' }, { role: 'zoomIn', label: 'Ampliar' }, { role: 'zoomOut', label: 'Reducir' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Pantalla completa' },
    ] },
    { role: 'windowMenu' },
  ]));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => { permissions(); menu(); createWindow(); updater.start(() => win); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
app.on('window-all-closed', () => app.quit());
