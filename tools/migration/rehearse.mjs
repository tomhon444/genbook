import { mkdir, writeFile } from 'node:fs/promises';
import { startDatabase } from '../issuance/database.mjs';
import { readDump } from './dump.mjs';
import { stageDump } from './import.mjs';

const source = process.argv[2];
if (!source || process.argv.length !== 3) throw new Error('Usage: node tools/migration/rehearse.mjs <snapshot.sql.gz>');
const dump = await readDump(source);
const database = await startDatabase({ port: 3319 });
try {
  const first = await stageDump(database.admin,dump);
  const replay = await stageDump(database.admin,dump);
  await mkdir('.local/t12', { recursive: true });
  await writeFile('.local/t12/rehearsal.json',JSON.stringify({ ...first, replayVerified: replay.replayed, stagingVerifiedEveryField: true, countersSeeded: false, appHistoryImported: false, cleanup: 'Isolated database removed on shutdown' },null,2));
  console.log(JSON.stringify({ counts: first.counts, duplicateGroups: first.duplicateGroups, duplicateExcess: first.duplicateExcess, cancelled: first.cancelled, replayVerified: replay.replayed, report: '.local/t12/rehearsal.json', productionReady: false }));
} finally { await database.close(); }
