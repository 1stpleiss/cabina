// Aviso flotante de pantalla compartida: solo puede pedir que se deje de compartir
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pill', { parar: () => ipcRenderer.send('share:parar') });
