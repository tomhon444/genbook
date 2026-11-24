import { createHash } from 'node:crypto';
import { lstat, open, readFile, realpath, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAttachmentInventory } from './attachments.mjs';
import { isApprovedLocalGenbookTarget } from './local-target.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const normalized = value => path.resolve(value).toLowerCase();
const schemaFile = fileURLToPath(new URL('./attachment-blobs.sql', import.meta.url));

export class AttachmentBlobImportError extends Error {
  constructor(code) { super(`Attachment BLOB import refused (${code})`); this.code = code; }
}
const fail = code => { throw new AttachmentBlobImportError(code); };

async function directFile(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || normalized(await realpath(filename)) !== normalized(filename)) fail('ARCHIVE_REDIRECTION');
  return info;
}

async function assertTarget(db) {
  const config = db.connection?.config ?? db.config;
  if (process.env.NODE_ENV === 'production' || !config || !['127.0.0.1', '::1'].includes(config.host)
    || !Number.isInteger(Number(config.port)) || Number(config.port) < 1024) fail('UNSAFE_TARGET');
  const [[target]] = await db.query('SELECT DATABASE() name, @@port port, @@datadir data_directory');
  if (Number(target.port) !== Number(config.port) || ((target.name !== 't05_synthetic' || Number(target.port) === 3306) && !await isApprovedLocalGenbookTarget(db))) fail('UNSAFE_TARGET');
  const [[marker]] = await db.query('SELECT instance_uuid FROM migration_instance WHERE id=1');
  const [[gate]] = await db.query('SELECT state FROM issuance_migration_gate WHERE id=1');
  if (!/^[a-f0-9-]{36}$/.test(marker?.instance_uuid ?? '') || gate?.state !== 'blocked') fail('TARGET_NOT_PRESERVED');
  return target;
}

async function assertSource(db, dump, count) {
  const [[batch]] = await db.execute('SELECT manifest_sha256 FROM legacy_batches WHERE source_sha256=?', [dump.sourceSha256]);
  if (batch?.manifest_sha256 !== hash(JSON.stringify(dump.tables))) fail('SOURCE_MISMATCH');
  const [[staged]] = await db.execute("SELECT COUNT(*) total FROM legacy_staging WHERE source_sha256=? AND source_table='genbook'", [dump.sourceSha256]);
  if (Number(staged.total) !== count) fail('SOURCE_COUNT_MISMATCH');
}

async function archiveState(archiveRoot, inventory, maxBytes) {
  if (!path.isAbsolute(archiveRoot) || normalized(await realpath(archiveRoot)) !== normalized(archiveRoot)) fail('ARCHIVE_REDIRECTION');
  const inventoryFile = path.join(archiveRoot, 'inventory.json');
  await directFile(inventoryFile);
  if (await readFile(inventoryFile, 'utf8') !== JSON.stringify(inventory)) fail('INVENTORY_MISMATCH');
  const journalFile = path.join(archiveRoot, 'results.jsonl');
  let text;
  try { await directFile(journalFile); text = await readFile(journalFile, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; text = ''; }
  if (text && !text.endsWith('\n')) fail('INCOMPLETE_JOURNAL');
  const entries = new Map(inventory.entries.map(entry => [entry.sourceId, entry]));
  const latest = new Map();
  for (const line of text.split('\n').filter(Boolean)) {
    let record;
    try { record = JSON.parse(line); } catch { fail('INVALID_JOURNAL'); }
    const original = entries.get(record.sourceId);
    if (record.inventorySha256 !== inventory.inventorySha256 || !original?.sourcePath || record.sourcePath !== original.sourcePath) fail('JOURNAL_SOURCE_MISMATCH');
    if (record.status === 'downloaded') {
      if (!isHash(record.sha256) || record.blob !== `blobs/${record.sha256}.pdf` || !Number.isSafeInteger(record.bytes) || record.bytes < 5 || record.bytes > maxBytes) fail('INVALID_BLOB_REFERENCE');
    } else if (record.status === 'failed') {
      if (typeof record.error !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(record.error)) fail('INVALID_JOURNAL');
    } else fail('INVALID_JOURNAL');
    latest.set(record.sourceId, record);
  }
  return latest;
}

async function fileBytes(root, record) {
  const filename = path.join(root, 'blobs', `${record.sha256}.pdf`);
  const info = await directFile(filename);
  if (info.size !== record.bytes) fail('ARCHIVE_BLOB_MISMATCH');
  const bytes = await readFile(filename);
  if (bytes.length !== record.bytes || hash(bytes) !== record.sha256 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') fail('ARCHIVE_BLOB_MISMATCH');
  return bytes;
}

function fieldsEqual(actual, original) {
  return actual && Object.keys(actual).length === Object.keys(original).length
    && Object.entries(original).every(([key, value]) => actual[key] === value);
}

/** Read back hashes and lengths in MySQL. This grants no application access. */
export async function verifyImportedAttachmentBlobs(db, sourceSha256) {
  try {
    if (!isHash(sourceSha256)) fail('INVALID_SOURCE');
    await assertTarget(db);
    const [[invalid]] = await db.execute(`SELECT COUNT(*) total FROM legacy_attachment_blobs b
      WHERE b.sha256 IN (SELECT blob_sha256 FROM legacy_attachment_links WHERE source_sha256=? AND status='downloaded')
      AND (b.byte_size<>OCTET_LENGTH(b.content) OR b.sha256<>UNHEX(SHA2(b.content,256)) OR b.media_type<>'application/pdf')`, [sourceSha256]);
    if (Number(invalid.total)) fail('DATABASE_BLOB_MISMATCH');
    const [groups] = await db.execute('SELECT status,COUNT(*) total FROM legacy_attachment_links WHERE source_sha256=? GROUP BY status', [sourceSha256]);
    const [[blobs]] = await db.execute(`SELECT COUNT(*) total,COALESCE(SUM(byte_size),0) bytes FROM legacy_attachment_blobs
      WHERE sha256 IN (SELECT blob_sha256 FROM legacy_attachment_links WHERE source_sha256=? AND status='downloaded')`, [sourceSha256]);
    return { sourceSha256, links: groups.reduce((sum, row) => sum + Number(row.total), 0),
      statuses: Object.fromEntries(groups.map(row => [row.status, Number(row.total)])),
      uniqueBlobs: Number(blobs.total), blobBytes: Number(blobs.bytes), databaseHashVerified: true };
  } catch (error) {
    if (error instanceof AttachmentBlobImportError) throw error;
    throw new AttachmentBlobImportError('VERIFICATION_FAILED');
  }
}

/** Copies private archive bytes into an existing, blocked, isolated local target. */
export async function importAttachmentBlobs(db, { dump, archiveRoot, progress = () => {}, maxBytes = 32 * 1024 * 1024, minFreeBytes = 2 * 1024 ** 3 } = {}) {
  let lock;
  let transaction = false;
  let lockName;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 5 || !Number.isSafeInteger(minFreeBytes) || minFreeBytes < 0) fail('INVALID_OPTIONS');
    const inventory = buildAttachmentInventory(dump);
    const target = await assertTarget(db);
    await assertSource(db, dump, inventory.entries.length);
    if (!path.isAbsolute(archiveRoot) || normalized(await realpath(archiveRoot)) !== normalized(archiveRoot)) fail('ARCHIVE_REDIRECTION');
    lockName = path.join(archiveRoot, 'import.lock');
    lock = await open(lockName, 'wx', 0o600);
    await lock.writeFile(JSON.stringify({ pid: process.pid, purpose: 'mysql-blob-import' })); await lock.sync();
    const journal = await archiveState(archiveRoot, inventory, maxBytes);
    // All validations above precede additive DDL. No source batch is synthesized.
    await db.query(await readFile(schemaFile, 'utf8'));
    const originals = new Map(dump.tables.genbook.records.map(row => [row.gen_book_id, row]));
    const verified = new Map();
    let newlyStoredBlobs = 0;
    for (let offset = 0; offset < inventory.entries.length; offset += 500) {
      const batch = inventory.entries.slice(offset, offset + 500);
      const placeholders = batch.map(() => '?').join(',');
      const plans = batch.map(entry => ({ ...entry, ...(journal.get(entry.sourceId) ?? {}) }));
      const estimatedBytes = plans.filter(row => row.status === 'downloaded' && !verified.has(row.sha256)).reduce((sum, row) => sum + row.bytes, 0);
      const free = await statfs(target.data_directory);
      if (free.bavail * free.bsize < minFreeBytes + estimatedBytes) fail('LOW_DISK_SPACE');
      await db.beginTransaction(); transaction = true;
      const [[gate]] = await db.query('SELECT state FROM issuance_migration_gate WHERE id=1 FOR UPDATE');
      if (gate?.state !== 'blocked') fail('TARGET_NOT_PRESERVED');
      await db.execute('SELECT source_sha256 FROM legacy_batches WHERE source_sha256=? FOR UPDATE', [dump.sourceSha256]);
      const [staged] = await db.query(`SELECT source_id,payload FROM legacy_staging WHERE source_sha256=? AND source_table='genbook' AND source_id IN (${placeholders})`, [dump.sourceSha256, ...batch.map(row => row.sourceId)]);
      if (staged.length !== batch.length || staged.some(row => !fieldsEqual(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload, originals.get(row.source_id)))) fail('STAGED_PAYLOAD_MISMATCH');
      const [oldLinks] = await db.query(`SELECT source_id,inventory_sha256,source_path,status,HEX(blob_sha256) blob_hash FROM legacy_attachment_links
        WHERE source_sha256=? AND source_table='genbook' AND source_id IN (${placeholders}) FOR UPDATE`, [dump.sourceSha256, ...batch.map(row => row.sourceId)]);
      const existing = new Map(oldLinks.map(row => [row.source_id, row]));
      const values = [];
      for (const plan of plans) {
        const old = existing.get(plan.sourceId);
        if (old && (old.inventory_sha256 !== inventory.inventorySha256 || old.source_path !== (plan.sourcePath ?? null)
          || (old.status === 'downloaded' && (plan.status !== 'downloaded' || old.blob_hash.toLowerCase() !== plan.sha256)))) fail('IMMUTABLE_LINK_CONFLICT');
        if (plan.status === 'downloaded' && verified.has(plan.sha256) && verified.get(plan.sha256) !== plan.bytes) fail('ARCHIVE_BLOB_MISMATCH');
        if (plan.status === 'downloaded' && !verified.has(plan.sha256)) {
          const content = await fileBytes(archiveRoot, plan);
          const sha = Buffer.from(plan.sha256, 'hex');
          const [[oldBlob]] = await db.execute('SELECT byte_size,content FROM legacy_attachment_blobs WHERE sha256=? FOR UPDATE', [sha]);
          if (!oldBlob) {
            await db.execute('INSERT INTO legacy_attachment_blobs(sha256,byte_size,media_type,content) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE sha256=sha256', [sha, content.length, 'application/pdf', content]);
            newlyStoredBlobs++;
          }
          const [[stored]] = await db.execute('SELECT byte_size,content FROM legacy_attachment_blobs WHERE sha256=?', [sha]);
          if (!stored || Number(stored.byte_size) !== content.length || !Buffer.isBuffer(stored.content) || !stored.content.equals(content) || hash(stored.content) !== plan.sha256) fail('DATABASE_BLOB_MISMATCH');
          verified.set(plan.sha256, plan.bytes);
        }
        values.push([dump.sourceSha256, 'genbook', plan.sourceId, inventory.inventorySha256, plan.sourcePath ?? null, plan.status,
          plan.status === 'downloaded' ? Buffer.from(plan.sha256, 'hex') : null, plan.status === 'failed' ? plan.error : null]);
      }
      await db.query(`INSERT INTO legacy_attachment_links(source_sha256,source_table,source_id,inventory_sha256,source_path,status,blob_sha256,failure_code) VALUES ?
        ON DUPLICATE KEY UPDATE status=VALUES(status),blob_sha256=VALUES(blob_sha256),failure_code=VALUES(failure_code)`, [values]);
      await db.commit(); transaction = false;
      try { progress({ phase: 'blob-import', processedDocuments: offset + batch.length, totalDocuments: inventory.entries.length }); } catch { /* Progress is advisory. */ }
    }
    const report = await verifyImportedAttachmentBlobs(db, dump.sourceSha256);
    if (report.links !== inventory.entries.length) fail('LINK_COUNT_MISMATCH');
    return { ...report, inventorySha256: inventory.inventorySha256, newlyStoredBlobs, appDownloadReady: false };
  } catch (error) {
    if (transaction) await db.rollback().catch(() => {});
    if (error instanceof AttachmentBlobImportError) throw error;
    throw new AttachmentBlobImportError(error?.code === 'EEXIST' ? 'ARCHIVE_LOCKED' : 'IMPORT_FAILED');
  } finally {
    if (lock) { await lock.close(); await unlink(lockName); }
  }
}
