import express from 'express';
import { setTimeout as delay } from 'node:timers/promises';
import { uuidv7 } from '../shared/uuidv7.js';
import { digest, equalSecret, fail, hashPassword, normalizeEmail, publicOrigin, randomToken, verifyPassword } from './admin-security.js';
import { createAdminMail } from './admin-mail.js';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const SESSION_HOURS = 12;
const genericReset = { ok: true, message: 'Si la cuenta puede recibir un enlace, lo enviaremos a su correo. Revisa también spam.' };
const route = handler => async (req, res, next) => {
  try { await handler(req, res); }
  catch (error) { if (error.status) res.status(error.status).json({ error: error.message }); else next(error); }
};
const safeUser = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, status: u.status });
const cookieName = req => req.secure ? '__Host-esquila_admin_session' : 'esquila_admin_session';
function cookieToken(req) {
  const entries = (req.headers.cookie || '').split(';').map(part => part.trim().split('='));
  const value = entries.find(([key]) => key === cookieName(req))?.[1];
  return tokenPattern.test(value || '') ? value : null;
}
function setCookie(req, res, token) {
  res.setHeader('Set-Cookie', `${cookieName(req)}=${token || ''}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? SESSION_HOURS * 3600 : 0}${req.secure ? '; Secure' : ''}`);
}
export function createAdminAuth(pool, env = process.env) {
  const legacySecret = env.ADMIN_PASSWORD || env.ADMIN_TOKEN;
  const configuredOrigin = env.PUBLIC_URL ? publicOrigin(env.PUBLIC_URL, env.NODE_ENV === 'test') : null;
  const mail = createAdminMail(pool, env);
  const initialized = async client => (await (client || pool).query('SELECT initialized FROM admin_auth_state WHERE singleton')).rows[0].initialized;
  const sameOrigin = req => req.headers.origin === (configuredOrigin || `${req.protocol}://${req.get('host')}`);
  const csrf = (req, res, next) => sameOrigin(req) ? next() : res.status(403).json({ error: 'invalid request origin' });
  async function limit(scope, value, max, seconds) {
    const row = (await pool.query(`INSERT INTO admin_auth_limits(key_hash,attempts,reset_at) VALUES($1,1,now()+($2::int * interval '1 second'))
      ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN admin_auth_limits.reset_at<=now() THEN 1 ELSE admin_auth_limits.attempts+1 END,
      reset_at=CASE WHEN admin_auth_limits.reset_at<=now() THEN excluded.reset_at ELSE admin_auth_limits.reset_at END RETURNING attempts`,
    [digest(`${scope}:${value}`),seconds])).rows[0];
    return row.attempts <= max;
  }
  async function throttle(req, scope, email = '') {
    if (!await limit(`${scope}:ip`, req.ip, 30, 900) || (email && !await limit(`${scope}:account`, email, 10, 900))) fail(429, 'Demasiados intentos. Espera 15 minutos.');
  }
  async function transaction(fn) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  const audit = (client, event, actor = null, subject = null) => client.query('INSERT INTO admin_security_audit(event,actor_id,subject_id) VALUES($1,$2,$3)', [event,actor,subject]);
  async function session(req) {
    const token = cookieToken(req); if (!token) return null;
    const row = (await pool.query(`SELECT s.token_hash,s.user_id,u.email,u.name,u.role,u.status FROM admin_sessions s
      LEFT JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.last_seen_at>now()-interval '1 hour'`, [digest(token)])).rows[0];
    if (!row || (row.user_id ? row.status !== 'active' : await initialized())) return null;
    await pool.query("UPDATE admin_sessions SET last_seen_at=now() WHERE token_hash=$1 AND last_seen_at<now()-interval '5 minutes'", [row.token_hash]);
    return row.user_id ? { ...safeUser({ ...row, id: row.user_id }), sessionHash: row.token_hash } : { legacy: true, role: 'owner', sessionHash: row.token_hash };
  }
  async function authenticate(req) {
    const found = await session(req); if (found) return found;
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (equalSecret(bearer, legacySecret) && !await initialized()) return { legacy: true, role: 'owner', bearer: true };
    return null;
  }
  const authorize = async (req, res, next) => {
    try {
      req.admin = await authenticate(req);
      if (!req.admin) return res.status(401).json({ error: 'authentication required' });
      if (!['GET', 'HEAD'].includes(req.method) && !req.admin.bearer && !sameOrigin(req)) return res.status(403).json({ error: 'invalid request origin' });
      next();
    } catch (error) { next(error); }
  };
  async function reauthenticate(req) {
    await throttle(req, 'reauth', req.admin.id || 'legacy');
    const u = req.admin.id ? (await pool.query('SELECT * FROM admin_users WHERE id=$1', [req.admin.id])).rows[0] : null;
    const valid = req.admin.legacy ? equalSecret(req.body?.currentPassword, legacySecret) : u?.status === 'active' && await verifyPassword(req.body?.currentPassword, u.password_hash);
    if (!valid) fail(403, 'Confirma tu contraseña actual para administrar cuentas.');
  }
  async function ownerLock(client, actor) {
    await client.query('SELECT * FROM admin_auth_state WHERE singleton FOR UPDATE');
    if (actor.legacy) { if (await initialized(client)) fail(401, 'Inicia sesión con tu cuenta personal.'); return; }
    const owner = (await client.query("SELECT 1 FROM admin_users WHERE id=$1 AND role='owner' AND status='active'", [actor.id])).rowCount;
    if (!owner) fail(403, 'Solo el propietario puede administrar cuentas.');
  }
  async function invalidateTokens(client, userId) {
    await client.query('UPDATE admin_action_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL', [userId]);
    await client.query("UPDATE admin_mail_jobs SET status='cancelled',payload=NULL WHERE user_id=$1 AND token_hash IS NOT NULL AND status IN ('queued','sending')", [userId]);
  }
  async function issue(client, user, purpose) {
    mail.require();
    await invalidateTokens(client, user.id);
    const token = randomToken(), hash = digest(token);
    await client.query(`INSERT INTO admin_action_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+($4::int * interval '1 minute'))`, [hash,user.id,purpose,purpose === 'invite' ? 1440 : 30]);
    await mail.enqueue(client, user, purpose, token, hash);
  }
  async function invite({ email: input, name, role = 'admin', actor }, { deliver = true } = {}) {
    mail.require();
    const email = normalizeEmail(input);
    if (!email || typeof name !== 'string' || !name.trim() || name.length > 80 || /[\x00-\x1f]/.test(name) || !['admin','owner'].includes(role)) fail(400, 'Revisa nombre, correo y rol.');
    await transaction(async client => {
      await ownerLock(client, actor);
      const ready = await initialized(client);
      if (!ready && !actor.legacy) fail(409, 'Primero activa la cuenta del propietario.');
      const users = (await client.query('SELECT * FROM admin_users ORDER BY created_at')).rows;
      let user = users.find(u => u.email === email);
      if (!ready && users.some(u => u.email !== email)) fail(409, 'Ya hay una invitación para el primer propietario. Reenvíala o cancélala antes de usar otro correo.');
      if (user && user.status !== 'invited') fail(409, 'Ya existe una cuenta con ese correo. Usa su restablecimiento de contraseña.');
      if (!user) {
        if (users.length >= 100) fail(409, 'Se alcanzó el límite de cuentas.');
        user = (await client.query("INSERT INTO admin_users(id,email,name,role,status) VALUES($1,$2,$3,$4,'invited') RETURNING *", [uuidv7(),email,name.trim(),ready ? role : 'owner'])).rows[0];
      }
      await issue(client, user, 'invite'); await audit(client, 'invitation_queued', actor.id, user.id);
    });
    if (deliver) mail.kick();
  }
  async function recoverOwner(input) {
    const email = normalizeEmail(input);
    mail.require();
    await transaction(async client => {
      const user = (await client.query("SELECT * FROM admin_users WHERE email=$1 AND role='owner' AND status='active' FOR UPDATE", [email])).rows[0];
      if (!user) fail(404, "No active owner with that email.");
      await issue(client, user, 'reset');
      await audit(client, 'owner_recovery_queued', null, user.id);
    });
  }
  function register(app) {
    const json = express.json({ limit: '8kb' });
    app.get('/api/admin/auth-status', route(async (_req,res) => res.json({ personalAccounts: await initialized(), emailEnabled: mail.enabled, legacyAvailable: Boolean(legacySecret) && !await initialized() })));
    app.post('/api/admin/login', csrf, json, route(async (req, res) => {
      const email = normalizeEmail(req.body?.email);
      await throttle(req, 'login', email || 'legacy');
      let user;
      const legacy = !req.body?.email && equalSecret(req.body?.password, legacySecret) && !await initialized();
      if (!legacy) {
        user = email ? (await pool.query('SELECT * FROM admin_users WHERE email=$1', [email])).rows[0] : null;
        if (!await verifyPassword(req.body?.password, user?.password_hash) || user?.status !== 'active') fail(401, 'Correo o contraseña incorrectos.');
      }
      const token = randomToken();
      await transaction(async client => {
        if (user) {
          const current = (await client.query('SELECT * FROM admin_users WHERE id=$1 FOR UPDATE', [user.id])).rows[0];
          if (current.status !== 'active' || current.password_hash !== user.password_hash) fail(401, 'Vuelve a iniciar sesión.');
          await client.query('UPDATE admin_users SET last_login_at=now() WHERE id=$1', [user.id]);
        } else if (await initialized(client)) fail(401, 'Inicia sesión con tu cuenta personal.');
        const previous = cookieToken(req);
        if (previous) await client.query('DELETE FROM admin_sessions WHERE token_hash=$1', [digest(previous)]);
        await client.query(`INSERT INTO admin_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')`, [digest(token),user?.id || null]);
        await audit(client, 'login', user?.id, user?.id);
      });
      setCookie(req,res,token); res.json({ ok: true });
    }));
    app.post('/api/admin/logout', csrf, route(async (req,res) => {
      const token = cookieToken(req);
      if (token) await pool.query('DELETE FROM admin_sessions WHERE token_hash=$1', [digest(token)]);
      setCookie(req,res,null); res.json({ ok:true });
    }));
    app.get('/api/admin/me', authorize, route(async (req,res) => res.json({ user: req.admin.legacy ? { legacy:true,role:'owner' } : safeUser(req.admin), emailEnabled: mail.enabled })));
    app.get('/api/admin/accounts', authorize, route(async (req,res) => {
      if (req.admin.role !== 'owner') fail(403, 'Solo el propietario puede administrar cuentas.');
      const { rows } = await pool.query(`SELECT u.id,u.email,u.name,u.role,u.status,u.created_at,u.last_login_at,
        (SELECT status FROM admin_mail_jobs m WHERE m.user_id=u.id ORDER BY m.created_at DESC LIMIT 1) AS delivery_status
        FROM admin_users u ORDER BY u.created_at`);
      res.json({ users:rows });
    }));
    app.post('/api/admin/accounts/invite', authorize, json, route(async (req,res) => {
      if (req.admin.role !== 'owner') fail(403, 'Solo el propietario puede invitar.');
      await reauthenticate(req);
      await invite({ ...req.body, actor:req.admin }); res.status(202).json({ ok:true });
    }));
    app.post('/api/admin/accounts/:id/disable', authorize, json, route(async (req,res) => {
      if (!/^[a-f0-9-]{36}$/.test(req.params.id)) fail(400,'Cuenta inválida.');
      if (req.admin.role !== 'owner') fail(403,'Solo el propietario puede administrar cuentas.');
      await reauthenticate(req);
      await transaction(async client => {
        await ownerLock(client,req.admin);
        const user = (await client.query('SELECT * FROM admin_users WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
        if (!user) fail(404,'Cuenta desconocida.');
        if (user.role === 'owner' && user.status === 'active' && (await client.query("SELECT 1 FROM admin_users WHERE role='owner' AND status='active' AND id<>$1",[user.id])).rowCount === 0) fail(409,'No puedes desactivar al último propietario.');
        await invalidateTokens(client,user.id);
        await client.query('DELETE FROM admin_sessions WHERE user_id=$1',[user.id]);
        // Before bootstrap only, let the operator correct a mistyped owner email.
        if (!await initialized(client)) {
          await client.query('DELETE FROM admin_mail_jobs WHERE user_id=$1',[user.id]);
          await client.query('DELETE FROM admin_action_tokens WHERE user_id=$1',[user.id]);
          await client.query('UPDATE admin_security_audit SET subject_id=NULL WHERE subject_id=$1',[user.id]);
          await client.query('DELETE FROM admin_users WHERE id=$1',[user.id]);
        } else await client.query("UPDATE admin_users SET status='disabled' WHERE id=$1",[user.id]);
        await audit(client,'account_disabled',req.admin.id,await initialized(client)?user.id:null);
      });
      res.json({ok:true});
    }));
    app.post('/api/admin/accounts/:id/restore', authorize, json, route(async (req,res) => {
      if (!/^[a-f0-9-]{36}$/.test(req.params.id)) fail(400,'Cuenta inválida.');
      if (req.admin.role !== 'owner') fail(403,'Solo el propietario puede administrar cuentas.');
      await reauthenticate(req); mail.require();
      await transaction(async client => {
        await ownerLock(client,req.admin);
        const user=(await client.query('SELECT * FROM admin_users WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
        if (!user || user.status!=='disabled') fail(409,'La cuenta no está desactivada.');
        await client.query("UPDATE admin_users SET status='invited',password_hash=NULL WHERE id=$1",[user.id]);
        await client.query('DELETE FROM admin_sessions WHERE user_id=$1',[user.id]);
        await issue(client,user,'invite'); await audit(client,'account_reinvited',req.admin.id,user.id);
      });
      mail.kick(); res.status(202).json({ok:true});
    }));
    app.post('/api/admin/password/forgot', csrf, json, route(async (req,res) => {
      const started = Date.now();
      mail.require();
      const email=normalizeEmail(req.body?.email);
      // Same response for unknown/disabled accounts and account-specific throttling.
      if (!await limit('reset:ip',req.ip,20,3600)) fail(429,'Demasiados intentos. Reintenta más tarde.');
      if (email && await limit('reset:email',email,3,3600)) await transaction(async client => {
        const user=(await client.query("SELECT * FROM admin_users WHERE email=$1 AND status IN ('active','invited') FOR UPDATE",[email])).rows[0];
        if (user) { await issue(client,user,user.status==='invited'?'invite':'reset'); await audit(client,'reset_requested',null,user.id); }
      });
      mail.kick(); await delay(Math.max(0, 500 - (Date.now() - started))); res.status(202).json(genericReset);
    }));
    app.post('/api/admin/password/complete', csrf, json, route(async (req,res) => {
      await throttle(req,'complete'); mail.require();
      if (!tokenPattern.test(req.body?.token || '')) fail(400,'El enlace venció o ya se usó. Solicita uno nuevo.');
      const hash=digest(req.body.token);
      // Reject invalid tokens before the expensive KDF; recheck under locks below.
      if (!(await pool.query('SELECT 1 FROM admin_action_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now()',[hash])).rowCount) fail(400,'El enlace venció o ya se usó. Solicita uno nuevo.');
      const passwordHash=await hashPassword(req.body.password);
      await transaction(async client => {
        await client.query('SELECT * FROM admin_auth_state WHERE singleton FOR UPDATE');
        const token=(await client.query('SELECT * FROM admin_action_tokens WHERE token_hash=$1',[hash])).rows[0];
        const user=token && (await client.query('SELECT * FROM admin_users WHERE id=$1 FOR UPDATE',[token.user_id])).rows[0];
        const valid=token && (await client.query('SELECT 1 FROM admin_action_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE',[hash])).rowCount;
        if (!valid || !user || user.status==='disabled' || (token.purpose==='invite' && user.status!=='invited')) fail(400,'El enlace venció o ya se usó. Solicita uno nuevo.');
        await client.query("UPDATE admin_users SET password_hash=$1,status='active',verified_at=COALESCE(verified_at,now()),password_changed_at=now() WHERE id=$2",[passwordHash,user.id]);
        await invalidateTokens(client,user.id);
        await client.query('DELETE FROM admin_sessions WHERE user_id=$1',[user.id]);
        if (!await initialized(client)) {
          if (user.role!=='owner') fail(409,'Primero activa el propietario.');
          await client.query('UPDATE admin_auth_state SET initialized=true WHERE singleton');
          await client.query('DELETE FROM admin_sessions WHERE user_id IS NULL');
        }
        await audit(client,token.purpose==='invite'?'account_activated':'password_reset',user.id,user.id);
        await mail.enqueue(client,user,'changed');
      });
      setCookie(req,res,null); mail.kick(); res.json({ok:true});
    }));
  }
  return { register, adminAuth:authorize, session, mail, invite, recoverOwner, initialized };
}
