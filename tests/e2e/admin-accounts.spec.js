import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startNodeService, stopService, waitFor, waitForHealth } from './helpers.mjs';
const { Pool } = createRequire(new URL('../../cloud/package.json', import.meta.url))('pg');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base='http://127.0.0.1:4195';
const legacy=`test-only-${crypto.randomUUID()}`;
const password='Many green sheep cross the pasture!';
const nextPassword='Black lambs enjoy the spring pasture!';
let pool, schemaPool, schema, database, cloud, smtp, smtpPort, ownerCookie, ownerId, deviceToken;
let smtpFailure=false;
const messages=[];
const key=crypto.randomBytes(32).toString('base64');
function startCloud() {
  return startNodeService('admin accounts',path.join(root,'cloud/server.js'), {cwd:path.join(root,'cloud'),env:{
    DATABASE_URL:database,PORT:'4195',PUBLIC_URL:base,NODE_ENV:'test',ADMIN_PASSWORD:legacy,
    ADMIN_MAIL_FROM:'noreply@example.test',ADMIN_SMTP_HOST:'127.0.0.1',ADMIN_SMTP_PORT:String(smtpPort),ADMIN_LINK_KEY:key,
    ADMIN_SMTP_USER:'',ADMIN_SMTP_PASSWORD:'',ADMIN_SMTP_USER_B64:'',ADMIN_SMTP_PASSWORD_B64:''
  }});
}
async function restart() { await stopService(cloud); cloud=startCloud(); await waitForHealth(base,cloud); }
async function api(route, {body,cookie,origin=base,bearer,method}={}) {
  return fetch(base+'/api/admin/'+route,{method:method || (body===undefined?'GET':'POST'),headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(bearer?{Authorization:`Bearer ${bearer}`}:{ }),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
}
async function login(email,pass=password) {
  const r=await api('login',{body:{email,password:pass}}); expect(r.status).toBe(200);
  expect(r.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
  return r.headers.get('set-cookie').split(';')[0];
}
const lastToken=email=>[...messages].reverse().find(m=>m.to===email && m.text.includes('/admin/access#'))?.text.match(/\/admin\/access#([A-Za-z0-9_-]{43})/)?.[1];
async function waitToken(email,old) { return waitFor(()=>{const token=lastToken(email);return token && token!==old && token;},{description:'test email delivered'}); }
async function complete(token,pass=password) { return api('password/complete',{body:{token,password:pass}}); }
async function invite(email,name='Test operator',role='admin') { return api('accounts/invite',{cookie:ownerCookie,body:{email,name,role,currentPassword:password}}); }

test.describe.configure({mode:'serial'});
test.beforeAll(async()=>{
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must be disposable');
  schema='admin_e2e_'+crypto.randomUUID().replaceAll('-','');
  schemaPool=new Pool({connectionString:process.env.TEST_DATABASE_URL}); await schemaPool.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-csearch_path=${schema}`);database=url.toString();
  pool=new Pool({connectionString:database});
  // Minimal loopback-only SMTP sink. Never contacts a real provider or recipient.
  smtp=net.createServer(socket=>{
    socket.setEncoding('utf8');socket.write('220 localhost ESMTP test\r\n');
    let buffer='',data=false,body=[],to='';
    socket.on('error',()=>{});
    socket.on('data',chunk=>{
      buffer+=chunk;
      while(buffer.includes('\r\n')) {
        const end=buffer.indexOf('\r\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(data) {
          if(line!=='.') {body.push(line);continue;}
          data=false;const raw=body.join('\r\n');
          if(smtpFailure) socket.write('451 temporary test outage\r\n');
          else {messages.push({to,raw,text:Buffer.from(raw.split('\r\n\r\n').slice(1).join('\r\n\r\n').replaceAll('\r\n',''),'base64').toString('utf8')});socket.write('250 accepted\r\n');}
        } else if(/^EHLO|^HELO/.test(line)) socket.write('250 localhost\r\n');
        else if(line.startsWith('RCPT TO:')) {to=line.match(/<([^>]+)>/)[1];socket.write('250 ok\r\n');}
        else if(line==='DATA') {data=true;body=[];socket.write('354 send data\r\n');}
        else if(line==='QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise(resolve=>smtp.listen(0,'127.0.0.1',resolve));smtpPort=smtp.address().port;
  cloud=startCloud();await waitForHealth(base,cloud);
});
test.afterAll(async()=>{
  await stopService(cloud); if(smtp) await new Promise(resolve=>smtp.close(resolve));
  if(pool) await pool.end();if(schemaPool){await schemaPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await schemaPool.end();}
});

test('bootstrap UI verifies mailbox, disables shared access, and preserves enrolled devices',async({page})=>{
  const created=await api('devices',{bearer:legacy,body:{name:'Existing test ranch',role:'server'}});expect(created.status).toBe(200);deviceToken=(await created.json()).token;
  const oldSession=await login(undefined,legacy);
  expect((await api('login',{origin:'https://attacker.test',body:{password:legacy}})).status).toBe(403);
  await page.goto(base+'/admin/accounts');
  await page.getByLabel('Contraseña de administración',{exact:true}).fill(legacy);
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Crear mi primera cuenta'})).toBeVisible();
  await page.getByLabel('Tu contraseña actual').fill(legacy);
  await page.getByLabel('Nombre',{exact:true}).fill('Test owner');
  await page.getByLabel('Correo de la persona').fill('OWNER@example.test');
  await page.getByRole('button',{name:'Enviar invitación'}).click();
  const token=await waitToken('owner@example.test');
  expect((await api('accounts/invite',{cookie:oldSession,body:{email:'other@example.test',name:'Other',currentPassword:legacy}})).status).toBe(409);
  await page.goto(base+'/admin/access#'+token);
  await expect(page).toHaveURL(base+'/admin/access');
  expect((await pool.query('SELECT consumed_at FROM admin_action_tokens')).rows[0].consumed_at).toBeNull();
  await page.getByLabel('Nueva contraseña',{exact:true}).fill(password);
  await page.getByLabel('Repetir contraseña').fill(password);
  await page.getByRole('button',{name:'Guardar contraseña'}).click();
  await expect(page.getByRole('status')).toContainText('Contraseña guardada');
  expect((await complete(token)).status).toBe(400);
  expect((await api('me',{cookie:oldSession})).status).toBe(401);
  expect((await api('devices',{bearer:legacy})).status).toBe(401);
  expect((await api('login',{body:{password:legacy}})).status).toBe(401);
  await page.getByRole('link',{name:'Ir a iniciar sesión / solicitar otro enlace'}).click();
  await page.getByLabel('Correo electrónico',{exact:true}).fill('OWNER@EXAMPLE.TEST');
  await page.getByLabel('Contraseña',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await expect(page.getByRole('link',{name:'Mi cuenta y accesos'})).toBeVisible();
  ownerCookie=await login('Owner@Example.Test');
  ownerId=(await (await api('me',{cookie:ownerCookie})).json()).user.id;
  expect((await fetch(base+'/api/snapshot',{headers:{Authorization:`Bearer ${deviceToken}`}})).status).toBe(200);
  expect((await api('devices',{bearer:deviceToken})).status).toBe(401);
  expect((await api('accounts/'+ownerId+'/disable',{cookie:ownerCookie,body:{currentPassword:password}})).status).toBe(409);
  const stored=(await pool.query('SELECT * FROM admin_users')).rows[0];expect(stored.password_hash).not.toContain(password);
  expect(JSON.stringify((await pool.query('SELECT * FROM admin_sessions')).rows)).not.toContain(ownerCookie.split('=')[1]);
  expect(JSON.stringify((await pool.query('SELECT * FROM admin_action_tokens')).rows)).not.toContain(token);
});

test('owner invites father; nonowners cannot manage access; sessions survive server restart',async({page})=>{
  await page.context().addCookies([{name:ownerCookie.split('=')[0],value:ownerCookie.split('=')[1],url:base}]);
  await page.goto(base+'/admin/accounts');
  await page.getByLabel('Tu contraseña actual').fill(password);
  await page.getByLabel('Nombre',{exact:true}).fill('<img src=x onerror=alert(1)>');
  await page.getByLabel('Correo de la persona').fill('father@example.test');
  await page.getByRole('button',{name:'Enviar invitación'}).click();
  const token=await waitToken('father@example.test');
  await expect(page.locator('#accounts')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#accounts img')).toHaveCount(0);
  const concurrent=await Promise.all([complete(token),complete(token)]);expect(concurrent.map(r=>r.status).sort()).toEqual([200,400]);
  const cookie=await login('father@example.test');
  expect((await api('accounts',{cookie})).status).toBe(403);
  expect((await api('accounts/invite',{cookie,body:{email:'evil@example.test',name:'Evil',currentPassword:password}})).status).toBe(403);
  expect((await api('devices',{cookie})).status).toBe(200);
  expect((await api('devices',{cookie,origin:'https://evil.test',body:{name:'bad'}})).status).toBe(403);
  await restart();expect((await api('me',{cookie})).status).toBe(200);
  expect((await api('devices',{bearer:legacy})).status).toBe(401);
  expect((await api('me',{cookie:'esquila_admin_session=%not-a-valid-cookie'})).status).toBe(401);
});

test('SMTP outage retains encrypted mail and retries after restart; expired/resend links are rejected',async()=>{
  smtpFailure=true;
  expect((await invite('retry@example.test')).status).toBe(202);
  await waitFor(async()=>(await pool.query("SELECT m.status FROM admin_mail_jobs m JOIN admin_users u ON u.id=m.user_id WHERE u.email='retry@example.test' AND attempts>=1")).rows[0]?.status==='queued');
  const job=(await pool.query("SELECT m.* FROM admin_mail_jobs m JOIN admin_users u ON u.id=m.user_id WHERE u.email='retry@example.test'")).rows[0];
  expect(job.status).toBe('queued');expect(job.payload).not.toContain('retry@example.test');expect(job.payload).not.toContain('/admin/access');
  expect((await fetch(base+'/healthz')).status).toBe(200);
  smtpFailure=false;
  await pool.query('UPDATE admin_mail_jobs SET next_attempt_at=now() WHERE id=$1',[job.id]);await restart();
  const old=await waitToken('retry@example.test');
  expect((await invite('retry@example.test')).status).toBe(202);
  const token=await waitToken('retry@example.test',old);
  expect((await complete(old)).status).toBe(400);
  await pool.query("UPDATE admin_action_tokens SET expires_at=now()-interval '1 second' WHERE user_id=$1",[job.user_id]);
  expect((await complete(token)).status).toBe(400);
  const logs=cloud.logs.join('');expect(logs).not.toContain(token);expect(logs).not.toContain(password);
});

test('password reset UI is generic, single-use, logs out all sessions, and requires explicit login',async({page})=>{
  const first=await login('father@example.test'),second=await login('father@example.test');
  const unknown=await api('password/forgot',{body:{email:'unknown@example.test'}});
  await page.goto(base+'/admin');await page.getByText('Olvidé mi contraseña',{exact:true}).click();
  await page.getByLabel('Correo de tu cuenta').fill('father@example.test');
  const old=lastToken('father@example.test');
  await page.getByRole('button',{name:'Enviar enlace de recuperación'}).click();
  await expect(page.locator('#reset-status')).toHaveText((await unknown.json()).message);
  const token=await waitToken('father@example.test',old);
  expect((await api('password/complete',{origin:'https://evil.test',body:{token,password:nextPassword}})).status).toBe(403);
  await page.goto(base+'/admin/access#'+token);
  await page.getByLabel('Nueva contraseña',{exact:true}).fill(nextPassword);
  await page.getByLabel('Repetir contraseña').fill('different passphrase');
  await page.getByRole('button',{name:'Guardar contraseña'}).click();
  await expect(page.getByRole('status')).toContainText('no coinciden');
  await page.getByLabel('Repetir contraseña').fill(nextPassword);
  await page.getByRole('button',{name:'Guardar contraseña'}).click();
  await expect(page.getByRole('status')).toContainText('Contraseña guardada');
  expect((await api('me',{cookie:first})).status).toBe(401);expect((await api('me',{cookie:second})).status).toBe(401);
  expect((await page.request.get(base+'/api/admin/me')).status()).toBe(401);
  expect((await api('login',{body:{email:'father@example.test',password}})).status).toBe(401);
  expect((await complete(token)).status).toBe(400);
  const cookie=await login('father@example.test',nextPassword);
  expect((await api('logout',{cookie,body:{}})).status).toBe(200);expect((await api('me',{cookie})).status).toBe(401);
});

test('disabling closes sessions and invalidates links; restoration requires a new password',async()=>{
  const cookie=await login('father@example.test',nextPassword);
  const father=(await (await api('me',{cookie})).json()).user;
  const old=lastToken(father.email);await api('password/forgot',{body:{email:father.email}});const reset=await waitToken(father.email,old);
  expect((await api('accounts/'+father.id+'/disable',{cookie:ownerCookie,body:{currentPassword:'wrong password'}})).status).toBe(403);
  expect((await api('accounts/'+father.id+'/disable',{cookie:ownerCookie,body:{currentPassword:password}})).status).toBe(200);
  expect((await api('me',{cookie})).status).toBe(401);expect((await complete(reset)).status).toBe(400);
  expect((await api('login',{body:{email:father.email,password:nextPassword}})).status).toBe(401);
  const count=messages.length;await api('password/forgot',{body:{email:father.email}});expect(messages.length).toBe(count);
  expect((await api('accounts/'+father.id+'/restore',{cookie:ownerCookie,body:{currentPassword:password}})).status).toBe(202);
  const fresh=await waitToken(father.email,reset);expect((await complete(fresh)).status).toBe(200);
  expect((await api('me',{cookie})).status).toBe(401);await login(father.email);
});

test('absolute and idle expiry are enforced, and login limits survive restart',async()=>{
  const cookie=await login('father@example.test');
  await pool.query("UPDATE admin_sessions SET last_seen_at=now()-interval '61 minutes' WHERE token_hash=$1",[crypto.createHash('sha256').update(cookie.split('=')[1]).digest('hex')]);
  expect((await api('me',{cookie})).status).toBe(401);
  const absolute=await login('father@example.test');
  await pool.query("UPDATE admin_sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",[crypto.createHash('sha256').update(absolute.split('=')[1]).digest('hex')]);
  expect((await api('me',{cookie:absolute})).status).toBe(401);
  // Isolate throttling assertions from prior successful test logins.
  await pool.query('DELETE FROM admin_auth_limits');
  for(let n=0;n<10;n++) expect((await api('login',{body:{email:'absent@example.test',password:'incorrect test password'}})).status).toBe(401);
  await restart();expect((await api('login',{body:{email:'absent@example.test',password:'incorrect test password'}})).status).toBe(429);
  expect((await api('accounts',{cookie:ownerCookie})).status).toBe(200);
  const response=await fetch(base+'/admin/access');expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('referrer-policy')).toBe('no-referrer');
});


test('trusted console recovery emails the existing owner without printing credentials or reopening bootstrap',async()=>{
  const run=promisify(execFile);
  const env={...process.env,DATABASE_URL:database,NODE_ENV:'test',PUBLIC_URL:base,ADMIN_MAIL_FROM:'noreply@example.test',ADMIN_SMTP_HOST:'127.0.0.1',ADMIN_SMTP_PORT:String(smtpPort),ADMIN_LINK_KEY:key,ADMIN_SMTP_USER:'',ADMIN_SMTP_PASSWORD:'',ADMIN_SMTP_USER_B64:'',ADMIN_SMTP_PASSWORD_B64:''};
  delete env.FORCE_COLOR;
  const old=lastToken('owner@example.test');
  const result=await run(process.execPath,['cloud/bootstrap-admin.js','recover','owner@example.test'],{cwd:root,env});
  expect(result.stdout).toContain('Email queued');expect(result.stdout).not.toContain('/admin/access#');expect(result.stderr).toBe('');
  await restart();const token=await waitToken('owner@example.test',old);
  expect(result.stdout).not.toContain(token);
  await expect(run(process.execPath,['cloud/bootstrap-admin.js','invite','intruder@example.test','Intruder'],{cwd:root,env})).rejects.toMatchObject({code:1});
  expect((await api('devices',{bearer:legacy})).status).toBe(401);
  const headers={'Content-Type':'application/json',Origin:base,'X-Forwarded-Proto':'https'};
  const secure=await fetch(base+'/api/admin/login',{method:'POST',headers,body:JSON.stringify({email:'owner@example.test',password})});
  expect(secure.status).toBe(200);expect(secure.headers.get('set-cookie')).toMatch(/^__Host-esquila_admin_session=.*; Secure$/);
  expect(secure.headers.get('strict-transport-security')).toContain('max-age=31536000');
});
