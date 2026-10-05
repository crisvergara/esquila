import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { shearingModes } from '../../shared/shearing-validation.js';
import { validateConfiguration, retainRetiredConfiguration, activeModes } from '../../shared/ranch-configuration.js';
import { createSurvey, validateSurvey, legacySurvey, questionsFor } from '../../shared/surveys.js';
import { migrateBarnSurveys } from '../../shared/survey-migration.js';

const questions = () => [
  { field: 'healthy', display: '¿Está sana?', type: 'choice', options: [{ value: 'yes', name: 'Sí' }, { value: 'no', name: 'No' }] },
  { field: 'weight', display: 'Peso', type: 'number', min: 1, max: 150 },
  { field: 'notes', display: 'Observaciones', type: 'text', required: false, maxLength: 100 },
];
const config = () => validateConfiguration({ schemaVersion: 2, name: 'Prueba', shearers: [{ name: 'Ana' }], modes: shearingModes.map(m => ({ ...m, surveySchema: questions() })) });
const answers = () => ({ healthy: 'yes', weight: 47.5, notes: null });

test('dynamic surveys support all animal modes, optional answers, bounds, and zero questions', () => {
  for (const type of ['oveja', 'carnero', 'borrega']) {
    const survey = createSurvey(config().modes, type, { surveyResponses: answers() });
    assert.equal(survey.responses.weight, 47.5);
    assert.equal(survey.responses.notes, null);
  }
  const c = config(); for (const mode of c.modes) mode.surveySchema = [];
  assert.deepEqual(createSurvey(c.modes, 'oveja', { surveyResponses: {} }).questions, []);
  for (const response of [{ ...answers(), healthy: 'unknown' }, { ...answers(), weight: 0 }, { ...answers(), weight: '47' },
    { ...answers(), notes: 'x'.repeat(101) }, { ...answers(), extra: 'x' }, { weight: 47 }, null, []]) {
    assert.throws(() => createSurvey(config().modes, 'oveja', { surveyResponses: response }));
  }
  for (const mutate of [q => { q[0].field = '__proto__'; }, q => { q[1].min = 151; }, q => { q[2].maxLength = 501; },
    q => q.push(q[0]), q => { q[0].type = 'script'; }, q => { q[0].required = 'yes'; }, q => q.push(...Array(24).fill(q[1]))]) {
    const c = config(); mutate(c.modes[0].surveySchema); assert.throws(() => validateConfiguration(c));
  }
});

test('retirement, reordering, labels and new questions never rewrite a recorded survey', () => {
  const before = config();
  const survey = createSurvey(before.modes, 'oveja', { surveyResponses: answers() });
  const next = config(); next.modes[0].surveySchema.splice(0, 1);
  next.modes[0].surveySchema[0].display = 'Peso nuevo'; next.modes[0].surveySchema.reverse();
  const retained = retainRetiredConfiguration(next, before);
  assert.equal(retained.modes[0].surveySchema.at(-1).active, false);
  assert.equal(activeModes(retained.modes)[0].surveySchema.length, 2);
  assert.equal(questionsFor(retained.modes, 'oveja').length, 2);
  const edited = createSurvey(retained.modes, 'carnero', { surveyResponses: { ...answers(), healthy: 'no', weight: 50 } }, { type: 'oveja', survey });
  assert.deepEqual(edited.questions, survey.questions);
  assert.equal(edited.responses.healthy, 'no');
  assert.equal(edited.questions[1].display, 'Peso');
  const incompatible = config(); incompatible.modes[0].surveySchema[1] = { field: 'weight', display: 'Peso', type: 'text' };
  assert.throws(() => retainRetiredConfiguration(incompatible, before));
  assert.throws(() => createSurvey(retained.modes, 'oveja', { surveyResponses: answers() }));
});

test('legacy uploads preserve custom answers and legacy null/unknown answers remain readable', () => {
  const modes = config().modes;
  modes[0].surveySchema.push(shearingModes[0].surveySchema[0]);
  const snapshot = createSurvey(modes, 'oveja', { surveyResponses: { ...answers(), woolQuality: 'GOOD' } });
  const merged = legacySurvey({ type: 'oveja', wool_quality: 'BAD' }, snapshot);
  assert.equal(merged.responses.woolQuality, 'BAD');
  assert.equal(merged.responses.weight, 47.5);
  assert.equal(merged.responses.healthy, 'yes');
  const legacy = validateSurvey(legacySurvey({ type: 'oveja', woolQuality: 'CUSTOM', lactation: null }));
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.responses.woolQuality, 'CUSTOM');
  assert.equal(legacy.responses.lactation, null);
  assert.throws(() => validateSurvey({ ...snapshot, responses: { ...snapshot.responses, weight: 151 } }));
});

test('SQLite v4 migration preserves identities, dates, tombstones, pending writes and receipts exactly once', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE counts(id TEXT PRIMARY KEY,type TEXT,woolQuality TEXT,lactation TEXT,date TEXT,updated_at TEXT,deleted_at TEXT);
    INSERT INTO counts VALUES('old','oveja','GOOD','dry','2023-01-01','2024-01-01',NULL),('deleted','oveja','CUSTOM',NULL,'2023-01-02','2024-01-02','2024-01-02');
    CREATE TABLE sync_outbox(seq INTEGER PRIMARY KEY,tbl TEXT,row_id TEXT); INSERT INTO sync_outbox VALUES(1,'counts','old');
    CREATE TABLE record_mutations(id TEXT PRIMARY KEY,request TEXT,result TEXT); INSERT INTO record_mutations VALUES('receipt','request','result');
    PRAGMA user_version=4;`);
  const before = db.prepare('SELECT * FROM counts').all();
  migrateBarnSurveys(db);
  assert.equal(db.pragma('user_version', { simple: true }), 5);
  const after = db.prepare('SELECT * FROM counts').all();
  assert.deepEqual(after.map(({ survey_json, ...row }) => row), before);
  assert.equal(validateSurvey(JSON.parse(after[0].survey_json)).responses.lactation, 'dry');
  assert.equal(validateSurvey(JSON.parse(after[1].survey_json)).responses.woolQuality, 'CUSTOM');
  assert.deepEqual(db.prepare('SELECT * FROM sync_outbox').all(), [{ seq: 1, tbl: 'counts', row_id: 'old' }]);
  assert.equal(db.prepare('SELECT result FROM record_mutations').get().result, 'result');
  migrateBarnSurveys(db);
  assert.deepEqual(db.prepare('SELECT * FROM counts').all(), after);
  db.close();
});

test('a failed SQLite survey backfill rolls back both the column and migration version', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE counts(id TEXT,type TEXT); INSERT INTO counts VALUES('old','oveja'); PRAGMA user_version=4;
    CREATE TRIGGER fail BEFORE UPDATE ON counts BEGIN SELECT RAISE(ABORT,'disk failure'); END;`);
  assert.throws(() => migrateBarnSurveys(db));
  assert.equal(db.pragma('user_version', { simple: true }), 4);
  assert.ok(!db.pragma('table_info(counts)').some(c => c.name === 'survey_json'));
  db.close();
});
