import { legacySurvey } from './surveys.js';

// Additive, transactional migration: identities, occurrence/update timestamps,
// tombstones, pending uploads and submission receipts remain untouched.
export function migrateBarnSurveys(db) {
  if (db.pragma('user_version', { simple: true }) >= 5) return;
  db.transaction(() => {
    db.exec('ALTER TABLE counts ADD COLUMN survey_json TEXT');
    const update = db.prepare('UPDATE counts SET survey_json=? WHERE id=?');
    for (const row of db.prepare('SELECT * FROM counts').all()) update.run(JSON.stringify(legacySurvey(row)), row.id);
    db.pragma('user_version = 5');
  })();
}

export async function migrateCloudSurveys(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Same lock order as all shearing writers. Backfill creates sync revisions
    // and audit entries, so already-connected barns receive the migrated data.
    await client.query('SELECT revision FROM shearing_sync_clock WHERE singleton FOR UPDATE');
    await client.query("SELECT set_config('esquila.change_source', 'survey-migration', true)");
    const rows = (await client.query('SELECT * FROM shearing_events WHERE survey IS NULL')).rows;
    for (const row of rows) await client.query('UPDATE shearing_events SET survey=$1 WHERE id=$2', [legacySurvey(row), row.id]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
