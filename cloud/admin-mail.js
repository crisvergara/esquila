import nodemailer from 'nodemailer';
import { uuidv7 } from '../shared/uuidv7.js';
import { fail, linkCipher, normalizeEmail, publicOrigin } from './admin-security.js';

export function createAdminMail(pool, env = process.env) {
  try { return configureMail(pool, env); }
  catch {
    // A bad email secret must never take device synchronization offline.
    console.warn("Administrator email configuration invalid; account emails unavailable.");
    return unavailable();
  }
}
const unavailable = () => ({ enabled: false, require() { fail(503, "Falta configurar el correo de administración. Revisa la guía de instalación."); }, start() {}, kick() {} });
function configureMail(pool, env) {
  const configured = Boolean(env.ADMIN_MAIL_FROM || env.ADMIN_SMTP_HOST || env.ADMIN_LINK_KEY);
  if (!configured) return unavailable();
  const test = env.NODE_ENV === 'test';
  const origin = publicOrigin(env.PUBLIC_URL, test);
  const from = normalizeEmail(env.ADMIN_MAIL_FROM);
  const port = Number(env.ADMIN_SMTP_PORT || 465);
  const host = env.ADMIN_SMTP_HOST;
  // The setup helper base64-encodes credentials solely to preserve every byte
  // through Fly's import parser. These remain secrets, not encrypted by base64.
  const credential = name => {
    if (!env[`${name}_B64`]) return env[name];
    const bytes = Buffer.from(env[`${name}_B64`], 'base64');
    if (bytes.toString('base64') !== env[`${name}_B64`]) throw new Error('Invalid SMTP credential encoding');
    return bytes.toString('utf8');
  };
  const username = credential('ADMIN_SMTP_USER'), password = credential('ADMIN_SMTP_PASSWORD');
  const testTransport = test && ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (!from || !host || /[\s/]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || (!testTransport && (!username || !password))) throw new Error('Invalid administrator SMTP configuration');
  const cipher = linkCipher(env.ADMIN_LINK_KEY);
  const transport = nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: !testTransport && port !== 465,
    ignoreTLS: testTransport, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    ...(username ? { auth: { user: username, pass: password } } : {}),
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  });
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    try {
      // Each worker leases one job. A crashed worker's lease expires safely.
      for (let count = 0; count < 10; count++) {
        const job = (await pool.query(`UPDATE admin_mail_jobs SET status='sending', attempts=attempts+1, next_attempt_at=now()+interval '2 minutes'
          WHERE id=(SELECT id FROM admin_mail_jobs WHERE (status='queued' OR status='sending') AND next_attempt_at<=now()
            ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`)).rows[0];
        if (!job) break;
        try {
          if (job.token_hash && !(await pool.query('SELECT 1 FROM admin_action_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now()', [job.token_hash])).rowCount) {
            await pool.query("UPDATE admin_mail_jobs SET status='cancelled',payload=NULL WHERE id=$1", [job.id]); continue;
          }
          const payload = cipher.decrypt(job.payload);
          const result = await transport.sendMail({ from, to: payload.to, subject: payload.subject, text: payload.text,
            textEncoding: 'base64', messageId: `<${job.id}@${new URL(origin).hostname}>` });
          if (!result.accepted?.length) throw new Error('Mail not accepted');
          await pool.query("UPDATE admin_mail_jobs SET status='sent',payload=NULL,sent_at=now() WHERE id=$1 AND status='sending'", [job.id]);
        } catch {
          // SMTP errors can include credentials, recipient addresses or message content.
          // Retain only generic status and retry the SAME encrypted message/link.
          await pool.query(`UPDATE admin_mail_jobs SET status=$2, payload=CASE WHEN $2='failed' THEN NULL ELSE payload END,
            next_attempt_at=now()+($3::int * interval '1 second') WHERE id=$1 AND status='sending'`,
          [job.id, job.attempts >= 6 ? 'failed' : 'queued', Math.min(1800, 30 * 2 ** job.attempts)]);
          console.warn('Administrator email delivery pending or failed; inspect account delivery status.');
        }
      }
      await pool.query("DELETE FROM admin_auth_limits WHERE reset_at<now()-interval '1 day'");
      await pool.query("DELETE FROM admin_sessions WHERE expires_at<now() OR last_seen_at<now()-interval '1 hour'");
      await pool.query("DELETE FROM admin_mail_jobs WHERE created_at<now()-interval '30 days'");
      await pool.query("DELETE FROM admin_action_tokens t WHERE expires_at<now()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM admin_mail_jobs m WHERE m.token_hash=t.token_hash)");
      await pool.query("DELETE FROM admin_security_audit WHERE occurred_at<now()-interval '180 days'");
    } catch { console.warn('Administrator email worker unavailable; queued messages remain pending.'); }
    finally { running = false; }
  }
  return {
    enabled: true, require() {}, origin,
    async enqueue(client, user, purpose, token = null, tokenHash = null) {
      const invite = purpose === 'invite';
      const link = token ? `${origin}/admin/access#${token}` : `${origin}/admin`;
      const payload = { to: user.email,
        subject: token ? (invite ? 'Invitación a Esquila' : 'Restablecer tu contraseña de Esquila') : 'Tu contraseña de Esquila cambió',
        text: token ? `${invite ? 'Te invitaron a administrar Esquila. Crea tu contraseña' : 'Solicitaste restablecer tu contraseña'}:\n\n${link}\n\nEl enlace vence en ${invite ? '24 horas' : '30 minutos'} y sirve una sola vez. Si no esperabas este correo, ignóralo. No compartas el enlace.\n` :
          `La contraseña de tu cuenta de Esquila cambió y se cerraron las sesiones anteriores. Si no fuiste tú, solicita un restablecimiento y avisa al propietario.\n\n${link}\n` };
      await client.query('INSERT INTO admin_mail_jobs(id,user_id,token_hash,payload) VALUES($1,$2,$3,$4)', [uuidv7(),user.id,tokenHash,cipher.encrypt(payload)]);
    },
    kick() { setImmediate(() => { void drain(); }); },
    start() { setInterval(() => { void drain(); }, 30000).unref(); void drain(); },
  };
}
