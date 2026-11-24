import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDump } from './dump.mjs';
import { openLocalGenbookDatabase } from './managed-local.mjs';
import { preserveSnapshot } from './preservation.mjs';
import { importAttachmentBlobs, verifyImportedAttachmentBlobs } from './attachment-blob-import.mjs';

export async function importLocalFiles(snapshot, archiveRoot) {
  if (!snapshot || !archiveRoot) throw new Error('Require a verified snapshot and its private archive');
  const dump = await readDump(snapshot);
  const approvalReference = 'User 2026-11-18: local legacy import with LONGBLOB/SHA256; no production release';
  const target = await openLocalGenbookDatabase();
  let report;
  try {
    console.log(JSON.stringify({ phase: 'managed-preservation-dry-run', sourceSha256: dump.sourceSha256 }));
    await preserveSnapshot(target.admin, dump, { approvalReference, dryRun: true });
    console.log(JSON.stringify({ phase: 'managed-preservation-commit' }));
    const preserved = await preserveSnapshot(target.admin, dump, { approvalReference });
    console.log(JSON.stringify({ phase: 'managed-preservation-replay' }));
    const replay = await preserveSnapshot(target.admin, dump, { approvalReference });
    let lastProgress = 0;
    const blobs = await importAttachmentBlobs(target.admin, { dump, archiveRoot: path.resolve(archiveRoot), progress: value => {
      if (Date.now() - lastProgress >= 5000) { console.log(JSON.stringify(value)); lastProgress = Date.now(); }
    } });
    report = { sourceSha256: dump.sourceSha256, database: 'genbook_db', host: '127.0.0.1', port: 3306, preserved, replayVerified: replay.replayed,
      blobs, gate: 'blocked', productionReady: false, appHistoryReady: false };
  } finally { await target.close(); }
  const reopened = await openLocalGenbookDatabase();
  try {
    const verified = await verifyImportedAttachmentBlobs(reopened.admin, dump.sourceSha256);
    if (!verified.databaseHashVerified || verified.links !== report.blobs.links || verified.uniqueBlobs !== report.blobs.uniqueBlobs) throw new Error('Restart verification failed');
    report.restartVerified = true;
  } finally { await reopened.close(); }
  const filename = path.resolve('.local/legacy-import', `managed-blob-import-${Date.now()}.json`);
  await writeFile(filename, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  importLocalFiles(...process.argv.slice(2)).catch(error => {
    console.error(`Local legacy import did not finish (${error.code ?? 'IMPORT_FAILED'}). Existing data and completed batches were retained.`);
    process.exitCode = 1;
  });
}
