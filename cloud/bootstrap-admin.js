// Run inside the trusted cloud machine, never from a public HTTP endpoint.
import pg from 'pg';
import { createAdminAuth } from './admin-auth.js';
const [mode, email, name] = process.argv.slice(2);
if (!['invite', 'recover'].includes(mode) || !email || (mode === 'invite' && !name)) {
  console.error('Usage: node bootstrap-admin.js invite EMAIL "NAME" | recover EMAIL'); process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
pool.on('error', () => console.error('Database connection unavailable.'));
try {
  const auth = createAdminAuth(pool);
  if (mode === 'recover') await auth.recoverOwner(email);
  else await auth.invite({ email, name, actor: { legacy: true } }, { deliver: false });
  console.log('Email queued. The cloud worker delivers it when the application is awake. No link or password is printed.');
} catch (error) {
  console.error(error.status ? error.message : 'Account setup failed. Check database and email configuration.');
  process.exitCode = 1;
} finally { await pool.end(); }
