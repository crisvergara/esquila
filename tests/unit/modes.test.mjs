import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { shearingModes, validateShearingFields } from '../../shared/shearing-validation.js';
import { activeModes, validateConfiguration, retainRetiredConfiguration } from '../../shared/ranch-configuration.js';
import { captureMode, modeForRecord, legacyMode, validateRecordedMode, editableMode } from '../../shared/modes.js';
import { migrateBarnModes } from '../../shared/mode-migration.js';
import { createRanchSync } from '../../shared/ranch-sync.js';
const individual = () => ({ ...structuredClone(shearingModes[0]), type: 'young_ewes', name: 'Borregas nuevas', bulk: false, surveySchema: [] });
const config = () => validateConfiguration({ schemaVersion: 3, name: 'Galpón', shearers: [{ name: 'Ana' }], modes: [individual(), { type: 'group', name: 'Por lote', bulk: true }] });

test('mode manifests support variable names/counts, retire stable IDs and forbid changing counting semantics', () => {
  const before = config();
  assert.equal(before.modes.length, 2);
  const next = structuredClone(before); next.modes.shift(); next.modes[0].name = 'Lotes pequeños';
  const result = retainRetiredConfiguration(next, before);
  assert.deepEqual(activeModes(result.modes).map(m => m.name), ['Lotes pequeños']);
  assert.equal(result.modes[1].type, 'young_ewes'); assert.equal(result.modes[1].active, false);
  next.modes[0] = { ...individual(), type: 'group' };
  assert.throws(() => retainRetiredConfiguration(validateConfiguration(next), before), /tipo de conteo/);
  for (const mutate of [c => { c.modes = []; }, c => c.modes.forEach(m => { m.active = false; }),
    c => { c.modes[0].name = ''; }, c => { c.modes[0].type = 'constructor'; }, c => { c.modes[0].type = 'borrega'; },
    c => { c.modes[0].type = 'long'.repeat(11); }, c => { c.modes[0].bulk = undefined; }, c => c.modes.push(c.modes[0]),
    c => { c.modes = Array.from({ length: 25 }, (_, i) => ({ ...c.modes[1], type: `mode_${i}` })); },
    c => { c.modes[0].name = 'x'.repeat(81); }]) {
    const bad = config(); mutate(bad); assert.throws(() => validateConfiguration(bad));
  }
  assert.throws(() => retainRetiredConfiguration({ ...before, schemaVersion: 2 }, before), /anterior/);
});

test('recorded mode keeps its original name and editable tag rules across renamed or missing manifests', () => {
  const mode = individual(), saved = captureMode(mode);
  const old = { type: mode.type, mode: saved, tag: 'A12345', color: 'green', station: 1 };
  const renamed = { ...mode, name: 'Otro nombre' };
  assert.deepEqual(modeForRecord([renamed], mode.type, old), saved);
  assert.equal(modeForRecord([renamed], mode.type).name, 'Otro nombre');
  assert.equal(validateShearingFields({ ...old, tag: 'A12346' }, 1, [], old), null);
  assert.ok(validateShearingFields({ ...old, tag: 'Z12346' }, 1, [], old));
  assert.ok(validateShearingFields(old, 1, [], null));
  assert.equal(editableMode([], old).tagSchema.textSchema[1].max, saved.tagRules.max);
  assert.throws(() => modeForRecord([{ ...mode, active: false }], mode.type), /retirado/);
  assert.equal(legacyMode({ type: 'borrega' }).id, 'carnillero');
  assert.equal(legacyMode({ type: 'carnero' }).name, 'Carneros');
  assert.equal(legacyMode({ type: 'toString' }).name, 'Sin modo registrado');
  for (const bad of [null, {}, { ...saved, name: '' }, { ...saved, id: '__proto__' }, { ...saved, tagRules: null },
    { ...saved, tagRules: { ...saved.tagRules, max: 20 } }, { ...saved, bulk: 'true' }]) assert.throws(() => validateRecordedMode(bad));
});

function oldDatabase() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE counts(id TEXT PRIMARY KEY,tag TEXT,station INTEGER,color TEXT,lactation TEXT,type TEXT,woolQuality TEXT,date TEXT,updated_at TEXT,deleted_at TEXT,origin TEXT,survey_json TEXT);
    CREATE TABLE sync_outbox(seq INTEGER PRIMARY KEY,tbl TEXT,row_id TEXT);
    CREATE TABLE lamb_sequence(singleton INTEGER PRIMARY KEY,value INTEGER); INSERT INTO lamb_sequence VALUES(1,0);
    PRAGMA user_version=5;`);
  return db;
}
test('SQLite mode migration is atomic, idempotent and preserves dates, tombstones and pending rows', () => {
  const db = oldDatabase(), id = randomUUID();
  db.prepare("INSERT INTO counts(id,type,tag,date,updated_at,deleted_at) VALUES(?,'borrega','L0001','old-day','updated','deleted')").run(id);
  db.prepare("INSERT INTO sync_outbox VALUES(1,'counts',?)").run(id);
  db.exec("CREATE TRIGGER fail_mode BEFORE UPDATE ON counts BEGIN SELECT RAISE(ABORT,'disk full'); END");
  assert.throws(() => migrateBarnModes(db), /disk full/);
  assert.equal(db.pragma('user_version', { simple: true }), 5);
  assert.ok(!db.pragma('table_info(counts)').some(c => c.name === 'mode_json'));
  db.exec('DROP TRIGGER fail_mode'); migrateBarnModes(db); migrateBarnModes(db);
  const row = db.prepare('SELECT * FROM counts').get();
  assert.deepEqual(JSON.parse(row.mode_json), { id: 'carnillero', name: 'Corderos', bulk: true, legacy: true });
  assert.equal(row.id, id); assert.equal(row.deleted_at, 'deleted'); assert.equal(row.date, 'old-day'); assert.equal(row.updated_at, 'updated');
  assert.equal(db.prepare('SELECT count(*) AS n FROM sync_outbox').get().n, 1);
  assert.equal(db.pragma('user_version', { simple: true }), 6); db.close();
});

test('pull snapshots survive legacy writers, restart and tombstones; malformed modes roll back the whole page', () => {
  const db = oldDatabase(); migrateBarnModes(db);
  let sync = createRanchSync(db);
  const row = { id: randomUUID(), tag: 'A12345', station: 1, type: 'young_ewes', color: 'green',
    occurred_at: '2026-10-08T12:00:00Z', updated_at: '2026-10-08T12:00:00Z', revision: '1', mode: captureMode(individual()) };
  sync.apply({ rows: [row], cursor: '1' }); sync = createRanchSync(db);
  sync.apply({ rows: [{ ...row, mode: undefined, revision: '2', updated_at: '2026-10-08T12:01:00Z' }], cursor: '2' });
  sync.apply({ rows: [{ ...row, mode: legacyMode(row), revision: '3', updated_at: '2026-10-08T12:02:00Z', deleted_at: '2026-10-08T12:02:00Z' }], cursor: '3' });
  assert.deepEqual(JSON.parse(db.prepare('SELECT mode_json FROM counts').get().mode_json), row.mode);
  assert.ok(db.prepare('SELECT deleted_at FROM counts').get().deleted_at);
  const next = { ...row, id: randomUUID(), revision: '4' };
  assert.throws(() => sync.apply({ rows: [next, { ...next, id: randomUUID(), revision: '5', mode: {} }], cursor: '5' }));
  assert.equal(sync.cursor(), '3'); assert.equal(db.prepare('SELECT count(*) AS n FROM counts').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM sync_outbox').get().n, 0); db.close();
});
