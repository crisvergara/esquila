// Exercise the real sandboxed connectivity preload, also against the built ASAR.
const { app, BrowserWindow, ipcMain, powerMonitor } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { once } = require('node:events');
const root = process.env.ESQUILA_SETTINGS_ROOT
  ? path.resolve(process.env.ESQUILA_SETTINGS_ROOT) : path.resolve(__dirname, '../..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esquila-connectivity-'));
app.setPath('userData', dataDir);
function finish(code) {
  clearTimeout(deadline);
  fs.rmSync(dataDir, { recursive: true, force: true });
  app.exit(code);
}
function fail(error) { console.error(error); finish(1); }
const deadline = setTimeout(() => fail(new Error('Connectivity test timed out')), 20000);
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
app.on('window-all-closed', () => {});
async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Connectivity event not received');
}
app.whenReady().then(async () => {
  const { watchSyncLifecycle } = await import(pathToFileURL(path.join(root, 'mac/sync-lifecycle.js')).href);
  let requests = 0;
  const watcher = watchSyncLifecycle({ app, BrowserWindow, ipcMain, powerMonitor, sourceRoot: root,
    requestSync: () => requests++, onError: () => { throw new Error('Observer failed to load'); },
  });
  const observer = BrowserWindow.getAllWindows()[0], contents = observer.webContents;
  await once(contents, 'did-finish-load');
  assert.equal(observer.isVisible(), false);
  assert.equal(contents.getLastWebPreferences().sandbox, true);
  contents.debugger.attach('1.3');
  await contents.debugger.sendCommand('Network.enable');
  async function connectivity(offline) {
    const received = once(ipcMain, 'sync:connectivity');
    await contents.debugger.sendCommand('Network.emulateNetworkConditions', {
      offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    const [, value] = await received;
    assert.equal(value, !offline);
  }
  await connectivity(true);
  const initial = requests;
  await connectivity(false);
  await waitFor(() => requests === initial + 1);
  // A different renderer and a subframe cannot impersonate the observer.
  const other = new BrowserWindow({ show: false });
  ipcMain.emit('sync:connectivity', { sender: other.webContents, senderFrame: other.webContents.mainFrame }, false);
  ipcMain.emit('sync:connectivity', { sender: contents, senderFrame: {} }, false);
  ipcMain.emit('sync:connectivity', { sender: contents, senderFrame: contents.mainFrame }, true);
  assert.equal(requests, initial + 1);
  const closed = once(other, 'closed'); other.close(); await closed;
  assert.equal(requests, initial + 2);
  // Reconnection continues with no operator windows; observer stays hidden.
  await connectivity(true); await connectivity(false);
  assert.equal(requests, initial + 3);
  powerMonitor.emit('resume'); app.emit('activate'); app.emit('second-instance');
  assert.equal(requests, initial + 6);
  watcher.dispose();
  powerMonitor.emit('resume'); app.emit('activate');
  assert.equal(requests, initial + 6);
  assert.equal(ipcMain.listenerCount('sync:connectivity'), 0);
  console.log('Connectivity, wake, reopen and window-close triggers verified in Electron.');
  finish(0);
}).catch(fail);
