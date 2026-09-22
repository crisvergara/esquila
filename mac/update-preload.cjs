const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('updates', {
  state: () => ipcRenderer.invoke('updates:state'),
  action: action => ipcRenderer.invoke('updates:action', action),
  subscribe: callback => ipcRenderer.on('updates:state', (_event, state) => callback(state)),
});
