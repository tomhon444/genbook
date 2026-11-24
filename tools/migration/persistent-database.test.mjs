import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import mysql from 'mysql2/promise';
import { openPersistentDatabase } from './persistent-database.mjs';
import { preserveSnapshot } from './preservation.mjs';
import { preservationFixture } from './preservation-fixture.mjs';

async function unusedPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  assert.ok(port >= 1024 && port !== 3306);
  return port;
}

test('persistent destination refuses unsafe names, ports and missing reopen destinations', async () => {
  for (const options of [{ name: '../outside' }, { name: 'legacy/x' }, { port: 3306 }, { name: 'genbook-db', port: 3306, createIfMissing: true }, { name: 'legacy', port: 3306, createIfMissing: false }, { port: 0 }, { createIfMissing: 'yes' }]) {
    await assert.rejects(openPersistentDatabase(options), /invalid name or port/);
  }
  await assert.rejects(openPersistentDatabase({ name: `absent-${randomUUID()}`, createIfMissing: false }), /does not exist/);
});

test('retained preservation survives restart, rejects occupied ports and prevents reader writes', { timeout: 120000 }, async () => {
  const name = `test-${randomUUID()}`, options = { name, port: await unusedPort() };
  const syntheticSettingsBefore = await readFile('.local/t05-database.json', 'utf8').catch(() => null);
  const dump = preservationFixture(), preservationOptions = { approvalReference: 'Synthetic retained test only' };
  let db = await openPersistentDatabase(options);
  try {
    const [[fresh]] = await db.admin.query('SELECT (SELECT COUNT(*) FROM issuance_series) series_count,(SELECT COUNT(*) FROM issuance_grants) grants,(SELECT state FROM issuance_migration_gate WHERE id=1) gate');
    assert.deepEqual([Number(fresh.series_count), Number(fresh.grants), fresh.gate], [0, 0, 'blocked']);
    await assert.rejects(openPersistentDatabase(options), /destination locked/);
    const first = await preserveSnapshot(db.admin, dump, preservationOptions);
    assert.equal(first.reservations, 6);
    const reader = await mysql.createConnection(db.url);
    try {
      const [[gate]] = await reader.query('SELECT state FROM issuance_migration_gate WHERE id=1');
      assert.equal(gate.state, 'blocked');
      for (const sql of ['SELECT * FROM legacy_staging', 'SELECT * FROM migration_instance', "UPDATE issuance_migration_gate SET state='open'", 'DELETE FROM legacy_number_reservations']) {
        await assert.rejects(reader.query(sql), error => error.code === 'ER_TABLEACCESS_DENIED_ERROR');
      }
    } finally { await reader.end(); }
    const runtime = db.runtime;
    await db.close();
    db = null;
    const occupying = createServer();
    await new Promise(resolve => occupying.listen(options.port, '127.0.0.1', resolve));
    try { await assert.rejects(openPersistentDatabase({ ...options, createIfMissing: false }), /port occupied/); }
    finally { await new Promise(resolve => occupying.close(resolve)); }
    db = await openPersistentDatabase({ ...options, createIfMissing: false });
    assert.equal(db.runtime, runtime);
    const replay = await preserveSnapshot(db.admin, dump, preservationOptions);
    assert.equal(replay.replayed, true);
    const [[stored]] = await db.admin.query('SELECT (SELECT COUNT(*) FROM legacy_number_reservations) reservations,(SELECT state FROM issuance_migration_gate WHERE id=1) gate');
    assert.deepEqual([Number(stored.reservations), stored.gate], [6, 'blocked']);
    await db.admin.query("UPDATE migration_instance SET instance_uuid='00000000-0000-0000-0000-000000000000'");
    await db.close();
    db = null;
    await assert.rejects(openPersistentDatabase({ ...options, createIfMissing: false }), /marker mismatch/);
    const settingsFile = `${runtime}/connection.json`;
    const metadata = JSON.parse(await readFile(settingsFile, 'utf8'));
    await writeFile(settingsFile, JSON.stringify({ ...metadata, ready: false }));
    await assert.rejects(openPersistentDatabase({ ...options, createIfMissing: false }), /incomplete or mismatched/);
    const settingsAfter = await readFile('.local/t05-database.json', 'utf8').catch(() => null);
    const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    assert.equal(digest(settingsAfter), digest(syntheticSettingsBefore), 'Persistent runtime must not overwrite disposable settings');
  } finally { await db?.close(); }
});
