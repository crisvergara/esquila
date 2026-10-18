import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { writeShearingWorkbook, EXPORT_LIMIT } from '../../cloud/shearing-export.js';
import { parseRecordFilters } from '../../cloud/shearing-browser.js';
const ExcelJS = createRequire(new URL('../../cloud/package.json', import.meta.url))('exceljs');
const filters = parseRecordFilters({ day: '' });
const sample = { id: 'fixture-id', tag: '0000123', station: 2, type: 'oveja', color: 'green', owner_server_id: 'fixture-server', servers: [{id:'fixture-server',name:'=SERVER()'}],
  occurred_at: '2026-01-02T02:59:59.000Z', updated_at: '2026-01-03T04:00:00.000Z', mode: {id:'oveja',name:'+Original',legacy:true}, pending_to_ranch:true,
  survey: {schemaVersion:1,questions:[{field:'notes',display:'=Question()',type:'text'},{field:'weight',display:'Peso',type:'number'},{field:'choice',display:'Lana',type:'choice',options:[{value:'yes',name:'@Original'}]},{field:'skip',display:'Omitida',type:'text'}],responses:{notes:'=HYPERLINK("https://example.invalid","test")',weight:0,choice:'yes',skip:null}} };
function client(rows, total = rows.length) {
  const calls = []; let offset = 0;
  return {calls, async query(sql) {
    calls.push(sql);
    if (sql.startsWith('SELECT count')) return {rows:[{n:total}]};
    if (sql.startsWith('DECLARE')) offset = 0;
    if (sql.startsWith('FETCH')) { const batch = rows.slice(offset,offset+100); offset += batch.length; return {rows:batch}; }
    return {rows:[]};
  }};
}
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(),'esquila-export-unit-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  return path.join(dir,'test.xlsx');
}
test('real XLSX preserves text tags, literal formulas, numeric zero, skipped answers and Chile time', async t => {
  const filename = await fixture(t), db = client([sample]);
  await writeShearingWorkbook(db, filters, {filename,language:'en'});
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  const book = await new ExcelJS.Workbook().xlsx.readFile(filename);
  assert.deepEqual(book.worksheets.map(s=>s.name),['Records','Answers','Export']);
  const record = book.worksheets[0].getRow(2);
  assert.equal(record.getCell(3).value,'0000123');
  assert.equal(record.getCell(4).value,'2026-01-01');
  assert.equal(record.getCell(5).value,'23:59:59');
  assert.equal(record.getCell(8).value,'=SERVER()');
  assert.equal(record.getCell(11).value,'+Original');
  const answers = book.worksheets[1];
  assert.equal(answers.rowCount,5);
  assert.equal(answers.getCell('G2').value,'=Question()');
  assert.equal(answers.getCell('J2').value,sample.survey.responses.notes);
  assert.equal(answers.getCell('J2').type,ExcelJS.ValueType.String);
  assert.equal(answers.getCell('J3').value,0);
  assert.equal(answers.getCell('J3').type,ExcelJS.ValueType.Number);
  assert.equal(answers.getCell('K4').value,'@Original');
  assert.equal(answers.getCell('I5').value,'No');
  assert.equal(answers.getCell('J5').value,null);
  for(const sheet of book.worksheets) sheet.eachRow(row=>row.eachCell(cell=>assert.notEqual(cell.type,ExcelJS.ValueType.Formula)));
  assert.equal(db.calls.at(-1),'COMMIT');
});
test('empty exports contain localized headers and no invented survey responses', async t => {
  const filename=await fixture(t);
  await writeShearingWorkbook(client([]),filters,{filename});
  const book=await new ExcelJS.Workbook().xlsx.readFile(filename);
  assert.deepEqual(book.worksheets.map(s=>s.name),['Registros','Respuestas','Exportación']);
  assert.equal(book.worksheets[0].rowCount,1); assert.equal(book.worksheets[1].rowCount,1);
  assert.equal(book.worksheets[0].getCell('C1').value,'Código');
});
test('oversized, interrupted and unrepresentable exports roll back instead of reporting success', async t => {
  const dir = await mkdtemp(path.join(tmpdir(),'esquila-export-errors-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const cases=[{db:client([],EXPORT_LIMIT+1),status:413},{db:client([{...sample,tag:'bad\u0001value'}]),status:422},
    {db:client([{...sample,tag:'x'.repeat(32768)}]),status:422}, {db:client([sample]),signal:AbortSignal.abort()}];
  for (const [i,c] of cases.entries()) {
    await assert.rejects(writeShearingWorkbook(c.db,filters,{filename:path.join(dir,`${i}.xlsx`),signal:c.signal}), error=>!c.status||error.status===c.status);
    assert.equal(c.db.calls.at(-1),'ROLLBACK'); assert.ok(!c.db.calls.includes('COMMIT'));
  }
});

test('disk failure and cancellation after a partial sheet cannot hang finalization', {timeout:3000}, async t => {
  const filename=await fixture(t), broken=client([sample]);
  await assert.rejects(writeShearingWorkbook(broken,filters,{filename:path.join(filename,'missing.xlsx')}),{code:'ENOENT'});
  assert.equal(broken.calls.at(-1),'ROLLBACK');
  const controller=new AbortController(), interrupted=client([sample]), query=interrupted.query;
  interrupted.query=async sql=>{
    const result=await query(sql);
    if(sql==='CLOSE export_records') controller.abort();
    return result;
  };
  await assert.rejects(writeShearingWorkbook(interrupted,filters,{filename,signal:controller.signal}),{name:'AbortError'});
  assert.equal(interrupted.calls.at(-1),'ROLLBACK');
  assert.ok(!interrupted.calls.includes('COMMIT'));
});
