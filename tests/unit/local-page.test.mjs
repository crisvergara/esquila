import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { loadLocalPage } from '../../mac/local-page.js';

test('phone QR window recovers from initial server failure and retries stop on close', async () => {
  const window = new EventEmitter(), contents = new EventEmitter();
  let loads = 0, ready = false, destroyed = false, pending, scheduled = 0, cancelled = 0;
  // Electron's BrowserWindow getter throws after the native window is destroyed.
  Object.defineProperty(window, 'webContents', { get() {
    if (destroyed) throw new TypeError('Object has been destroyed');
    return contents;
  } });
  window.isDestroyed = () => destroyed;
  window.loadURL = async () => { loads++; if (!ready) throw new Error('local server not ready'); };
  loadLocalPage(window, 'http://127.0.0.1:3001/tagger-setup', {
    schedule: callback => { pending = callback; scheduled++; return scheduled; },
    cancel: () => { cancelled++; pending = undefined; },
  });
  await Promise.resolve(); assert.equal(loads, 1); assert.equal(scheduled, 1);
  window.webContents.emit('did-fail-load', {}, -102, 'refused', 'http://127.0.0.1:3001/tagger-setup', true);
  window.webContents.emit('did-finish-load');
  assert.equal(cancelled, 0, 'an error document finishing must not cancel recovery');
  assert.equal(scheduled, 1, 'failure event and rejected promise must share one retry');
  pending(); await Promise.resolve(); assert.equal(loads, 2); assert.equal(scheduled, 2);
  ready = true; pending(); await Promise.resolve(); assert.equal(loads, 3); assert.equal(scheduled, 2);
  window.webContents.emit('did-fail-load', {}, -102, 'refused', 'http://127.0.0.1:3001/tagger-setup', false);
  assert.equal(scheduled, 2, 'subresource failures must not reload the whole page');
  window.webContents.emit('did-fail-load', {}, -102, 'refused', 'http://127.0.0.1:3001/tagger-setup', true);
  assert.equal(scheduled, 3);
  const late = pending; destroyed = true;
  assert.doesNotThrow(() => window.emit('closed')); late();
  assert.equal(cancelled, 1); assert.equal(loads, 3);
  assert.equal(contents.listenerCount('did-fail-load'), 0);
});

test('a navigation rejected after window destruction cannot schedule another retry', async () => {
  const window = new EventEmitter(), contents = new EventEmitter();
  let destroyed = false, rejectLoad, scheduled = 0;
  Object.defineProperty(window, 'webContents', { get() {
    if (destroyed) throw new TypeError('Object has been destroyed');
    return contents;
  } });
  window.isDestroyed = () => destroyed;
  window.loadURL = () => new Promise((_resolve, reject) => { rejectLoad = reject; });
  loadLocalPage(window, 'http://127.0.0.1:3001/tagger-setup', { schedule: () => { scheduled++; } });
  destroyed = true;
  assert.doesNotThrow(() => window.emit('closed'));
  rejectLoad(Object.assign(new Error('Navigation failed during quit'), { code: 'ERR_FAILED' }));
  await Promise.resolve();
  assert.equal(scheduled, 0);
  assert.equal(contents.listenerCount('did-fail-load'), 0);
});
