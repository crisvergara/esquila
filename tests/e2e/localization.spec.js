import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startNodeService, stopService, waitForHealth, jsonRequest } from './helpers.mjs';
const { Pool } = createRequire(new URL('../../cloud/package.json', import.meta.url))('pg');
const root = fileURLToPath(new URL('../..', import.meta.url));
const barnBase = 'http://127.0.0.1:4210', cloudBase = 'http://127.0.0.1:4211';
const password = 'localization-disposable-test-password';
let barn, cloud, pool, schema, dir, server;
const admin = (method, route, body) => jsonRequest(cloudBase + route, { method, body, token: password });
const startBarn = () => startNodeService('language barn', path.join(root, 'countserver.js'), { cwd: dir, env: { PORT: '4210', NODE_ENV: 'test', CLOUD_SYNC_URL: '', CLOUD_SYNC_TOKEN: '', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '' } });
async function chooseLanguage(page, value) {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('combobox', {name: /Idioma.*Language|Idioma.*language/}).selectOption(value);
  await expect(page.locator('html')).toHaveAttribute('lang', value);
}
test.beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Disposable TEST_DATABASE_URL required');
  schema = `language_${crypto.randomUUID().replaceAll('-', '')}`;
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await pool.query(`CREATE SCHEMA ${schema}`); await pool.end();
  const url = new URL(process.env.TEST_DATABASE_URL); url.searchParams.set('options', `-csearch_path=${schema}`);
  pool = new Pool({ connectionString: url.toString() });
  cloud = startNodeService('language cloud', path.join(root, 'cloud/server.js'), { cwd: path.join(root, 'cloud'), env: { PORT: '4211', NODE_ENV: 'test', DATABASE_URL: url.toString(), ADMIN_PASSWORD: password, PUBLIC_URL: cloudBase } });
  await waitForHealth(cloudBase, cloud);
  server = (await admin('POST', '/api/admin/devices', { name: 'Guardar', role: 'server' })).data;
  dir = await mkdtemp(path.join(os.tmpdir(), 'esquila-language-'));
  barn = startBarn(); await waitForHealth(barnBase, barn);
  await jsonRequest(`${barnBase}/setup/shearers`, { method: 'POST', body: { names: ['Configuración'] } });
});
test.afterAll(async () => {
  await stopService(barn); await stopService(cloud);
  if (pool) { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end(); }
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('English cloud controls persist across screens and login, while ranch-authored questions and labels stay literal', async ({ page }, info) => {
  await page.goto(`${cloudBase}/admin`); await chooseLanguage(page, 'en');
  await expect(page.getByRole('heading', { name: 'Esquila · Administration' })).toBeVisible();
  await page.getByLabel('Administration password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Administration' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Guardar', exact: true })).toBeVisible();
  for (const [label, heading] of [['Records','Browse shearing records'], ['Devices','Enroll a device'], ['My account and access','Create my first account'], ['Configuration','Barn configuration']]) {
    await page.getByRole('navigation').getByRole('link', { name: label, exact: false }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  }
  await expect(page.getByLabel('Barn name', {exact:true})).toHaveValue('Guardar');
  await expect(page.locator('.config-question').first().getByLabel('Question', {exact:true})).toHaveValue('¿Cómo es la calidad de la lana?');
  // Labels that look exactly like built-in text must not be translated as data.
  await page.getByLabel('Barn name', {exact:true}).fill('Configuración');
  await page.getByRole('button', {name:'Publish configuration'}).click();
  await expect(page.locator('#configuration-status')).toContainText('Published: revision 1');
  expect((await admin('GET', `/api/admin/ranches/${server.id}/configuration`)).data.configuration.name).toBe('Configuración');
  await page.reload(); await expect(page.getByLabel('Barn name', {exact:true})).toHaveValue('Configuración');
  const message = await page.evaluate(async () => {
    const { api } = await import('/admin-ui.js');
    try { await api('GET', '/api/admin/ranches/invalid/configuration'); } catch (error) { return error.message; }
  });
  expect(message).toBe('Invalid barn identifier.');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('english-admin.png')});
  await page.getByRole('button', {name:'Sign out'}).click();
  await expect(page.getByRole('button', {name:'Sign in',exact:true})).toBeVisible();
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('lang','en');
});

test('English local controls and Spanish tagger coexist offline; language changes preserve counts, retries and snapshots', async ({ page, context }, info) => {
  await context.route('**/*', route => new URL(route.request().url()).origin === barnBase ? route.continue() : route.abort());
  await page.goto(`${barnBase}/setup`); await chooseLanguage(page, 'en');
  await expect(page.getByText('Device settings', {exact:true})).toBeVisible();
  await expect(page.getByRole('button', { name:'Apply mode' })).toBeVisible();
  await page.goto(`${barnBase}/records/`);
  await expect(page.getByRole('heading', { name:'Recent records' })).toBeVisible();
  await page.goto(`${barnBase}/tagger-setup`);
  await expect(page.getByRole('heading', { name:'Connect phones to the barn' })).toBeVisible();
  await expect(page.locator('#tagger-qr')).toBeVisible();
  await page.goto(`${barnBase}/tagger/`);
  await expect(page.locator('html')).toHaveAttribute('lang','es');
  await expect(page.getByText('Elige un esquilador')).toBeVisible();
  await page.getByRole('button', {name:'Configuración',exact:true}).click();
  await page.getByRole('button', {name:'Verde',exact:true}).click();
  await expect(page.getByRole('combobox',{name:/Idioma/})).toHaveCount(0); // no reload during an animal
  await page.getByRole('button', {name:'A',exact:true}).click();
  for(const digit of '19385') await page.getByRole('button', {name:digit,exact:true}).click();
  await page.getByRole('button',{name:'✔',exact:true}).click();
  await expect(page.getByRole('heading',{name:'¿Cómo es la calidad de la lana?'})).toBeVisible();
  await page.getByRole('button',{name:'Buena',exact:true}).click();
  await expect(page.getByRole('heading',{name:'¿La oveja está en lactancia?'})).toBeVisible();
  await page.getByRole('button',{name:'Sí',exact:true}).click();
  let swallowed = false;
  await page.route('**/count', async route => { if (!swallowed) { swallowed = true; await route.fetch(); await route.abort(); } else await route.continue(); });
  await page.getByRole('button',{name:'OK',exact:true}).click();
  await expect(page.getByRole('heading',{name:'No se pudo guardar'})).toBeVisible();
  await page.getByRole('button',{name:'Reintentar',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Conteo registrado'})).toBeVisible();
  await expect(page.getByText('Elige un color')).toBeVisible();
  const records = (await jsonRequest(`${barnBase}/api/records?tag=A19385`)).data.rows;
  expect(records).toHaveLength(1); expect(records[0].survey.responses).toMatchObject({ woolQuality:'GOOD', lactation:'OK' });
  expect(records[0].survey.questions[1].display).toBe('¿La oveja está en lactancia?');
  await chooseLanguage(page, 'en');
  await expect(page.getByText('Choose a color')).toBeVisible();
  await page.getByRole('button',{name:'Change shearer'}).click();
  await expect(page.getByRole('button',{name:'Configuración',exact:true})).toBeVisible();
  await page.reload(); await expect(page.getByText('Choose a shearer')).toBeVisible();
  await chooseLanguage(page,'es');
  await page.setViewportSize({width:320,height:740});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('spanish-tagger.png')});
  await stopService(barn); barn = startBarn(); await waitForHealth(barnBase,barn);
  await page.reload(); await expect(page.getByText('Elige un esquilador')).toBeVisible();
  await page.goto(`${barnBase}/records/`); await expect(page.getByRole('heading',{name:'Recent records'})).toBeVisible();
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await expect(page.getByLabel('¿La oveja está en lactancia?')).toHaveValue('OK');
  expect((await jsonRequest(`${barnBase}/api/records?tag=A19385`)).data.rows[0].survey).toEqual(records[0].survey);
  await page.goto(`${barnBase}/tagger/?lang=invalid`);
  await expect(page.locator('html')).toHaveAttribute('lang','es');
  await page.evaluate(() => { const write = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('esquila-language-')) throw new DOMException('Blocked', 'SecurityError'); return write.call(this,key,value); }; });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('combobox',{name:/Idioma/}).selectOption('en');
  await expect(page.getByRole('alert')).toContainText('No se pudo guardar el idioma');
  await expect(page.locator('html')).toHaveAttribute('lang','es');
});

test('Mac language selection uses native persistence and English settings/update errors are visible offline', async ({ page }) => {
  await page.route('http://settings.test/**', async route => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'mac/settings.html';
    if (!['mac/settings.html','mac/settings.js','mac/update.html','mac/update.css','mac/update-window.js','shared/i18n.js','shared/browser-language.js','shared/page-language.js','shared/locales/en.js','shared/locales/es.js'].includes(name)) return route.abort();
    await route.fulfill({body:await readFile(path.join(root,name)),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});
  });
  await page.addInitScript(() => {
    window.esquila = {
      setLanguage: async value => localStorage.setItem('native-language',value),
      loadSettings:async()=>({configured:true,shearers:[{name:'Guardar'}],cloudAppUrl:'',cloudSyncUrl:''}),
      loadModes:async()=>({mode:'oveja',modes:[{type:'oveja',name:'Ovejas'}]}),
      setMode:async()=>{throw new Error('Modo inválido.');},
    };
    window.updates = { state:async()=>({phase:'error',error:'La descarga está incompleta. Reintenta para continuar.'}),subscribe:()=>{},action:async()=>{} };
  });
  await page.goto('http://settings.test/mac/settings.html'); await chooseLanguage(page,'en');
  expect(await page.evaluate(()=>localStorage.getItem('native-language'))).toBe('en');
  await expect(page.getByRole('button',{name:'Save and open monitor'})).toBeVisible();
  await expect(page.locator('.name-input')).toHaveValue('Guardar');
  await page.getByRole('button',{name:'Apply mode'}).click();
  await expect(page.locator('#mode-status')).toContainText('Invalid mode.');
  await page.reload(); await expect(page.getByRole('button',{name:'Apply mode'})).toBeVisible();
  await page.goto('http://settings.test/mac/update.html?lang=en');
  await expect(page.getByRole('status')).toHaveText('The download is incomplete. Try again to resume.');
});
