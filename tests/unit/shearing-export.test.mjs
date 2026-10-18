import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { writeShearingWorkbook, EXPORT_LIMIT, SURVEY_COLUMN_LIMIT } from '../../cloud/shearing-export.js';
import { parseRecordFilters } from '../../cloud/shearing-browser.js';
const ExcelJS = createRequire(new URL('../../cloud/package.json', import.meta.url))('exceljs');
const filters = parseRecordFilters({ day: '' });
const sample = { id: 'fixture-id', tag: '0000123', station: 2, type: 'oveja', color: 'green', owner_server_id: 'fixture-server', servers: [{id:'fixture-server',name:'=SERVER()'}],
  occurred_at: '2026-01-02T02:59:59.000Z', updated_at: '2026-01-03T04:00:00.000Z', mode: {id:'oveja',name:'+Original',legacy:true}, pending_to_ranch:true,
  survey: {schemaVersion:1,questions:[{field:'notes',display:'=Question()',type:'text'},{field:'weight',display:'Peso',type:'number'},{field:'choice',display:'Lana',type:'choice',options:[{value:'yes',name:'@Original'}]},{field:'skip',display:'Omitida',type:'text'}],responses:{notes:'=HYPERLINK("https://example.invalid","test")',weight:0,choice:'yes',skip:null}} };
function client(rows, total = rows.length, references = [{ id:'fixture-server', shearers:[{name:'First'},{name:'=Shearer()'}] }]) {
  const calls = []; let offset = 0;
  return {calls, async query(sql) {
    calls.push(sql);
    if (sql.startsWith('SELECT count')) return {rows:[{n:total}]};
    if (sql.startsWith('SELECT d.id')) return {rows:references};
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
  assert.equal(record.getCell(10).value,'=Shearer()');
  assert.equal(record.getCell(12).value,'+Original');
  const records=book.worksheets[0];
  const questionCell=prefix=>record.getCell(records.getRow(1).values.findIndex(value=>value?.startsWith(prefix+' [')));
  assert.equal(questionCell('=Question()').value,sample.survey.responses.notes);
  assert.equal(questionCell('Peso').value,0);
  assert.equal(questionCell('Peso').type,ExcelJS.ValueType.Number);
  assert.equal(questionCell('Lana').value,'@Original');
  assert.equal(questionCell('Omitida').value,'No answer');
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
  assert.equal(book.worksheets[0].columnCount,20);
});
test('survey columns cover later batches, keep renamed snapshots apart and distinguish skipped from unasked', async t => {
  const filename=await fixture(t);
  const q=sample.survey.questions[2];
  const event=(id,question,response)=>({...sample,id, survey:{schemaVersion:1,questions:question?[question]:[],responses:{choice:response}}});
  const rows=[event('original',q,'yes'),event('flags',{...q,required:false,options:q.options.map(option=>({...option,active:false}))},'yes'),
    event('renamed-option',{...q,options:[{value:'yes',name:'New answer'}]},'yes'),event('renamed-question',{...q,display:'New question'},'yes'),
    event('skipped',q,null),event('unasked',null,null),{...event('different-mode',q,'yes'),mode:{id:'different',name:'Another mode'}}];
  rows.push(...Array.from({length:100},(_,i)=>event(`filler-${i}`,q,'yes')),
    event('late',{...q,field:'late',display:'Pregunta al final'},null));
  await writeShearingWorkbook(client(rows),filters,{filename,language:'en'});
  const book=await new ExcelJS.Workbook().xlsx.readFile(filename),sheet=book.getWorksheet('Records');
  const headers=sheet.getRow(1).values;
  assert.equal(sheet.columnCount,25);
  assert.equal(new Set(headers.slice(21)).size,5);
  const original=sheet.getRow(2).values.findIndex((value,i)=>i>20&&value==='@Original');
  assert.equal(sheet.getRow(3).getCell(original).value,'@Original');
  assert.equal(sheet.getRow(4).getCell(original).value,null);
  assert.equal(sheet.getRow(4).values.filter(value=>value==='New answer').length,1);
  assert.equal(sheet.getRow(5).getCell(original).value,null);
  assert.equal(sheet.getRow(6).getCell(original).value,'No answer');
  for(let col=21;col<=25;col++) assert.equal(sheet.getRow(7).getCell(col).value,null);
  assert.equal(sheet.getRow(8).getCell(original).value,null);
  const late=headers.findIndex(value=>value?.startsWith('Pregunta al final ['));
  assert.ok(late>20); assert.equal(sheet.getRow(rows.length+1).getCell(late).value,'No answer');
  // Sorting the records cannot change column identities or order.
  const reversed=path.join(path.dirname(filename),'reversed.xlsx');
  await writeShearingWorkbook(client([...rows].reverse()),filters,{filename:reversed,language:'en'});
  const again=await new ExcelJS.Workbook().xlsx.readFile(reversed);
  assert.deepEqual(again.getWorksheet('Records').getRow(1).values,headers);
});
test('shearer names follow owning server and stable station numbers, with an explicit unknown fallback', async t => {
  const filename=await fixture(t);
  const rows=[sample,{...sample,owner_server_id:'second-server'},{...sample,owner_server_id:null},{...sample,owner_server_id:'revoked-server'},{...sample,station:24}];
  const references=[{id:'fixture-server',shearers:[{name:'One'},{name:'José',active:false}]},{id:'second-server',shearers:[{name:'Other one'},{name:'Ana'}]}];
  await writeShearingWorkbook(client(rows,rows.length,references),filters,{filename,language:'en'});
  const book=await new ExcelJS.Workbook().xlsx.readFile(filename),sheet=book.getWorksheet('Records');
  assert.equal(sheet.getCell('J1').value,'Shearer (current reference name)');
  assert.deepEqual(sheet.getColumn(10).values.slice(2),['José','Ana','Unnamed','Unnamed','Unnamed']);
  assert.deepEqual(sheet.getColumn(9).values.slice(2),[2,2,2,2,24]);
});
test('oversized, interrupted and unrepresentable exports roll back instead of reporting success', async t => {
  const dir = await mkdtemp(path.join(tmpdir(),'esquila-export-errors-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const cases=[{db:client([],EXPORT_LIMIT+1),status:413},{db:client([{...sample,tag:'bad\u0001value'}]),status:422},
    {db:client(Array.from({length:SURVEY_COLUMN_LIMIT+1},(_,i)=>({...sample,survey:{questions:[{field:'text',display:`Question ${i}`,type:'text'}],responses:{}}}))),status:413},
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
  let passes=0;
  interrupted.query=async sql=>{
    const result=await query(sql);
    if(sql==='CLOSE export_records' && ++passes===2) controller.abort();
    return result;
  };
  await assert.rejects(writeShearingWorkbook(interrupted,filters,{filename,signal:controller.signal}),{name:'AbortError'});
  assert.equal(interrupted.calls.at(-1),'ROLLBACK');
  assert.ok(!interrupted.calls.includes('COMMIT'));
});
