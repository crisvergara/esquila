import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stageNativeUpdate } from '../../mac/native-update.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'esquila-native-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'fixture.zip');
  const bytes = Buffer.from('signed ZIP stand-in');
  await writeFile(filename, bytes);
  return { filename, bytes, release: { version: '0.1.7', build: 21, publishedAt: '2026-09-21T00:00:00Z',
    automatic: { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } };
}

test('native staging serves only verified local ZIP, closes server, and does not quit itself', async t => {
  const f = await fixture(t);
  const native = new EventEmitter();
  let feed;
  native.setFeedURL = options => { feed = options.url; assert.equal(options.serverType, 'default'); };
  let pending;
  native.checkForUpdates = () => {
    pending = (async () => {
      const response = await fetch(feed);
      const metadata = await response.json();
      assert.equal((await fetch(new URL('/update.zip', feed))).status, 404);
      assert.equal((await fetch(feed, { method: 'POST' })).status, 403);
      assert.deepEqual(Buffer.from(await (await fetch(metadata.url)).arrayBuffer()), f.bytes);
      native.emit('update-downloaded');
    })().catch(error => native.emit('error', error));
  };
  native.quitAndInstall = () => assert.fail('Staging must not quit the application');
  await stageNativeUpdate({ autoUpdater: native, ...f });
  await pending;
  assert.equal(native.listenerCount('update-downloaded'), 0);
  await assert.rejects(fetch(feed));
});

test('corrupt files never reach native updater; native failure and timeout leave no listeners/server', async t => {
  const f = await fixture(t);
  const native = new EventEmitter();
  let checks = 0;
  native.setFeedURL = () => {};
  native.checkForUpdates = () => { checks++; native.emit('error', new Error('signature rejected')); };
  await assert.rejects(stageNativeUpdate({ autoUpdater: native, ...f }), /signature rejected/);
  assert.equal(native.listenerCount('error'), 0);
  native.checkForUpdates = () => { checks++; };
  await assert.rejects(stageNativeUpdate({ autoUpdater: native, ...f, timeoutMs: 10 }), /demasiado/);
  await writeFile(f.filename, 'corrupt');
  await assert.rejects(stageNativeUpdate({ autoUpdater: native, ...f }));
  assert.equal(checks, 2);
});
