import { randomBytes } from 'node:crypto';
import { open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPersistentDatabase } from './persistent-database.mjs';
import { approveLocalGenbookTarget } from './local-target.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const receiptFile = path.join(project, '.local/genbook-local8.json');
async function writeReceipt(value, fresh) {
  const filename = fresh ? receiptFile : `${receiptFile}.${randomBytes(8).toString('hex')}.tmp`;
  const file = await open(filename, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync(); } finally { await file.close(); }
  if (!fresh) await rename(filename, receiptFile);
}

// Installed MySQL 8, retained directory/port; never upgrades the MySQL 5.6 service.
export async function openLocalGenbookDatabase({ createIfMissing = false } = {}) {
  const runtime = await openPersistentDatabase({ name: 'genbook-db', port: 3306, createIfMissing });
  const db = runtime.admin;
  try {
    const [[identity]] = await db.query('SELECT instance_uuid FROM migration_instance WHERE id=1');
    let receipt;
    try { receipt = JSON.parse(await readFile(receiptFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT' || !createIfMissing) throw error; }
    const [existing] = await db.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE LOWER(SCHEMA_NAME)=?', ['genbook_db']);
    if (!receipt) {
      if (existing.length) throw new Error('Existing unmarked genbook_db was retained; adoption refused');
      receipt = { version: 1, instanceId: identity.instance_uuid, host: '127.0.0.1', port: 3306, database: 'genbook_db',
        username: `genbook_app_${randomBytes(4).toString('hex')}`, password: randomBytes(32).toString('hex'), ready: false };
      await writeReceipt(receipt, true);
      await db.query('CREATE DATABASE genbook_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
      await db.query('USE genbook_db');
      await db.query(await readFile(path.join(project, 'tools/issuance/schema.sql'), 'utf8'));
      const schema = await readFile(path.join(project, 'tools/migration/schema.sql'), 'utf8');
      const closed = schema.replace("VALUES (1,'open')", "VALUES (1,'blocked')");
      if (schema === closed) throw new Error('Closed migration gate could not be prepared');
      await db.query(closed);
      await db.query('CREATE TABLE migration_instance(id TINYINT PRIMARY KEY,instance_uuid CHAR(36) NOT NULL) ENGINE=InnoDB');
      await db.query('INSERT INTO migration_instance(id,instance_uuid) VALUES (1,?)', [receipt.instanceId]);
      await db.query('CREATE USER ?@? IDENTIFIED BY ?', [receipt.username, '127.0.0.1', receipt.password]);
      for (const table of ['issuance_owner_locks', 'issuance_counters', 'issuance_subcounters', 'issuance_documents']) await db.query(`GRANT SELECT,INSERT,UPDATE ON genbook_db.${table} TO ?@?`, [receipt.username, '127.0.0.1']);
      for (const table of ['issuance_departments', 'issuance_series', 'issuance_grants', 'legacy_documents', 'legacy_document_details', 'legacy_number_reservations', 'legacy_reservation_links', 'issuance_migration_gate']) await db.query(`GRANT SELECT ON genbook_db.${table} TO ?@?`, [receipt.username, '127.0.0.1']);
      await db.query('GRANT SELECT,INSERT ON genbook_db.issuance_audit TO ?@?', [receipt.username, '127.0.0.1']);
      receipt.ready = true;
      await writeReceipt(receipt, false);
    } else {
      if (receipt.version !== 1 || !receipt.ready || receipt.instanceId !== identity.instance_uuid || receipt.host !== '127.0.0.1' || receipt.port !== 3306 || receipt.database !== 'genbook_db'
          || !/^genbook_app_[a-f0-9]{8}$/.test(receipt.username ?? '') || !/^[a-f0-9]{64}$/.test(receipt.password ?? '') || !existing.some(row => row.SCHEMA_NAME === 'genbook_db')) throw new Error('Local receipt mismatch; no reset was performed');
      await db.query('USE genbook_db');
    }
    await approveLocalGenbookTarget(db, receipt.instanceId);
    const [[gate]] = await db.query('SELECT state FROM issuance_migration_gate WHERE id=1');
    if (gate?.state !== 'blocked') throw new Error('Migration requires the blocked gate');
    return { admin: db, receipt, runtime: runtime.runtime, url: `mysql://${receipt.username}:${receipt.password}@127.0.0.1:3306/genbook_db`,
      close: async () => { await db.query('USE t05_synthetic'); await runtime.close(); } };
  } catch (error) { await runtime.close(); throw error; }
}
