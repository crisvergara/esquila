// Real Electron teardown regression: no server, updater installation, network,
// credentials or operator data. CI imports the helper from the packaged ASAR.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { once } = require('node:events');
const root = process.env.ESQUILA_SETTINGS_ROOT
  ? path.resolve(process.env.ESQUILA_SETTINGS_ROOT) : path.resolve(__dirname, '../..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esquila-window-close-'));
app.setPath('userData', dataDir);
function finish(code) {
  clearTimeout(deadline);
  fs.rmSync(dataDir, { recursive: true, force: true });
  app.exit(code);
}
function fail(error) { console.error(error); finish(1); }
const deadline = setTimeout(() => fail(new Error('Window teardown test timed out')), 20000);
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
app.on('window-all-closed', () => {});
const pending = new Set();
const options = {
  schedule: callback => { pending.add(callback); return callback; },
  cancel: callback => pending.delete(callback),
};
app.whenReady().then(async () => {
  const { loadLocalPage } = await import(pathToFileURL(path.join(root, 'mac/local-page.js')).href);
  const create = () => new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  for (const close of ['close', 'destroy']) {
    const window = create(), contents = window.webContents;
    const loaded = once(contents, 'did-finish-load');
    loadLocalPage(window, 'data:text/html,<title>Test local page</title>', options);
    await loaded;
    const closed = once(window, 'closed');
    window[close](); await closed;
    assert.equal(window.isDestroyed(), true);
    assert.equal(contents.listenerCount('did-fail-load'), 0);
    assert.equal(pending.size, 0);
  }
  // A failed local load queues recovery. Quitting (as installation does) must
  // destroy the window, detach its listener, and cancel that recovery safely.
  const window = create(), contents = window.webContents;
  const failed = once(contents, 'did-fail-load');
  loadLocalPage(window, pathToFileURL(path.join(dataDir, 'missing-local-page.html')).href, options);
  await failed; await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.size, 1);
  const late = [...pending][0];
  app.once('will-quit', event => {
    event.preventDefault();
    try {
      assert.equal(window.isDestroyed(), true);
      assert.equal(pending.size, 0);
      assert.equal(contents.listenerCount('did-fail-load'), 0);
      assert.doesNotThrow(late);
      console.log('Local windows close, destroy and quit safely, including pending recovery.');
      finish(0);
    } catch (error) { fail(error); }
  });
  app.quit();
}).catch(fail);
