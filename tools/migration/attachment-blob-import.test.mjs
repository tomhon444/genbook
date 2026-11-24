import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startDatabase } from '../issuance/database.mjs';
import { preservationFixture } from './preservation-fixture.mjs';
import { preserveSnapshot } from './preservation.mjs';
import { buildAttachmentInventory } from './attachments.mjs';
import { importAttachmentBlobs, verifyImportedAttachmentBlobs } from './attachment-blob-import.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const pdf = Buffer.from('%PDF-1.7\nSynthetic archival bytes\0\xff\n%%EOF', 'latin1');
const otherPdf = Buffer.from('%PDF-1.7\nDifferent synthetic PDF\n%%EOF');
const expectCode = code => error => error.code === code;

async function archive(t, dump) {
  const root = await mkdtemp(path.join(tmpdir(), 'genbook-blob-import-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'blobs'));
  const inventory = buildAttachmentInventory(dump);
  await writeFile(path.join(root, 'inventory.json'), JSON.stringify(inventory));
  const digest = hash(pdf);
  await writeFile(path.join(root, 'blobs', `${digest}.pdf`), pdf);
  const records = inventory.entries.filter(entry => ['1', '2'].includes(entry.sourceId)).map(entry => ({ ...entry, status: 'downloaded', inventorySha256: inventory.inventorySha256, bytes: pdf.length, sha256: digest, blob: `blobs/${digest}.pdf` }));
  const failed = inventory.entries.find(entry => entry.sourceId === '3');
  records.push({ ...failed, inventorySha256: inventory.inventorySha256, status: 'failed', error: 'HTTP_404' });
  await writeFile(path.join(root, 'results.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n');
  return { root, inventory, records, digest };
}

test('unsafe targets are rejected before any SQL or schema creation', async () => {
  const dump = preservationFixture();
  const db = { config: { host: 'remote.example', port: 3340 }, query: () => { throw new Error('Must not query'); } };
  await assert.rejects(importAttachmentBlobs(db, { dump, archiveRoot: 'not-used' }), expectCode('UNSAFE_TARGET'));
});

test('isolated MySQL stores LONGBLOB, deduplicates, preserves source status and verifies replay', { timeout: 120_000 }, async t => {
  const database = await startDatabase({ port: 3340 });
  t.after(() => database.close());
  const db = database.admin;
  const dump = preservationFixture();
  for (const row of dump.tables.genbook.records) {
    row.document_file = ['1', '2', '3', '6'].includes(row.gen_book_id) ? `file-${row.gen_book_id}` : row.gen_book_id === '5' ? '../unsafe' : null;
    row.document_extension = '.pdf';
  }
  await preserveSnapshot(db, dump, { approvalReference: 'Synthetic BLOB import test; no real source' });
  await db.query('CREATE TABLE migration_instance(id TINYINT PRIMARY KEY,instance_uuid CHAR(36) NOT NULL) ENGINE=InnoDB');
  await db.execute('INSERT INTO migration_instance VALUES (1,?)', [randomUUID()]);
  const a = await archive(t, dump);

  await t.test('one binary content row can serve two source links; missing and pending are separate', async () => {
    const report = await importAttachmentBlobs(db, { dump, archiveRoot: a.root });
    assert.equal(report.links, 6);
    assert.equal(report.uniqueBlobs, 1);
    assert.equal(report.newlyStoredBlobs, 1);
    assert.deepEqual(report.statuses, { downloaded: 2, failed: 1, missing_reference: 1, invalid_reference: 1, pending: 1 });
    assert.equal(report.databaseHashVerified, true);
    assert.equal(report.appDownloadReady, false);
    const [[stored]] = await db.query('SELECT HEX(sha256) sha,byte_size,content FROM legacy_attachment_blobs');
    assert.equal(stored.sha.toLowerCase(), a.digest);
    assert.equal(Number(stored.byte_size), pdf.length);
    assert.deepEqual(stored.content, pdf);
    assert.equal((await importAttachmentBlobs(db, { dump, archiveRoot: a.root })).newlyStoredBlobs, 0);
    const [[gate]] = await db.query('SELECT state FROM issuance_migration_gate WHERE id=1');
    assert.equal(gate.state, 'blocked');
  });

  await t.test('schema enforces hash size, BLOB length, status combinations and source foreign key', async () => {
    await assert.rejects(db.execute('INSERT INTO legacy_attachment_blobs(sha256,byte_size,media_type,content) VALUES (?,?,?,?)', [Buffer.alloc(32, 1), 9, 'application/pdf', Buffer.from('x')]));
    await assert.rejects(db.execute("INSERT INTO legacy_attachment_links(source_sha256,source_id,inventory_sha256,status) VALUES (?,?,?,'downloaded')", [dump.sourceSha256, '999', a.inventory.inventorySha256]));
    await assert.rejects(db.execute("INSERT INTO legacy_attachment_links(source_sha256,source_id,inventory_sha256,status) VALUES (?,?,?,'missing_reference')", [dump.sourceSha256, '999', a.inventory.inventorySha256]));
  });

  await t.test('database hash tampering is rejected on readback and replay rather than repaired', async () => {
    const changed = Buffer.from(pdf); changed[10] ^= 1;
    await db.execute('UPDATE legacy_attachment_blobs SET content=? WHERE sha256=?', [changed, Buffer.from(a.digest, 'hex')]);
    await assert.rejects(verifyImportedAttachmentBlobs(db, dump.sourceSha256), expectCode('DATABASE_BLOB_MISMATCH'));
    await assert.rejects(importAttachmentBlobs(db, { dump, archiveRoot: a.root }), expectCode('DATABASE_BLOB_MISMATCH'));
    await db.execute('UPDATE legacy_attachment_blobs SET content=? WHERE sha256=?', [pdf, Buffer.from(a.digest, 'hex')]);
  });

  await t.test('source identity, inventory and journal mutation fail closed', async () => {
    const changedDump = structuredClone(dump); changedDump.tables.genbook.records[0].title = 'Different';
    await assert.rejects(importAttachmentBlobs(db, { dump: changedDump, archiveRoot: a.root }), expectCode('SOURCE_MISMATCH'));
    const inventoryPath = path.join(a.root, 'inventory.json');
    await writeFile(inventoryPath, JSON.stringify({ ...a.inventory, sourceSha256: 'f'.repeat(64) }));
    await assert.rejects(importAttachmentBlobs(db, { dump, archiveRoot: a.root }), expectCode('INVENTORY_MISMATCH'));
    await writeFile(inventoryPath, JSON.stringify(a.inventory));
    const journalPath = path.join(a.root, 'results.jsonl');
    const original = await readFile(journalPath, 'utf8');
    await writeFile(journalPath, original.slice(0, -1));
    await assert.rejects(importAttachmentBlobs(db, { dump, archiveRoot: a.root }), expectCode('INCOMPLETE_JOURNAL'));
    await writeFile(journalPath, original + JSON.stringify({ ...a.records[0], sourcePath: '../wrong.pdf' }) + '\n');
    await assert.rejects(importAttachmentBlobs(db, { dump, archiveRoot: a.root }), expectCode('JOURNAL_SOURCE_MISMATCH'));
    await writeFile(journalPath, original);
  });

  await t.test('archive corruption, changing an immutable document file and importer locks are refused', async () => {
    const filename = path.join(a.root, 'blobs', `${a.digest}.pdf`);
    await writeFile(filename, 'corrupt');
    await assert.rejects(importAttachmentBlobs(db, { dump, archiveRoot: a.root }), expectCode('ARCHIVE_BLOB_MISMATCH'));
    await writeFile(filename, pdf);
    const journalPath = path.join(a.root, 'results.jsonl');
    const original = await readFile(journalPath, 'utf8');
    const changedSha = hash(otherPdf);
    await writeFile(path.join(a.root, 'blobs', `${changedSha}.pdf`), otherPdf);
    await writeFile(journalPath, original + JSON.stringify({ ...a.records[0], sha256: changedSha, bytes: otherPdf.length, blob: `blobs/${changedSha}.pdf` }) + '\n');
    await assert.rejects(importAttachmentBlobs(db, { dump, archiveRoot: a.root }), expectCode('IMMUTABLE_LINK_CONFLICT'));
    await writeFile(journalPath, original);
    await writeFile(path.join(a.root, 'import.lock'), 'other importer');
    await assert.rejects(importAttachmentBlobs(db, { dump, archiveRoot: a.root }), expectCode('ARCHIVE_LOCKED'));
    await rm(path.join(a.root, 'import.lock'));
    assert.equal((await verifyImportedAttachmentBlobs(db, dump.sourceSha256)).uniqueBlobs, 1);
  });
});
