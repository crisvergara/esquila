// Apply a page and its cursor together. Remote rows never create upload echoes.
export function createRanchSync(db) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS ranch_sync_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), cursor TEXT NOT NULL);
      INSERT OR IGNORE INTO ranch_sync_state VALUES(1,'0');`);
    if (db.pragma('user_version', { simple: true }) < 3) db.pragma('user_version = 3');
  })();
  const cursor = () => db.prepare('SELECT cursor FROM ranch_sync_state WHERE singleton=1').get().cursor;
  const revision = value => typeof value === 'string' && /^(0|[1-9]\d{0,17})$/.test(value);
  const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const apply = db.transaction(page => {
    let position = cursor();
    let previous = BigInt(position);
    if (!page || !Array.isArray(page.rows) || page.rows.length > 500 || !revision(page.cursor)) throw new Error('Invalid sync page');
    for (const row of page.rows) {
      if (!revision(row.revision) || BigInt(row.revision) <= previous ||
          typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.id) ||
          typeof row.tag !== 'string' || !instant(row.occurred_at) || !instant(row.updated_at) ||
          (row.deleted_at != null && !instant(row.deleted_at)) ||
          (row.station != null && !Number.isInteger(row.station)) ||
          ['color','lactation','type','wool_quality','origin'].some(k => row[k] != null && typeof row[k] !== 'string')) throw new Error('Invalid sync row');
      previous = BigInt(row.revision);
    }
    if (String(previous) !== page.cursor) throw new Error('Invalid sync cursor');
    let changed = 0;
    for (const row of page.rows) {
      const old = db.prepare('SELECT * FROM counts WHERE id=?').get(row.id);
      if (!old || Date.parse(row.updated_at) >= Date.parse(old.updated_at)) {
        // A local edit made during the request must reach the cloud (and its audit)
        // before an equal/newer cloud version can replace it.
        if (db.prepare("SELECT 1 FROM sync_outbox WHERE tbl='counts' AND row_id=?").get(row.id)) break;
        db.prepare(`INSERT INTO counts(id,tag,station,color,lactation,type,woolQuality,date,updated_at,deleted_at,origin)
          VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET tag=excluded.tag,station=excluded.station,
          color=excluded.color,lactation=excluded.lactation,type=excluded.type,woolQuality=excluded.woolQuality,
          date=excluded.date,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,origin=excluded.origin`).run(
          row.id,row.tag,row.station,row.color,row.lactation,row.type,row.wool_quality,
          new Date(row.occurred_at).toISOString(),new Date(row.updated_at).toISOString(),
          row.deleted_at ? new Date(row.deleted_at).toISOString() : null,row.origin || 'ranch-server');
        changed++;
      }
      if (/^L\d+$/.test(row.tag) && Number.isSafeInteger(Number(row.tag.slice(1)))) {
        db.prepare('UPDATE lamb_sequence SET value=max(value,?) WHERE singleton=1').run(Number(row.tag.slice(1)));
      }
      position = row.revision;
    }
    db.prepare('UPDATE ranch_sync_state SET cursor=? WHERE singleton=1').run(position);
    return { changed, cursor: position };
  });
  return { cursor, apply };
}
