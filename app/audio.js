// Audio del sistema al compartir la pantalla en Mac (macOS 14.2 o posterior). Electron no lo da con el selector de
// pantalla del sistema, así que lo captura un ayudante propio (helper/audio.swift) con Core Audio, dejando fuera los
// procesos de Cabina: los demás oyen lo que suena en el ordenador, pero no a sí mismos. Esto lanza el ayudante cuando
// la web lo pide, lee su audio y se lo pasa a la página por un MessagePort (no sale del ordenador). Solo mientras
// se comparte. En Windows el audio lo da Electron (main.js, 'loopback').
const { app, ipcMain, MessageChannelMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let getWin = () => null;
let cur = null; // { proc, port }

const helperPath = () => app.isPackaged ? path.join(process.resourcesPath, 'cabina-audio') : path.join(__dirname, 'helper', 'build', 'cabina-audio');
// macOS 14.2 es Darwin 23.2
const supported = () => {
  if (process.platform !== 'darwin') return false;
  const [maj, min] = os.release().split('.').map(Number);
  return (maj > 23 || (maj === 23 && min >= 2)) && fs.existsSync(helperPath());
};

function stop(){
  if (!cur) return;
  const c = cur; cur = null;
  try { c.proc.stdin.end(); c.proc.kill(); } catch {}
  try { c.port.close(); } catch {}
}

function start(){
  stop();
  const win = getWin();
  // Fuera: todos los procesos de esta app (el de audio de Chromium incluido) y sus auxiliares por identificador
  const pids = app.getAppMetrics().map(m => m.pid);
  const args = [...pids.flatMap(p => ['--excluir-pid', String(p)]), '--excluir-bundle', 'com.cabina.app',
    ...(app.isPackaged ? [] : ['--excluir-bundle', 'com.github.Electron'])];
  const proc = spawn(helperPath(), args, { stdio: ['pipe', 'pipe', 'ignore'] });
  const { port1, port2 } = new MessageChannelMain();
  cur = { proc, port: port1 };
  proc.stdin.on('error', () => {});
  return new Promise(resolve => {
    let sr = 0, head = Buffer.alloc(0), rest = Buffer.alloc(0);
    const fin = ok => { if (resolve) { resolve(ok ? { ok: true, sr } : { ok: false }); resolve = null; } };
    proc.stdout.on('data', chunk => {
      if (!sr) {
        head = Buffer.concat([head, chunk]);
        const i = head.indexOf(10); if (i < 0) return;
        sr = +((/^sr (\d+)/.exec(head.subarray(0, i).toString()) || [])[1]) || 48000;
        chunk = head.subarray(i + 1);
        if (win && !win.isDestroyed()) win.webContents.postMessage('sysaudio:port', null, [port2]);
        fin(true);
      }
      // Bloques enteros de muestras estéreo float32 (8 bytes)
      const all = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      const n = all.length - (all.length % 8);
      rest = Buffer.from(all.subarray(n));
      if (n && cur && cur.proc === proc) port1.postMessage(all.buffer.slice(all.byteOffset, all.byteOffset + n));
    });
    proc.on('exit', () => { fin(false); if (cur && cur.proc === proc) stop(); });
    proc.on('error', () => fin(false));
    setTimeout(() => { if (!sr) { stop(); fin(false); } }, 5000);
  });
}

function setup(win){
  getWin = win;
  const fromApp = e => { const w = getWin(); return w && !w.isDestroyed() && e.sender === w.webContents; };
  ipcMain.on('sysaudio:supported', e => { e.returnValue = fromApp(e) && supported(); });
  ipcMain.handle('sysaudio:start', e => fromApp(e) && supported() ? start() : { ok: false });
  ipcMain.on('sysaudio:stop', e => { if (fromApp(e)) stop(); });
  app.on('before-quit', stop);
  const w = getWin();
  if (w) { w.webContents.on('did-start-navigation', (ev, url, inPlace, isMain) => { if (isMain && !inPlace) stop(); }); w.on('closed', stop); }
}

module.exports = { setup };
