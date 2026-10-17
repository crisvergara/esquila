const { ipcRenderer } = require('electron');
const report = () => ipcRenderer.send('sync:connectivity', navigator.onLine);
window.addEventListener('online', report);
window.addEventListener('offline', report);
report();
