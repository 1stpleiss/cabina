// La web sabe que está dentro de la app (para no ofrecer descargarla, dejar el hueco de los botones
// de la ventana...) y si está en pantalla completa, donde en Mac no hay botones
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('CABINA_APP', { platform: process.platform });
ipcRenderer.on('fullscreen', (e, on) => document.documentElement.classList.toggle('app-full', on));
