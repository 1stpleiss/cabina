// Aviso flotante de pantalla compartida: solo puede dejar de compartir, cambiar la casilla del audio del sistema,
// decir su tamaño y esconderse o volver
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pill', {
  parar: () => ipcRenderer.send('share:parar'),
  audio: on => ipcRenderer.send('share:audio', !!on),
  size: (w, h) => ipcRenderer.send('hud:size', +w, +h),
  esconder: () => ipcRenderer.send('hud:esconder'),
  mostrar: () => ipcRenderer.send('hud:mostrar'),
  onState: cb => ipcRenderer.on('hud:state', (e, st) => cb(st)),
  onMode: cb => ipcRenderer.on('hud:mode', (e, m) => cb(m)),
});
