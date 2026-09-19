import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createRanchSync } from '../../shared/ranch-sync.js';
import { validateShearingFields } from '../../shared/shearing-validation.js';
function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE counts(id TEXT PRIMARY KEY,tag TEXT,station INTEGER,color TEXT,lactation TEXT,type TEXT,woolQuality TEXT,date TEXT,updated_at TEXT,deleted_at TEXT,origin TEXT);
    CREATE TABLE sync_outbox(seq INTEGER PRIMARY KEY,tbl TEXT,row_id TEXT);
    CREATE TABLE lamb_sequence(singleton INTEGER PRIMARY KEY,value INTEGER); INSERT INTO lamb_sequence VALUES(1,0);`);
  return { db, sync: createRanchSync(db) };
}
const row = (revision, fields = {}) => ({ id: randomUUID(), tag: 'L5000', station: 1, color: 'none', lactation: 'idk', type: 'borrega', wool_quality: 'IDK', origin: 'cloud-admin', occurred_at: '2026-09-19T12:00:00Z', updated_at: '2026-09-19T12:00:00Z', deleted_at: null, revision: String(revision), ...fields });
test('pull applies >500 records across pages, resumes cursor, reserves lamb numbers, and never echoes', () => {
  const { db, sync } = fixture();
  const rows = Array.from({ length: 500 }, (_, i) => row(i + 1));
  assert.equal(sync.apply({ rows, cursor: '500' }).changed, 500);
  const restarted = createRanchSync(db);
  assert.equal(restarted.cursor(), '500');
  restarted.apply({ rows: [row(501)], cursor: '501' });
  assert.equal(db.prepare('SELECT count(*) AS n FROM counts').get().n, 501);
  assert.equal(db.prepare('SELECT value FROM lamb_sequence').get().value, 5000);
  assert.equal(db.prepare('SELECT count(*) AS n FROM sync_outbox').get().n, 0);
  const tombstone = { ...rows[0], revision: '502', updated_at: '2026-09-19T13:00:00Z', deleted_at: '2026-09-19T13:00:00Z' };
  restarted.apply({ rows: [tombstone], cursor: '502' });
  assert.ok(db.prepare('SELECT deleted_at FROM counts WHERE id=?').get(rows[0].id).deleted_at);
  assert.equal(restarted.apply({ rows: [], cursor: '502' }).changed, 0);
  db.close();
});
test('local edits during pull are not overwritten before their outbox version reaches cloud audit', () => {
  const { db, sync } = fixture(); const original = row(1);
  sync.apply({ rows: [original], cursor: '1' });
  db.prepare("UPDATE counts SET tag='L6000',updated_at='2026-09-19T13:00:00.000Z'").run();
  db.prepare("INSERT INTO sync_outbox VALUES(1,'counts',?)").run(original.id);
  const earlier = { ...original, revision: '2', updated_at: '2026-09-19T12:30:00Z' };
  sync.apply({ rows: [earlier], cursor: '2' });
  assert.equal(db.prepare('SELECT tag FROM counts').get().tag, 'L6000');
  const later = { ...original, revision: '3', updated_at: '2026-09-19T14:00:00Z', deleted_at: '2026-09-19T14:00:00Z' };
  assert.equal(sync.apply({ rows: [later], cursor: '3' }).cursor, '2');
  assert.equal(db.prepare('SELECT deleted_at FROM counts').get().deleted_at, null);
  db.exec('DELETE FROM sync_outbox');
  assert.equal(sync.apply({ rows: [later], cursor: '3' }).cursor, '3');
  assert.ok(db.prepare('SELECT deleted_at FROM counts').get().deleted_at);
  db.close();
});
test('bad pages and failed local transactions never partially advance data or cursor', () => {
  const { db, sync } = fixture(); const first = row(1);
  assert.throws(() => sync.apply({ rows: [first, row(2, { updated_at: 'bad' })], cursor: '2' }));
  assert.equal(sync.cursor(), '0'); assert.equal(db.prepare('SELECT count(*) AS n FROM counts').get().n, 0);
  assert.throws(() => sync.apply({ rows: [first], cursor: '2' }));
  db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON counts BEGIN SELECT RAISE(ABORT,'disk failure'); END");
  assert.throws(() => sync.apply({ rows: [first], cursor: '1' }));
  assert.equal(sync.cursor(), '0');
  db.close();
});
test('cloud and ranch record editors share animal validation', () => {
  const sheep = { tag: 'A12345', station: 1, type: 'oveja', color: 'pink', woolQuality: 'GOOD', lactation: 'dry' };
  assert.equal(validateShearingFields(sheep, 4), null);
  for (const changes of [{ station: 5 }, { tag: 'A1234' }, { color: 'invalid' }, { woolQuality: 'IDK' }, { lactation: 'invalid' }]) assert.ok(validateShearingFields({ ...sheep, ...changes }, 4));
  assert.equal(validateShearingFields({ ...sheep, type: 'carnero', tag: 'AC12345', woolQuality: 'IDK', lactation: 'idk' }, 4), null);
});

test('historical nullable station and survey fields remain importable', () => {
  const { db, sync } = fixture();
  sync.apply({ rows: [row(1, { station: null, color: null, lactation: null, type: null, wool_quality: null })], cursor: '1' });
  assert.equal(db.prepare('SELECT station FROM counts').get().station, null);
  assert.equal(sync.cursor(), '1');
  db.close();
});
