// La web sabe que está dentro de la app (para no ofrecer descargarla, dejar el hueco de los botones
// de la ventana...) y si está en pantalla completa, donde en Mac no hay botones. También le da el
// control remoto: pedir permiso a quien comparte, pasar lo que hace quien controla y saber cuándo se quita.
const { contextBridge, ipcRenderer } = require('electron');
// Audio del sistema en Mac (app/audio.js): llega por un MessagePort y se le pasa a la página bloque a bloque
let audioCb = null, audioPort = null;
ipcRenderer.on('sysaudio:port', e => {
  if (audioPort) audioPort.close();
  audioPort = e.ports[0];
  audioPort.onmessage = ev => { if (audioCb) audioCb(ev.data); };
  audioPort.start();
});
contextBridge.exposeInMainWorld('CABINA_APP', {
  platform: process.platform,
  version: ipcRenderer.sendSync('app:version'), // para mostrarla en la web
  control: {
    ask: (name, w, h) => ipcRenderer.invoke('control:ask', { name, w, h }),
    send: ev => ipcRenderer.send('control:ev', ev),
    end: () => ipcRenderer.send('control:end'),
    onEnded: cb => ipcRenderer.on('control:ended', () => cb()),
  },
  // Instalar o actualizar los plugins (app/plugins.js)
  plugins: () => ipcRenderer.send('plugins:check'),
  // Aviso flotante mientras se comparte la pantalla (app/compartir.js): sustituye al de la página (hud), con su
  // casilla de audio del sistema y "Dejar de compartir"
  hud: true,
  sharing: (on, info) => ipcRenderer.send('share:state', !!on, { audio: !!(info && info.audio), warn: String((info && info.warn) || '').slice(0, 200) }),
  onShareStop: cb => ipcRenderer.on('share:stop', () => cb()),
  systemAudio: {
    supported: ipcRenderer.sendSync('sysaudio:supported'),
    start: cb => { audioCb = cb; return ipcRenderer.invoke('sysaudio:start'); },
    stop: () => { audioCb = null; if (audioPort) { audioPort.close(); audioPort = null; } ipcRenderer.send('sysaudio:stop'); },
  },
});
ipcRenderer.on('fullscreen', (e, on) => document.documentElement.classList.toggle('app-full', on));
