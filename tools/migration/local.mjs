import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDump } from './dump.mjs';
import { openPersistentDatabase } from './persistent-database.mjs';
import { importLocalPreservation, verifyLocalPreservation, retainSource, readRetainedSource, writeLocalReport } from './local-preservation.mjs';

export async function main(args = process.argv.slice(2)) {
  const [command, sourceOrName, targetName] = args;
  if (!['import', 'verify', 'recover'].includes(command) || !sourceOrName || args.length > (command === 'verify' ? 2 : 3)) throw new Error('Usage: local.mjs import <snapshot.sql.gz> [target] | verify <target> | recover <old-target> <new-target>');
  if (command === 'recover' && (!targetName || targetName === sourceOrName)) throw new Error('Recovery requires a distinct new target name; the existing target is preserved');
  const name = command === 'verify' ? sourceOrName : targetName ?? 'legacy';
  const { source, dump } = command === 'import'
    ? { source: sourceOrName, dump: await readDump(sourceOrName) }
    : await readRetainedSource(sourceOrName);
  const db = await openPersistentDatabase({ name, createIfMissing: command !== 'verify' });
  let result;
  try {
    if (command !== 'verify') await retainSource(db.runtime, source, dump.sourceSha256);
    result = command === 'verify' ? await verifyLocalPreservation(db.admin, dump) : await importLocalPreservation(db.admin, dump, { progress: phase => console.log(JSON.stringify({ phase, target: name })) });
    await writeLocalReport(db.runtime, { command, ...result, persistent: true, gate: 'blocked', appHistoryImported: false, countersSeeded: false, productionReady: false, createdAt: new Date().toISOString() });
  } finally { await db.close(); }
  // Reopen from disk with newly spawned MySQL. A successful in-process commit
  // alone is insufficient evidence that the local target survives restart.
  const reopened = await openPersistentDatabase({ name, createIfMissing: false });
  try {
    console.log(JSON.stringify({ phase: 'verify-after-restart', target: name }));
    await verifyLocalPreservation(reopened.admin, dump);
    const report = { command, target: name, ...result, persistent: true, restartVerified: true, gate: 'blocked', appHistoryImported: false, productionReady: false };
    await writeLocalReport(reopened.runtime, report);
    console.log(JSON.stringify(report));
    return report;
  } finally { await reopened.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Do not print driver errors, SQL payloads, credentials or source data.
    console.error('Local preservation did not finish. Existing target/source data were retained. Check local configuration and use verify before retrying.');
    process.exitCode = 1;
  });
}
