import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { jsonRequest, startNodeService, stopService, waitForHealth } from './helpers.mjs';
import { legacySurvey } from '../../shared/surveys.js';
const { Pool } = createRequire(new URL('../../cloud/package.json', import.meta.url))('pg');
const root = fileURLToPath(new URL('../..', import.meta.url));
const base = 'http://127.0.0.1:4198';
const password = `navigation-fixture-${crypto.randomUUID()}`;
let pool, schema, cloud, first, second, phone, events, legacyId;
const admin = (method, route, body) => jsonRequest(`${base}${route}`, { method, token: password, body });
const listing = async query => { const result = await admin('GET', `/api/admin/shearing?day=&${query}`); expect(result.response.status, JSON.stringify(result.data)).toBe(200); return result.data; };
const push = (device, rows) => jsonRequest(`${base}/api/sync/push`, { method:'POST', token:device.token, body:{batches:[{table:'shearing_events',rows}]} });
const info = { shearers: [{name:'Ana'},{name:'Luis'}],mode:'oveja',pending:0,uptime:100,hostname:'fixture',version:'test',platform:'test' };
async function login(page, url = '/admin/records') {
  await page.goto(base + url);
  await page.getByLabel('Contraseña de administración').fill(password);
  await page.getByRole('button',{name:'Iniciar sesión'}).click();
  await expect(page.getByRole('navigation',{name:'Administración'})).toBeVisible();
}
test.describe.configure({mode:'serial'});
test.beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Disposable TEST_DATABASE_URL required');
  pool = new Pool({connectionString:process.env.TEST_DATABASE_URL});
  schema = `admin_browser_${crypto.randomUUID().replaceAll('-','')}`;
  await pool.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.searchParams.set('options',`-csearch_path=${schema}`);
  await pool.end(); pool = new Pool({connectionString:url.toString()});
  cloud = startNodeService('admin browser',path.join(root,'cloud/server.js'),{cwd:path.join(root,'cloud'),env:{PORT:'4198',DATABASE_URL:url.toString(),ADMIN_PASSWORD:password,PUBLIC_URL:base,NODE_ENV:'test'}});
  await waitForHealth(base,cloud);
  first = (await admin('POST','/api/admin/devices',{name:'Galpón Norte',role:'server'})).data;
  second = (await admin('POST','/api/admin/devices',{name:'Galpón Sur',role:'server'})).data;
  phone = (await admin('POST','/api/admin/devices',{name:'Teléfono de prueba',role:'phone'})).data;
  events = Array.from({length:31},(_,i)=>({id:crypto.randomUUID(),tag:`A${20000+i}`,station:i%2+1,color:'none',type:'oveja',wool_quality:'GOOD',lactation:'idk',occurred_at:`2025-07-04T${i === 0 ? '03:59:00' : '04:01:00'}.000Z`,updated_at:'2025-07-04T05:00:00.000Z',origin:second.id,survey:legacySurvey({type:'oveja',wool_quality:'GOOD',lactation:'idk'})}));
  expect((await push(first,events)).response.status).toBe(200);
  expect((await push(second,[{...events[0],id:crypto.randomUUID(),tag:'B30001',type:'carnero',station:2,occurred_at:'2025-07-05T12:00:00.000Z'}])).response.status).toBe(200);
  legacyId = crypto.randomUUID();
  await pool.query("INSERT INTO shearing_events(id,tag,station,type,color,occurred_at,updated_at) VALUES($1,'LEGACY_100%',1,'oveja','none','2020-01-01','2020-01-01')",[legacyId]);
  await jsonRequest(`${base}/api/sync/ranch`,{method:'POST',token:first.token,body:{cursor:'0',information:info}});
  await jsonRequest(`${base}/api/sync/ranch`,{method:'POST',token:second.token,body:{cursor:'0',information:info}});
});
test.afterAll(async()=>{await stopService(cloud);if(pool){if(schema)await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}});

test('browser API attributes authenticated uploads, preserves old records, combines filters, and does not refresh upload time on replay', async()=>{
  const all = await listing(''); expect(all.total).toBe(33);
  expect((await listing(`server=${first.id}`)).total).toBe(31);
  expect((await listing(`server=${second.id}`)).total).toBe(1); // forged origin cannot change attribution
  expect((await listing('server=unknown')).rows.map(r=>r.id)).toEqual([legacyId]);
  expect((await listing('tag=%25')).rows.map(r=>r.id)).toEqual([legacyId]);
  expect((await listing(`server=${first.id}&from=2025-07-03&to=2025-07-03`)).rows.map(r=>r.id)).toEqual([events[0].id]);
  expect((await listing(`server=${first.id}&from=2025-07-04&to=2025-07-04&station=2&type=oveja&color=none`)).total).toBe(15);
  const a = await listing(`server=${first.id}&limit=25`), b = await listing(`server=${first.id}&limit=25&offset=25`);
  expect(a.rows).toHaveLength(25); expect(b.rows).toHaveLength(6); expect(new Set([...a.rows,...b.rows].map(r=>r.id)).size).toBe(31);
  expect((await listing(`server=${first.id}&limit=25&offset=999`)).offset).toBe(25);
  const timestamps = await pool.query('SELECT last_uploaded_at FROM shearing_record_servers WHERE record_id=$1 AND server_id=$2',[events[0].id,first.id]);
  const revision = (await pool.query('SELECT revision FROM shearing_sync_clock')).rows[0].revision;
  const recordVersion = (await pool.query('SELECT revision FROM shearing_events WHERE id=$1',[events[0].id])).rows[0].revision;
  const auditCount = (await pool.query('SELECT count(*) FROM shearing_audit WHERE row_id=$1',[events[0].id])).rows[0].count;
  expect((await push(first,[events[0]])).response.status).toBe(200);
  expect((await pool.query('SELECT last_uploaded_at FROM shearing_record_servers WHERE record_id=$1 AND server_id=$2',[events[0].id,first.id])).rows).toEqual(timestamps.rows);
  // PostgreSQL's BEFORE INSERT trigger may advance the clock on an upsert replay; the event and audit must not change.
  expect((await pool.query('SELECT revision FROM shearing_events WHERE id=$1',[events[0].id])).rows[0].revision).toBe(recordVersion);
  expect((await pool.query('SELECT count(*) FROM shearing_audit WHERE row_id=$1',[events[0].id])).rows[0].count).toBe(auditCount);
  expect((await push(phone,[events[0]])).response.status).toBe(403);
  expect((await jsonRequest(`${base}/api/admin/shearing?day=&server=${first.id}`,{token:phone.token})).response.status).toBe(401);
  for(const query of ['sort=malicious','limit=5000','from=2025-02-30','from=2025-10-01&to=2025-01-01','server=invalid','station=-1','sync=nope','tag[]=x','offset=-1']) expect((await admin('GET',`/api/admin/shearing?day=&${query}`)).response.status).toBe(400);
  expect((await listing(`server=${first.id}&sync=pending`)).total).toBe(31);
  await jsonRequest(`${base}/api/sync/ranch`,{method:'POST',token:first.token,body:{cursor:revision,information:info}});
  expect((await listing(`server=${first.id}&sync=received`)).total).toBe(31);
  expect((await listing(`server=${first.id}&sync=pending`)).total).toBe(0);
  expect((await listing('sync=received')).total).toBe(0); // the other server has not acknowledged
  const updated = {...events[0],updated_at:'2025-07-06T00:00:00.000Z',tag:'A29000'};
  expect((await push(first,[updated])).response.status).toBe(200);
  expect((await listing('sort=uploaded')).rows[0].id).toBe(updated.id);
  expect((await listing(`server=${first.id}&sync=pending`)).total).toBe(1);
});

test('dedicated screens keep navigation, legacy deep links and account/device workflows; layout fits a phone',async({page},testInfo)=>{
  for(const route of ['/admin','/admin/records','/admin/configuration','/admin/devices','/admin/accounts']) {
    const response=await page.request.get(base+route); expect(response.headers()['cache-control']).toBe('no-store'); expect(await response.text()).toContain('Iniciar sesión');
  }
  await login(page,`/admin?server=${first.id}#configuration`);
  await expect(page).toHaveURL(new RegExp(`/admin/configuration\\?server=${first.id}`));
  await expect(page.locator('#configuration-form')).toBeVisible();
  await expect(page.locator('#ranch-rows')).toHaveCount(0);
  const nav=page.getByRole('navigation',{name:'Administración'});
  await nav.getByRole('link',{name:'Resumen'}).click();
  await expect(page.getByRole('table',{name:'Monitor por esquilador'})).toBeVisible();
  await expect(page.locator('#configuration-form')).toHaveCount(0);
  await nav.getByRole('link',{name:'Dispositivos'}).click();
  await expect(page.getByRole('heading',{name:'Inscribir un dispositivo'})).toBeVisible();
  await page.getByLabel('Nombre del dispositivo').fill('Servidor nuevo');await page.getByLabel('Rol del dispositivo').selectOption('server');await page.getByRole('button',{name:'Crear + QR'}).click();
  await expect(page.locator('#qr .token')).not.toBeEmpty();
  const [configPage]=await Promise.all([page.waitForEvent('popup'),page.getByRole('link',{name:'Configurar este galpón'}).click()]);
  await expect(configPage.getByLabel('Nombre del galpón',{exact:true})).toHaveValue('Servidor nuevo');
  await expect(page.locator('#qr .token')).not.toBeEmpty();await configPage.close();
  await nav.getByRole('link',{name:'Mi cuenta y accesos'}).click();
  await expect(page.locator('#profile')).toContainText('Configuración inicial');
  await expect(nav.getByRole('link',{name:'Mi cuenta y accesos'})).toHaveAttribute('aria-current','page');
  await nav.getByRole('link',{name:'Registros'}).click();
  await expect(page.locator('#ranch-rows tr')).toHaveCount(31);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#ranch-rows tr').first().scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('records-mobile.png'),fullPage:false});
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:testInfo.outputPath('records-desktop.png'),fullPage:false});
  await page.getByRole('button',{name:'Cerrar sesión'}).click();
  await expect(page.getByRole('button',{name:'Iniciar sesión'})).toBeVisible();
});

test('recent scans need no search; filters and pagination survive reload, history is reviewable and failures are visible',async({page})=>{
  await login(page,'/admin');
  await expect(page.getByRole('table',{name:'Monitor por esquilador'})).toBeVisible();
  await page.getByRole('navigation',{name:'Administración'}).getByRole('link',{name:'Registros'}).click();
  await expect(page.locator('#ranch-rows tr')).toHaveCount(33);
  await page.getByLabel('Servidor',{exact:true}).selectOption(first.id);
  await page.getByRole('button',{name:'Buscar / Actualizar'}).click();
  await page.getByLabel('Por página').selectOption('25');await expect(page.locator('#ranch-rows tr')).toHaveCount(25);
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();await expect(page.locator('#ranch-rows tr')).toHaveCount(6);
  await page.goBack(); await expect(page.locator('#ranch-rows tr')).toHaveCount(25);
  await page.goForward(); await expect(page.locator('#ranch-rows tr')).toHaveCount(6);
  const ids=await page.locator('#ranch-rows tr').evaluateAll(rows=>rows.map(r=>r.dataset.id));
  await page.reload();await expect(page.locator('#ranch-rows tr')).toHaveCount(6);expect(await page.locator('#ranch-rows tr').evaluateAll(rows=>rows.map(r=>r.dataset.id))).toEqual(ids);
  await page.getByRole('button',{name:'Limpiar filtros'}).click();await expect(page.locator('#ranch-rows')).toContainText('LEGACY_100%');
  await page.getByLabel('Buscar código').fill('A29000');await page.getByRole('button',{name:'Buscar / Actualizar'}).click();
  await expect(page.locator('#ranch-rows tr')).toHaveCount(1);
  await page.getByRole('button',{name:'Historial',exact:true}).click();await expect(page.locator('#history-rows')).toContainText('A29000');await page.getByRole('button',{name:'Cerrar historial'}).click();
  const before = (await listing('tag=A29000')).rows[0];
  await page.getByRole('button',{name:'Editar',exact:true}).click();
  const correction = await admin('POST','/api/admin/shearing',{...before,action:'edit',tag:'A29000',station:2,submissionId:crypto.randomUUID()});
  expect(correction.response.status).toBe(200);
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await expect(page.locator('#editor-error')).toContainText('El registro cambió');
  await expect(page.locator('#ranch-rows')).toContainText('Estación 2');
  await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.getByRole('button',{name:'Editar',exact:true}).click();
  await expect(page.locator('#record-station')).toHaveValue('2');
  await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.route('**/api/admin/shearing?**',route=>route.abort('failed'));
  await page.getByRole('button',{name:'Buscar / Actualizar'}).click();await expect(page.locator('#ranch-error')).toContainText('datos visibles pueden estar atrasados');
  await expect(page.locator('#ranch-rows')).toContainText('A29000');await page.unroute('**/api/admin/shearing?**');
  await page.getByLabel('Buscar código').fill('NO-MATCH');await page.getByRole('button',{name:'Buscar / Actualizar'}).click();await expect(page.locator('#ranch-empty')).toBeVisible();
});

test('manual additions retain server context, rejected batches roll attribution back, and revocation retains history', async()=>{
  const body = { action:'add',serverId:first.id,configurationRevision:0,submissionId:crypto.randomUUID(),tag:'A56789',station:1,type:'oveja',color:'none',woolQuality:'GOOD',lactation:'idk' };
  const added = await admin('POST','/api/admin/shearing',body); expect(added.response.status).toBe(200);
  const repeated = await admin('POST','/api/admin/shearing',body);expect(repeated.data).toMatchObject({id:added.data.id,duplicate:true});
  const row = (await listing(`server=${first.id}&tag=A56789`)).rows[0];expect(row.id).toBe(added.data.id);expect(row.last_uploaded_at).toBeNull();expect(row.servers[0].id).toBe(first.id);
  const failedId = crypto.randomUUID();
  expect((await push(first,[{...events[0],id:failedId},{...events[0],id:crypto.randomUUID(),station:'invalid-integer'}])).response.status).toBe(400);
  expect((await pool.query('SELECT 1 FROM shearing_events WHERE id=$1',[failedId])).rowCount).toBe(0);
  expect((await pool.query('SELECT 1 FROM shearing_record_servers WHERE record_id=$1',[failedId])).rowCount).toBe(0);
  expect((await admin('DELETE',`/api/admin/devices/${second.id}`)).response.status).toBe(200);
  const historical = await listing(`server=${second.id}`);expect(historical.total).toBe(1);expect(historical.rows[0].servers[0]).toMatchObject({id:second.id,name:'Galpón Sur',revoked:true});
  expect(historical.servers.find(s=>s.id===second.id).revoked).toBe(true);
});
