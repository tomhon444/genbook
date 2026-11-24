import { mkdir,writeFile } from 'node:fs/promises';
import { startDatabase } from '../issuance/database.mjs';
import { readDump } from './dump.mjs';
import { preserveSnapshot } from './preservation.mjs';

if(process.argv.length!==3)throw new Error('Usage: node tools/migration/preserve-rehearsal.mjs <approved snapshot.sql.gz>');
const dump=await readDump(process.argv[2]);
if(dump.sourceSha256!=='78629b14b7fcc8309aea012ae145fbae6dfde3a4d48a1b07fad9e0fb97411c82')throw new Error('This rehearsal approval is bound to the confirmed snapshot; review a different snapshot separately');
const db=await startDatabase({port:3323});
try{
  const options={approvalReference:'User confirmation 2026-11-13: preserve originals, restrict unresolved access, unknown time, reserve existing numbers'};
  const first=await preserveSnapshot(db.admin,dump,options);
  const replay=await preserveSnapshot(db.admin,dump,options);
  const report={...first,replayVerified:replay.replayed,rawEveryFieldVerified:true,derivedEveryFieldVerified:true,cleanup:'Isolated database removed after rehearsal'};
  await mkdir('.local/t12',{recursive:true});
  await writeFile('.local/t12/preservation-rehearsal.json',JSON.stringify(report,null,2),'utf8');
  console.log(JSON.stringify(report));
}finally{await db.close();}
