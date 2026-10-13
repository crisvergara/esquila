import path from 'node:path';

// Chromium delivers OS connectivity changes in a renderer. Keep this bundled,
// isolated observer alive even when the operator closes every visible window.
export function watchSyncLifecycle({ app, BrowserWindow, ipcMain, powerMonitor,
  sourceRoot, requestSync, onError = () => {} }) {
  let online, disposed = false, observer;
  const request = () => { if (!disposed) requestSync(); };
  const onWindow = (_event, window) => {
    window.once('closed', () => { if (window !== observer) request(); });
  };
  app.on('browser-window-created', onWindow);
  app.on('activate', request);
  app.on('second-instance', request);
  powerMonitor.on('resume', request);
  observer = new BrowserWindow({
    show: false, skipTaskbar: true,
    webPreferences: {
      preload: path.join(sourceRoot, 'mac', 'connectivity-preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false,
    },
  });
  const contents = observer.webContents;
  const onConnectivity = (event, value) => {
    if (disposed || contents.isDestroyed() || event.sender !== contents ||
        event.senderFrame !== contents.mainFrame || typeof value !== 'boolean') return;
    const previous = online;
    online = value;
    // Startup already syncs. Initial status is a baseline, never a sync gate.
    if (previous === false && online) request();
  };
  ipcMain.on('sync:connectivity', onConnectivity);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  observer.loadFile(path.join(sourceRoot, 'mac', 'connectivity.html')).catch(() => onError());

  function dispose() {
    if (disposed) return;
    disposed = true;
    ipcMain.removeListener('sync:connectivity', onConnectivity);
    powerMonitor.removeListener('resume', request);
    app.removeListener('activate', request);
    app.removeListener('second-instance', request);
    app.removeListener('browser-window-created', onWindow);
    app.removeListener('will-quit', dispose);
    if (!observer.isDestroyed()) observer.destroy();
  }
  app.once('will-quit', dispose);
  return { dispose };
}
