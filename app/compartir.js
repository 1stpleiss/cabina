// Aviso flotante mientras se comparte la pantalla: encima de todo y en todos los escritorios, para saberlo aunque
// Cabina esté detrás (trabajando en el DAW), con un botón para dejar de compartir. La web lo enciende y lo apaga
// (CABINA_APP.sharing); el botón le pide a la web que deje de compartir (share:stop).
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let getWin = () => null;
let pill = null;

function show(){
  if (pill && !pill.isDestroyed()) return;
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const w = 300, h = 52;
  pill = new BrowserWindow({
    width: w, height: h, x: Math.round(d.workArea.x + (d.workArea.width - w) / 2), y: d.workArea.y + 12,
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false,
    acceptFirstMouse: true, // un clic basta aunque Cabina no esté delante
    webPreferences: { preload: path.join(__dirname, 'compartir-preload.js') },
  });
  pill.setAlwaysOnTop(true, 'screen-saver');
  pill.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pill.loadFile(path.join(__dirname, 'compartir.html'));
  pill.once('ready-to-show', () => pill && !pill.isDestroyed() && pill.showInactive());
}
function hide(){ if (pill && !pill.isDestroyed()) pill.close(); pill = null; }

function setup(win){
  getWin = win;
  const fromApp = e => { const w = getWin(); return w && !w.isDestroyed() && e.sender === w.webContents; };
  ipcMain.on('share:state', (e, on) => { if (fromApp(e)) (on ? show() : hide()); });
  ipcMain.on('share:parar', e => {
    if (!pill || pill.isDestroyed() || e.sender !== pill.webContents) return;
    const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('share:stop');
  });
  // Si la página se recarga o se cierra mientras se comparte, el aviso no se queda colgado
  const w = getWin();
  if (w) { w.webContents.on('did-start-navigation', (ev, url, inPlace, isMain) => { if (isMain && !inPlace) hide(); }); w.on('closed', hide); }
}

module.exports = { setup };
