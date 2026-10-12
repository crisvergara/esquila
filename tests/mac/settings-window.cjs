// Exercise the real file:// renderer, CSP and sandboxed preload without running
// the barn, reading operator data, opening a browser or using any credentials.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = process.env.ESQUILA_SETTINGS_ROOT
  ? path.resolve(process.env.ESQUILA_SETTINGS_ROOT) : path.resolve(__dirname, '../..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esquila-settings-smoke-'));
app.setPath('userData', dataDir);
let adminOpens = 0, modeAvailable = true;
ipcMain.handle('settings:load', () => ({ configured: true, cloudSyncUrl: 'https://cloud.example.test',
  cloudAppUrl: '', hasCloudSyncToken: true, shearers: [], manifest: null, openAtLogin: false }));
ipcMain.handle('settings:modes', () => {
  if (!modeAvailable) throw new Error('Test barn is restarting');
  return { mode: 'oveja', modes: [{ type: 'oveja', name: 'Ovejas' }] };
});
ipcMain.handle('settings:admin', () => { adminOpens++; });
function finish(code) {
  clearTimeout(deadline);
  fs.rmSync(dataDir, { recursive: true, force: true });
  app.exit(code);
}
const deadline = setTimeout(() => { console.error('Settings smoke test timed out'); finish(1); }, 20000);
let exitCode = 0;
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  for (const language of ['es', 'en']) {
    const window = new BrowserWindow({ show: false, webPreferences: {
      preload: path.join(root, 'mac/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
    } });
    window.webContents.setWindowOpenHandler(() => { throw new Error('Unexpected browser open'); });
    try {
      await window.loadFile(path.join(root, 'mac/settings.html'), { query: { lang: language } });
      const state = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const poll = () => {
          if (!document.getElementById('load-configuration').disabled && document.getElementById('mode-status').textContent) {
            resolve({ language: document.documentElement.lang, url: document.getElementById('sync-url').value,
              token: document.getElementById('sync-token').value, saveDisabled: document.getElementById('save').disabled,
              saveText: document.getElementById('save').textContent, status: document.getElementById('status').textContent,
              modeStatus: document.getElementById('mode-status').textContent,
              adminHidden: document.getElementById('open-admin').hidden,
              picker: Boolean(document.querySelector('.language-picker select')), bridge: typeof window.esquila?.loadSettings });
          } else if (Date.now() > deadline) reject(new Error('Settings failed to initialize from file://'));
          else setTimeout(poll, 25);
        }; poll();
      })`);
      assert.equal(state.language, language);
      assert.equal(state.url, 'https://cloud.example.test');
      assert.equal(state.token, '');
      assert.equal(state.saveDisabled, false);
      assert.equal(state.status, '');
      assert.equal(state.adminHidden, false);
      assert.equal(state.picker, true);
      assert.equal(state.bridge, 'function');
      assert.equal(state.saveText, language === 'es' ? 'Guardar y abrir monitor' : 'Save and open monitor');
      if (language === 'en') assert.match(state.modeStatus, /Could not read/);
      assert.equal(adminOpens, 0, 'opening local settings must never require cloud administration');
      await window.webContents.executeJavaScript("document.getElementById('open-admin').click()");
      // IPC is asynchronous; use an ordered request on the same renderer channel.
      await window.webContents.executeJavaScript('window.esquila.loadSettings()');
      assert.equal(adminOpens, 1);
      adminOpens = 0; modeAvailable = false;
    } finally { window.destroy(); }
  }
  console.log('Mac settings render in both languages without a manifest, including during barn recovery.');
}).catch(error => { console.error(error); exitCode = 1; }).finally(() => finish(exitCode));
