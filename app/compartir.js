// Aviso flotante mientras se comparte la pantalla: encima de todo y en todos los escritorios, para saberlo aunque
// Cabina esté detrás (trabajando en el DAW). Es el mismo aviso que el de la web (que en la app no se muestra), con la
// casilla del audio del sistema y "Dejar de compartir". Se arrastra por la pantalla (se recuerda dónde) y la flecha
// lo esconde deslizándolo hacia el borde más cercano, donde queda una pestañita que lo trae de vuelta.
// La web lo enciende y lo apaga (CABINA_APP.sharing); sus botones se los pasa a la web (share:stop y el evento
// cabina-share-audio).
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const PAD = 14;                 // margen transparente para la sombra (compartir.html)
const TAB_W = 46, TAB_H = 34;   // la pestañita
const POS = () => path.join(app.getPath('userData'), 'aviso.json');

let getWin = () => null;
let pill = null, shown = false, mode = 'full', full = null, anim = null, busy = false, info = { audio: false, warn: '' };

const loadPos = () => { try { const p = JSON.parse(fs.readFileSync(POS(), 'utf8')); return Number.isFinite(p.cx) && Number.isFinite(p.y) ? p : null; } catch { return null; } };
const savePos = b => { try { fs.writeFileSync(POS(), JSON.stringify({ cx: Math.round(b.x + b.width / 2), y: b.y })); } catch {} };
const areaOf = b => screen.getDisplayMatching(b).workArea;
// Que no se salga de la pantalla en la que está
const inside = b => {
  const wa = areaOf(b);
  return { ...b, x: Math.max(wa.x, Math.min(b.x, wa.x + wa.width - b.width)), y: Math.max(wa.y, Math.min(b.y, wa.y + wa.height - b.height)) };
};
const toLeft = b => { const wa = areaOf(b); return b.x + b.width / 2 < wa.x + wa.width / 2; };
const alive = () => pill && !pill.isDestroyed();
const sendState = () => { if (alive()) pill.webContents.send('hud:state', { ...info, toLeft: full ? toLeft(full) : false }); };

// Desliza la ventana en horizontal hasta x (suavizado), y después done
function slide(toX, ms, easeIn, done){
  clearInterval(anim);
  const b = pill.getBounds(), from = b.x, t0 = Date.now();
  anim = setInterval(() => {
    if (!alive()) { clearInterval(anim); anim = null; return; }
    const k = Math.min(1, (Date.now() - t0) / ms), e = easeIn ? k * k * k : 1 - Math.pow(1 - k, 3);
    pill.setPosition(Math.round(from + (toX - from) * e), b.y);
    if (k >= 1) { clearInterval(anim); anim = null; done && done(); }
  }, 16);
}

function show(){
  if (alive()) return sendState();
  shown = false; mode = 'full'; full = null;
  pill = new BrowserWindow({
    width: 560, height: 72, show: false,
    frame: false, transparent: true, resizable: false, movable: true, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
    acceptFirstMouse: true, // un clic basta aunque Cabina no esté delante
    webPreferences: { preload: path.join(__dirname, 'compartir-preload.js') },
  });
  pill.setAlwaysOnTop(true, 'screen-saver');
  pill.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pill.webContents.on('will-navigate', e => e.preventDefault());
  pill.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  pill.webContents.on('did-finish-load', sendState);
  // Al soltarlo tras arrastrarlo: se guarda dónde
  pill.on('moved', () => { if (alive() && mode === 'full' && !busy) { full = pill.getBounds(); savePos(full); sendState(); } });
  pill.loadFile(path.join(__dirname, 'compartir.html'));
}
function hide(){ clearInterval(anim); anim = null; busy = false; if (alive()) pill.close(); pill = null; }

// La página dice cuánto mide el aviso: la primera vez se coloca y se muestra; después se ajusta sin moverse del centro
function size(w, h){
  if (!alive() || !Number.isFinite(w) || !Number.isFinite(h)) return;
  w = Math.round(Math.max(120, Math.min(w, 1000))); h = Math.round(Math.max(40, Math.min(h, 200)));
  if (!shown) {
    const p = loadPos(), cur = screen.getCursorScreenPoint();
    const d = p ? screen.getDisplayNearestPoint({ x: p.cx, y: p.y }) : screen.getDisplayNearestPoint(cur);
    const b = inside({ x: Math.round((p ? p.cx : d.workArea.x + d.workArea.width / 2) - w / 2), y: p ? p.y : d.workArea.y + 4, width: w, height: h });
    pill.setBounds(b); full = b; shown = true;
    pill.showInactive(); sendState();
    return;
  }
  const base = full || pill.getBounds();
  full = inside({ x: Math.round(base.x + base.width / 2 - w / 2), y: base.y, width: w, height: h });
  if (mode === 'full' && !busy) pill.setBounds(full);
}

// Esconder: el aviso sale por el borde más cercano y entra la pestañita a su altura
function esconder(){
  if (!alive() || mode !== 'full' || busy) return;
  busy = true; full = pill.getBounds();
  const wa = areaOf(full), left = toLeft(full);
  slide(left ? wa.x - full.width : wa.x + wa.width, 220, true, () => {
    mode = left ? 'l' : 'r';
    pill.webContents.send('hud:mode', mode);
    const w = TAB_W + PAD, h = TAB_H + 2 * PAD, y = Math.round(full.y + full.height / 2 - h / 2);
    pill.setBounds({ x: left ? wa.x - w : wa.x + wa.width, y, width: w, height: h });
    setTimeout(() => alive() && slide(left ? wa.x : wa.x + wa.width - w, 280, false, () => { busy = false; }), 60);
  });
}
// Mostrar: la pestañita se va y vuelve a entrar el aviso donde estaba
function mostrar(){
  if (!alive() || mode === 'full' || busy) return;
  busy = true;
  const b = pill.getBounds(), wa = areaOf(b), left = mode === 'l';
  slide(left ? wa.x - b.width : wa.x + wa.width, 160, true, () => {
    mode = 'full';
    pill.webContents.send('hud:mode', 'full');
    const to = inside(full);
    pill.setBounds({ ...to, x: left ? wa.x - to.width : wa.x + wa.width });
    setTimeout(() => alive() && slide(to.x, 320, false, () => { full = pill.getBounds(); busy = false; }), 60);
  });
}

function setup(win){
  getWin = win;
  const fromApp = e => { const w = getWin(); return w && !w.isDestroyed() && e.sender === w.webContents; };
  const fromPill = e => alive() && e.sender === pill.webContents;
  const toApp = (ch, ...a) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, ...a); };
  ipcMain.on('share:state', (e, on, st) => {
    if (!fromApp(e)) return;
    info = { audio: !!(st && st.audio), warn: String((st && st.warn) || '').slice(0, 200) };
    on ? show() : hide();
  });
  ipcMain.on('share:parar', e => { if (fromPill(e)) toApp('share:stop'); });
  // La casilla del audio vuelve a abrir el selector de pantalla, y eso el navegador solo lo deja tras un clic en la
  // página: se le pasa como evento con el gesto del usuario (el código es fijo; solo cambia true/false)
  ipcMain.on('share:audio', (e, on) => {
    if (!fromPill(e)) return;
    const w = getWin(); if (!w || w.isDestroyed()) return;
    w.webContents.executeJavaScript(`dispatchEvent(new CustomEvent('cabina-share-audio', { detail: ${on ? 'true' : 'false'} }))`, true).catch(() => {});
  });
  ipcMain.on('hud:size', (e, w, h) => { if (fromPill(e)) size(+w, +h); });
  ipcMain.on('hud:esconder', e => { if (fromPill(e)) esconder(); });
  ipcMain.on('hud:mostrar', e => { if (fromPill(e)) mostrar(); });
  // Si la página se recarga o se cierra mientras se comparte, el aviso no se queda colgado
  const w = getWin();
  if (w) { w.webContents.on('did-start-navigation', (ev, url, inPlace, isMain) => { if (isMain && !inPlace) hide(); }); w.on('closed', hide); }
}

module.exports = { setup };
