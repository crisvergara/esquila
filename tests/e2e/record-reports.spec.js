import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonRequest, startNodeService, stopService, waitFor, waitForHealth } from './helpers.mjs';
import { validateQuestions } from '../../shared/surveys.js';
import { legacyMode } from '../../shared/modes.js';
const { Pool } = createRequire(new URL('../../cloud/package.json', import.meta.url))('pg');
const root = fileURLToPath(new URL('../..', import.meta.url));
const remote = 'http://127.0.0.1:4202', local = 'http://127.0.0.1:3202';
const password = `reports-fixture-${crypto.randomUUID()}`;
let pool, schema, database, directory, cloud, barn, server, phone, other, events;
const questions = validateQuestions([
  {field:'good',display:'¿Buena lana?',type:'choice',required:false,options:[{value:'yes',name:'Sí'},{value:'no',name:'No'}]},
  {field:'weight',display:'Peso',type:'number',required:false},
  {field:'notes',display:'Notas',type:'text',required:false},
]);
const admin = (method, route, body) => jsonRequest(remote + route, {method, token:password, body});
async function remoteList(query = '') {
  const result = await admin('GET', `/api/admin/shearing?day=&report=1&${query}`);
  expect(result.response.status, JSON.stringify(result.data)).toBe(200); return result.data;
}
async function localList(query = '') {
  const result = await jsonRequest(`${local}/api/records?report=1&${query}`);
  expect(result.response.status, JSON.stringify(result.data)).toBe(200); return result.data;
}
const push = (device, rows) => jsonRequest(`${remote}/api/sync/push`, { method:'POST', token:device.token, body:{batches:[{table:'shearing_events',rows}]} });
function startCloud() {
  return startNodeService('report cloud', path.join(root,'cloud/server.js'), {cwd:path.join(root,'cloud'),env:{PORT:'4202',DATABASE_URL:database,ADMIN_PASSWORD:password,PUBLIC_URL:remote,NODE_ENV:'test'}});
}
function startBarn() {
  return startNodeService('report barn',path.join(root,'countserver.js'),{cwd:directory,env:{PORT:'3202',CLOUD_SYNC_URL:remote,CLOUD_SYNC_TOKEN:server.token,CLOUD_SYNC_INTERVAL_MS:'100',AWS_ACCESS_KEY_ID:'',AWS_SECRET_ACCESS_KEY:'',NODE_ENV:'test'}});
}
test.describe.configure({mode:'serial'});
test.beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Disposable TEST_DATABASE_URL required');
  pool = new Pool({connectionString:process.env.TEST_DATABASE_URL});
  schema = `reports_${crypto.randomUUID().replaceAll('-','')}`; await pool.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.searchParams.set('options',`-csearch_path=${schema}`); database = url.toString();
  directory = await mkdtemp(path.join(os.tmpdir(),'esquila-reports-'));
  cloud = startCloud(); await waitForHealth(remote,cloud);
  server = (await admin('POST','/api/admin/devices',{name:'Reports fixture',role:'server'})).data;
  phone = (await admin('POST','/api/admin/devices',{name:'Phone fixture',role:'phone'})).data;
  other = (await admin('POST','/api/admin/devices',{name:'Other fixture',role:'server'})).data;
  events = Array.from({length:250}, (_,i) => ({id:crypto.randomUUID(),tag:`A${50000+i}`,station:i%2+1,type:'oveja',color:'none',wool_quality:'GOOD',lactation:'idk',
    occurred_at:'2026-01-02T12:00:00.000Z',updated_at:'2026-01-03T00:00:00.000Z',mode:legacyMode({type:'oveja'}),
    survey:{schemaVersion:1,questions,responses:{good:i===249?null:i%2?'yes':'no',weight:i===249?null:i%2?10:0,notes:i%2?'Nota':null}}}));
  const variant = {...questions[0],display:'Pregunta <img src=x onerror=alert(1)>',options:[{value:'yes',name:'Renombrado',active:true},{value:'no',name:'No',active:true}]};
  events.push({...events[0],id:crypto.randomUUID(),tag:'A60000',survey:{schemaVersion:1,questions:[],responses:{}}},
    {...events[0],id:crypto.randomUUID(),tag:'A60001',survey:{schemaVersion:1,questions:[variant],responses:{good:'yes'}}},
    {...events[0],id:crypto.randomUUID(),tag:'A60002',occurred_at:'2026-01-02T02:59:59.999Z'},
    {...events[0],id:crypto.randomUUID(),tag:'A60003',deleted_at:'2026-01-03T00:00:00.000Z'});
  expect((await push(server,events)).response.status).toBe(200);
  expect((await push(other,[{...events[0],id:crypto.randomUUID(),tag:'B99999',occurred_at:'2027-01-01T12:00:00.000Z'}])).response.status).toBe(200);
  barn=startBarn(); await waitForHealth(local,barn);
  await waitFor(async () => (await localList()).total === 253);
});
test.afterAll(async () => {
  await stopService(barn); await stopService(cloud);
  if (pool) { if(schema) await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end(); }
  if(directory) await rm(directory,{recursive:true,force:true});
});

test('SQLite and PostgreSQL reports agree across all pages, Chile dates, historical questions and authorization', async () => {
  const a = await localList('day=2026-01-02&limit=25&offset=25');
  const b = await remoteList(`from=2026-01-02&to=2026-01-02&server=${server.id}&limit=25&offset=25`);
  expect(a.total).toBe(252); expect(a.rows).toHaveLength(25); expect(a.report.total).toBe(252);
  expect(a.report).toEqual(b.report);
  expect(a.report.surveyed).toBe(251);
  const good = a.report.questions.find(q => q.display === '¿Buena lana?');
  expect(good).toMatchObject({asked:250,answered:249,missing:1});
  expect(good.choices.find(c => c.value === 'yes').count).toBe(124);
  expect(a.report.questions.find(q => q.field === 'weight')).toMatchObject({minimum:0,maximum:10,answered:249});
  expect(a.report.questions.filter(q => q.field === 'good')).toHaveLength(2);
  expect((await localList('day=2026-01-01')).total).toBe(1);
  expect((await remoteList(`from=2026-01-02&to=2026-01-02&deleted=1&server=${server.id}`)).report.total).toBe(252);
  expect((await remoteList('deleted=only')).report.total).toBe(0);
  expect((await remoteList(`server=${other.id}`)).report.total).toBe(1);
  expect((await remoteList('tag=NO-MATCH')).report.total).toBe(0);
  for (const token of [undefined,phone.token,server.token]) expect((await jsonRequest(`${remote}/api/admin/shearing?day=&report=1`,{token})).response.status).toBe(401);
  for (const base of [local,remote]) {
    const route = base === local ? '/api/records' : '/api/admin/shearing';
    for (const query of ['day=2026-02-30','limit=999','offset=-1','report[]=1','report=yes']) expect((await jsonRequest(`${base}${route}?${query}`,{token:base===remote?password:undefined})).response.status).toBe(400);
  }
});

test('ranch rows are numbered beyond 200, filters survive reload, reports work offline, and survey edits sync', async ({page}, testInfo) => {
  await stopService(cloud); cloud=undefined;
  await page.goto(`${local}/records/?lang=en`);
  await page.getByLabel('Day (Chile)').fill('2026-01-02');
  await page.getByLabel('Per page').selectOption('100');
  const table = page.getByRole('table',{name:'Shearing records',exact:true});
  await expect(table.locator('tbody tr')).toHaveCount(100);
  await expect(table.locator('tbody tr').first().locator('td').first()).toHaveText('1');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(table.locator('tbody tr').first().locator('td').first()).toHaveText('101');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(table.locator('tbody tr').first().locator('td').first()).toHaveText('201');
  await expect(table.locator('tbody tr')).toHaveCount(52);
  await page.reload();
  await expect(page.getByLabel('Day (Chile)')).toHaveValue('2026-01-02');
  await expect(table.locator('tbody tr').first().locator('td').first()).toHaveText('201');
  await page.getByText('Summary and reports',{exact:true}).click();
  await expect(page.locator('.report-total').first()).toContainText('252');
  await expect(page.locator('.report-question').filter({hasText:'¿Buena lana?'})).toContainText('Asked: 250');
  await expect(page.locator('.record-report img')).toHaveCount(0);
  const row = (await localList('day=2026-01-02&limit=100&offset=200')).rows.find(r => r.survey.questions.length===3);
  await table.getByRole('row').filter({hasText:row.tag}).getByRole('button',{name:'Edit',exact:true}).click();
  const editor = page.getByRole('region',{name:'Record form',exact:true});
  await editor.getByLabel('¿Buena lana?',{exact:true}).selectOption('yes');
  await editor.getByLabel('Peso',{exact:true}).fill('20');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByText('Change saved at the barn. It will sync automatically.',{exact:true})).toBeVisible();
  const edited = (await localList(`tag=${row.tag}`)).rows[0];
  expect(edited.pending).toBe(1); expect(edited.survey.responses.weight).toBe(20);
  await expect(page.locator('.report-question').filter({hasText:'Peso'})).toContainText('20');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('ranch-records-phone.png')});
  await page.locator('.record-report').screenshot({path:testInfo.outputPath('ranch-report.png')});
  cloud=startCloud(); await waitForHealth(remote,cloud);
  await waitFor(async () => (await remoteList(`tag=${row.tag}`)).rows[0].survey.responses.weight===20);
  expect((await localList('day=2026-01-02')).report).toEqual((await remoteList(`from=2026-01-02&to=2026-01-02&server=${server.id}`)).report);
  await page.route('**/api/records?**',route=>route.abort('failed'));
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('out of date');
});

test('cloud day shortcut, numbered pages and full reports render in English on a phone and recover from errors', async ({page},testInfo) => {
  await page.goto(`${remote}/admin/records?server=${server.id}&lang=en`);
  await page.getByLabel('Administration password').fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByLabel('Day (Chile)').fill('2026-01-02');
  await expect(page.locator('#ranch-summary')).toContainText('252');
  await page.getByLabel('Per page').selectOption('100');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.locator('#ranch-rows tr').first().locator('td').first()).toHaveText('101');
  await page.getByText('Summary and reports',{exact:true}).click();
  await expect(page.locator('.report-total').first()).toContainText('252');
  await expect(page.getByRole('heading',{name:'¿Buena lana?',exact:true})).toBeVisible();
  await expect(page.locator('.record-report img')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Summary and reports',{exact:true})).toBeVisible();
  await expect(page.locator('#ranch-reports')).toHaveAttribute('open','');
  await expect(page.locator('#ranch-rows tr').first().locator('td').first()).toHaveText('101');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('cloud-records-phone.png')});
  await page.locator('.record-report').screenshot({path:testInfo.outputPath('cloud-report.png')});
  await page.route('**/api/admin/shearing?**',route=>route.abort('failed'));
  await page.getByRole('button',{name:'Search / Refresh',exact:true}).click();
  await expect(page.locator('#ranch-error')).toContainText('out of date');
  await expect(page.locator('#ranch-report-content')).toContainText('out of date');
  await page.unroute('**/api/admin/shearing?**');
  await page.getByRole('button',{name:'Search / Refresh',exact:true}).click();
  await expect(page.locator('.report-total').first()).toContainText('252');
  await expect(page.locator('#ranch-error')).toBeEmpty();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await expect(page.getByLabel('Day (Chile)')).toHaveValue('');
  await expect(page.locator('#ranch-summary')).toContainText('254');
  await page.reload();
  await expect(page.getByText('Summary and reports',{exact:true})).toBeVisible();
});

test('new scans leave displayed row numbers stable; cloud corrections, replay and deletion reconcile reports', async ({page}) => {
  await page.goto(`${local}/records/?lang=en&day=2026-01-02`);
  const rows = page.getByRole('table',{name:'Shearing records',exact:true}).locator('tbody tr');
  await expect(rows).toHaveCount(50);
  const originalFirst = await rows.first().textContent();
  const fresh = {...events[0],id:crypto.randomUUID(),tag:'A70000',occurred_at:'2026-01-02T15:00:00.000Z'};
  expect((await push(server,[fresh])).response.status).toBe(200);
  await waitFor(async () => (await localList('day=2026-01-02')).total===253);
  // Cover the previous five-second automatic table refresh explicitly.
  await page.waitForTimeout(5200);
  expect(await rows.first().textContent()).toBe(originalFirst);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(rows.first()).toContainText('A70000');
  await expect(rows.first().locator('td').first()).toHaveText('1');
  const before = (await remoteList('tag=A70000')).rows[0];
  const correction = {...before,action:'edit',serverId:server.id,submissionId:crypto.randomUUID(),surveyResponses:{...before.survey.responses,weight:30}};
  expect((await admin('POST','/api/admin/shearing',correction)).response.status).toBe(200);
  // Retry the exact committed change, as after losing its response.
  expect((await admin('POST','/api/admin/shearing',correction)).data.duplicate).toBe(true);
  await waitFor(async () => (await localList('tag=A70000')).rows[0]?.survey.responses.weight===30);
  const localReport = (await localList('day=2026-01-02')).report;
  expect(localReport.questions.find(q=>q.field==='weight').maximum).toBe(30);
  expect(localReport).toEqual((await remoteList(`from=2026-01-02&to=2026-01-02&server=${server.id}`)).report);
  const edited = (await remoteList('tag=A70000')).rows[0];
  const deletion = {id:edited.id,updated_at:edited.updated_at,action:'delete',submissionId:crypto.randomUUID()};
  expect((await admin('POST','/api/admin/shearing',deletion)).response.status).toBe(200);
  expect((await admin('POST','/api/admin/shearing',deletion)).data.duplicate).toBe(true);
  expect((await push(server,[fresh])).response.status).toBe(200); // stale upload cannot resurrect it
  await waitFor(async () => (await localList('tag=A70000')).total===0);
  expect((await localList('day=2026-01-02')).report).toEqual((await remoteList(`from=2026-01-02&to=2026-01-02&server=${server.id}`)).report);
  expect((await localList('day=2026-01-02')).report.total).toBe(252);
  await page.getByLabel('Search code').fill('0');
  await expect(page).toHaveURL(/tag=0/);
  await page.reload();
  await expect(page.getByLabel('Search code')).toHaveValue('0');
});
