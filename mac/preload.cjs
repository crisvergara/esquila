const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("esquila", {
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (values) => ipcRenderer.invoke("settings:save", values),
  clearToken: () => ipcRenderer.invoke("settings:clearToken"),
  previewConfiguration: values => ipcRenderer.invoke('settings:preview', values),
  openAdmin: () => ipcRenderer.invoke('settings:admin'),
});
