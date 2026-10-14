import express from 'express';
import { UUID } from '../shared/ranch-configuration.js';

// Only unambiguous attribution at creation is eligible for automatic backfill.
// Multiple/no uploaders remain cloud-only until an administrator assigns them.
// Legacy admin receipts put the explicitly selected server at request index 9.
export async function migrateShearingOwnership(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT revision FROM shearing_sync_clock WHERE singleton FOR UPDATE');
    if (!(await client.query('SELECT 1 FROM shearing_ownership_migration')).rowCount) {
      await client.query("SELECT set_config('esquila.change_source','ownership-migration',true)");
      await client.query(`UPDATE shearing_events e SET owner_server_id=s.server_id
        FROM shearing_record_servers s WHERE e.id=s.record_id AND e.owner_server_id IS NULL
          AND (SELECT count(*) FROM shearing_record_servers all_s WHERE all_s.record_id=e.id)=1
          AND (EXISTS (SELECT 1 FROM shearing_audit a WHERE a.row_id=e.id AND a.before_row IS NULL
                AND a.recorded_at=s.first_uploaded_at)
            OR EXISTS (SELECT 1 FROM admin_record_mutations m WHERE m.result->>'id'=e.id::text
                AND m.request->>0='add' AND m.request->>9=s.server_id::text))`);
      await client.query('INSERT INTO shearing_ownership_migration VALUES(true)');
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export function registerShearingOwnership(app, {pool, deviceAuth}) {
  // Reconcile legacy local copies before pushing anything. Never return foreign
  // content or ownership identities; classify only UUIDs already held by the caller.
  app.post('/api/sync/ownership', deviceAuth, express.json({limit:'32kb'}), async (req,res,next) => {
    if (req.device.role !== 'server') return res.status(403).json({error:'server role required'});
    const ids=req.body?.ids;
    if (!Array.isArray(ids) || ids.length>500 || ids.some(id=>typeof id!=='string'||!UUID.test(id)) || new Set(ids).size!==ids.length)
      return res.status(400).json({error:'invalid ownership request'});
    try {
      const rows=(await pool.query('SELECT id,owner_server_id FROM shearing_events WHERE id=ANY($1::uuid[])',[ids])).rows;
      const byId=new Map(rows.map(row=>[row.id,row]));
      res.set('Cache-Control','no-store').json({protocol:1,deviceId:req.device.id,records:ids.map(id=>{
        const row=byId.get(id.toLowerCase());
        return {id,status:!row?'new':row.owner_server_id===req.device.id?'owned':row.owner_server_id?'foreign':'unassigned'};
      })});
    } catch(error) { next(error); }
  });
}
