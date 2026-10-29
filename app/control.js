// Control remoto: otro participante mueve tu ratón y escribe en tu ordenador mientras compartes la pantalla
// entera. La web de quien mira manda lo que hace sobre tu pantalla (posición de 0 a 1, botones, rueda y
// teclas por su posición física, `KeyboardEvent.code`); la web de quien comparte se lo pasa a la app y la
// app lo hace con un pequeño programa por sistema (helper/mac.swift, helper/win.cs), que solo está abierto
// mientras dura el control.
// Siempre lo decide quien comparte: la app pregunta cada vez, y mientras dura hay un aviso flotante encima
// de todo con "Quitar control". Se corta también al dejar de compartir o al salir de la sala.
const { app, BrowserWindow, dialog, ipcMain, screen, shell, systemPreferences } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Código físico de la tecla (KeyboardEvent.code) → código de tecla de Mac y tecla virtual de Windows
const MAC = {
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7, KeyC: 8, KeyV: 9, IntlBackslash: 10, KeyB: 11,
  KeyQ: 12, KeyW: 13, KeyE: 14, KeyR: 15, KeyY: 16, KeyT: 17, Digit1: 18, Digit2: 19, Digit3: 20, Digit4: 21, Digit6: 22,
  Digit5: 23, Equal: 24, Digit9: 25, Digit7: 26, Minus: 27, Digit8: 28, Digit0: 29, BracketRight: 30, KeyO: 31, KeyU: 32,
  BracketLeft: 33, KeyI: 34, KeyP: 35, Enter: 36, KeyL: 37, KeyJ: 38, Quote: 39, KeyK: 40, Semicolon: 41, Backslash: 42,
  Comma: 43, Slash: 44, KeyN: 45, KeyM: 46, Period: 47, Tab: 48, Space: 49, Backquote: 50, Backspace: 51, Escape: 53,
  MetaRight: 54, MetaLeft: 55, ShiftLeft: 56, CapsLock: 57, AltLeft: 58, ControlLeft: 59, ShiftRight: 60, AltRight: 61,
  ControlRight: 62, NumpadDecimal: 65, NumpadMultiply: 67, NumpadAdd: 69, NumLock: 71, NumpadDivide: 75, NumpadEnter: 76,
  NumpadSubtract: 78, NumpadEqual: 81, Numpad0: 82, Numpad1: 83, Numpad2: 84, Numpad3: 85, Numpad4: 86, Numpad5: 87,
  Numpad6: 88, Numpad7: 89, Numpad8: 91, Numpad9: 92, F5: 96, F6: 97, F7: 98, F3: 99, F8: 100, F9: 101, F11: 103,
  F10: 109, F12: 111, Home: 115, PageUp: 116, Delete: 117, F4: 118, End: 119, F2: 120, PageDown: 121, F1: 122,
  ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126,
};
const WIN = {
  Backspace: 0x08, Tab: 0x09, Enter: 0x0D, NumpadEnter: 0x0D, ShiftLeft: 0xA0, ShiftRight: 0xA1, ControlLeft: 0xA2,
  ControlRight: 0xA3, AltLeft: 0xA4, AltRight: 0xA5, CapsLock: 0x14, Escape: 0x1B, Space: 0x20, PageUp: 0x21,
  PageDown: 0x22, End: 0x23, Home: 0x24, ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
  Insert: 0x2D, Delete: 0x2E, MetaLeft: 0x5B, MetaRight: 0x5C, NumpadMultiply: 0x6A, NumpadAdd: 0x6B,
  NumpadSubtract: 0x6D, NumpadDecimal: 0x6E, NumpadDivide: 0x6F, NumLock: 0x90, Semicolon: 0xBA, Equal: 0xBB,
  Comma: 0xBC, Minus: 0xBD, Period: 0xBE, Slash: 0xBF, Backquote: 0xC0, BracketLeft: 0xDB, Backslash: 0xDC,
  BracketRight: 0xDD, Quote: 0xDE, IntlBackslash: 0xE2,
};
for (let i = 0; i < 26; i++) WIN['Key' + String.fromCharCode(65 + i)] = 0x41 + i;
for (let i = 0; i < 10; i++) { WIN['Digit' + i] = 0x30 + i; WIN['Numpad' + i] = 0x60 + i; }
for (let i = 1; i <= 12; i++) WIN['F' + i] = 0x6F + i;
const MODS = /^(Shift|Control|Alt|Meta)(Left|Right)$|^CapsLock$/;

let getWin = () => null;
let lastDisplayId = null; // pantalla elegida en la ventana propia (Windows)
let ctl = null;           // { proc, display, pill, name, limite }
const LIMITE = 60 * 60 * 1000;

const helperPath = () => {
  const f = process.platform === 'win32' ? 'cabina-control.exe' : 'cabina-control';
  return app.isPackaged ? path.join(process.resourcesPath, f) : path.join(__dirname, 'helper', 'build', f);
};

// La pantalla que se comparte. En Windows se sabe por la ventana para elegir; en Mac (selector del sistema)
// se reconoce por el tamaño de la imagen.
function pickDisplay(w, h){
  const ds = screen.getAllDisplays();
  if (lastDisplayId != null) { const d = ds.find(x => String(x.id) === String(lastDisplayId)); if (d) return d; }
  const near = (a, b) => Math.abs(a - b) <= 4;
  return ds.find(d => (near(d.bounds.width * d.scaleFactor, w) && near(d.bounds.height * d.scaleFactor, h)) || (near(d.bounds.width, w) && near(d.bounds.height, h)))
    || ds.find(d => w && h && Math.abs(d.bounds.width / d.bounds.height - w / h) < 0.01)
    || screen.getPrimaryDisplay();
}

// Aviso flotante, encima de todo y en todos los escritorios, mientras alguien tiene el control
function showPill(name, d){
  const w = 360, h = 52;
  const pill = new BrowserWindow({
    width: w, height: h, x: Math.round(d.workArea.x + (d.workArea.width - w) / 2), y: d.workArea.y + 12,
    frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    acceptFirstMouse: true, // un solo clic en "Quitar control" aunque Cabina no esté delante
    fullscreenable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'control-preload.js') },
  });
  pill.setAlwaysOnTop(true, 'screen-saver');
  pill.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pill.loadFile(path.join(__dirname, 'control.html'), { query: { nombre: name } });
  pill.once('ready-to-show', () => pill.showInactive());
  return pill;
}

function start(name, d){
  const proc = spawn(helperPath(), [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  proc.on('exit', () => { if (ctl && ctl.proc === proc) stop(true); });
  proc.stdin.on('error', () => {});
  // Como mucho una hora: después se corta solo y hay que volver a pedirlo y aceptarlo
  const limite = setTimeout(() => { if (ctl && ctl.proc === proc) stop(true); }, LIMITE);
  ctl = { proc, display: d, name, pill: showPill(name, d), limite };
}

// fromUser: lo ha quitado quien comparte (aviso flotante) o se ha cerrado el ayudante: avisar a la web
function stop(fromUser){
  if (!ctl) return;
  const c = ctl; ctl = null;
  clearTimeout(c.limite);
  try { c.proc.stdin.end(); c.proc.kill(); } catch {}
  if (c.pill && !c.pill.isDestroyed()) c.pill.close();
  const win = getWin();
  if (fromUser && win && !win.isDestroyed()) win.webContents.send('control:ended');
}

const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

function handle(ev){
  if (!ctl || !ev || typeof ev !== 'object') return;
  const d = ctl.display, out = { t: ev.t, m: num(ev.m, 0, 15) | 0 };
  if (ev.t === 'move' || ev.t === 'down' || ev.t === 'up') {
    let p = { x: d.bounds.x + num(ev.x, 0, 1) * d.bounds.width, y: d.bounds.y + num(ev.y, 0, 1) * d.bounds.height };
    if (process.platform === 'win32') p = screen.dipToScreenPoint(p);
    out.x = Math.round(p.x * 10) / 10; out.y = Math.round(p.y * 10) / 10;
    if (ev.t !== 'move') out.b = [0, 1, 2].includes(ev.b) ? ev.b : 0;
  } else if (ev.t === 'scroll') {
    out.dx = num(ev.dx, -3000, 3000); out.dy = num(ev.dy, -3000, 3000);
  } else if (ev.t === 'key') {
    const k = (process.platform === 'win32' ? WIN : MAC)[ev.code];
    if (k == null) return;
    out.k = k; out.down = !!ev.down; out.mod = MODS.test(ev.code);
  } else return;
  try { ctl.proc.stdin.write(JSON.stringify(out) + '\n'); } catch {}
}

async function ask(name, w, h){
  const win = getWin();
  name = String(name || 'Alguien').slice(0, 40);
  if (!['darwin', 'win32'].includes(process.platform)) return { ok: false, reason: 'sistema' };
  if (ctl) return { ok: false, reason: 'ocupado' };
  if (!fs.existsSync(helperPath())) return { ok: false, reason: 'falta' };
  if (process.platform === 'darwin') app.dock.bounce('critical'); else if (win) win.flashFrame(true);
  // En Mac hace falta el permiso de Accesibilidad para mover el ratón y escribir
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info', message: `${name} quiere controlar tu ordenador`,
      detail: 'Para dejar que te controlen, Cabina necesita el permiso de Accesibilidad. Actívalo en Ajustes del Sistema → Privacidad y seguridad → Accesibilidad y pide que vuelvan a solicitar el control.',
      buttons: ['Abrir Ajustes', 'Ahora no'], defaultId: 0, cancelId: 1,
    });
    if (response === 0) {
      systemPreferences.isTrustedAccessibilityClient(true); // añade Cabina a la lista
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    }
    return { ok: false, reason: 'permiso' };
  }
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', message: `${name} quiere controlar tu ordenador`,
    detail: 'Podrá mover tu ratón y escribir en la pantalla que compartes. Puedes quitárselo cuando quieras desde el aviso de arriba.',
    buttons: ['Permitir', 'Denegar'], defaultId: 1, cancelId: 1,
  });
  if (win) win.flashFrame(false);
  if (response !== 0) return { ok: false, reason: 'no' };
  if (ctl) return { ok: false, reason: 'ocupado' };
  start(name, pickDisplay(w, h));
  return { ok: true };
}

function setup(win){
  getWin = win;
  const fromApp = e => { const w = getWin(); return w && !w.isDestroyed() && e.sender === w.webContents; };
  ipcMain.handle('control:ask', (e, o) => fromApp(e) ? ask(o && o.name, o && o.w, o && o.h) : { ok: false });
  ipcMain.on('control:ev', (e, ev) => { if (fromApp(e)) handle(ev); });
  ipcMain.on('control:end', e => { if (fromApp(e)) stop(false); });
  ipcMain.on('control:quitar', e => { if (ctl && ctl.pill && !ctl.pill.isDestroyed() && e.sender === ctl.pill.webContents) stop(true); }); // botón del aviso flotante
  app.on('before-quit', () => stop(false));
}

module.exports = { setup, stop, setDisplay: id => { lastDisplayId = id; } };
