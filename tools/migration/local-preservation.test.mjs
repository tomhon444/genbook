import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createServer } from 'node:net';
import { openPersistentDatabase } from './persistent-database.mjs';
import { preservationFixture } from './preservation-fixture.mjs';
import { importLocalPreservation, verifyLocalPreservation, retainSource, readRetainedSource } from './local-preservation.mjs';
import { hash, readDump } from './dump.mjs';

function compressedFixture() {
  const dump = preservationFixture();
  const literal = value => value === null ? 'NULL' : `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  const sql = Object.entries(dump.tables).filter(([, table]) => table.records.length).map(([name, table]) => {
    const columns = Object.keys(table.records[0]);
    return `INSERT INTO \`${name}\` (${columns.map(key => `\`${key}\``).join(',')}) VALUES ${table.records.map(row => `(${columns.map(key => literal(row[key])).join(',')})`).join(',')};`;
  }).join('\n');
  return gzipSync(sql);
}

test('persistent local import is atomic, source-bound and restart/recovery safe', { timeout: 180000 }, async () => {
  const suffix = randomUUID().slice(0, 12), name = `local-test-${suffix}`, recoveredName = `recovered-test-${suffix}`;
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const options = { name, port };
  let db = await openPersistentDatabase(options);
  let recovery;
  try {
    const bytes = compressedFixture(), source = `${db.runtime}/fixture.sql.gz`;
    await writeFile(source, bytes, { flag: 'wx', mode: 0o600 });
    const dump = await readDump(source);
    assert.equal(dump.sourceSha256, hash(bytes));
    await assert.rejects(verifyLocalPreservation(db.admin, dump), /missing the expected snapshot/);
    await db.admin.query("CREATE TRIGGER t12_atomic_failure BEFORE INSERT ON legacy_number_reservations FOR EACH ROW BEGIN IF NEW.source_id='3' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic import fault'; END IF; END");
    await assert.rejects(importLocalPreservation(db.admin, dump));
    const [[failed]] = await db.admin.query('SELECT (SELECT COUNT(*) FROM legacy_batches) batches,(SELECT COUNT(*) FROM legacy_staging) raw_count,(SELECT COUNT(*) FROM legacy_number_reservations) reservations,(SELECT state FROM issuance_migration_gate WHERE id=1) gate');
    assert.deepEqual([Number(failed.batches), Number(failed.raw_count), Number(failed.reservations), failed.gate], [0, 0, 0, 'blocked']);
    await db.admin.query('DROP TRIGGER t12_atomic_failure');
    await retainSource(db.runtime, source, dump.sourceSha256);
    const result = await importLocalPreservation(db.admin, dump);
    assert.equal(result.dryRunVerified, true);
    assert.equal(result.replayVerified, true);
    assert.equal(result.rawEveryFieldVerified, true);
    const changed = structuredClone(dump); changed.sourceSha256 = hash('another-snapshot');
    await assert.rejects(importLocalPreservation(db.admin, changed), /different snapshot/);
    await assert.rejects(retainSource(db.runtime, source, hash('changed-source')), /Source changed/);
    await db.close(); db = null;
    db = await openPersistentDatabase({ ...options, createIfMissing: false });
    const afterRestart = await verifyLocalPreservation(db.admin, dump);
    assert.equal(afterRestart.reservations, 6);
    const retained = await readRetainedSource(name);
    assert.equal(retained.dump.sourceSha256, dump.sourceSha256);
    assert.equal(hash(await readFile(retained.source)), dump.sourceSha256);
    const replacement = gzipSync(Buffer.concat([gunzipSync(bytes), Buffer.from('\n')]));
    await writeFile(retained.source, replacement);
    await assert.rejects(readRetainedSource(name), /original receipt/);
    await writeFile(retained.source, bytes);
    await db.admin.query("UPDATE legacy_number_reservations SET main_number=1 WHERE source_id='3'");
    await assert.rejects(verifyLocalPreservation(db.admin, dump), /Reservation payload mismatch/);
    await db.close(); db = null;
    // Recover into a separate fresh destination; original corrupted data remain
    // available for investigation. No destructive restore/drop/delete is used.
    recovery = await openPersistentDatabase({ name: recoveredName, port });
    await retainSource(recovery.runtime, retained.source, dump.sourceSha256);
    const restored = await importLocalPreservation(recovery.admin, retained.dump);
    assert.equal(restored.reservations, result.reservations);
    assert.deepEqual(restored.rawCounts, result.rawCounts);
    assert.equal(restored.gate, 'blocked');
    await recovery.close(); recovery = null;
    recovery = await openPersistentDatabase({ name: recoveredName, port, createIfMissing: false });
    assert.equal((await verifyLocalPreservation(recovery.admin, dump)).derivedEveryFieldVerified, true);
    await recovery.admin.query("UPDATE issuance_migration_gate SET state='open'");
    await assert.rejects(verifyLocalPreservation(recovery.admin, dump), /must be blocked/);
    await recovery.admin.query("UPDATE issuance_migration_gate SET state='blocked'");
  } finally { await db?.close(); await recovery?.close(); }
});
