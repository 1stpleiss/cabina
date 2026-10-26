// La web sabe que está dentro de la app (para no ofrecer descargarla, por ejemplo)
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('CABINA_APP', { platform: process.platform });
