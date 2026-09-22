import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';
import { validateRelease, isNewerRelease, UPDATE_FEED_URL } from '../../shared/mac-release.js';
import { createUpdater, verifyInstaller } from '../../mac/updater.js';
import { registerMacUpdates } from '../../cloud/mac-updates.js';

const bytes = Buffer.from('disposable installer fixture');
const release = {
  schema: 1, version: '0.1.4', build: 20, commit: 'a'.repeat(40), platform: 'darwin', arch: 'arm64',
  sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
  publishedAt: '2026-09-14T12:00:00Z',
  url: `https://github.com/crisvergara/esquila/releases/download/mac-${'a'.repeat(40)}/Esquila-0.1.4-arm64.dmg`,
};
const installed = { version: '0.1.4', build: 19 };
async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'esquila-updates-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('release validation pins platform, repository, identity, size, and digest', () => {
  assert.deepEqual(validateRelease(release), release);
  for (const invalid of [{ schema: 2 }, { version: '../file' }, { build: 0 }, { build: 1.5 },
    { commit: 'bad' }, { arch: 'x64' }, { platform: 'win32' }, { size: 0 }, { size: 2 ** 31 },
    { sha256: 'bad' }, { publishedAt: 'no' }, { url: release.url.replace('crisvergara', 'attacker') },
    { url: release.url.replace('https:', 'http:') }]) {
    assert.throws(() => validateRelease({ ...release, ...invalid }));
  }
  assert.equal(isNewerRelease(release, installed), true);
  assert.equal(isNewerRelease(release, { ...installed, build: 20 }), false);
  assert.equal(isNewerRelease(release, { ...installed, build: 21 }), false);
  assert.equal(isNewerRelease(release, { version: '0.2.0', build: 0 }), false);
  assert.equal(isNewerRelease(release, { version: '0.1.3', build: 0 }), true);
});

test('checks retain a usable release offline and disable offers for rollback/equal builds', async t => {
  let offline = false;
  let advertised = release;
  const updater = createUpdater({ installed, directory: await temporary(t), fetchImpl: async (url, options) => {
    assert.equal(url, UPDATE_FEED_URL);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    if (offline) throw new TypeError('network down');
    return Response.json(advertised);
  } });
  assert.equal((await updater.check()).phase, 'available');
  offline = true;
  assert.equal((await updater.check()).phase, 'error');
  assert.equal(updater.state.release.build, 20);
  offline = false; advertised = { ...release, build: 18 };
  assert.equal((await updater.check()).phase, 'current');
  assert.equal(updater.state.release, null);
});

test('downloads follow allowed redirects, verify contents, reuse cache, and detect tampering', async t => {
  let requests = 0;
  const updater = createUpdater({ installed, directory: await temporary(t), fetchImpl: async url => {
    if (url === UPDATE_FEED_URL) return Response.json(release);
    requests++;
    if (url === release.url) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/fixture' } });
    return new Response(bytes);
  } });
  await updater.check();
  const state = await updater.download();
  assert.equal(state.phase, 'ready');
  assert.deepEqual(await readFile(state.filename), bytes);
  await updater.download();
  assert.equal(requests, 2);
  await writeFile(state.filename, Buffer.alloc(bytes.length));
  await assert.rejects(() => verifyInstaller(state.filename, release));
  assert.equal((await updater.download()).phase, 'ready');
  assert.equal(requests, 4);
});

test('partial, corrupt, oversized, and unsafe downloads never become installable', async t => {
  for (const response of [
    () => new Response(bytes.subarray(0, 5)),
    () => new Response(Buffer.alloc(bytes.length)),
    () => new Response(Buffer.alloc(bytes.length + 1)),
    () => new Response(null, { status: 302, headers: { location: 'https://attacker.example/installer' } }),
    () => new Response(null, { status: 302, headers: { location: 'http://github.com/file' } }),
    () => { throw new TypeError('disconnected'); },
  ]) {
    const directory = await temporary(t);
    const updater = createUpdater({ installed, directory, fetchImpl: async url => url === UPDATE_FEED_URL ? Response.json(release) : response() });
    await updater.check();
    assert.equal((await updater.download()).phase, 'error');
    assert.equal(updater.state.filename, null);
    const files = await readdir(directory);
    assert.ok(files.every(name => name.endsWith('.part')));
    for (const name of files) assert.deepEqual(await readFile(path.join(directory, name)), bytes.subarray(0, 5));
  }
});

test('malformed or oversized metadata fails without exposing an update', async t => {
  for (const response of [() => new Response('bad JSON'), () => new Response('x'.repeat(17000)),
    () => new Response('', { status: 503 }), () => Response.json({ ...release, url: 'https://attacker.example' })]) {
    const updater = createUpdater({ installed, directory: await temporary(t), fetchImpl: async () => response() });
    assert.equal((await updater.check()).phase, 'error');
    assert.equal(updater.state.release, null);
  }
});

test('concurrent requests do not race the update state', async t => {
  let resolve;
  const updater = createUpdater({ installed, directory: await temporary(t), fetchImpl: () => new Promise(r => { resolve = r; }) });
  const pending = updater.check();
  assert.equal(await updater.check(), undefined);
  assert.equal(await updater.download(), undefined);
  resolve(Response.json(release));
  await pending;
  assert.equal(updater.state.phase, 'available');
});

test('cloud feed serves validated metadata without authentication and fails closed when absent or invalid', async t => {
  const directory = await temporary(t);
  const file = path.join(directory, 'mac-update.json');
  const app = express();
  registerMacUpdates(app, file);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/updates/mac`;
  assert.equal((await fetch(url)).status, 503);
  await writeFile(file, JSON.stringify(release));
  const response = await fetch(url);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), release);
  await writeFile(file, JSON.stringify({ ...release, sha256: 'bad' }));
  assert.equal((await fetch(url)).status, 503);
});

const signedRelease = { ...release, automatic: { url: release.url.replace('.dmg', '.zip'),
  sha256: release.sha256, size: release.size, teamId: 'ABCDEFGHIJ' } };

test('signed payload validation rejects substituted ZIPs, sizes, digests and identities', () => {
  assert.deepEqual(validateRelease(signedRelease), signedRelease);
  for (const override of [{ url: release.url }, { sha256: 'bad' }, { size: 0 }, { teamId: 'bad' }]) {
    assert.throws(() => validateRelease({ ...signedRelease, automatic: { ...signedRelease.automatic, ...override } }));
  }
});

test('interrupted signed downloads resume across restart with progress and exact byte verification', async t => {
  const directory = await temporary(t);
  const states = [];
  let interrupted = true;
  const fetchImpl = async (url, options) => {
    if (url === UPDATE_FEED_URL) return Response.json(signedRelease);
    assert.equal(url, signedRelease.automatic.url);
    if (interrupted) return new Response(bytes.subarray(0, 5));
    assert.equal(options.headers.Range, 'bytes=5-');
    return new Response(bytes.subarray(5), { status: 206, headers: { 'content-range': `bytes 5-${bytes.length - 1}/${bytes.length}` } });
  };
  let updater = createUpdater({ installed, directory, teamId: 'ABCDEFGHIJ', fetchImpl });
  await updater.check();
  assert.equal((await updater.download()).phase, 'error');
  interrupted = false;
  updater = createUpdater({ installed, directory, teamId: 'ABCDEFGHIJ', fetchImpl, onChange: state => states.push(state) });
  await updater.check();
  const result = await updater.download();
  assert.equal(result.phase, 'ready');
  assert.equal(result.automatic, true);
  assert.ok(result.filename.endsWith('.zip'));
  assert.deepEqual(await readFile(result.filename), bytes);
  assert.ok(states.some(state => state.received === 5));
  assert.equal(result.received, bytes.length);
  assert.equal((await updater.check()).phase, 'ready');
});

test('range ignored restarts safely, invalid range fails, different signing team uses manual DMG', async t => {
  for (const invalid of [false, true]) {
    let first = true;
    const updater = createUpdater({ installed, directory: await temporary(t), fetchImpl: async url => {
      if (url === UPDATE_FEED_URL) return Response.json(release);
      if (first) { first = false; return new Response(bytes.subarray(0, 5)); }
      return invalid ? new Response(bytes, { status: 206, headers: { 'content-range': 'bytes 0-2/3' } }) : new Response(bytes);
    } });
    await updater.check(); await updater.download();
    assert.equal((await updater.download()).phase, invalid ? 'error' : 'ready');
  }
  const updater = createUpdater({ installed, teamId: 'XXXXXXXXXX', directory: await temporary(t), fetchImpl: async url => {
    if (url === UPDATE_FEED_URL) return Response.json(signedRelease);
    assert.equal(url, release.url);
    return new Response(bytes);
  } });
  await updater.check();
  assert.equal((await updater.download()).automatic, false);
});

test('pause aborts an active transfer and leaves durable bytes for retry', async t => {
  let streaming;
  const began = new Promise(resolve => { streaming = resolve; });
  const updater = createUpdater({ installed, directory: await temporary(t), fetchImpl: async (url, options) => {
    if (url === UPDATE_FEED_URL) return Response.json(release);
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, 5));
      options.signal.addEventListener('abort', () => controller.error(options.signal.reason));
    } }));
  }, onChange: state => { if (state.received === 5) streaming(); } });
  await updater.check();
  const download = updater.download();
  await began;
  updater.pause();
  const result = await download;
  assert.equal(result.phase, 'error');
  assert.match(result.error, /pausada/);
  assert.equal(result.received, 5);
  assert.equal(result.filename, null);
});
