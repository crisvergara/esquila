import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {migrateBarnOwnership,createRanchOwnership} from '../../shared/ranch-ownership.js';
import {createRanchSync} from '../../shared/ranch-sync.js';

function fixture(t) {
  const db=new Database(':memory:'); t.after(()=>db.close());
  db.exec(`CREATE TABLE counts(id TEXT PRIMARY KEY,tag TEXT,station INTEGER,color TEXT,lactation TEXT,type TEXT,woolQuality TEXT,date TEXT,updated_at TEXT,deleted_at TEXT,origin TEXT,survey_json TEXT,mode_json TEXT);
    CREATE TABLE sync_outbox(seq INTEGER PRIMARY KEY,tbl TEXT,row_id TEXT);
    CREATE TABLE lamb_sequence(singleton INTEGER PRIMARY KEY,value INTEGER); INSERT INTO lamb_sequence VALUES(1,0);
    PRAGMA user_version=6;`);
  createRanchSync(db); migrateBarnOwnership(db);
  const ownership=createRanchOwnership(db,'https://cloud.example.test');
  const sync=createRanchSync(db,{deviceId:ownership.deviceId});
  const id=randomUUID(),deviceId=randomUUID();
  db.prepare("INSERT INTO counts(id,tag,updated_at) VALUES(?,'A12345','2026-01-01T00:00:00.000Z')").run(id);
  const page=(status)=>({protocol:1,deviceId,records:[{id,status}]});
  return {db,ownership,sync,id,deviceId,page};
}
test('v7 migration is idempotent; classification resets old cursor once and persists token-bound identity',t=>{
  const {db,ownership,id,deviceId,page}=fixture(t);
  db.exec("UPDATE ranch_sync_state SET cursor='500'");
  assert.equal(ownership.canEdit(db.prepare('SELECT * FROM counts').get()),false);
  ownership.apply([id],page('owned'));
  assert.equal(ownership.deviceId(),deviceId); assert.equal(ownership.status().unverified,0);
  assert.equal(db.prepare('SELECT cursor FROM ranch_sync_state').get().cursor,'0');
  db.exec("UPDATE ranch_sync_state SET cursor='600'");
  migrateBarnOwnership(db);
  const restarted=createRanchOwnership(db,'https://cloud.example.test');
  restarted.apply([],{protocol:1,deviceId,records:[]});
  assert.equal(db.prepare('SELECT cursor FROM ranch_sync_state').get().cursor,'600');
  assert.throws(()=>restarted.apply([],{protocol:1,deviceId:randomUUID(),records:[]}),/another ranch/);
  assert.throws(()=>createRanchOwnership(db,'https://other.example.test').apply([],{protocol:1,deviceId,records:[]}),/another ranch/);
  assert.equal(db.pragma('user_version',{simple:true}),7);
});
test('foreign copies and pending edits are durably quarantined, never sent as tombstones',t=>{
  const {db,ownership,id,page}=fixture(t);
  db.prepare("INSERT INTO sync_outbox VALUES(1,'counts',?)").run(id);
  const before=db.prepare('SELECT * FROM counts').get();
  assert.equal(ownership.apply([id],page('foreign')),1);
  assert.equal(db.prepare('SELECT count(*) n FROM counts').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM sync_outbox').get().n,0);
  const saved=db.prepare('SELECT * FROM record_quarantine').get();
  assert.deepEqual(JSON.parse(saved.row_json),before);
  assert.equal(JSON.parse(saved.outbox_json)[0].row_id,id);
  assert.equal(ownership.status().archived,1);
});
test('bad classifications and failed archive writes roll back the identity, cursor, record and outbox',t=>{
  const {db,ownership,id,page}=fixture(t);
  assert.throws(()=>ownership.apply([id],page('bogus')),/Invalid/);
  db.exec("CREATE TRIGGER archive_failure BEFORE INSERT ON record_quarantine BEGIN SELECT RAISE(ABORT,'disk full'); END");
  assert.throws(()=>ownership.apply([id],page('foreign')),/disk full/);
  assert.equal(ownership.deviceId(),undefined); assert.equal(ownership.pendingIds()[0],id);
});
test('strict pull rejects foreign/old protocol pages atomically; new local rows stay editable offline',t=>{
  const {db,ownership,id,deviceId,page,sync}=fixture(t);
  ownership.markCreated(id);
  assert.equal(ownership.canEdit(db.prepare('SELECT * FROM counts').get()),true);
  ownership.apply([id],page('new'));
  const row={id:randomUUID(),owner_server_id:randomUUID(),tag:'A12345',revision:'1',occurred_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'};
  assert.throws(()=>sync.apply({protocol:1,deviceId,rows:[row],cursor:'1'}),/Foreign/);
  assert.throws(()=>sync.apply({rows:[],cursor:'0'}),/ownership/);
  assert.equal(sync.cursor(),'0');
  assert.equal(db.prepare('SELECT count(*) n FROM counts').get().n,1);
});

test('an explicit cloud assignment restores an archived record without replaying its old pending edit',t=>{
  const {db,ownership,id,deviceId,page,sync}=fixture(t);
  db.prepare("UPDATE counts SET tag='A99999',updated_at='2099-01-01T00:00:00.000Z' WHERE id=?").run(id);
  db.prepare("INSERT INTO sync_outbox VALUES(1,'counts',?)").run(id);
  ownership.apply([id],page('unassigned'));
  const row={id,owner_server_id:deviceId,tag:'A12345',station:1,type:'oveja',color:'none',lactation:'idk',wool_quality:'GOOD',
    revision:'1',occurred_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-02T00:00:00.000Z'};
  assert.equal(sync.apply({protocol:1,deviceId,rows:[row],cursor:'1'}).changed,1);
  assert.equal(db.prepare('SELECT tag FROM counts').get().tag,'A12345');
  assert.equal(db.prepare('SELECT count(*) n FROM sync_outbox').get().n,0);
  assert.equal(ownership.status().archived,0);
  assert.equal(JSON.parse(db.prepare('SELECT row_json FROM record_quarantine').get().row_json).tag,'A99999');
});
