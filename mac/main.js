import { app, autoUpdater, dialog, Notification, BrowserWindow, ipcMain, Menu, nativeImage, safeStorage, shell, Tray } from "electron";
import Bonjour from "bonjour-service";
import { spawn } from "node:child_process";
import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createUpdater, verifyInstaller } from "./updater.js";
import { stageNativeUpdate } from "./native-update.js";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PORT = 3001;
const SERVER_ORIGIN = `http://127.0.0.1:${SERVER_PORT}`;
const usesIsolatedTestData = Boolean(process.env.ESQUILA_DATA_DIR);

// Test builds can isolate their database, config, and single-instance lock.
if (process.env.ESQUILA_DATA_DIR) {
  app.setPath("userData", process.env.ESQUILA_DATA_DIR);
}

let serverProcess;
let activeConfig;
let suppressServerRestart = false;
let monitorWindow;
let settingsWindow;
let taggerSetupWindow;
let recordsWindow;
let tray;
let bonjour;
let quitting = false;
let updater;
let refreshTray = () => {};
let updateDialogOpen = false;
let updateWindow;
let installingUpdate = false;
let downloadInProgress = false;

const dataDir = () => app.getPath("userData");
const configPath = () => path.join(dataDir(), "config.json");
const serverPath = () => path.join(sourceRoot, "countserver.js");

function log(message) {
  appendFile(
    path.join(dataDir(), "esquila.log"),
    `${new Date().toISOString()} ${message}\n`
  ).catch(() => {});
}

async function readConfig() {
  try {
    const parsed = JSON.parse(await readFile(configPath(), "utf8"));
    return {
      cloudSyncUrl: parsed.cloudSyncUrl || "",
      cloudSyncToken: parsed.cloudSyncTokenEncrypted && safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(parsed.cloudSyncTokenEncrypted, "base64"))
        : parsed.cloudSyncToken || "",
      cloudAppUrl: parsed.cloudAppUrl || "",
      configured: parsed.configured === true,
    };
  } catch {
    return { cloudSyncUrl: "", cloudSyncToken: "", cloudAppUrl: "", configured: false };
  }
}

async function writeConfig(config) {
  await mkdir(dataDir(), { recursive: true });
  const stored = { ...config };
  if (stored.cloudSyncToken && safeStorage.isEncryptionAvailable()) {
    stored.cloudSyncTokenEncrypted = safeStorage.encryptString(stored.cloudSyncToken).toString("base64");
    delete stored.cloudSyncToken;
  }
  await writeFile(configPath(), JSON.stringify(stored, null, 2), { mode: 0o600 });
  await chmod(configPath(), 0o600);
}

function startServer(config) {
  if (serverProcess) return;
  activeConfig = config;
  serverProcess = spawn(process.execPath, [serverPath()], {
    cwd: dataDir(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(SERVER_PORT),
      CLOUD_SYNC_URL: config.cloudSyncUrl,
      CLOUD_SYNC_TOKEN: config.cloudSyncToken,
      CLOUD_APP_URL: config.cloudAppUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", (data) => log(`[server] ${data}`.trim()));
  serverProcess.stderr.on("data", (data) => log(`[server:error] ${data}`.trim()));
  serverProcess.on("exit", (code, signal) => {
    log(`Barn server exited (${code ?? signal})`);
    serverProcess = undefined;
    if (suppressServerRestart) suppressServerRestart = false;
    else if (!quitting) setTimeout(() => startServer(activeConfig), 3000);
  });
}

async function stopServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = undefined;
  suppressServerRestart = true;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 8000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function restartServer(config) {
  await stopServer();
  startServer(config);
  await waitForServer();
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${SERVER_ORIGIN}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("El servidor local no pudo iniciar.");
}

function advertiseRanchServer() {
  try {
    bonjour = new Bonjour({}, (error) => {
      log(`[bonjour:error] ${error.message}`);
    });
    const service = bonjour.publish({
      name: "Esquila Tagger",
      type: "http",
      port: SERVER_PORT,
      txt: { path: "/tagger/" },
    });
    service.on("up", () => log("Local network service advertised"));
    service.on("error", (error) => log(`[bonjour:error] ${error.message}`));
  } catch (error) {
    log(`[bonjour:error] ${error.message}`);
  }
}

function stopAdvertisingRanchServer() {
  if (!bonjour) return;
  const instance = bonjour;
  bonjour = undefined;
  instance.unpublishAll(() => instance.destroy());
}

function createMonitorWindow() {
  app.dock?.show();
  if (monitorWindow && !monitorWindow.isDestroyed()) {
    if (monitorWindow.webContents.getURL().startsWith("chrome-error://")) {
      monitorWindow.loadURL(`${SERVER_ORIGIN}/monitor`);
    }
    monitorWindow.show();
    monitorWindow.focus();
    return;
  }
  monitorWindow = new BrowserWindow({
    title: "Esquila — Monitor",
    backgroundColor: "#282c34",
    fullscreen: true,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  monitorWindow.loadURL(`${SERVER_ORIGIN}/monitor`);
  monitorWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  monitorWindow.on("closed", () => {
    monitorWindow = undefined;
    if (!settingsWindow && !taggerSetupWindow && !recordsWindow) app.dock?.hide();
  });
}

function createSettingsWindow() {
  app.dock?.show();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    title: "Configurar Esquila",
    width: 720,
    height: 760,
    minWidth: 620,
    minHeight: 650,
    backgroundColor: "#282c34",
    webPreferences: {
      preload: path.join(sourceRoot, "mac", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWindow.loadFile(path.join(sourceRoot, "mac", "settings.html"));
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  settingsWindow.on("closed", () => {
    settingsWindow = undefined;
    if (!monitorWindow && !taggerSetupWindow && !recordsWindow) app.dock?.hide();
  });
}

function createTaggerSetupWindow() {
  app.dock?.show();
  if (taggerSetupWindow && !taggerSetupWindow.isDestroyed()) {
    taggerSetupWindow.show();
    taggerSetupWindow.focus();
    return;
  }
  taggerSetupWindow = new BrowserWindow({
    title: "Configurar teléfonos — Esquila",
    width: 680,
    height: 820,
    minWidth: 520,
    minHeight: 680,
    backgroundColor: "#1d2129",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  taggerSetupWindow.loadURL(`${SERVER_ORIGIN}/tagger-setup`);
  taggerSetupWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${SERVER_ORIGIN}/tagger`)) shell.openExternal(url);
    return { action: "deny" };
  });
  taggerSetupWindow.on("closed", () => {
    taggerSetupWindow = undefined;
    if (!monitorWindow && !settingsWindow && !recordsWindow) app.dock?.hide();
  });
}

function createRecordsWindow() {
  app.dock?.show();
  if (recordsWindow && !recordsWindow.isDestroyed()) {
    recordsWindow.show();
    recordsWindow.focus();
    return;
  }
  recordsWindow = new BrowserWindow({
    title: "Registros recientes — Esquila", width: 1180, height: 780,
    minWidth: 640, minHeight: 520,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  recordsWindow.loadURL(`${SERVER_ORIGIN}/records/`);
  recordsWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  recordsWindow.on("closed", () => {
    recordsWindow = undefined;
    if (!monitorWindow && !settingsWindow && !taggerSetupWindow) app.dock?.hide();
  });
}

async function checkForUpdates(manual = false) {
  if (manual) showUpdates();
  if (!updater || updateDialogOpen || downloadInProgress || installingUpdate) return;
  const state = await updater.check();
  if (!state) return;
  if (state.phase === "available") {
    const label = `${state.release.version} (${state.release.build})`;
    if (!manual) {
      const marker = path.join(dataDir(), "updates", "notified-build");
      const previous = await readFile(marker, "utf8").catch(() => "");
      if (previous !== String(state.release.build) && Notification.isSupported()) {
        const notice = new Notification({ title: "Actualización de Esquila disponible",
          body: `Versión ${label}. Abre el menú de la oveja para descargarla cuando te acomode.` });
        notice.on("click", () => checkForUpdates(true));
        notice.show();
        await mkdir(path.dirname(marker), { recursive: true });
        await writeFile(marker, String(state.release.build)).catch(() => {});
      }
    }
  }
}

function showUpdates() {
  if (updateWindow) { updateWindow.show(); updateWindow.focus(); return; }
  app.dock?.show();
  updateWindow = new BrowserWindow({ width: 600, height: 480, title: "Actualizaciones de Esquila",
    webPreferences: { preload: path.join(sourceRoot, "mac", "update-preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  updateWindow.loadFile(path.join(sourceRoot, "mac", "update.html"));
  updateWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  updateWindow.webContents.on("will-navigate", event => event.preventDefault());
  updateWindow.on("closed", () => { updateWindow = undefined; });
}

async function downloadUpdate() {
  showUpdates();
  if (downloadInProgress || installingUpdate) return;
  downloadInProgress = true;
  try { await updater?.download(); }
  finally { downloadInProgress = false; }
}

async function installUpdate() {
  const state = updater?.state;
  if (!state || state.phase !== "ready" || installingUpdate || updateDialogOpen) return;
  updateDialogOpen = true;
  try {
    const result = await dialog.showMessageBox(updateWindow, { type: "question", title: "Instalar actualización",
      message: state.automatic ? "¿Instalar y reiniciar Esquila ahora?" : "¿Abrir el instalador y cerrar Esquila?",
      detail: "Los teléfonos no podrán contar durante el reinicio. Los registros y la configuración se conservan." +
        (state.automatic ? " La aplicación se reemplazará y abrirá automáticamente." : " Arrastra Esquila a Aplicaciones, acepta Reemplazar y vuelve a abrirla."),
      buttons: [state.automatic ? "Instalar y reiniciar" : "Abrir instalador", "Seguir contando"], defaultId: 1, cancelId: 1 });
    if (result.response !== 0) return;
    installingUpdate = true;
    refreshTray();
    updateWindow?.webContents.send("updates:state", { ...state, phase: "installing" });
    if (state.automatic) {
      await stageNativeUpdate({ autoUpdater, filename: state.filename, release: state.release });
      // Drain the child before Squirrel quits Electron. app.exit() in the normal
      // quit handler would bypass Squirrel's installation/relaunch lifecycle.
      quitting = true;
      await stopServer();
      autoUpdater.quitAndInstall();
    } else {
      await verifyInstaller(state.filename, state.release);
      const error = await shell.openPath(state.filename);
      if (error) throw new Error("macOS no pudo abrir el instalador. Reintenta desde el menú.");
      quitting = true;
      app.quit();
    }
  } catch (error) {
    if (quitting) { quitting = false; startServer(activeConfig); }
    await dialog.showMessageBox({ type: "warning", message: "No se pudo instalar la actualización.", detail: error.message, buttons: ["Aceptar"] });
  } finally {
    installingUpdate = false;
    updateDialogOpen = false;
    refreshTray();
    updateWindow?.webContents.send("updates:state", updater.state);
  }
}

ipcMain.handle("updates:state", event => {
  if (event.sender !== updateWindow?.webContents) throw new Error("Ventana no autorizada.");
  return updater?.state || { phase: "idle" };
});
ipcMain.handle("updates:action", async (event, action) => {
  if (event.sender !== updateWindow?.webContents) throw new Error("Ventana no autorizada.");
  if (installingUpdate || !updater) return;
  if (action === "check") await checkForUpdates(true);
  else if (action === "download") await downloadUpdate();
  else if (action === "pause") updater.pause();
  else if (action === "install") await installUpdate();
});
// Native errors outside a staging request must not crash the running barn.
autoUpdater.on("error", error => log(`Native update: ${error.message}`));

function buildTray() {
  const iconPath = path.join(sourceRoot, "public", "logo192.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Esquila — servidor del galpón");
  const rebuildMenu = () => {
    const updateState = updater?.state;
    const updateBusy = installingUpdate || ["checking", "downloading"].includes(updateState?.phase);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Abrir monitor", click: createMonitorWindow },
      { label: "Registros recientes…", click: createRecordsWindow },
      { label: "Configuración…", click: createSettingsWindow },
      { label: "Configurar teléfonos…", click: createTaggerSetupWindow },
      { label: "Abrir tagger en este Mac", click: () => shell.openExternal(`${SERVER_ORIGIN}/tagger`) },
      { type: "separator" },
      {
        label: "Iniciar automáticamente",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true });
          rebuildMenu();
        },
      },
      { type: "separator" },
      { label: updateState?.phase === "checking" ? "Buscando actualizaciones…" : "Buscar actualizaciones…",
        enabled: Boolean(updater) && !updateBusy, click: () => checkForUpdates(true).catch(error => log(error.message)) },
      ...(updateState?.release ? [{
        label: updateState.phase === "downloading" ? `Descargando actualización: ${Math.floor(100 * updateState.received / (updateState.total || 1))}%…` : `Actualizar a ${updateState.release.version} (${updateState.release.build})…`,
        enabled: !installingUpdate, click: () => showUpdates(),
      }] : []),
      { type: "separator" },
      { label: "Salir de Esquila", enabled: !installingUpdate, click: () => { quitting = true; app.quit(); } },
    ]));
  };
  refreshTray = rebuildMenu;
  tray.on("click", createMonitorWindow);
  rebuildMenu();
}

ipcMain.handle("settings:load", async () => {
  const config = await readConfig();
  let shearers = [];
  try {
    shearers = await fetch(`${SERVER_ORIGIN}/shearers`).then((res) => res.json());
  } catch {}
  return {
    cloudSyncUrl: config.cloudSyncUrl,
    cloudAppUrl: config.cloudAppUrl,
    hasCloudSyncToken: Boolean(config.cloudSyncToken),
    configured: config.configured,
    shearers,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
  };
});

ipcMain.handle("settings:save", async (_event, values) => {
  const previous = await readConfig();
  const names = Array.isArray(values.names) ? values.names.map((name) => name.trim()) : [];
  if (names.length < 1 || names.length > 6 || names.some((name) => !name)) {
    throw new Error("Ingresa entre 1 y 6 nombres.");
  }
  const cloudSyncUrl = String(values.cloudSyncUrl || "").trim().replace(/\/$/, "");
  const cloudAppUrl = String(values.cloudAppUrl || "").trim().replace(/\/$/, "");
  const newToken = String(values.cloudSyncToken || "").trim();
  if ((cloudSyncUrl && !(newToken || previous.cloudSyncToken)) || (!cloudSyncUrl && newToken)) {
    throw new Error("La dirección de sincronización y el token deben configurarse juntos.");
  }
  const response = await fetch(`${SERVER_ORIGIN}/setup/shearers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names }),
  });
  if (!response.ok) throw new Error("No se pudieron guardar los esquiladores.");
  const config = {
    cloudSyncUrl,
    cloudSyncToken: cloudSyncUrl ? (newToken || previous.cloudSyncToken) : "",
    cloudAppUrl,
    configured: true,
  };
  await writeConfig(config);
  const openAtLogin = values.openAtLogin === true;
  if (!usesIsolatedTestData && openAtLogin !== app.getLoginItemSettings().openAtLogin) {
    app.setLoginItemSettings({ openAtLogin, openAsHidden: true });
  }
  await restartServer(config);
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
  createMonitorWindow();
  return { ok: true };
});

ipcMain.handle("settings:clearToken", async () => {
  const config = await readConfig();
  config.cloudSyncToken = "";
  config.cloudSyncUrl = "";
  await writeConfig(config);
  return { ok: true };
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => createMonitorWindow());
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await mkdir(dataDir(), { recursive: true });
  const config = await readConfig();
  startServer(config);
  try {
    await waitForServer();
  } catch (error) {
    log(error.stack || error.message);
  }
  if (app.isPackaged && process.arch === "arm64") {
    let installed = { version: app.getVersion(), build: 0 };
    try {
      const identity = JSON.parse(await readFile(path.join(sourceRoot, "mac", "release.json"), "utf8"));
      if (identity.version === installed.version && Number.isSafeInteger(identity.build) && identity.build > 0) installed = identity;
    } catch { /* Local/manual builds have no CI identity. */ }
    updater = createUpdater({ installed, teamId: installed.teamId, directory: path.join(dataDir(), "updates"), onChange: state => {
      refreshTray();
      updateWindow?.webContents.send("updates:state", state);
      updateWindow?.setProgressBar(state.phase === "downloading" ? state.received / (state.total || 1) : -1);
    } });
    const check = () => checkForUpdates().catch(error => log(`Update check: ${error.message}`));
    setTimeout(check, 30_000).unref();
    setInterval(check, 6 * 60 * 60_000).unref();
  }
  buildTray();
  if (config.configured) createMonitorWindow();
  else createSettingsWindow();
  advertiseRanchServer();
});

app.on("activate", async () => {
  const config = await readConfig();
  if (config.configured) createMonitorWindow();
  else createSettingsWindow();
});
app.on("window-all-closed", () => {});
app.on("before-quit", (event) => {
  stopAdvertisingRanchServer();
  if (serverProcess) {
    event.preventDefault();
    quitting = true;
    stopServer().finally(() => app.exit(0));
  }
});
