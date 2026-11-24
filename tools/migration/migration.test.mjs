import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { startDatabase } from '../issuance/database.mjs';
import { parseValues, readDump, hash } from './dump.mjs';
import { mkdir,writeFile,unlink } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { importHistory, stageDump } from './import.mjs';
import { fixture } from './fixture.mjs';

registerHooks({ resolve(specifier,context,next) {
  if (specifier === './input' && /lib\/issuance\/(service|history)\.ts$/.test(context.parentURL ?? '')) return next(`${specifier}.ts`,context);
  return next(specifier,context);
} });
const { issue } = await import('../../lib/issuance/service.ts');
const { history, historyDetail } = await import('../../lib/issuance/history.ts');
const actor = { staffId: 'TEST-001', departmentId: '204' };
const input = () => ({ requestId: randomUUID(),seriesId:'TEST-S1',subject:'จำลองออกต่อ',recipient:'จำลอง',recipientDepartmentIds:[],externalOrganization:'จำลอง',signer:'จำลอง',confidential:true,documentDate:'2026-11-12' });

test('SQL parser handles escaped quotes/newlines/NULL/semicolons and rejects expressions, malformed rows', () => {
  assert.deepEqual(parseValues("('a\\'b;\nINSERT INTO',NULL,00042),('c''d',0,2);",0,3).records,[["a'b;\nINSERT INTO",null,'00042'],["c'd",'0','2']]);
  for (const sql of ["(NOW(),1);", "('unterminated);", '(1,2);', '(NULLx,1,2);']) assert.throws(() => parseValues(sql,0,3));
});

test('dump reader rejects unsupported INSERT variants and ignores statement text inside quoted payloads',async()=>{
  await mkdir('.local/t12',{recursive:true});
  const file=`.local/t12/parser-${randomUUID()}.sql.gz`;
  const sql="-- comment\nINSERT INTO `bookdept` (`bookdept_id`) VALUES (1);\nINSERT INTO `genbook` (`gen_book_id`,`title`) VALUES (1,'payload; INSERT IGNORE INTO `genbook` (fake) VALUES (2);');\n";
  try {
    await writeFile(file,gzipSync(sql));
    assert.equal((await readDump(file)).tables.genbook.records.length,1);
    for(const bad of ['INSERT IGNORE INTO','INSERT LOW_PRIORITY INTO','REPLACE INTO','insert into']) {
      await writeFile(file,gzipSync(sql+`${bad} \`genbook\` (\`gen_book_id\`) VALUES (2);`));
      await assert.rejects(readDump(file),/Unsupported/);
    }
  } finally { await unlink(file); }
});

test('isolated MySQL migration preserves duplicates, permissions, counters, replay and atomic failure', { timeout:120000 },async t => {
  const db = await startDatabase({ port:3320 });
  const pool = mysql.createPool({ uri:db.url,timezone:'Z',dateStrings:true,connectionLimit:10 });
  const manifest = fixture();
  try {
    await db.admin.query("UPDATE issuance_series SET enabled=0 WHERE id='TEST-S1'");
    await t.test('dry run rolls back all writes; missing mapping and unknown flags rejected', async () => {
      const report = await importHistory(db.admin,manifest);
      assert.equal(report.count,5);
      const [[counts]] = await db.admin.query('SELECT (SELECT COUNT(*) FROM legacy_documents) history,(SELECT COUNT(*) FROM legacy_batches) batches,(SELECT COUNT(*) FROM issuance_counters) counters');
      assert.deepEqual([Number(counts.history),Number(counts.batches),Number(counts.counters)],[0,0,0]);
      for (const changes of [{ confidential:null },{ departmentId:'unknown' },{ main:0 },{ documentDate:'2026-02-30' }]) {
        const invalid = structuredClone(manifest); Object.assign(invalid.documents[0],changes);
        await assert.rejects(importHistory(db.admin,invalid,{ dryRun:false }));
      }
    });
    await t.test('failure midway through history inserts rolls back batch, rows and counters',async () => {
      await db.admin.query("CREATE TRIGGER t12_failure BEFORE INSERT ON legacy_documents FOR EACH ROW BEGIN IF NEW.source_id='3' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic migration failure'; END IF; END");
      await assert.rejects(importHistory(db.admin,manifest,{dryRun:false}));
      await db.admin.query('DROP TRIGGER t12_failure');
      const [[row]] = await db.admin.query('SELECT COUNT(*) total FROM legacy_batches'); assert.equal(Number(row.total),0);
    });
    await t.test('commit preserves duplicates and canceled subnumbers; replay is stable and changes conflict', async () => {
      await importHistory(db.admin,manifest,{dryRun:false});
      assert.equal((await importHistory(db.admin,manifest,{dryRun:false})).replayed,true);
      const changed = structuredClone(manifest); changed.documents[0].subject='เปลี่ยน';
      await assert.rejects(importHistory(db.admin,changed,{dryRun:false}),/Changed/);
      const [[counter]] = await db.admin.query("SELECT last_number FROM issuance_counters WHERE series_id='TEST-S1' AND number_year=2569");
      assert.equal(counter.last_number,70);
      assert.equal((await history(db.admin,actor,'เลขซ้ำ',1)).documents.length,1);
      await db.admin.query("UPDATE legacy_documents SET confidential=1 WHERE source_id='1'");
      await assert.rejects(importHistory(db.admin,manifest,{dryRun:false}),/payload mismatch/);
      await db.admin.query("UPDATE legacy_documents SET confidential=0 WHERE source_id='1'; UPDATE issuance_counters SET last_number=1 WHERE series_id='TEST-S1'");
      await assert.rejects(importHistory(db.admin,manifest,{dryRun:false}),/counter mismatch/);
      await db.admin.query("UPDATE issuance_counters SET last_number=70 WHERE series_id='TEST-S1'");
    });
    await t.test('T02 reads enforce owner/current department/confidential/publication and scope before pagination', async () => {
      assert.equal((await history(db.admin,actor,'',1)).documents.length,5);
      const same = {staffId:'TEST-002',departmentId:'204'};
      assert.equal((await history(db.admin,same,'',1)).documents.length,4);
      const outside = {staffId:'TEST-003',departmentId:'TEST-D1'};
      assert.equal((await history(db.admin,outside,'',1)).documents.length,1);
      assert.equal((await history(db.admin,{...actor,departmentId:'TEST-D2'},'',1)).documents.length,5);
      await assert.rejects(historyDetail(db.admin,outside,manifest.sourceSha256,'4'),error => error.status===404);
      assert.equal((await history(db.admin,actor,"%' OR 1=1 --",1)).documents.length,0);
      await assert.rejects(history(db.admin,actor,'',0));
      await assert.rejects(history(db.admin,actor,'x'.repeat(201),1));
    });
    await t.test('simulated release issues concurrently above ALL historical maxima, no duplicate numbers', async () => {
      await db.admin.query("UPDATE issuance_series SET enabled=1 WHERE id='TEST-S1'");
      const results = await Promise.all(Array.from({length:8},() => issue(pool,actor,input(),() => new Date('2026-11-12T03:00:00Z'))));
      assert.deepEqual(results.map(result=>result.document.number).sort(),Array.from({length:8},(_,index)=>`ทดสอบ 001/00${index+71}`));
    });
    await t.test('legacy pending PDF blocks owner issuance without allocating; canceled pending does not',async () => {
      await db.admin.query("UPDATE legacy_documents SET pdf_pending=1 WHERE source_id='1'");
      await assert.rejects(issue(pool,actor,input()),error=>error.status===409);
      await db.admin.query("UPDATE legacy_documents SET pdf_pending=0 WHERE source_id='1'; UPDATE legacy_documents SET pdf_pending=1 WHERE source_id='3'");
      await issue(pool,actor,input(),()=>new Date('2026-11-12T03:00:00Z'));
    });
    await t.test('raw staging verifies every field and detects changed replay, count tampering and failure',async () => {
      const dump = { sourceSha256:hash('synthetic-raw'),tables:{
        genbook:{primaryKey:'gen_book_id',records:[{gen_book_id:'1',bookdept:'1',gen_book_year:'2569',book_number:'42',book_number_insert:null,status_genbook:'n',secret:'0',publish:'0',user_request:'TEST-001',user_dept:'204',user_datetime:'2026-11-01 10:00:00'}]},
        bookdept:{primaryKey:'bookdept_id',records:[{bookdept_id:'00001',book_number:'จำลอง',book_year:'y'}]},
        genbook_inform:{primaryKey:'gen_book_inform_id',records:[]},genbook_dept:{primaryKey:'gen_book_dept_id',records:[]}
      }};
      assert.equal((await stageDump(db.admin,dump)).replayed,false);
      assert.equal((await stageDump(db.admin,dump)).replayed,true);
      const changed = structuredClone(dump); changed.tables.genbook.records[0].secret='1';
      await assert.rejects(stageDump(db.admin,changed),/Changed/);
      await db.admin.query("UPDATE legacy_staging SET payload=JSON_OBJECT('tampered',true) WHERE source_table='genbook'");
      await assert.rejects(stageDump(db.admin,dump),/payload mismatch/);
      await db.admin.query("CREATE TRIGGER t12_stage_failure BEFORE INSERT ON legacy_staging FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic stage failure'");
      await assert.rejects(stageDump(db.admin,{...dump,sourceSha256:hash('fail-stage')}));
      await db.admin.query('DROP TRIGGER t12_stage_failure');
      const [[count]] = await db.admin.execute('SELECT COUNT(*) total FROM legacy_batches WHERE source_sha256=?',[hash('fail-stage')]);
      assert.equal(Number(count.total),0);
    });
  } finally { await pool.end(); await db.close(); }
});
