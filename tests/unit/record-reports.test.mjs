import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { browseLocalRecords, parseLocalRecordFilters } from '../../shared/local-records.js';
import { ranchDay, ranchDayBounds, validRanchDay } from '../../shared/ranchdate.js';
import { assembleReport } from '../../shared/record-reports.js';

const choice = { field: 'good', display: '¿Buena lana?', type: 'choice', options: [{ value: 'yes', name: 'Sí' }, { value: 'no', name: 'No' }] };
const number = { field: 'weight', display: 'Peso', type: 'number' };
const text = { field: 'notes', display: 'Notas', type: 'text' };
function fixture(t) {
  const db = new Database(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE counts(id TEXT PRIMARY KEY, date TEXT, tag TEXT, station INTEGER, type TEXT, deleted_at TEXT, survey_json TEXT, mode_json TEXT);
    CREATE TABLE sync_outbox(tbl TEXT, row_id TEXT);`);
  const insert = db.prepare('INSERT INTO counts VALUES (?,?,?,?,?,?,?,?)');
  let id = 0;
  return { db, add({ date = '2026-01-02T04:00:00.000Z', tag = 'A12345', station = 1, deleted = null, questions = [choice,number,text], responses = {} } = {}) {
    insert.run(String(++id).padStart(6, '0'), date, tag, station, 'oveja', deleted, JSON.stringify({ questions, responses }), JSON.stringify({ id: 'oveja', name: 'Ovejas' }));
  }, read: query => browseLocalRecords(db, parseLocalRecordFilters(query)) };
}

test('calendar filters span actual Chilean days, including both DST transitions', () => {
  for (const [day, hours] of [['2026-01-02',24], ['2026-04-04',25], ['2026-09-06',23]]) {
    const { start, end } = ranchDayBounds(day);
    assert.equal((Date.parse(end) - Date.parse(start)) / 3600000, hours);
    assert.equal(ranchDay(start), day);
    assert.equal(ranchDay(Date.parse(end) - 1), day);
    assert.notEqual(ranchDay(Date.parse(start) - 1), day);
    assert.notEqual(ranchDay(end), day);
  }
  for (const value of ['2026-02-30','0000-01-01','2026-1-1','bad']) assert.equal(validRanchDay(value), false);
});

test('pagination reaches beyond 200 rows, sorts equal instants by ID and clamps after deletions', t => {
  const f = fixture(t);
  for (let i = 0; i < 251; i++) f.add();
  const first = f.read({ limit:'100' }), second = f.read({ limit:'100', offset:'100' }), last = f.read({ limit:'100', offset:'200' });
  assert.equal(first.total, 251); assert.equal(last.rows.length, 51);
  assert.equal(new Set([...first.rows, ...second.rows, ...last.rows].map(r => r.id)).size, 251);
  assert.equal(first.rows[0].id, '000251');
  f.db.exec("UPDATE counts SET deleted_at='2026-01-03T00:00:00Z' WHERE id<='000052'");
  assert.equal(f.read({ limit:'100', offset:'200' }).offset, 100);
  assert.equal(f.read({ tag:'nothing', offset:'200' }).offset, 0);
  for (const query of [{day:'2026-02-30'}, {limit:'500'}, {offset:'-1'}, {tag:['x']}, {report:'yes'}, {extra:'1'}]) assert.throws(() => f.read(query), /Filtros inválidos/);
  assert.equal(f.read({tag:'%'}).total, 0);
});

test('reports cover the whole filtered set, preserve question wording, and exclude tombstones and unasked questions', t => {
  const f = fixture(t);
  for (let i=0; i<50; i++) f.add({ responses: {good:i%2?'yes':'no', weight:i%2?10:0, notes:i%2?'Nota':null} });
  f.add({ responses: {good:null, weight:null}, station:2 });
  f.add({ questions:[], station:2 });
  f.add({ questions:[{ ...choice, display:'Pregunta nueva' }], responses:{good:'yes'} });
  f.add({ questions:[{ ...choice, options: [{value:'yes',name:'Renombrado'},{value:'no',name:'No'}] }], responses:{good:'yes'} });
  f.add({ deleted:'2026-01-03T00:00:00Z', responses:{good:'no',weight:999} });
  f.add({ date:'2026-01-02T02:59:59.999Z', responses:{good:'yes', weight:999} });
  const data = f.read({ day:'2026-01-02', limit:'25', offset:'25', report:'1' });
  assert.equal(data.rows.length, 25); assert.equal(data.total, 54);
  assert.equal(data.report.total, 54); assert.equal(data.report.surveyed, 53); assert.equal(data.report.withoutSurvey, 1);
  assert.deepEqual(data.report.stations, [{station:1,count:52},{station:2,count:2}]);
  const original = data.report.questions.find(q => q.field === 'good' && q.asked === 51);
  assert.equal(original.answered, 50); assert.equal(original.missing, 1);
  assert.deepEqual(original.choices.map(o => o.count), [25,25]);
  assert.equal(data.report.questions.filter(q => q.field === 'good').length, 3);
  const numeric = data.report.questions.find(q => q.field === 'weight');
  assert.equal(numeric.average, 5); assert.equal(numeric.minimum, 0); assert.equal(numeric.maximum, 10); assert.equal(numeric.missing, 1);
  assert.equal(data.report.questions.find(q => q.field === 'notes').answered, 25);
  assert.equal(f.read({ tag:'nothing', report:'1' }).report.total, 0);
  assert.equal(f.read({}).report, undefined);
});

test('excess survey groups show an explicit error without publishing incomplete survey totals', () => {
  const report = assembleReport({totals:{total:'50000',surveyed:'50000'},stations:[],modes:[],surveys:Array(2001).fill({})});
  assert.equal(report.total, 50000);
  assert.match(report.surveyError, /Filtra por día o código/);
  assert.deepEqual(report.questions, []);
});
