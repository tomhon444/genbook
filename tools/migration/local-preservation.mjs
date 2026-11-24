import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, readDump } from './dump.mjs';
import { stageDump } from './import.mjs';
import { preservationPlan, preserveSnapshot, verifyPreservation } from './preservation.mjs';

export const localApproval = 'User authorization: T12 offline preservation into a persistent isolated local target; no production release';
const persistentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.local/t12-persistent');

// Actual data must never be mixed with synthetic grants, other snapshots or
// app-readable history. The persistent runtime supplies the local connection.
export async function assertLocalPreservationState(db, dump, { requireImported = false } = {}) {
  const [[state]] = await db.query(`SELECT
    (SELECT state FROM issuance_migration_gate WHERE id=1) gate,
    (SELECT COUNT(*) FROM issuance_documents) issued,
    (SELECT COUNT(*) FROM legacy_documents) history,
    (SELECT COUNT(*) FROM issuance_grants) grants_count,
    (SELECT COUNT(*) FROM issuance_series) series_count,
    (SELECT COUNT(*) FROM issuance_counters) counters_count,
    (SELECT COUNT(*) FROM issuance_subcounters) subcounters_count`);
  if (state.gate !== 'blocked' || ['issued', 'history', 'grants_count', 'series_count', 'counters_count', 'subcounters_count'].some(key => Number(state[key]) !== 0)) throw new Error('Local target must be blocked and contain no live history, grants, series or counters');
  const [batches] = await db.query('SELECT source_sha256 FROM legacy_batches');
  if (batches.length > 1 || batches.some(row => row.source_sha256 !== dump.sourceSha256) || (requireImported && batches.length !== 1)) throw new Error('Local target is missing the expected snapshot or belongs to a different snapshot');
  return state;
}

export async function verifyLocalPreservation(db, dump) {
  await db.beginTransaction();
  try {
    await db.query('SELECT state FROM issuance_migration_gate WHERE id=1 FOR UPDATE');
    await assertLocalPreservationState(db, dump, { requireImported: true });
    const plan = preservationPlan(dump);
    const staged = await stageDump(db, dump, { manageTransaction: false });
    if (!staged.replayed) throw new Error('Verification must not create a missing source batch');
    await verifyPreservation(db, dump, plan, localApproval);
    const [[raw]] = await db.query('SELECT COUNT(*) total FROM legacy_staging');
    const expected = Object.values(dump.tables).reduce((sum, table) => sum + table.records.length, 0);
    if (Number(raw.total) !== expected) throw new Error('Unexpected rows outside the source snapshot');
    return { ...plan.summary, rawEveryFieldVerified: true, derivedEveryFieldVerified: true };
  } finally { await db.rollback(); }
}

export async function importLocalPreservation(db, dump, { progress = () => {} } = {}) {
  await assertLocalPreservationState(db, dump);
  progress('dry-run');
  const [[before]] = await db.query('SELECT COUNT(*) batches FROM legacy_batches');
  const dryRun = await preserveSnapshot(db, dump, { approvalReference: localApproval, dryRun: true });
  const [[after]] = await db.query('SELECT COUNT(*) batches FROM legacy_batches');
  if (Number(before.batches) !== Number(after.batches)) throw new Error('Dry-run changed the target');
  await assertLocalPreservationState(db, dump);
  progress('import');
  const imported = await preserveSnapshot(db, dump, { approvalReference: localApproval });
  progress('replay');
  const replay = await preserveSnapshot(db, dump, { approvalReference: localApproval });
  progress('verify-every-field');
  const verified = await verifyLocalPreservation(db, dump);
  return { ...verified, dryRunVerified: dryRun.dryRun === true, replayVerified: replay.replayed === true, alreadyImported: imported.replayed === true };
}

// Preserve the exact compressed input as a recovery artifact. Never overwrite a
// different source, and check a second read so a changed source cannot be saved.
export async function retainSource(runtime, file, expectedHash) {
  const bytes = await readFile(file);
  if (hash(bytes) !== expectedHash) throw new Error('Source changed while preparing the import');
  const backup = path.join(runtime, 'source.sql.gz');
  try { await writeFile(backup, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (path.resolve(await realpath(backup)).toLowerCase() !== path.resolve(backup).toLowerCase()) throw new Error('Retained source must not be redirected');
  if (hash(await readFile(backup)) !== expectedHash) throw new Error('Retained source mismatch; use a separate target');
  const receiptFile = path.join(runtime, 'source-manifest.json');
  try { await writeFile(receiptFile, JSON.stringify({ version: 1, sourceSha256: expectedHash }, null, 2), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const receipt = await readSourceReceipt(runtime);
  if (receipt.sourceSha256 !== expectedHash) throw new Error('Retained source receipt mismatch');
  return backup;
}

async function readSourceReceipt(runtime) {
  const filename = path.join(runtime, 'source-manifest.json');
  if (path.resolve(await realpath(filename)).toLowerCase() !== path.resolve(filename).toLowerCase()) throw new Error('Source receipt must not be redirected');
  const receipt = JSON.parse(await readFile(filename, 'utf8'));
  if (!receipt || Object.keys(receipt).length !== 2 || receipt.version !== 1 || !/^[a-f0-9]{64}$/.test(receipt.sourceSha256 ?? '')) throw new Error('Invalid retained source receipt');
  return receipt;
}

export async function readRetainedSource(name) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(name ?? '')) throw new Error('Invalid local target name');
  const root = await realpath(persistentRoot);
  if (path.resolve(root).toLowerCase() !== persistentRoot.toLowerCase()) throw new Error('Retained source root must not be redirected');
  const directory = await realpath(path.join(root, name));
  if (path.relative(root, directory) !== name) throw new Error('Retained source directory must stay inside the local target root');
  const source = await realpath(path.join(directory, 'source.sql.gz'));
  if (path.dirname(source) !== directory) throw new Error('Retained source must not be redirected');
  const receipt = await readSourceReceipt(directory);
  const dump = await readDump(source);
  if (dump.sourceSha256 !== receipt.sourceSha256) throw new Error('Retained source does not match its original receipt');
  return { source, dump };
}

export async function writeLocalReport(runtime, report) {
  await mkdir(path.join(runtime, 'reports'), { recursive: true });
  const filename = path.join(runtime, 'reports', `${Date.now()}-${report.command}.json`);
  await writeFile(filename, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  return filename;
}
