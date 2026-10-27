// La web sabe que está dentro de la app (para no ofrecer descargarla, dejar el hueco de los botones
// de la ventana...) y si está en pantalla completa, donde en Mac no hay botones. También le da el
// control remoto: pedir permiso a quien comparte, pasar lo que hace quien controla y saber cuándo se quita.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('CABINA_APP', {
  platform: process.platform,
  control: {
    ask: (name, w, h) => ipcRenderer.invoke('control:ask', { name, w, h }),
    send: ev => ipcRenderer.send('control:ev', ev),
    end: () => ipcRenderer.send('control:end'),
    onEnded: cb => ipcRenderer.on('control:ended', () => cb()),
  },
});
ipcRenderer.on('fullscreen', (e, on) => document.documentElement.classList.toggle('app-full', on));
