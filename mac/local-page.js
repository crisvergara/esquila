// A window opened while the barn process is starting/restarting must recover
// without an internet check or requiring the operator to close it first.
export function loadLocalPage(window, url, { schedule = setTimeout, cancel = clearTimeout } = {}) {
  let timer;
  let closed = false;
  const load = () => {
    if (!closed && !window.isDestroyed()) window.loadURL(url).catch(error => { if (error.code !== 'ERR_ABORTED') retry(); });
  };
  function retry() {
    if (closed || window.isDestroyed() || timer !== undefined) return;
    timer = schedule(() => { timer = undefined; load(); }, 2000);
  }
  // An error document may itself finish loading; only a successful loadURL
  // stops retrying. Do not cancel retries on a generic did-finish-load event.
  const failed = (_event, code, _description, failedUrl, isMainFrame) => {
    if (isMainFrame && code !== -3 && failedUrl === url) retry();
  };
  window.webContents.on('did-fail-load', failed);
  window.once('closed', () => {
    closed = true;
    if (timer !== undefined) cancel(timer);
    window.webContents.removeListener('did-fail-load', failed);
  });
  load();
}
