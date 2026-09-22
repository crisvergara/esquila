import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonRequest, startNodeService, stopService, waitFor, waitForHealth } from './helpers.mjs';
const { Pool } = createRequire(new URL('../../cloud/package.json', import.meta.url))('pg');
const root = fileURLToPath(new URL('../..', import.meta.url));
const cloudBase = 'http://127.0.0.1:4191', barnBase = 'http://127.0.0.1:3191';
const password = `configuration-fixture-${crypto.randomUUID()}`;
let pool, schema, database, directory, cloud, barn, server, other, phone;
const admin = (method, route, body) => jsonRequest(`${cloudBase}${route}`, { method, token: password, body });
const endpoint = () => `/api/admin/ranches/${server.id}/configuration`;
const readConfig = async () => (await admin('GET', endpoint())).data;
const local = async () => (await jsonRequest(`${barnBase}/api/configuration`)).data;
const publish = async (revision, configuration) => {
  const result = await admin('PUT', endpoint(), { revision, configuration, submissionId: crypto.randomUUID() });
  expect(result.response.status, JSON.stringify(result.data)).toBe(200); return result.data.manifest;
};
function startCloud() {
  return startNodeService('configuration cloud', path.join(root, 'cloud/server.js'), { cwd: path.join(root, 'cloud'), env: { PORT: '4191', DATABASE_URL: database, ADMIN_PASSWORD: password, PUBLIC_URL: cloudBase, NODE_ENV: 'test' } });
}
function startBarn() {
  return startNodeService('configuration barn', path.join(root, 'countserver.js'), { cwd: directory, env: { PORT: '3191', CLOUD_SYNC_URL: cloudBase, CLOUD_SYNC_TOKEN: server.token, CLOUD_SYNC_INTERVAL_MS: '150', CLOUD_APP_URL: cloudBase, AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', NODE_ENV: 'test' } });
}
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must be disposable');
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  schema = `configuration_${crypto.randomUUID().replaceAll('-', '')}`;
  await pool.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.searchParams.set('options', `-csearch_path=${schema}`); database = url.toString();
  directory = path.join(await mkdtemp(path.join(os.tmpdir(), 'esquila-config-e2e-')), 'barn'); await mkdir(directory);
  cloud = startCloud(); await waitForHealth(cloudBase, cloud);
  server = (await admin('POST', '/api/admin/devices', { name: 'Galpón principal', role: 'server' })).data;
  other = (await admin('POST', '/api/admin/devices', { name: 'Otro galpón', role: 'server' })).data;
  phone = (await admin('POST', '/api/admin/devices', { name: 'Teléfono', role: 'phone' })).data;
});
test.afterAll(async () => {
  await Promise.all([stopService(barn), stopService(cloud)]);
  if (pool) { if (schema) await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end(); }
});

test('remote editor publishes colors and seven stations, survives a lost response, and enforces server/CSRF boundaries', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  page.on('dialog', d => d.accept());
  expect((await jsonRequest(`${cloudBase}${endpoint()}`)).response.status).toBe(401);
  expect((await jsonRequest(`${cloudBase}/api/server/configuration`, { token: phone.token })).response.status).toBe(403);
  expect((await jsonRequest(`${cloudBase}/api/server/configuration`, { token: server.token })).response.status).toBe(409);
  expect((await jsonRequest(`${cloudBase}/api/sync/configuration`, { token: phone.token, method: 'POST', body: { revision: 0 } })).response.status).toBe(403);
  await page.goto(`${cloudBase}/admin?server=${server.id}#configuration`);
  await page.getByLabel('Contraseña de administración').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(new RegExp(`server=${server.id}`));
  await expect(page.getByLabel('Nombre del galpón', { exact: true })).toHaveValue('Galpón principal');
  await page.getByLabel('Estación 1', { exact: true }).fill('Ana');
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Agregar estación', exact: true }).click();
  await page.getByLabel('Estación 7', { exact: true }).fill('Luis');
  const ewe = page.locator('#configuration details').filter({ has: page.locator('summary', { hasText: 'Ovejas' }) });
  const colors = ewe.locator('.config-options').filter({ has: page.getByRole('heading', { name: 'Colores de caravana' }) });
  await expect(colors.getByLabel('Nombre', { exact: true }).filter({ visible: true })).toHaveCount(10);
  await colors.getByRole('button', { name: 'Agregar color' }).click();
  const added = colors.locator('.config-choice').last();
  await added.getByLabel('Nombre', { exact: true }).fill('Turquesa');
  await added.getByLabel('Color de fondo').fill('#12abcd');
  expect(await page.locator('#configuration').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  let lost;
  await page.route(`**${endpoint()}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch(); lost = await response.json(); await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Publicar configuración' }).click();
  await expect(page.getByRole('button', { name: 'Reintentar publicación' })).toBeVisible();
  expect(lost.manifest.revision).toBe(1);
  await page.unroute(`**${endpoint()}`); await page.reload();
  await page.getByRole('button', { name: 'Reintentar publicación' }).click();
  await expect(page.locator('#configuration-status')).toContainText('Publicada: revisión 1');
  await expect(page.locator('#configuration-status')).toContainText('Pendiente en el galpón');
  const saved = await readConfig();
  expect(saved.revision).toBe(1); expect(saved.configuration.shearers).toHaveLength(7);
  expect((await jsonRequest(`${cloudBase}/api/server/configuration`, { token: other.token })).response.status).toBe(409);
  const tokenManifest = await jsonRequest(`${cloudBase}/api/server/configuration?server=${other.id}`, { token: server.token });
  expect(tokenManifest.data.deviceId).toBe(server.id);
  expect((await admin('PUT', endpoint(), { revision: 0, configuration: saved.configuration, submissionId: crypto.randomUUID() })).response.status).toBe(409);
  const bad = structuredClone(saved.configuration); bad.modes[0].tagSchema.colors[0].color = 'red';
  expect((await admin('PUT', endpoint(), { revision: 1, configuration: bad, submissionId: crypto.randomUUID() })).response.status).toBe(400);
  await request.post(`${cloudBase}/api/admin/login`, { data: { password } });
  expect((await request.put(`${cloudBase}${endpoint()}`, { data: { revision: 1, configuration: saved.configuration, submissionId: crypto.randomUUID() } })).status()).toBe(403);
  barn = startBarn(); await waitForHealth(barnBase, barn);
  await waitFor(async () => (await local()).revision === 1);
  const live = (await jsonRequest(`${barnBase}/api/live`)).data;
  expect(live.configuration.shearers).toHaveLength(7);
  expect((await jsonRequest(`${barnBase}/api/live?configurationId=${encodeURIComponent(live.configurationId)}`)).data.configuration).toBeUndefined();
  expect((await jsonRequest(`${barnBase}/api/live?configurationId=another-server:1`)).data.configuration.shearers).toHaveLength(7);
  await waitFor(async () => (await readConfig()).appliedRevision === 1);
  expect((await jsonRequest(`${barnBase}/setup/shearers`, { method: 'POST', body: { names: ['Override'] } })).response.status).toBe(409);
});

test('live manifest updates preserve in-progress animals, retired history, custom monitor colors and offline restart', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), monitor = await context.newPage();
  await page.goto(`${barnBase}/tagger/`); await monitor.goto(`${barnBase}/monitor/`);
  await page.getByRole('button', { name: 'Ana', exact: true }).click();
  await page.getByRole('button', { name: 'Turquesa', exact: true }).click();
  const original = await readConfig();
  const color = original.configuration.modes[0].tagSchema.colors.find(c => c.name === 'Turquesa').value;
  const next = structuredClone(original.configuration);
  next.modes[0].tagSchema.colors = next.modes[0].tagSchema.colors.filter(c => c.value !== color);
  next.shearers[0].active = false;
  await publish(1, next); await waitFor(async () => (await local()).revision === 2);
  await page.getByRole('button', { name: 'A', exact: true }).click();
  for (const digit of '12345') await page.getByRole('button', { name: digit, exact: true }).click();
  await page.getByRole('button', { name: '✔', exact: true }).click();
  await page.getByRole('button', { name: 'Bueno', exact: true }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  let lost = false;
  await page.route('**/count', async route => {
    if (!lost && route.request().method() === 'POST') { lost = true; await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.getByText('Conteo registrado', { exact: true })).toBeVisible();
  await expect(monitor.getByText('A12345', { exact: true })).toHaveCSS('background-color', 'rgb(18, 171, 205)');
  await expect(page.getByRole('button', { name: 'Luis', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ana', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Luis', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Turquesa', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Verde', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Negro', exact: true })).toBeVisible();
  const base = { station: 7, type: 'oveja', tag: 'A54321', color, woolQuality: 'GOOD', lactation: 'OK' };
  const post = body => jsonRequest(`${barnBase}/count`, { method: 'POST', body: { ...body, submissionId: crypto.randomUUID() } });
  expect((await post(base)).response.status).toBe(400);
  expect((await post({ ...base, color: 'black', configurationRevision: 999 })).response.status).toBe(400);
  expect((await post({ ...base, color: 'black' })).response.status).toBe(200);
  await expect(monitor.getByText('A54321', { exact: true })).toHaveCSS('background-color', 'rgb(22, 22, 22)');
  let records = (await jsonRequest(`${barnBase}/api/records`)).data.rows;
  expect(records.filter(r => r.tag === 'A12345')).toHaveLength(1);
  const retired = records.find(r => r.tag === 'A12345');
  expect((await jsonRequest(`${barnBase}/api/records`, { method: 'POST', body: { ...retired, action: 'edit', tag: 'A12346', submissionId: crypto.randomUUID() } })).response.status).toBe(200);
  await waitFor(async () => (await admin('GET', '/api/admin/shearing?day=&tag=A12346')).data.rows.length === 1);
  const remote = (await admin('GET', '/api/admin/shearing?day=&tag=A12346')).data.rows[0];
  expect((await admin('POST', '/api/admin/shearing', { ...remote, action: 'edit', tag: 'A12347', serverId: server.id, submissionId: crypto.randomUUID() })).response.status).toBe(200);
  await stopService(cloud); cloud = undefined;
  expect((await post({ ...base, color: 'green', tag: 'A77777' })).response.status).toBe(200);
  await stopService(barn); barn = startBarn(); await waitForHealth(barnBase, barn);
  expect((await local()).revision).toBe(2);
  expect((await local()).configuration.shearers[6].name).toBe('Luis');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Negro', exact: true })).toBeVisible();
  expect((await post({ ...base, color: 'black', tag: 'A77778' })).response.status).toBe(200);
  cloud = startCloud(); await waitForHealth(cloudBase, cloud);
  await waitFor(async () => (await admin('GET', '/api/admin/shearing?day=&tag=A7777')).data.rows.length === 2);
  await waitFor(async () => (await jsonRequest(`${barnBase}/api/records?tag=A12347`)).data.rows.length === 1);
  await context.close();
});

test('invalid remote metadata cannot block count synchronization, and revocation preserves the offline configuration', async ({ page }) => {
  const saved = await readConfig();
  await pool.query(`UPDATE ${schema}.ranch_configurations SET revision=3, configuration=jsonb_set(configuration,'{schemaVersion}','2') WHERE device_id=$1`, [server.id]);
  await waitFor(() => barn.logs.some(s => s.includes('Versión de configuración no compatible')));
  expect((await local()).revision).toBe(2);
  expect((await jsonRequest(`${barnBase}/bulk`, { method: 'POST', body: { station: 7, quantity: 1, submissionId: crypto.randomUUID() } })).response.status).toBe(200);
  await waitFor(async () => (await jsonRequest(`${barnBase}/api/records`)).data.pending === 0);
  await pool.query(`UPDATE ${schema}.ranch_configurations SET configuration=$1 WHERE device_id=$2`, [saved.configuration,server.id]);
  await waitFor(async () => (await local()).revision === 3);
  await page.goto(`${cloudBase}/admin?server=${server.id}#configuration`);
  await page.getByLabel('Contraseña de administración').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByLabel('Nombre del galpón', { exact: true })).toHaveValue('Galpón principal');
  await page.locator('#devices tr').filter({ hasText: 'Galpón principal' }).getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByLabel('Nombre del galpón', { exact: true })).toHaveValue('Otro galpón');
  await expect(page).toHaveURL(new RegExp(`server=${other.id}`));
  expect((await jsonRequest(`${cloudBase}/api/server/configuration`, { token: server.token })).response.status).toBe(401);
  expect((await jsonRequest(`${barnBase}/bulk`, { method: 'POST', body: { station: 7, quantity: 1, submissionId: crypto.randomUUID() } })).response.status).toBe(200);
  expect((await local()).revision).toBe(3);
});

test('Mac onboarding previews the selected ranch, gates saving, and surfaces a failed load', async ({ page }) => {
  const configuration = (await admin('GET', `/api/admin/ranches/${other.id}/configuration`)).data.configuration;
  await page.route('http://settings.test/**', async route => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'settings.html';
    if (!['settings.html', 'settings.js'].includes(name)) return route.abort();
    await route.fulfill({ body: await readFile(path.join(root, 'mac', name)), contentType: name.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  await page.addInitScript(({ configuration, deviceId }) => {
    window.saved = [];
    window.esquila = {
      loadSettings: async () => ({ cloudSyncUrl: '', cloudAppUrl: '', hasCloudSyncToken: false, configured: false, shearers: [], openAtLogin: false }),
      previewConfiguration: async value => { if (value.cloudSyncToken !== 'fixture-token') throw new Error('Token inválido.'); return { manifest: { configuration, deviceId, revision: 1 } }; },
      saveSettings: async value => { window.saved.push(value); },
      openAdmin: async () => {},
    };
  }, { configuration, deviceId: other.id });
  await page.goto('http://settings.test/');
  await page.getByLabel('Dirección del servicio').fill('https://example.test');
  await expect(page.getByRole('button', { name: 'Guardar y abrir monitor' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cargar configuración del galpón' }).click();
  await expect(page.locator('#status')).toHaveText('Token inválido.');
  await page.getByLabel('Token del servidor').fill('fixture-token');
  await page.getByRole('button', { name: 'Cargar configuración del galpón' }).click();
  await expect(page.locator('#configuration-preview')).toContainText('Otro galpón');
  await expect(page.locator('#local-stations')).toBeHidden();
  await page.getByRole('button', { name: 'Guardar y abrir monitor' }).click();
  expect((await page.evaluate(() => window.saved))[0].confirmedDeviceId).toBe(other.id);
  await page.getByLabel('Token del servidor').fill('changed-token');
  await expect(page.getByRole('button', { name: 'Guardar y abrir monitor' })).toBeDisabled();
});
