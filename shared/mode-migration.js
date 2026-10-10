import { legacyMode } from './modes.js';

export function migrateBarnModes(db) {
  if (db.pragma('user_version', { simple: true }) >= 6) return;
  db.transaction(() => {
    db.exec('ALTER TABLE counts ADD COLUMN mode_json TEXT');
    const save = db.prepare('UPDATE counts SET mode_json=? WHERE id=?');
    for (const row of db.prepare('SELECT id,type FROM counts').all()) save.run(JSON.stringify(legacyMode(row)), row.id);
    db.pragma('user_version = 6');
  })();
}

export async function migrateCloudModes(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT revision FROM shearing_sync_clock WHERE singleton FOR UPDATE');
    await client.query("SELECT set_config('esquila.change_source', 'mode-migration', true)");
    const rows = (await client.query('SELECT id,type FROM shearing_events WHERE mode IS NULL')).rows;
    for (const row of rows) await client.query('UPDATE shearing_events SET mode=$1 WHERE id=$2', [legacyMode(row), row.id]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
