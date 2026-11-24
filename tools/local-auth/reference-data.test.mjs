import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { startDatabase } from '../issuance/database.mjs';
import { applyDemoReferences } from './reference-data.mjs';
import { buildLegacyCatalog } from '../issuance/legacy-catalog.mjs';

function catalog() {
  return buildLegacyCatalog({ sourceSha256: 'a'.repeat(64), tables: {
    book: { records: [{ idbook: '1', book: 'มอ', dept_id: '202', alias_dept: 'กลุ่มเดิม', status: '1', typebook_idtypebook: '2' }] },
    typebook: { records: [{ idtypebook: '2', typebook: 'มอ', typesecret: 'y' }] },
    bookdept: { records: [
      { bookdept_id: '00021', book_number: 'มอ 202.1', book_year: 'y', dept_id: '202', book_idbook: '1', sub_dept: 'สารบรรณเดิม' },
      { bookdept_id: '00047', book_number: '', book_year: '', dept_id: '202', book_idbook: '1', sub_dept: 'พักตามกติกา' },
    ] },
  } });
}

test('reference preview preserves existing documents/counters and grants only the demo identity', { timeout: 120000 }, async () => {
  const db = await startDatabase({ port: 3343 });
  let app;
  try {
    await db.admin.query("INSERT INTO issuance_counters(series_id,number_year,last_number) VALUES ('TEST-S1',2569,17)");
    app = await mysql.createConnection(db.url);
    await applyDemoReferences(app, catalog());
    const [[counter]] = await app.query("SELECT last_number FROM issuance_counters WHERE series_id='TEST-S1' AND number_year=2569");
    assert.equal(Number(counter.last_number), 17);
    const [grants] = await app.query('SELECT owner_id,series_id FROM issuance_grants WHERE active=1');
    assert.deepEqual(grants.map(row => [row.owner_id, row.series_id]), [['LOCAL-001', '00021']]);
    const [[series]] = await app.query("SELECT name,prefix FROM issuance_series WHERE enabled=1");
    assert.deepEqual([series.name, series.prefix], ['สารบรรณเดิม', 'มอ 202.1']);
    const [[paused]] = await app.query("SELECT enabled FROM issuance_series WHERE id='00047'");
    assert.equal(Number(paused.enabled), 0);
    const [[department]] = await app.query("SELECT name FROM issuance_departments WHERE id='202'");
    assert.equal(department.name, 'รหัสหน่วยงาน 202');
    await applyDemoReferences(app, catalog());
    const [[count]] = await app.query('SELECT COUNT(*) total FROM issuance_grants WHERE active=1');
    assert.equal(Number(count.total), 1);
    await db.admin.query("UPDATE issuance_migration_gate SET state='blocked'");
    await assert.rejects(applyDemoReferences(app, catalog()), /refuses preserved/);
    await db.admin.query("UPDATE issuance_migration_gate SET state='open'");
    await db.admin.query("CREATE TRIGGER fail_catalog BEFORE INSERT ON issuance_series FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic catalog failure'");
    await assert.rejects(applyDemoReferences(app, catalog()));
    const [[unchanged]] = await app.query('SELECT COUNT(*) total FROM issuance_grants WHERE active=1');
    assert.equal(Number(unchanged.total), 1);
    await db.admin.query('DROP TRIGGER fail_catalog');
  } finally { await app?.end(); await db.close(); }
});

test('reference preview refuses remote destinations and invalid preview contracts before SQL', async () => {
  let queried = false;
  const db = { config: { host: 'remote', port: 3306 }, query: () => { queried = true; } };
  await assert.rejects(applyDemoReferences(db, catalog()), /isolated loopback/);
  await assert.rejects(applyDemoReferences(db, { demoOnly: false }), /development-only/);
  assert.equal(queried, false);
});
