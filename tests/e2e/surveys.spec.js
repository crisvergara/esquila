import { legacySurvey } from '../../shared/surveys.js';
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonRequest, startNodeService, stopService, waitFor, waitForHealth } from './helpers.mjs';
const { Pool } = createRequire(new URL('../../cloud/package.json', import.meta.url))('pg');
const root = fileURLToPath(new URL('../..', import.meta.url));
const cloudBase = 'http://127.0.0.1:4196', barnBase = 'http://127.0.0.1:3196';
const password = `survey-fixture-${crypto.randomUUID()}`;
let pool, schema, database, directory, cloud, barn, server, phone;
const admin = (method, route, body) => jsonRequest(`${cloudBase}${route}`, { method, token: password, body });
const local = (route, body) => jsonRequest(`${barnBase}${route}`, { method: body ? 'POST' : 'GET', body });
const endpoint = () => `/api/admin/ranches/${server.id}/configuration`;
const config = async () => (await admin('GET', endpoint())).data;
const records = async () => (await local('/api/records')).data.rows;
const remoteRecord = async id => (await pool.query(`SELECT * FROM ${schema}.shearing_events WHERE id=$1`, [id])).rows[0];
function startCloud() {
  return startNodeService('survey cloud', path.join(root, 'cloud/server.js'), { cwd: path.join(root, 'cloud'), env: { PORT: '4196', DATABASE_URL: database, ADMIN_PASSWORD: password, PUBLIC_URL: cloudBase, NODE_ENV: 'test' } });
}
function startBarn() {
  return startNodeService('survey barn', path.join(root, 'countserver.js'), { cwd: directory, env: { PORT: '3196', CLOUD_SYNC_URL: cloudBase, CLOUD_SYNC_TOKEN: server.token, CLOUD_SYNC_INTERVAL_MS: '150', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', NODE_ENV: 'test' } });
}
async function publish(configuration) {
  const current = await config();
  const result = await admin('PUT', endpoint(), { revision: current.revision, configuration, submissionId: crypto.randomUUID() });
  expect(result.response.status, JSON.stringify(result.data)).toBe(200);
  return result.data.manifest;
}
async function login(page) {
  await page.goto(`${cloudBase}/admin?server=${server.id}#configuration`);
  if (await page.getByLabel('Contraseña de administración').isVisible()) {
    await page.getByLabel('Contraseña de administración').fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  }
  await expect(page.getByLabel('Nombre del galpón', { exact: true })).toHaveValue('Encuestas de prueba');
}
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('A disposable TEST_DATABASE_URL is required');
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  schema = `survey_${crypto.randomUUID().replaceAll('-', '')}`; await pool.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.searchParams.set('options', `-csearch_path=${schema}`); database = url.toString();
  await pool.end(); pool = new Pool({ connectionString: database });
  directory = await mkdtemp(path.join(os.tmpdir(), 'esquila-surveys-'));
  cloud = startCloud(); await waitForHealth(cloudBase, cloud);
  server = (await admin('POST', '/api/admin/devices', { name: 'Encuestas de prueba', role: 'server' })).data;
  phone = (await admin('POST', '/api/admin/devices', { name: 'Teléfono', role: 'phone' })).data;
});
test.afterAll(async () => {
  await Promise.all([stopService(barn), stopService(cloud)]);
  if (pool) { if (schema) await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end(); }
});

test('admin builds, reorders and retires survey questions without JSON; migration preserves old cloud responses', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  const survey = page.getByRole('region', { name: 'Encuesta Ovejas', exact: true });
  for (let i = 0; i < 2; i++) await survey.getByRole('button', { name: 'Retirar pregunta', exact: true }).first().click();
  await survey.getByRole('button', { name: 'Agregar pregunta', exact: true }).click();
  let question = survey.locator('.config-question').last();
  await question.getByLabel('Pregunta', { exact: true }).fill('¿Está sana?');
  await survey.getByLabel('Tipo de nueva pregunta').selectOption('number');
  await survey.getByRole('button', { name: 'Agregar pregunta', exact: true }).click();
  question = survey.locator('.config-question').last();
  await question.getByLabel('Pregunta', { exact: true }).fill('Peso (kg)');
  await question.getByLabel('Valor mínimo (opcional)').fill('1');
  await question.getByLabel('Valor máximo (opcional)').fill('150');
  await survey.getByLabel('Tipo de nueva pregunta').selectOption('text');
  await survey.getByRole('button', { name: 'Agregar pregunta', exact: true }).click();
  question = survey.locator('.config-question').last();
  await question.getByLabel('Pregunta', { exact: true }).fill('Observaciones');
  await question.getByLabel('Respuesta obligatoria').uncheck();
  await question.getByRole('button', { name: 'Subir pregunta' }).click();
  expect(await page.locator('#configuration').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Publicar configuración' }).click();
  await expect(page.locator('#configuration-status')).toContainText('Publicada: revisión 1');
  const saved = (await config()).configuration;
  expect(saved.schemaVersion).toBe(3);
  expect(saved.modes[0].surveySchema.filter(q => q.active).map(q => q.display)).toEqual(['¿Está sana?', 'Observaciones', 'Peso (kg)']);
  // Existing PostgreSQL rows are backfilled on boot without replacing dates or ids.
  await stopService(cloud);
  const oldId = crypto.randomUUID();
  await pool.query(`INSERT INTO ${schema}.shearing_events(id,tag,type,wool_quality,lactation,occurred_at,updated_at,deleted_at) VALUES($1,'A99999','oveja','EXCELLENT','dry','2020-01-01','2020-01-02','2020-01-03')`, [oldId]);
  cloud = startCloud(); await waitForHealth(cloudBase, cloud);
  const migrated = await remoteRecord(oldId);
  expect(migrated.mode).toEqual({ id: 'oveja', name: 'Ovejas', bulk: false, legacy: true });
  expect(migrated.survey.legacy).toBe(true);
  expect(migrated.survey.responses).toEqual({ woolQuality: 'EXCELLENT', lactation: 'dry' });
  expect(migrated.updated_at.toISOString()).toBe('2020-01-02T00:00:00.000Z');
  expect(migrated.deleted_at.toISOString()).toBe('2020-01-03T00:00:00.000Z');
  const revision = migrated.revision;
  await stopService(cloud); cloud = startCloud(); await waitForHealth(cloudBase, cloud);
  expect((await remoteRecord(oldId)).revision).toBe(revision);
  barn = startBarn(); await waitForHealth(barnBase, barn);
  await waitFor(async () => (await local('/api/configuration')).data.revision === 1);
});

test('offline surveys survive manifest changes, ambiguous retries and restart; both record editors reconcile original answers', async ({ browser }, testInfo) => {
  test.setTimeout(150000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), cloudPage = await context.newPage();
  await page.goto(`${barnBase}/tagger/`);
  await page.getByRole('button', { name: 'Estación 1', exact: true }).click();
  await page.getByRole('button', { name: 'Verde', exact: true }).click();
  const original = (await config()).configuration;
  const active = original.modes[0].surveySchema.filter(q => q.active);
  const [healthy, notes, weight] = active.map(q => q.field);
  const changed = structuredClone(original);
  changed.modes[0].surveySchema.find(q => q.field === healthy).active = false;
  changed.modes[0].surveySchema.find(q => q.field === weight).display = 'Peso nuevo';
  const newer = await publish(changed);
  await waitFor(async () => (await local('/api/configuration')).data.revision === newer.revision);
  await stopService(cloud);
  await page.getByRole('button', { name: 'A', exact: true }).click();
  for (const digit of '12345') await page.getByRole('button', { name: digit, exact: true }).click();
  await page.getByRole('button', { name: '✔', exact: true }).click();
  await expect(page.getByText('¿Está sana?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sí', exact: true }).click();
  await page.getByRole('button', { name: 'Omitir pregunta', exact: true }).click();
  await page.getByLabel('Peso (kg)', { exact: true }).fill('47.5');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  const weightSummary = page.locator('.Survey-summary > div').filter({ has: page.getByText('Peso (kg)', { exact: true }) });
  await expect(weightSummary.locator('dt')).toHaveText('Peso (kg)');
  await expect(weightSummary.locator('dd')).toHaveText('47.5');
  await page.route('**/count', async route => { await route.fetch(); await route.abort('failed'); });
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
  await stopService(barn); barn = startBarn(); await waitForHealth(barnBase, barn);
  await page.unroute('**/count'); await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.getByText('Conteo registrado', { exact: true })).toBeVisible();
  let [record] = await records();
  expect((await records())).toHaveLength(1);
  expect(record.survey.questions.map(q => q.display)).toEqual(active.map(q => q.display));
  expect(record.survey.responses).toEqual({ [healthy]: 'yes', [notes]: null, [weight]: 47.5 });
  await page.goto(`${barnBase}/records/`);
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('¿Está sana?', { exact: true }).selectOption('no');
  await page.getByLabel('Peso (kg)', { exact: true }).fill('50');
  await page.getByLabel('Observaciones', { exact: true }).fill('Revisar mañana');
  await page.route('**/api/records', async route => {
    if (route.request().method() === 'POST') { await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
  await page.unroute('**/api/records'); await page.reload();
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.getByText('El cambio ya estaba guardado. No se duplicó.')).toBeVisible();
  [record] = await records();
  expect(record.survey.responses[healthy]).toBe('no'); expect(record.survey.responses[weight]).toBe(50);
  cloud = startCloud(); await waitForHealth(cloudBase, cloud);
  await waitFor(async () => (await remoteRecord(record.id))?.survey.responses[weight] === 50);
  await waitFor(async () => (await records())[0].pending === 0);
  await stopService(barn); // cloud corrections wait durably for an offline barn
  await login(cloudPage);
  await cloudPage.getByRole('navigation', { name: 'Administración' }).getByRole('link', { name: 'Registros' }).click();
  const row = cloudPage.locator('#ranch-rows tr').filter({ hasText: 'A12345' });
  await row.getByRole('button', { name: 'Editar', exact: true }).click();
  await cloudPage.getByLabel('¿Está sana?', { exact: true }).selectOption('yes');
  await cloudPage.getByLabel('Peso (kg)', { exact: true }).fill('52');
  const editor = cloudPage.locator('#ranch-editor');
  expect(await editor.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await cloudPage.screenshot({ path: testInfo.outputPath('historical-survey-editor.png') });
  await cloudPage.route('**/api/admin/shearing', async route => {
    if (route.request().method() === 'POST') { await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await cloudPage.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(cloudPage.getByRole('button', { name: 'Reintentar mismo cambio' })).toBeVisible();
  await cloudPage.unroute('**/api/admin/shearing'); await cloudPage.reload();
  await cloudPage.getByRole('button', { name: 'Reintentar mismo cambio' }).click();
  await expect(cloudPage.locator('#ranch-result')).toContainText('Guardado en la nube');
  barn = startBarn(); await waitForHealth(barnBase, barn);
  await waitFor(async () => (await records())[0].survey.responses[weight] === 52);
  const synced = (await records())[0];
  expect(synced.survey.questions).toEqual(record.survey.questions);
  expect(synced.survey.responses).toEqual({ [healthy]: 'yes', [notes]: 'Revisar mañana', [weight]: 52 });
  expect(synced.date).toBe(record.date);
  // Stale editor and invalid response writes cannot mutate committed answers.
  expect((await local('/api/records', { ...record, action: 'edit', surveyResponses: record.survey.responses, submissionId: crypto.randomUUID() })).response.status).toBe(409);
  const invalid = await admin('POST', '/api/admin/shearing', { ...synced, action: 'edit', serverId: server.id, surveyResponses: { ...synced.survey.responses, [weight]: 999 }, submissionId: crypto.randomUUID() });
  expect(invalid.response.status).toBe(400);
  expect((await remoteRecord(record.id)).survey.responses[weight]).toBe(52);
  // Old server versions omit the new column: preserve custom answers on upload.
  const oldClient = await remoteRecord(record.id); delete oldClient.survey; delete oldClient.revision;
  oldClient.updated_at = new Date(Date.now() + 1000).toISOString(); oldClient.color = 'black';
  const push = body => jsonRequest(`${cloudBase}/api/sync/push`, { method: 'POST', token: server.token, body });
  const batch = { batches: [{ table: 'shearing_events', rows: [oldClient] }] };
  expect((await push(batch)).response.status).toBe(200);
  expect((await remoteRecord(record.id)).survey).toEqual(synced.survey);
  const remote = await remoteRecord(record.id);
  expect((await push(batch)).response.status).toBe(200);
  expect((await remoteRecord(record.id)).revision).toBe(remote.revision);
  const migratedUpload = { ...oldClient, updated_at: new Date(Date.now() + 2000).toISOString(), survey: legacySurvey(oldClient) };
  expect((await push({ batches: [{ table: 'shearing_events', rows: [migratedUpload] }] })).response.status).toBe(200);
  expect((await remoteRecord(record.id)).survey).toEqual(synced.survey);
  await waitFor(async () => (await records())[0].updated_at === migratedUpload.updated_at);
  expect((await records())[0].survey).toEqual(synced.survey);
  expect((await jsonRequest(`${cloudBase}/api/sync/push`, { method: 'POST', token: phone.token, body: batch })).response.status).toBe(403);
  // A bad survey aborts a whole sync batch, including otherwise valid rows.
  const good = { ...remote, id: crypto.randomUUID(), tag: 'A22222' }, bad = { ...remote, id: crypto.randomUUID(), survey: { ...remote.survey, responses: { bogus: 'x' } } };
  expect((await push({ batches: [{ table: 'shearing_events', rows: [good, bad] }] })).response.status).toBe(400);
  expect(await remoteRecord(good.id)).toBeUndefined();
  await context.close();
});

test('survey questions stay prominent and in view after the keypad and long answer lists', async ({ browser }, testInfo) => {
  const settings = structuredClone((await config()).configuration);
  const longQuestion = '¿Qué condición presenta este animal al finalizar la esquila? Revisa cuidadosamente las opciones antes de registrar tu respuesta.';
  const longAnswer = 'Necesita una revisión adicional antes de regresar al potrero';
  const questions = [
    { field: 'condition', display: longQuestion, type: 'choice', options: Array.from({ length: 12 }, (_, i) => ({ value: `condition_${i}`, name: i === 11 ? longAnswer : `Condición ${i + 1}` })) },
    { field: 'notes', display: '¿Qué observaciones debemos guardar para la próxima revisión?', type: 'text', required: false, maxLength: 100 },
    { field: 'weight', display: '¿Cuánto pesa el animal en kilogramos?', type: 'number', min: 1, max: 150 },
    // Labels need not be unique: each question/answer keeps its own stable id.
    { field: 'second_condition', display: longQuestion, type: 'choice', options: [{ value: 'yes', name: 'Sí' }, { value: 'no', name: 'No' }] },
  ];
  settings.modes[0].surveySchema = questions;
  settings.modes[2].surveySchema = questions;
  const manifest = await publish(settings);
  await waitFor(async () => (await local('/api/configuration')).data.revision === manifest.revision);
  const before = (await records()).length;
  for (const [width, height, bulk] of [[320, 568, false], [390, 844, true], [640, 360, false], [1280, 800, false]]) {
    await local('/mode', { mode: bulk ? 'carnillero' : 'oveja' });
    const context = await browser.newContext({ viewport: { width, height } });
    try {
      const page = await context.newPage();
      await page.goto(`${barnBase}/tagger/`);
      await page.getByRole('button', { name: 'Estación 1', exact: true }).click();
      if (!bulk) {
        await page.getByRole('button', { name: 'Verde', exact: true }).click();
        await page.getByRole('button', { name: 'A', exact: true }).click();
      }
      for (const digit of bulk ? '2' : '12345') await page.getByRole('button', { name: digit, exact: true }).click();
      await page.getByRole('button', { name: '✔', exact: true }).click();
      const assertQuestion = async (index) => {
        const heading = page.getByRole('heading', { name: questions[index].display, exact: true });
        await expect(heading).toBeInViewport({ ratio: 1 });
        await expect(heading).toBeFocused();
        await expect(page.getByText(`Pregunta ${index + 1} de 4`, { exact: true })).toBeVisible();
        expect(await heading.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(28);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      };
      await assertQuestion(0);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      if (height > 500) await expect(page.getByRole('heading', { name: longQuestion, exact: true })).toBeInViewport({ ratio: 1 });
      await page.getByRole('group', { name: longQuestion, exact: true }).getByRole('button', { name: longAnswer, exact: true }).click();
      await assertQuestion(1);
      await page.getByRole('button', { name: 'Omitir pregunta', exact: true }).click();
      await assertQuestion(2);
      await expect(page.locator('.Survey-header')).toHaveCSS('position', 'static');
      await page.getByLabel(questions[2].display, { exact: true }).fill('42.5');
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await assertQuestion(3);
      await page.screenshot({ path: testInfo.outputPath(`question-${width}.png`) });
      await page.getByRole('button', { name: 'No', exact: true }).click();
      const summary = page.locator('.Survey-summary');
      await expect(summary.locator('dt')).toHaveText(questions.map(q => q.display));
      await expect(summary.locator('dd')).toHaveText([longAnswer, 'Sin respuesta', '42.5', 'No']);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // Inspect the review without recording a real/synthetic animal in this test.
      await page.getByRole('button', { name: 'Cancelar', exact: true }).last().click();
    } finally { await context.close(); }
  }
  expect((await records()).length).toBe(before);
});

test('rams and lamb batches use configured surveys; new manual records and tombstones sync', async ({ browser }) => {
  const settings = structuredClone((await config()).configuration);
  settings.modes[1].surveySchema = [{ field: 'horns', display: '¿Tiene cuernos?', type: 'choice', options: [{ name: 'Sí', value: 'yes' }, { name: 'No', value: 'no' }] }];
  settings.modes[2].surveySchema = [{ field: 'batch_notes', display: 'Nota del lote', type: 'text', required: false, maxLength: 100 }];
  const manifest = await publish(settings);
  await waitFor(async () => (await local('/api/configuration')).data.revision === manifest.revision);
  const body = { type: 'carnero', station: 1, color: 'green', tag: 'AC12345', surveyResponses: { horns: 'yes' }, configurationRevision: manifest.revision, submissionId: crypto.randomUUID() };
  expect((await local('/count', body)).response.status).toBe(200);
  const bulk = { station: 1, quantity: 2, surveyResponses: { batch_notes: 'Revisados' }, submissionId: crypto.randomUUID() };
  expect((await local('/bulk', bulk)).response.status).toBe(200);
  expect((await local('/bulk', bulk)).data.created).toBe(false);
  await waitFor(async () => (await records()).filter(r => r.type === 'borrega').length === 2);
  for (const row of (await records()).filter(r => r.type === 'borrega')) expect(row.survey.responses.batch_notes).toBe('Revisados');
  const context = await browser.newContext(); const page = await context.newPage();
  await page.goto(`${barnBase}/records/`); await page.getByRole('button', { name: 'Agregar registro', exact: true }).click();
  await page.getByLabel('Modo', { exact: true }).selectOption('carnero');
  await page.getByLabel('Código', { exact: true }).fill('AC54321');
  await page.getByLabel('¿Tiene cuernos?', { exact: true }).selectOption('no');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Cambio guardado en el galpón. Se sincronizará automáticamente.')).toBeVisible();
  const manual = (await records()).find(r => r.tag === 'AC54321');
  await waitFor(async () => (await remoteRecord(manual.id))?.survey.responses.horns === 'no');
  const del = await admin('POST', '/api/admin/shearing', { action: 'delete', id: manual.id, updated_at: (await remoteRecord(manual.id)).updated_at.toISOString(), submissionId: crypto.randomUUID() });
  expect(del.response.status).toBe(200);
  await waitFor(async () => !(await records()).some(r => r.id === manual.id));
  expect((await remoteRecord(manual.id)).survey.responses.horns).toBe('no');
  await login(page);
  await page.getByRole('navigation', { name: 'Administración' }).getByRole('link', { name: 'Registros' }).click();
  await page.getByRole('button', { name: 'Agregar registro', exact: true }).click();
  await page.locator('#record-type').selectOption('carnero');
  await page.locator('#record-tag').fill('AC56789');
  await page.getByLabel('¿Tiene cuernos?', { exact: true }).selectOption('yes');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.locator('#ranch-result')).toContainText('Guardado en la nube');
  await waitFor(async () => (await records()).some(r => r.tag === 'AC56789' && r.survey.responses.horns === 'yes'));
  await context.close();
});
