import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { legacyMode } from '../../shared/modes.js';
import { jsonRequest, startNodeService, stopService, waitFor, waitForHealth } from './helpers.mjs';
const { Pool } = createRequire(new URL('../../cloud/package.json', import.meta.url))('pg');
const root = fileURLToPath(new URL('../..', import.meta.url));
const cloudBase = 'http://127.0.0.1:4197', barnBase = 'http://127.0.0.1:3197';
const password = `modes-fixture-${crypto.randomUUID()}`;
let pool, schema, database, directory, cloud, barn, server, individualId, bulkId, questionId, original;
const admin = (method, route, body) => jsonRequest(`${cloudBase}${route}`, { method, token: password, body });
const local = (route, body) => jsonRequest(`${barnBase}${route}`, { method: body ? 'POST' : 'GET', body });
const endpoint = () => `/api/admin/ranches/${server.id}/configuration`;
const config = async () => (await admin('GET', endpoint())).data;
const records = async () => (await local('/api/records')).data.rows;
const remoteRecord = async id => (await pool.query('SELECT * FROM shearing_events WHERE id=$1', [id])).rows[0];
const syncRow = r => ({ ...r, occurred_at: r.date, wool_quality: r.woolQuality });
function startCloud() {
  return startNodeService('modes cloud', path.join(root, 'cloud/server.js'), { cwd: path.join(root, 'cloud'), env: { PORT: '4197', DATABASE_URL: database, ADMIN_PASSWORD: password, PUBLIC_URL: cloudBase, NODE_ENV: 'test' } });
}
function startBarn() {
  return startNodeService('modes barn', path.join(root, 'countserver.js'), { cwd: directory, env: { PORT: '3197', CLOUD_SYNC_URL: cloudBase, CLOUD_SYNC_TOKEN: server.token, CLOUD_SYNC_INTERVAL_MS: '150', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', NODE_ENV: 'test' } });
}
async function publish(configuration) {
  const current = await config();
  const result = await admin('PUT', endpoint(), { revision: current.revision, configuration, submissionId: crypto.randomUUID() });
  expect(result.response.status, JSON.stringify(result.data)).toBe(200);
  await waitFor(async () => (await local('/api/configuration')).data.revision === result.data.manifest.revision);
  return result.data.manifest;
}
async function login(page, route) {
  await page.goto(`${cloudBase}${route}`);
  if (await page.getByLabel('Contraseña de administración').isVisible()) {
    await page.getByLabel('Contraseña de administración').fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  }
}
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('A disposable TEST_DATABASE_URL is required');
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  schema = `modes_${crypto.randomUUID().replaceAll('-', '')}`; await pool.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.searchParams.set('options', `-csearch_path=${schema}`); database = url.toString();
  await pool.end(); pool = new Pool({ connectionString: database });
  directory = await mkdtemp(path.join(os.tmpdir(), 'esquila-modes-'));
  cloud = startCloud(); await waitForHealth(cloudBase, cloud);
  server = (await admin('POST', '/api/admin/devices', { name: 'Modos de prueba', role: 'server' })).data;
});
test.afterAll(async () => {
  await Promise.all([stopService(barn), stopService(cloud)]);
  if (pool) { if (schema) await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end(); }
});

test('admin creates, names, orders and retires individual/bulk modes without JSON and the barn downloads them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, `/admin/configuration?server=${server.id}`);
  await expect(page.getByLabel('Nombre del galpón', { exact: true })).toHaveValue('Modos de prueba');
  await page.getByLabel('Copiar configuración de').selectOption('carnero');
  await page.getByRole('button', { name: 'Agregar modo', exact: true }).click();
  let section = page.locator('#configuration-fields > details').last();
  await section.getByLabel('Nombre del modo', { exact: true }).fill('Borregas de reemplazo');
  await section.getByRole('button', { name: 'Agregar pregunta', exact: true }).click();
  await section.getByLabel('Pregunta', { exact: true }).fill('¿Se revisó la caravana?');
  await page.getByLabel('Copiar configuración de').selectOption('carnillero');
  await page.getByRole('button', { name: 'Agregar modo', exact: true }).click();
  section = page.locator('#configuration-fields > details').last();
  await section.getByLabel('Nombre del modo', { exact: true }).fill('Corderos por lote');
  await section.getByRole('button', { name: 'Subir modo', exact: true }).click();
  for (const name of ['Ovejas', 'Carneros', 'Corderos']) {
    const mode = page.locator('#configuration-fields > details').filter({ has: page.locator('summary', { hasText: new RegExp(`^${name}$`) }) });
    if (!await mode.evaluate(n => n.open)) await mode.locator('summary').click();
    await mode.getByRole('button', { name: 'Retirar modo', exact: true }).click();
  }
  expect(await page.locator('#configuration-fields').evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Publicar configuración' }).click();
  await expect(page.locator('#configuration-status')).toContainText('Publicada: revisión 1');
  original = (await config()).configuration;
  expect(original.schemaVersion).toBe(3);
  const modes = original.modes.filter(m => m.active);
  expect(modes.map(m => m.name)).toEqual(['Corderos por lote', 'Borregas de reemplazo']);
  bulkId = modes[0].type; individualId = modes[1].type; questionId = modes[1].surveySchema[0].field;
  expect(individualId).not.toBe('carnero');
  barn = startBarn(); await waitForHealth(barnBase, barn);
  await waitFor(async () => (await local('/api/configuration')).data.revision === 1);
  expect((await local('/mode')).data.mode).toBe(bulkId);
  expect((await local('/mode', { mode: 'oveja' })).response.status).toBe(400);
  await page.goto(`${barnBase}/setup`);
  await page.getByLabel('Modo activo').selectOption(individualId);
  await page.getByRole('button', { name: 'Aplicar modo' }).click();
  await expect(page.locator('#mode-status')).toContainText('Modo guardado');
  expect((await local('/mode')).data.mode).toBe(individualId);
});

test('offline selection and frozen animals survive retirement, rename, lost response and restart; snapshots sync both ways', async ({ browser }, testInfo) => {
  test.setTimeout(150000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${barnBase}/tagger/`);
  await page.getByRole('button', { name: 'Estación 1', exact: true }).click();
  await expect(page.getByLabel('Modo de conteo')).toHaveText('Borregas de reemplazo');
  await page.getByRole('button', { name: 'Verde', exact: true }).click();
  const changed = structuredClone(original);
  const retired = changed.modes.find(m => m.type === individualId); retired.name = 'Borregas históricas'; retired.active = false;
  changed.modes.find(m => m.type === bulkId).name = 'Lotes actuales';
  await publish(changed);
  expect((await local('/mode')).data.mode).toBe(bulkId);
  await expect(page.getByText('La configuración cambió. Se usará con el próximo animal.')).toBeVisible();
  await expect(page.getByLabel('Modo de conteo')).toHaveText('Borregas de reemplazo');
  await stopService(cloud);
  await page.getByRole('button', { name: 'A', exact: true }).click();
  for (const digit of '12345') await page.getByRole('button', { name: digit, exact: true }).click();
  await page.getByRole('button', { name: '✔', exact: true }).click();
  await expect(page.getByRole('heading', { name: '¿Se revisó la caravana?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sí', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('mode-and-survey.png'), fullPage: true });
  await page.route('**/count', async route => { await route.fetch(); await route.abort('failed'); });
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
  await stopService(barn); barn = startBarn(); await waitForHealth(barnBase, barn);
  expect((await local('/mode')).data.mode).toBe(bulkId);
  await page.unroute('**/count'); await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.getByText('Conteo registrado', { exact: true })).toBeVisible();
  const [first] = await records();
  expect((await records())).toHaveLength(1); expect(first.pending).toBe(1);
  expect(first.mode).toMatchObject({ id: individualId, name: 'Borregas de reemplazo', bulk: false });
  expect(first.type).toBe(individualId); expect(first.survey.responses[questionId]).toBe('yes');
  await page.reload();
  await expect(page.getByLabel('Modo de conteo')).toHaveText('Lotes actuales');
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: '✔', exact: true }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByText('Conteo registrado', { exact: true })).toBeVisible();
  const bulk = (await records()).filter(r => r.type === bulkId);
  expect(bulk).toHaveLength(2); expect(bulk[0].mode).toEqual({ id: bulkId, name: 'Lotes actuales', bulk: true });
  expect(new Set(bulk.map(r => r.tag)).size).toBe(2);
  expect((await local('/count')).data['1'].byMode).toEqual({ [individualId]: 1, [bulkId]: 2 });
  // The local editor uses the recorded survey and can correct a retired mode offline.
  await page.goto(`${barnBase}/records/`);
  const row = page.getByRole('row').filter({ hasText: 'A12345' });
  await expect(row).toContainText('Borregas de reemplazo');
  await row.getByRole('button', { name: 'Editar' }).click();
  await expect(page.getByLabel('Modo', { exact: true })).toHaveValue(individualId);
  await page.getByLabel('Código', { exact: true }).fill('A12346');
  await page.getByLabel('¿Se revisó la caravana?', { exact: true }).selectOption('no');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'A12346' })).toContainText('Borregas de reemplazo');
  cloud = startCloud(); await waitForHealth(cloudBase, cloud);
  await waitFor(async () => (await remoteRecord(first.id))?.tag === 'A12346');
  expect((await remoteRecord(first.id)).mode).toEqual(first.mode);
  expect((await remoteRecord(first.id)).survey.responses[questionId]).toBe('no');
  const remote = await context.newPage(); await login(remote, `/admin/records?server=${server.id}&type=${individualId}`);
  const remoteRow = remote.getByRole('row').filter({ hasText: 'A12346' });
  await expect(remoteRow).toContainText('Borregas de reemplazo');
  await remoteRow.getByRole('button', { name: 'Editar' }).click();
  await remote.getByLabel('Código', { exact: true }).fill('A12347');
  await remote.getByLabel('¿Se revisó la caravana?', { exact: true }).selectOption('yes');
  await remote.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(remote.getByRole('row').filter({ hasText: 'A12347' })).toBeVisible();
  await waitFor(async () => (await records()).some(r => r.tag === 'A12347' && r.survey.responses[questionId] === 'yes'));
  expect((await records()).find(r => r.id === first.id).mode).toEqual(first.mode);
  await remote.goto(`${cloudBase}/admin?server=${server.id}`);
  await expect(remote.getByRole('columnheader', { name: 'Lotes actuales', exact: true })).toBeVisible();
  await expect(remote.getByRole('columnheader', { name: 'Borregas históricas', exact: true })).toBeVisible();
  await waitFor(async () => (await admin('GET', '/api/admin/ranch')).data.servers[0].information?.mode === bulkId);
  const manualBody = { type: bulkId, station: 1, color: 'none', surveyResponses: {}, action: 'add' };
  const manualLocal = await local('/api/records', { ...manualBody, tag: 'L0020', submissionId: crypto.randomUUID() });
  expect(manualLocal.response.status).toBe(200);
  const manualCloud = await admin('POST', '/api/admin/shearing', { ...manualBody, tag: 'L0021', serverId: server.id, submissionId: crypto.randomUUID() });
  expect(manualCloud.response.status).toBe(200);
  await waitFor(async () => (await records()).some(r => r.id === manualCloud.data.id));
  await waitFor(async () => (await remoteRecord(manualLocal.data.id))?.mode?.id === bulkId);
  expect((await records()).find(r => r.id === manualCloud.data.id).mode).toEqual({ id: bulkId, name: 'Lotes actuales', bulk: true });
  const correction = (await records()).find(r => r.id === manualCloud.data.id);
  expect((await local('/api/records', { ...correction, action: 'edit', type: individualId, tag: 'A65432', submissionId: crypto.randomUUID() })).response.status).toBe(400);
  const flock = (await jsonRequest(`${cloudBase}/api/snapshot`, { token: server.token })).data.shearing_events.find(r => r.id === first.id);
  expect(flock.mode).toEqual(first.mode);
  expect(flock).not.toHaveProperty('survey'); // The vaccination PWA needs the mode label, not full survey payloads for every animal.
  // Missing or migrated legacy metadata must never erase the original mode snapshot.
  await stopService(barn);
  let current = await remoteRecord(first.id);
  const push = rows => jsonRequest(`${cloudBase}/api/sync/push`, { method: 'POST', token: server.token, body: { batches: [{ table: 'shearing_events', rows }] } });
  for (const mode of [undefined, legacyMode(current)]) {
    current = { ...current, mode, tag: 'A12348', updated_at: new Date(Date.parse(current.updated_at) + 1000).toISOString() };
    expect((await push([current])).response.status).toBe(200);
    expect((await remoteRecord(first.id)).mode).toEqual(first.mode);
  }
  const invalidId = crypto.randomUUID();
  expect((await push([{ ...syncRow(first), id: invalidId }, { ...current, mode: { id: 'invalid' } }])).response.status).toBe(400);
  expect(await remoteRecord(invalidId)).toBeUndefined();
  current = await remoteRecord(first.id);
  const deleted = await admin('POST', '/api/admin/shearing', { action: 'delete', id: first.id, updated_at: current.updated_at, submissionId: crypto.randomUUID() });
  expect(deleted.response.status).toBe(200);
  barn = startBarn(); await waitForHealth(barnBase, barn);
  await waitFor(async () => !(await records()).some(r => r.id === first.id));
  expect((await remoteRecord(first.id)).mode).toEqual(first.mode);
  // Switching locally works while cloud is down and persists through a restart.
  const restored = structuredClone(changed); restored.modes.find(m => m.type === individualId).active = true;
  await publish(restored);
  const corrected = await local('/api/records', { ...correction, action: 'edit', type: individualId, tag: 'A65432', color: 'green', submissionId: crypto.randomUUID() });
  expect(corrected.response.status).toBe(200);
  await waitFor(async () => (await remoteRecord(correction.id))?.mode?.id === individualId);
  expect((await remoteRecord(correction.id)).mode.name).toBe('Borregas históricas');
  expect((await remoteRecord(correction.id)).survey.questions).toEqual([]);
  await stopService(cloud); cloud = undefined;
  await page.goto(`${barnBase}/setup`); await page.getByLabel('Modo activo').selectOption(individualId);
  await page.getByRole('button', { name: 'Aplicar modo' }).click(); await expect(page.locator('#mode-status')).toContainText('Modo guardado');
  await stopService(barn); barn = startBarn(); await waitForHealth(barnBase, barn);
  expect((await local('/mode')).data.mode).toBe(individualId);
  await context.close();
});

test('Mac configuration applies locally without saving connection settings or restarting, and reports failures', async ({ page }) => {
  await page.route('http://settings.test/**', async route => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'settings.html';
    if (['shared/i18n.js', 'shared/browser-language.js', 'shared/page-language.js', 'shared/locales/en.js', 'shared/locales/es.js'].includes(name)) return route.fulfill({ body: await readFile(name), contentType: 'text/javascript' });
    if (!['settings.html', 'settings.js'].includes(name)) return route.abort();
    await route.fulfill({ body: await readFile(path.join(root, 'mac', name)), contentType: name.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  await page.addInitScript(({ individualId, bulkId }) => {
    window.mode = individualId; window.saved = false; window.fail = false;
    window.esquila = {
      loadSettings: async () => ({ configured: true, shearers: [{ name: 'Ana' }], cloudAppUrl: '', cloudSyncUrl: '' }),
      saveSettings: async () => { window.saved = true; },
      loadModes: async () => ({ mode: window.mode, modes: [{ type: individualId, name: 'Individual' }, { type: bulkId, name: 'Por lote' }] }),
      setMode: async value => { if (window.fail) throw new Error('Modo retirado'); window.mode = value; },
    };
  }, { individualId, bulkId });
  await page.goto('http://settings.test/');
  await page.getByLabel('Modo activo').selectOption(bulkId);
  await page.getByRole('button', { name: 'Aplicar modo' }).click();
  await expect(page.locator('#mode-status')).toContainText('sin reiniciar');
  expect(await page.evaluate(() => window.mode)).toBe(bulkId); expect(await page.evaluate(() => window.saved)).toBe(false);
  await page.evaluate(() => { window.fail = true; });
  await page.getByLabel('Modo activo').selectOption(individualId); await page.getByRole('button', { name: 'Aplicar modo' }).click();
  await expect(page.locator('#mode-status')).toContainText('No se confirmó el cambio');
  await page.getByRole('button', { name: 'Actualizar lista' }).click();
  await expect(page.getByLabel('Modo activo')).toHaveValue(bulkId);
});
