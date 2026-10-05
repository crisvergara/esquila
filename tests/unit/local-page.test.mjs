import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { loadLocalPage } from '../../mac/local-page.js';

test('phone QR window recovers from initial server failure and retries stop on close', async () => {
  const window = new EventEmitter(); window.webContents = new EventEmitter();
  let loads = 0, ready = false, destroyed = false, pending, scheduled = 0, cancelled = 0;
  window.isDestroyed = () => destroyed;
  window.loadURL = async () => { loads++; if (!ready) throw new Error('local server not ready'); };
  loadLocalPage(window, 'http://127.0.0.1:3001/tagger-setup', {
    schedule: callback => { pending = callback; scheduled++; return scheduled; },
    cancel: () => { cancelled++; pending = undefined; },
  });
  await Promise.resolve(); assert.equal(loads, 1); assert.equal(scheduled, 1);
  window.webContents.emit('did-fail-load', {}, -102, 'refused', 'http://127.0.0.1:3001/tagger-setup', true);
  assert.equal(scheduled, 1, 'failure event and rejected promise must share one retry');
  pending(); await Promise.resolve(); assert.equal(loads, 2); assert.equal(scheduled, 2);
  ready = true; pending(); await Promise.resolve(); assert.equal(loads, 3); assert.equal(scheduled, 2);
  window.webContents.emit('did-fail-load', {}, -102, 'refused', 'http://127.0.0.1:3001/tagger-setup', false);
  assert.equal(scheduled, 2, 'subresource failures must not reload the whole page');
  window.webContents.emit('did-fail-load', {}, -102, 'refused', 'http://127.0.0.1:3001/tagger-setup', true);
  assert.equal(scheduled, 3);
  window.webContents.emit('did-finish-load');
  assert.equal(cancelled, 1, 'a successful manual reload cancels an outstanding retry');
  window.webContents.emit('did-fail-load', {}, -102, 'refused', 'http://127.0.0.1:3001/tagger-setup', true);
  const late = pending; destroyed = true; window.emit('closed'); late();
  assert.equal(cancelled, 2); assert.equal(loads, 3);
  assert.equal(window.webContents.listenerCount('did-fail-load'), 0);
});
