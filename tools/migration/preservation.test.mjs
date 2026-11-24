import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import mysql from 'mysql2/promise';
import { startDatabase } from '../issuance/database.mjs';
import { preservationPlan,preserveSnapshot,seedReservedCounters } from './preservation.mjs';
import { preservationFixture } from './preservation-fixture.mjs';

registerHooks({resolve(specifier,context,next){if(specifier==='./input'&&/lib\/issuance\/(service|history)\.ts$/.test(context.parentURL??''))return next(`${specifier}.ts`,context);return next(specifier,context);}});
const {issue}=await import('../../lib/issuance/service.ts');
const {history,historyDetail}=await import('../../lib/issuance/history.ts');
const actor={staffId:'TEST-001',departmentId:'204'};
const input=()=>({requestId:randomUUID(),seriesId:'TEST-S1',subject:'Synthetic next number',recipient:'Synthetic',recipientDepartmentIds:[],externalOrganization:'Synthetic',signer:'Synthetic',confidential:true,documentDate:'2026-11-13'});
const clock=()=>new Date('2026-11-13T03:00:00Z');
const approvalReference='Synthetic test only: approved preservation policy';

test('preservation plan keeps all number sources including canceled subnumbers and unknown owners',()=>{
  const dump=preservationFixture(),plan=preservationPlan(dump);
  assert.deepEqual([plan.summary.reservations,plan.summary.dispositions,plan.summary.reasonOccurrences,plan.summary.restricted,plan.summary.unknownTime],[6,5,7,4,1]);
  assert.deepEqual(plan.summary.unresolvedSeries,['00096']);
  assert.equal(plan.reservations.filter(row=>row.main===42).length,2);
  assert.equal(plan.reservations.find(row=>row.sourceId==='2').sub,2);
  assert.equal(plan.reservations.find(row=>row.sourceId==='3').main,90);
  assert.equal(dump.tables.genbook.records[3].user_datetime,null);
  const invalid=structuredClone(dump);invalid.tables.genbook.records[0].book_number='not-a-number';assert.throws(()=>preservationPlan(invalid),/Unreservable/);
});

test('isolated preservation is atomic, private, replay-safe and prevents historical reuse under concurrency',{timeout:120000},async t=>{
  const db=await startDatabase({port:3324});
  const pool=mysql.createPool({uri:db.url,timezone:'Z',dateStrings:true,connectionLimit:10});
  const password=randomUUID();
  await db.admin.query("CREATE USER 't12_migration'@'127.0.0.1' IDENTIFIED BY ?",[password]);
  await db.admin.query("GRANT ALL ON t05_synthetic.* TO 't12_migration'@'127.0.0.1'");
  const migrationPool=mysql.createPool({host:'127.0.0.1',port:3324,user:'t12_migration',password,database:'t05_synthetic',timezone:'Z',dateStrings:true});
  const migration=await migrationPool.getConnection();
  const dump=preservationFixture(),options={approvalReference};
  try{
    await t.test('dry-run rolls back raw, policy, reservations, dispositions and gate',async()=>{
      await preserveSnapshot(db.admin,dump,{...options,dryRun:true});
      const [[row]]=await db.admin.query('SELECT (SELECT COUNT(*) FROM legacy_batches) batches,(SELECT COUNT(*) FROM legacy_staging) raw_rows,(SELECT COUNT(*) FROM legacy_number_reservations) reservations,(SELECT state FROM issuance_migration_gate WHERE id=1) gate');
      assert.deepEqual([Number(row.batches),Number(row.raw_rows),Number(row.reservations),row.gate],[0,0,0,'open']);
      await assert.rejects(preserveSnapshot(db.admin,dump),/approval reference/);
    });
    await t.test('mid-reservation failure rolls back all raw writes and gate closure',async()=>{
      await db.admin.query("CREATE TRIGGER t12_preserve_fail BEFORE INSERT ON legacy_number_reservations FOR EACH ROW BEGIN IF NEW.source_id='3' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic preservation failure'; END IF; END");
      await assert.rejects(preserveSnapshot(db.admin,dump,options));
      await db.admin.query('DROP TRIGGER t12_preserve_fail');
      const [[row]]=await db.admin.query('SELECT (SELECT COUNT(*) FROM legacy_batches) batches,(SELECT COUNT(*) FROM legacy_preservation_batches) policies,(SELECT state FROM issuance_migration_gate WHERE id=1) gate');
      assert.deepEqual([Number(row.batches),Number(row.policies),row.gate],[0,0,'open']);
    });
    await t.test('in-flight preservation gate serializes an issuer and closes before allocation',async()=>{
      await db.admin.query('CREATE TRIGGER t12_preserve_wait BEFORE INSERT ON legacy_number_reservations FOR EACH ROW DO SLEEP(0.15)');
      const preserving=preserveSnapshot(migration,dump,options);
      let locked=false;
      for(let attempt=0;attempt<100;attempt++){
        const [[row]]=await db.admin.query("SELECT COUNT(*) total FROM performance_schema.data_locks WHERE OBJECT_NAME='issuance_migration_gate' AND LOCK_TYPE='RECORD' AND LOCK_MODE LIKE 'X%'");
        if(Number(row.total)){locked=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(locked,true);
      // Attach rejection handler immediately; the promise waits for import commit.
      const waiting=assert.rejects(issue(pool,actor,input(),clock),error=>error.status===503);
      await preserving;await waiting;
      await db.admin.query('DROP TRIGGER t12_preserve_wait');
      const [[count]]=await db.admin.query('SELECT COUNT(*) total FROM issuance_documents');assert.equal(Number(count.total),0);
    });
    await t.test('replay verifies all fields; app DB principal cannot read restricted tables or open gate',async()=>{
      assert.equal((await preserveSnapshot(db.admin,dump,options)).replayed,true);
      for(const table of ['legacy_staging','legacy_dispositions','legacy_preservation_batches'])await assert.rejects(pool.query(`SELECT * FROM ${table}`),error=>error.code==='ER_TABLEACCESS_DENIED_ERROR');
      await assert.rejects(pool.query("UPDATE issuance_migration_gate SET state='open'"),error=>error.code==='ER_TABLEACCESS_DENIED_ERROR');
      assert.equal((await history(pool,actor,'',1)).documents.length,0);
      await assert.rejects(historyDetail(pool,actor,dump.sourceSha256,'1'),error=>error.status===404);
      const [[stored]]=await db.admin.execute("SELECT payload FROM legacy_staging WHERE source_table='genbook' AND source_id='4'");
      assert.equal((typeof stored.payload==='string'?JSON.parse(stored.payload):stored.payload).user_datetime,null);
      await assert.rejects(preserveSnapshot(db.admin,dump,{approvalReference:'Changed approval'}),/approval mismatch/);
    });
    await t.test('tampering with raw, reservation or disposition is detected, not silently repaired',async()=>{
      await db.admin.query("UPDATE legacy_number_reservations SET main_number=1 WHERE source_id='3'");
      await assert.rejects(preserveSnapshot(db.admin,dump,options),/Reservation payload/);
      await db.admin.query("UPDATE legacy_number_reservations SET main_number=90 WHERE source_id='3'; UPDATE legacy_dispositions SET reasons=JSON_ARRAY() WHERE source_table='genbook' AND source_id='3'");
      await assert.rejects(preserveSnapshot(db.admin,dump,options),/Disposition payload/);
      await db.admin.query("UPDATE legacy_dispositions SET reasons=JSON_ARRAY('A03','A04','A05') WHERE source_table='genbook' AND source_id='3'; UPDATE legacy_staging SET payload=JSON_OBJECT('tampered',true) WHERE source_table='genbook' AND source_id='4'");
      await assert.rejects(preserveSnapshot(db.admin,dump,options),/Staged payload/);
      await db.admin.execute("UPDATE legacy_staging SET payload=? WHERE source_table='genbook' AND source_id='4'",[JSON.stringify(dump.tables.genbook.records[3])]);
      assert.equal((await preserveSnapshot(db.admin,dump,options)).replayed,true);
    });
    const mapping={dump,approvalReference,reviewedBy:'Synthetic mapping reviewer',mappings:[{legacySeriesId:'00001',seriesId:'TEST-S1'}]};
    await t.test('unknown source-series cannot be recreated or aliased; explicit mappings require disabled empty targets',async()=>{
      await assert.rejects(seedReservedCounters(db.admin,mapping),/disabled/);
      await db.admin.query("UPDATE issuance_series SET enabled=0 WHERE id='TEST-S1'; INSERT INTO issuance_series(id,name,document_type,prefix,year_basis,enabled) VALUES ('00096','Synthetic','Synthetic','Synthetic','calendar',0)");
      for(const seriesId of ['00096','TEST-S1'])await assert.rejects(seedReservedCounters(db.admin,{...mapping,mappings:[{legacySeriesId:'00096',seriesId}]}),/Unresolved/);
      const seeded=await seedReservedCounters(db.admin,mapping);
      assert.equal(seeded.counters[0].reservedFloor,90);
      const [[gate]]=await db.admin.query('SELECT state FROM issuance_migration_gate');assert.equal(gate.state,'blocked');
      assert.equal((await preserveSnapshot(db.admin,dump,options)).replayed,true);
      await db.admin.query("UPDATE issuance_counters SET last_number=1 WHERE series_id='TEST-S1'");
      await assert.rejects(preserveSnapshot(db.admin,dump,options),/counter mismatch/);
      await seedReservedCounters(db.admin,mapping);
    });
    await t.test('synthetic release uses reserved maximum incl unknown owner/canceled subnumber; rewind/deletion fails closed',async()=>{
      // Test-only release. There is deliberately no release function/API in product code.
      await db.admin.query("UPDATE issuance_migration_gate SET state='open'; UPDATE issuance_series SET enabled=1 WHERE id='TEST-S1'");
      const result=await Promise.all(Array.from({length:8},()=>issue(pool,actor,input(),clock)));
      assert.deepEqual(result.map(row=>row.document.number).sort(),Array.from({length:8},(_,index)=>`ทดสอบ 001/00${index+91}`));
      await db.admin.query("UPDATE issuance_counters SET last_number=50 WHERE series_id='TEST-S1'");
      await assert.rejects(issue(pool,actor,input(),clock),error=>error.status===409);
      await db.admin.query("DELETE FROM issuance_counters WHERE series_id='TEST-S1'");
      await assert.rejects(issue(pool,actor,input(),clock),error=>error.status===409);
      const [[count]]=await db.admin.query('SELECT COUNT(*) total FROM issuance_documents');assert.equal(Number(count.total),8);
    });
  }finally{migration.release();await migrationPool.end();await pool.end();await db.close();}
});
