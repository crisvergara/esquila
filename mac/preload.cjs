const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("esquila", {
  setLanguage: language => ipcRenderer.invoke('settings:language', language),
  loadModes: () => ipcRenderer.invoke('settings:modes'),
  setMode: mode => ipcRenderer.invoke('settings:mode', mode),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (values) => ipcRenderer.invoke("settings:save", values),
  clearToken: () => ipcRenderer.invoke("settings:clearToken"),
  previewConfiguration: values => ipcRenderer.invoke('settings:preview', values),
  diagnoseConnection: values => ipcRenderer.invoke('settings:diagnose', values),
  openAdmin: () => ipcRenderer.invoke('settings:admin'),
});
