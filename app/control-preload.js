// Aviso flotante del control remoto: solo puede pedir que se quite el control
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pill', { quitar: () => ipcRenderer.send('control:quitar') });
