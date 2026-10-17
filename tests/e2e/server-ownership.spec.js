import {test,expect} from '@playwright/test';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {jsonRequest,startNodeService,stopService,waitFor,waitForHealth} from './helpers.mjs';
import {legacySurvey} from '../../shared/surveys.js';
import {legacyMode} from '../../shared/modes.js';
const {Pool}=createRequire(new URL('../../cloud/package.json',import.meta.url))('pg');
const root=fileURLToPath(new URL('../..',import.meta.url));
const remote='http://127.0.0.1:4203',homeUrl='http://127.0.0.1:3203',fatherUrl='http://127.0.0.1:3204';
const password=`ownership-test-${crypto.randomUUID()}`;
let pool,schema,database,temp,cloud,homeBarn,fatherBarn,home,father,phone,homeEvent,fatherEvent,ambiguous,unassigned,unsent;
const admin=(method,route,body)=>jsonRequest(remote+route,{method,token:password,body});
const list=async query=>(await admin('GET',`/api/admin/shearing?day=&${query||''}`)).data;
const local=async(base,query='')=>(await jsonRequest(`${base}/api/records?${query}`)).data;
const push=(device,rows)=>jsonRequest(`${remote}/api/sync/push`,{method:'POST',token:device.token,body:{batches:[{table:'shearing_events',rows}]}});
const info={shearers:[{name:'Fixture'}],mode:'oveja',pending:0,uptime:10,hostname:'test',version:'test',platform:'test'};
const pull=(device,cursor='0',extra={})=>jsonRequest(`${remote}/api/sync/ranch`,{method:'POST',token:device.token,body:{cursor,information:info,...extra}});
function event(tag='A12345') {return {id:crypto.randomUUID(),tag,station:1,type:'oveja',color:'none',wool_quality:'GOOD',lactation:'idk',occurred_at:'2026-10-01T12:00:00.000Z',updated_at:'2026-10-01T12:00:00.000Z',origin:'ranch-server',survey:legacySurvey({type:'oveja',woolQuality:'GOOD',lactation:'idk'}),mode:legacyMode({type:'oveja'})};}
function startCloud(){return startNodeService('ownership cloud',path.join(root,'cloud/server.js'),{cwd:path.join(root,'cloud'),env:{PORT:'4203',DATABASE_URL:database,ADMIN_PASSWORD:password,PUBLIC_URL:remote,NODE_ENV:'test'}});}
function startBarn(name,port,token){return startNodeService(name,path.join(root,'countserver.js'),{cwd:path.join(temp,name),env:{PORT:String(port),CLOUD_SYNC_URL:token?remote:'',CLOUD_SYNC_TOKEN:token||'',CLOUD_SYNC_INTERVAL_MS:'100',AWS_ACCESS_KEY_ID:'',AWS_SECRET_ACCESS_KEY:'',NODE_ENV:'test'}});}
async function addDevice(name,role='server') {return (await admin('POST','/api/admin/devices',{name,role})).data;}
test.describe.configure({mode:'serial'});
test.beforeAll(async()=>{
  if(!process.env.TEST_DATABASE_URL)throw new Error('Disposable TEST_DATABASE_URL required');
  const bootstrap=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  schema=`ownership_${crypto.randomUUID().replaceAll('-','')}`;await bootstrap.query(`CREATE SCHEMA ${schema}`);await bootstrap.end();
  const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-csearch_path=${schema}`);database=url.toString();pool=new Pool({connectionString:database});
  temp=await mkdtemp(path.join(os.tmpdir(),'esquila-ownership-'));await mkdir(path.join(temp,'home'));await mkdir(path.join(temp,'father'));
  cloud=startCloud();await waitForHealth(remote,cloud);
  home=await addDevice('Home fixture');father=await addDevice('Father fixture');phone=await addDevice('Phone fixture','phone');
  await stopService(cloud);cloud=undefined;
  // Simulate pre-ownership cloud history: one uploader, multiple uploaders, none.
  homeEvent=event();fatherEvent=event();ambiguous=event('A22222');unassigned=event('A33333');unsent=event('A44444');
  for(const row of [homeEvent,fatherEvent,ambiguous,unassigned]) await pool.query(`INSERT INTO shearing_events(id,tag,station,type,color,wool_quality,lactation,occurred_at,updated_at,origin,survey,mode)
    VALUES($1,$2,1,'oveja','none','GOOD','idk',$3,$3,'forged-origin',$4,$5)`,[row.id,row.tag,row.occurred_at,row.survey,row.mode]);
  for(const [row,device] of [[homeEvent,home],[fatherEvent,father],[ambiguous,home],[ambiguous,father]])
    await pool.query(`INSERT INTO shearing_record_servers(record_id,server_id,server_name,first_uploaded_at)
      SELECT $1,$2,$3,recorded_at FROM shearing_audit WHERE row_id=$1 AND before_row IS NULL LIMIT 1`,[row.id,device.id,device.name]);
  // A lone later uploader is not proof of creation on that server.
  await pool.query(`INSERT INTO shearing_record_servers(record_id,server_id,server_name,first_uploaded_at)
    VALUES($1,$2,$3,'2099-01-01')`,[unassigned.id,home.id,home.name]);
  await pool.query('DELETE FROM shearing_ownership_migration');
  // Create an actual old Mac database containing copied foreign rows and an unsent edit.
  homeBarn=startBarn('home',3203);await waitForHealth(homeUrl,homeBarn);await stopService(homeBarn);homeBarn=undefined;
  const db=new Database(path.join(temp,'home/esquila'));
  for(const row of [homeEvent,fatherEvent,ambiguous,unsent]) db.prepare(`INSERT INTO counts(id,tag,station,type,color,woolQuality,lactation,date,updated_at,origin,survey_json,mode_json)
    VALUES(?,?,1,'oveja','none','GOOD','idk',?,?,'ranch-server',?,?)`).run(row.id,row.tag,row.occurred_at,row.updated_at,JSON.stringify(row.survey),JSON.stringify(row.mode));
  db.prepare("UPDATE counts SET tag='A99999',updated_at='2099-01-01T00:00:00.000Z' WHERE id=?").run(fatherEvent.id);
  for(const row of [fatherEvent,unsent]) db.prepare("INSERT INTO sync_outbox(tbl,row_id) VALUES('counts',?)").run(row.id);
  db.exec(`DROP INDEX counts_owner; ALTER TABLE counts DROP COLUMN owner_server_id; ALTER TABLE counts DROP COLUMN created_here;
    DROP TABLE ranch_identity; DROP TABLE record_quarantine; UPDATE ranch_sync_state SET cursor='999'; PRAGMA user_version=6;`);db.close();
  homeBarn=startBarn('home',3203,home.token);await waitForHealth(homeUrl,homeBarn);
});
test.afterAll(async()=>{await stopService(homeBarn);await stopService(fatherBarn);await stopService(cloud);if(pool){await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}if(temp)await rm(temp,{recursive:true,force:true});});

test('offline migration preserves old records and blocks unverified edits; online cleanup archives foreign pending changes',async()=>{
  const before=await local(homeUrl);expect(before.total).toBe(4);expect(before.ownership.unverified).toBe(4);
  expect((await readdir(path.join(temp,'home'))).some(f=>f.startsWith('esquila-pre-v7-'))).toBe(true);
  const foreign=before.rows.find(r=>r.id===fatherEvent.id);expect(foreign.editable).toBe(false);
  expect((await jsonRequest(homeUrl+'/api/records',{method:'POST',body:{...foreign,action:'edit',submissionId:crypto.randomUUID()}})).response.status).toBe(409);
  // New counting remains durable while ownership lookup/cloud are unavailable.
  expect((await jsonRequest(homeUrl+'/api/records',{method:'POST',body:{action:'add',submissionId:crypto.randomUUID(),tag:'A55555',station:1,type:'oveja',color:'none',woolQuality:'GOOD',lactation:'idk'}})).response.status).toBe(200);
  cloud=startCloud();await waitForHealth(remote,cloud);
  fatherBarn=startBarn('father',3204,father.token);await waitForHealth(fatherUrl,fatherBarn);
  await waitFor(async()=>{const d=await local(homeUrl);return d.total===3&&d.pending===0&&d.ownership.archived===2;});
  await waitFor(async()=>(await local(fatherUrl)).total===1);
  expect((await local(homeUrl)).rows.some(r=>r.id===fatherEvent.id)).toBe(false);
  expect((await local(fatherUrl)).rows[0].id).toBe(fatherEvent.id);
  const remoteFather=(await list(`server=${father.id}`)).rows[0];expect(remoteFather.tag).toBe('A12345');expect(remoteFather.updated_at).toBe(fatherEvent.updated_at);
  const db=new Database(path.join(temp,'home/esquila'),{readonly:true});
  const archived=db.prepare('SELECT * FROM record_quarantine WHERE id=?').get(fatherEvent.id);
  expect(JSON.parse(archived.row_json).tag).toBe('A99999');expect(JSON.parse(archived.outbox_json)).toHaveLength(1);db.close();
  expect((await list('server=unknown')).rows.map(r=>r.id).sort()).toEqual([ambiguous.id,unassigned.id].sort());
  expect((await list()).total).toBe(6); // all servers remain searchable by cloud admins
});

test('server tokens cannot forge ownership, overwrite, delete, claim legacy rows or read foreign records',async()=>{
  const future={...fatherEvent,updated_at:'2099-01-01T00:00:00.000Z',tag:'A99999'};
  for(const row of [future,{...future,deleted_at:future.updated_at},{...ambiguous,updated_at:future.updated_at}, {...event(),owner_server_id:father.id}])
    expect((await push(home,[row])).response.status).toBe(403);
  const fresh=event('A66666');
  expect((await push(home,[fresh,future])).response.status).toBe(403);
  expect((await list('tag=A66666')).total).toBe(0); // the entire denied batch rolls back
  const snapshot=(await jsonRequest(remote+'/api/snapshot',{token:home.token})).data;
  expect(snapshot.shearing_events.some(r=>r.id===fatherEvent.id)).toBe(false);
  const feed=(await pull(home,'0',{serverId:father.id})).data;
  expect(feed.rows.every(r=>r.owner_server_id===home.id)).toBe(true);
  expect((await pull(phone)).response.status).toBe(403);
  expect((await jsonRequest(remote+'/api/sync/ownership',{method:'POST',token:phone.token,body:{ids:[fatherEvent.id]}})).response.status).toBe(403);
  const classification=(await jsonRequest(remote+'/api/sync/ownership',{method:'POST',token:home.token,body:{ids:[fatherEvent.id]}})).data;
  expect(classification.records).toEqual([{id:fatherEvent.id,status:'foreign'}]);expect(JSON.stringify(classification)).not.toContain(father.id);
  expect((await jsonRequest(remote+'/api/snapshot',{token:phone.token})).data.shearing_events.some(r=>r.id===fatherEvent.id)).toBe(true);
  const current=(await list(`server=${father.id}`)).rows[0];
  expect((await admin('POST','/api/admin/shearing',{...current,action:'edit',serverId:home.id,submissionId:crypto.randomUUID()})).response.status).toBe(409);
  expect((await admin('POST','/api/admin/shearing',{action:'add',tag:'A66666',submissionId:crypto.randomUUID()})).response.status).toBe(400);
});

test('cloud UI assigns ambiguous legacy ownership; edits and tombstones sync exclusively to the owner',async({page})=>{
  await page.goto(remote+'/admin/records?server=unknown&lang=en');
  await page.getByLabel('Administration password').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  const row=page.locator('#ranch-rows tr').filter({hasText:'A22222'});
  await expect(row).toContainText('Unassigned: choose an owner');
  await row.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByLabel('Owning server').selectOption(father.id);
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('#ranch-editor')).not.toBeVisible();
  await waitFor(async()=>(await local(fatherUrl)).rows.some(r=>r.id===ambiguous.id));
  expect((await local(homeUrl)).rows.some(r=>r.id===ambiguous.id)).toBe(false);
  // Replaying stale clients cannot change the newly assigned owner.
  expect((await push(home,[ambiguous])).response.status).toBe(403);
  const current=(await list(`tag=A22222`)).rows[0];
  expect(current.owner_server_id).toBe(father.id);
  const correction={...current,action:'edit',tag:'A22223',serverId:father.id,submissionId:crypto.randomUUID()};
  expect((await admin('POST','/api/admin/shearing',correction)).response.status).toBe(200);
  expect((await admin('POST','/api/admin/shearing',correction)).data.duplicate).toBe(true);
  await waitFor(async()=>(await local(fatherUrl,'tag=A22223')).total===1);
  expect((await local(homeUrl,'tag=A22223')).total).toBe(0);
  const edited=(await list('tag=A22223')).rows[0];
  expect((await admin('POST','/api/admin/shearing',{action:'delete',id:edited.id,updated_at:edited.updated_at,submissionId:crypto.randomUUID()})).response.status).toBe(200);
  await waitFor(async()=>(await local(fatherUrl,'tag=A22223')).total===0);
  expect((await push(home,[{...edited,deleted_at:null,updated_at:'2099-01-01T00:00:00Z'}])).response.status).toBe(403);
});

test('scoped pages exceed 500 rows, restart safely, and ownership backfill never reassigns on restart',async()=>{
  const rows=Array.from({length:501},(_,i)=>event(`B${String(i).padStart(5,'0')}`));
  expect((await push(home,rows)).response.status).toBe(200);
  const first=(await pull(home)).data;expect(first.rows).toHaveLength(500);expect(first.rows.every(r=>r.owner_server_id===home.id)).toBe(true);
  const second=(await pull(home,first.cursor)).data;expect(second.rows).toHaveLength(4);
  await waitFor(async()=>(await local(homeUrl)).total===504);
  const fatherRows=(await pull(father)).data.rows;expect(fatherRows).toHaveLength(2);expect(fatherRows.every(r=>r.owner_server_id===father.id)).toBe(true);
  await stopService(homeBarn);homeBarn=undefined;await stopService(cloud);cloud=undefined;
  const cursorDb=new Database(path.join(temp,'home/esquila'),{readonly:true});const cursor=cursorDb.prepare('SELECT cursor FROM ranch_sync_state').get().cursor;cursorDb.close();
  cloud=startCloud();await waitForHealth(remote,cloud);homeBarn=startBarn('home',3203,home.token);await waitForHealth(homeUrl,homeBarn);
  expect((await local(homeUrl)).total).toBe(504);expect((await list(`server=${father.id}&deleted=1`)).rows.every(r=>r.owner_server_id===father.id)).toBe(true);
  const afterDb=new Database(path.join(temp,'home/esquila'),{readonly:true});expect(BigInt(afterDb.prepare('SELECT cursor FROM ranch_sync_state').get().cursor)).toBeGreaterThanOrEqual(BigInt(cursor));afterDb.close();
  expect((await list('server=unknown')).rows.map(r=>r.id)).toEqual([unassigned.id]);
});

test('legacy cloud additions use the explicit server in the original admin receipt',async()=>{
  await stopService(cloud);cloud=undefined;
  const row=event('C77777');
  await pool.query(`INSERT INTO shearing_events(id,tag,station,type,color,wool_quality,lactation,occurred_at,updated_at,origin,survey,mode)
    VALUES($1,$2,1,'oveja','none','GOOD','idk',$3,$3,'cloud-admin',$4,$5)`,[row.id,row.tag,row.occurred_at,row.survey,row.mode]);
  await pool.query('INSERT INTO shearing_record_servers(record_id,server_id,server_name) VALUES($1,$2,$3)',[row.id,home.id,home.name]);
  const request=['add',null,null,row.tag,1,'oveja','none','GOOD','idk',home.id];
  await pool.query('INSERT INTO admin_record_mutations VALUES($1,$2,$3)',[crypto.randomUUID(),JSON.stringify(request),{id:row.id}]);
  await pool.query('DELETE FROM shearing_ownership_migration');
  cloud=startCloud();await waitForHealth(remote,cloud);
  expect((await list('tag=C77777')).rows[0].owner_server_id).toBe(home.id);
  await waitFor(async()=>(await local(homeUrl,'tag=C77777')).total===1);
  expect((await local(fatherUrl,'tag=C77777')).total).toBe(0);
  expect((await list('server=unknown')).rows.map(r=>r.id)).toEqual([unassigned.id]);
});
