import { UUID } from './ranch-configuration.js';

export function migrateBarnOwnership(db) {
  if (db.pragma('user_version',{simple:true})>=7) return;
  db.transaction(()=>{
    db.exec(`ALTER TABLE counts ADD COLUMN owner_server_id TEXT;
      ALTER TABLE counts ADD COLUMN created_here INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE ranch_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1), origin TEXT NOT NULL, device_id TEXT NOT NULL);
      CREATE TABLE record_quarantine(id TEXT PRIMARY KEY, row_json TEXT NOT NULL, outbox_json TEXT NOT NULL,
        reason TEXT NOT NULL, archived_at TEXT NOT NULL, restored_at TEXT);
      CREATE INDEX counts_owner ON counts(owner_server_id);`);
    db.pragma('user_version = 7');
  })();
}

export function createRanchOwnership(db, origin) {
  const identity=()=>db.prepare('SELECT * FROM ranch_identity WHERE singleton=1').get();
  const deviceId=()=>identity()?.device_id;
  const markCreated=id=>db.prepare('UPDATE counts SET created_here=1,owner_server_id=? WHERE id=?').run(deviceId()||null,id);
  const pendingIds=()=>db.prepare('SELECT id FROM counts WHERE owner_server_id IS NULL ORDER BY id LIMIT 500').all().map(r=>r.id);
  const apply=db.transaction((ids,response)=>{
    if (response?.protocol!==1 || typeof response.deviceId!=='string' || !UUID.test(response.deviceId) ||
        !Array.isArray(response.records) || response.records.length!==ids.length || new Set(response.records.map(r=>r.id)).size!==ids.length ||
        response.records.some(r=>!ids.includes(r.id)||!['new','owned','foreign','unassigned'].includes(r.status))) throw new Error('Invalid ownership response');
    const bound=identity();
    if (bound && (bound.device_id!==response.deviceId || bound.origin!==origin)) throw new Error('This database belongs to another ranch server; use its original credentials');
    if (!bound) {
      db.prepare('INSERT INTO ranch_identity VALUES(1,?,?)').run(origin,response.deviceId);
      // The previous global cursor may have advanced past this server's records.
      db.prepare("UPDATE ranch_sync_state SET cursor='0' WHERE singleton=1").run();
    }
    let removed=0;
    for (const record of response.records) {
      const row=db.prepare('SELECT * FROM counts WHERE id=?').get(record.id);
      if (!row) continue;
      if (record.status==='owned'||record.status==='new') {
        if (row.owner_server_id && row.owner_server_id!==response.deviceId) throw new Error('Local record ownership mismatch');
        db.prepare('UPDATE counts SET owner_server_id=? WHERE id=?').run(response.deviceId,row.id);
      } else {
        // Archive before removal, in the same transaction. No cloud tombstone is
        // generated. Retain pending corrections verbatim for deliberate recovery.
        const entries=db.prepare("SELECT * FROM sync_outbox WHERE tbl='counts' AND row_id=?").all(row.id);
        db.prepare(`INSERT INTO record_quarantine(id,row_json,outbox_json,reason,archived_at) VALUES(?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET row_json=excluded.row_json,outbox_json=excluded.outbox_json,
          reason=excluded.reason,archived_at=excluded.archived_at,restored_at=NULL`).run(row.id,JSON.stringify(row),JSON.stringify(entries),record.status,new Date().toISOString());
        db.prepare("DELETE FROM sync_outbox WHERE tbl='counts' AND row_id=?").run(row.id);
        db.prepare('DELETE FROM counts WHERE id=?').run(row.id);
        removed++;
      }
    }
    return removed;
  });
  const status=()=>({
    unverified:db.prepare('SELECT count(*) n FROM counts WHERE owner_server_id IS NULL AND created_here=0').get().n,
    archived:db.prepare('SELECT count(*) n FROM record_quarantine WHERE restored_at IS NULL').get().n,
  });
  const canEdit=row=>Boolean(row.created_here || (row.owner_server_id && row.owner_server_id===deviceId()));
  return {deviceId,markCreated,pendingIds,apply,status,canEdit};
}
