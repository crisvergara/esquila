import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonRequest, startNodeService, stopService, waitFor, waitForHealth } from './helpers.mjs';
const { Pool } = createRequire(new URL('../../cloud/package.json', import.meta.url))('pg');
const root = fileURLToPath(new URL('../..', import.meta.url));
const cloudBase = 'http://127.0.0.1:4201', barnBase = 'http://127.0.0.1:3201';
const password = `sync-lifecycle-fixture-${crypto.randomUUID()}`;
let pool, schema, directory, cloud, barn, device, proxy, proxyBase;
let network = 'online', dropPush = false, releasePush, proxyError;
const requests = [];
const ownershipBatchSizes = [];
const admin = (method, route, body) => jsonRequest(`${cloudBase}${route}`, { method, token: password, body });
const records = async () => (await jsonRequest(`${barnBase}/api/records`)).data;
const remoteRows = async tag => (await admin('GET', `/api/admin/shearing?tag=${tag}`)).data.rows;
function startBarn() {
  return startNodeService('lifecycle barn', path.join(root, 'countserver.js'), {
    cwd: directory, ipc: true,
    env: { PORT: '3201', CLOUD_SYNC_URL: proxyBase, CLOUD_SYNC_TOKEN: device.token,
      CLOUD_SYNC_INTERVAL_MS: '600000', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', NODE_ENV: 'test' },
  });
}
async function trigger() {
  await new Promise((resolve, reject) => barn.child.send({ type: 'sync-now' }, error => error ? reject(error) : resolve()));
}
async function add(tag) {
  const result = await jsonRequest(`${barnBase}/api/records`, { method: 'POST', body: {
    action: 'add', tag, station: 1, color: 'none', type: 'oveja', woolQuality: 'GOOD', lactation: 'idk', submissionId: crypto.randomUUID(),
  } });
  expect(result.response.status, JSON.stringify(result.data)).toBe(200);
}
async function waitSynced(tag) {
  await waitFor(async () => {
    if (proxyError) throw proxyError;
    return (await records()).pending === 0 && (await remoteRows(tag)).length === 1;
  }, { timeoutMs: 8000, description: `lifecycle sync ${tag}` });
}
function snapshot() {
  const db = new Database(path.join(directory, 'esquila'), { readonly: true });
  try { return { pending: db.prepare('SELECT count(*) n FROM sync_outbox').get().n,
    rows: db.prepare('SELECT tag FROM counts WHERE deleted_at IS NULL').all() }; }
  finally { db.close(); }
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must be disposable');
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  schema = `lifecycle_${crypto.randomUUID().replaceAll('-', '')}`;
  await pool.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.searchParams.set('options', `-csearch_path=${schema}`);
  directory = path.join(await mkdtemp(path.join(os.tmpdir(), 'esquila-lifecycle-')), 'barn'); await mkdir(directory);
  cloud = startNodeService('lifecycle cloud', path.join(root, 'cloud/server.js'), { cwd: path.join(root, 'cloud'),
    env: { PORT: '4201', DATABASE_URL: url.toString(), ADMIN_PASSWORD: password, PUBLIC_URL: cloudBase, NODE_ENV: 'test' } });
  await waitForHealth(cloudBase, cloud);
  device = (await admin('POST', '/api/admin/devices', { name: 'Lifecycle fixture', role: 'server' })).data;
  proxy = createServer(async (req, res) => {
    requests.push(req.url);
    if (network === 'hung') return;
    if (network === 'offline') { res.writeHead(503); res.end(); return; }
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      if (req.url === '/api/sync/ownership') ownershipBatchSizes.push(JSON.parse(body).ids.length);
      const upstream = await fetch(`${cloudBase}${req.url}`, { method: req.method, headers: {
        'Content-Type': 'application/json', Authorization: req.headers.authorization,
      }, body, signal: AbortSignal.timeout(10000) });
      const text = await upstream.text();
      if (req.url === '/api/sync/push' && dropPush) {
        dropPush = false;
        // Hold an acknowledged cloud commit until a newer local edit exists,
        // then lose the response as the network might at quit/reconnect.
        await new Promise(resolve => { releasePush = resolve; });
        releasePush = undefined; res.destroy(); return;
      }
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' }); res.end(text);
    } catch (error) { proxyError = error; res.destroy(); }
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  proxyBase = `http://127.0.0.1:${proxy.address().port}`;
});
test.afterAll(async () => {
  releasePush?.();
  await stopService(barn); await stopService(cloud);
  if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
  if (pool) { if (schema) await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end(); }
  if (directory) await rm(path.dirname(directory), { recursive: true, force: true });
});

test('startup and lifecycle hints sync both ways immediately, including configuration and an ambiguous upload', async () => {
  barn = startBarn(); await waitForHealth(barnBase, barn);
  await waitFor(() => requests.includes('/api/sync/ranch') && requests.includes('/api/sync/configuration'), { timeoutMs: 3000 });
  await waitFor(async () => (await jsonRequest(`${barnBase}/api/configuration`)).data.revision > 0);
  network = 'offline';
  await add('A81001');
  const failures = barn.logs.length;
  await trigger();
  await waitFor(() => barn.logs.slice(failures).join('').includes('Cloud sync failed'));
  expect((await records()).pending).toBe(1);
  const endpoint = `/api/admin/ranches/${device.id}/configuration`;
  const manifest = (await admin('GET', endpoint)).data;
  manifest.configuration.shearers[0].name = 'Lifecycle shearer';
  expect((await admin('PUT', endpoint, { revision: manifest.revision, configuration: manifest.configuration, submissionId: crypto.randomUUID() })).response.status).toBe(200);
  network = 'online'; dropPush = true;
  await trigger();
  await waitFor(() => releasePush);
  // Configuration is independent even while an upload is held open.
  await waitFor(async () => (await jsonRequest(`${barnBase}/api/configuration`)).data.configuration.shearers[0].name === 'Lifecycle shearer');
  const original = (await records()).rows.find(row => row.tag === 'A81001');
  expect((await jsonRequest(`${barnBase}/api/records`, { method: 'POST', body: {
    ...original, action: 'edit', tag: 'A81002', submissionId: crypto.randomUUID(),
  } })).response.status).toBe(200);
  const pushCount = requests.filter(route => route === '/api/sync/push').length;
  for (let i = 0; i < 10; i++) await trigger();
  // The held upload must still be the only upload; release then coalesced retry.
  expect(requests.filter(route => route === '/api/sync/push')).toHaveLength(pushCount);
  releasePush();
  await waitSynced('A81002');
  const remote = (await remoteRows('A81002'))[0];
  expect(remote.id).toBe(original.id);
  expect((await remoteRows('A81001')).length).toBe(0);
  expect((await admin('POST', '/api/admin/shearing', { ...remote, action: 'edit', tag: 'A81003', serverId: device.id, submissionId: crypto.randomUUID() })).response.status).toBe(200);
  await trigger();
  await waitFor(async () => (await records()).rows.some(row => row.tag === 'A81003'));
  // No periodic attempt is due for ten minutes. SIGTERM itself must upload.
  await add('A81004');
  await stopService(barn);
  expect(barn.child.exitCode).toBe(0);
  expect((await remoteRows('A81004')).length).toBe(1);
  expect(snapshot().pending).toBe(0);
});

test('offline/hung shutdown is bounded and all accepted writes replay on the next launch', async () => {
  network = 'hung';
  const ownershipAttempts = requests.filter(route => route === '/api/sync/ownership').length;
  barn = startBarn(); await waitForHealth(barnBase, barn);
  await waitFor(() => requests.filter(route => route === '/api/sync/ownership').length > ownershipAttempts);
  await add('A82001');
  await add('A82002');
  expect((await records()).pending).toBe(2);
  const started = Date.now();
  await stopService(barn);
  expect(barn.child.exitCode).toBe(0); // Not the test helper's SIGKILL fallback.
  expect(Date.now() - started).toBeLessThan(6500);
  // Shutdown cancels the hung ownership request and verifies identity again
  // for its final attempt, without bypassing the check or waiting 30 seconds.
  expect(requests.filter(route => route === '/api/sync/ownership').length).toBe(ownershipAttempts + 2);
  expect(snapshot().pending).toBe(2);
  expect(snapshot().rows.map(row => row.tag)).toEqual(expect.arrayContaining(['A82001', 'A82002']));
  network = 'online';
  barn = startBarn(); await waitForHealth(barnBase, barn);
  await waitSynced('A82001');
  expect((await remoteRows('A82002')).length).toBe(1);
  expect((await records()).rows.filter(row => row.tag === 'A82001')).toHaveLength(1);
  await stopService(barn);
});

test('legacy ownership pages finish promptly before uploads despite a long periodic interval', async () => {
  const db = new Database(path.join(directory, 'esquila'));
  try {
    const template = db.prepare('SELECT * FROM counts LIMIT 1').get();
    const insert = db.prepare(`INSERT INTO counts(id,tag,station,color,lactation,type,woolQuality,date,updated_at,origin,survey_json,mode_json)
      VALUES(?,?,1,'none','idk','oveja','GOOD',?,?,'ranch-server',?,?)`);
    const queue = db.prepare("INSERT INTO sync_outbox(tbl,row_id) VALUES('counts',?)");
    db.transaction(() => {
      for (let i = 0; i < 501; i++) {
        const id = crypto.randomUUID();
        insert.run(id, `A${83000 + i}`, template.date, template.updated_at, template.survey_json, template.mode_json);
        queue.run(id);
      }
    })();
  } finally { db.close(); }
  const requestStart = requests.length, batchStart = ownershipBatchSizes.length;
  barn = startBarn(); await waitForHealth(barnBase, barn);
  // Ten-minute polling cannot account for this progress: the second ownership
  // page must be scheduled by the lifecycle loop's returned short delay.
  await waitFor(async () => (await records()).pending === 1, { timeoutMs: 8000 });
  expect(ownershipBatchSizes.slice(batchStart)).toEqual([500, 1]);
  expect(requests.slice(requestStart).filter(route => route !== '/api/sync/configuration').slice(0, 3))
    .toEqual(['/api/sync/ownership', '/api/sync/ownership', '/api/sync/push']);
  expect((await records()).ownership.unverified).toBe(0);
  await trigger();
  await waitSynced('A83500');
  await stopService(barn);
});
