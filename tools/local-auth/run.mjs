import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { startIdentity } from './provider.mjs';
import { startDatabase } from '../issuance/database.mjs';
import { access } from 'node:fs/promises';
import { loadDemoReferences, applyDemoReferences } from './reference-data.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Local runner cannot run in production');
const webPort = Number(process.env.LOCAL_WEB_PORT ?? 3000);
if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535) throw new Error('Invalid local web port');
const password = randomBytes(12).toString('base64url');
const users = [
  { username: 'demo.staff', password, staffId: 'LOCAL-001', displayName: 'บุคลากรตัวอย่าง', departmentId: 'LOCAL-DEPT-01', departmentName: 'หน่วยงานตัวอย่าง', active: true, faculty: true },
];
const secret = randomBytes(32).toString('hex');
const provider = await startIdentity({ secret, users });
let database;
try { database = await startDatabase(); }
catch (error) { await provider.close(); throw error; }
// A local, optional snapshot provides familiar reference labels for preview.
// Real history/owners/counters are never loaded into this disposable database.
const referenceSource = process.env.LOCAL_REFERENCE_SNAPSHOT ?? '.local/t12-persistent/legacy-78629b14/source.sql.gz';
let hasReferences = false;
try {
  await access(referenceSource);
  hasReferences = true;
} catch (error) {
  if (error.code !== 'ENOENT' || process.env.LOCAL_REFERENCE_SNAPSHOT) { await provider.close(); await database.close(); throw error; }
}
try {
  if (hasReferences) {
    const catalog = await loadDemoReferences(referenceSource);
    console.log(JSON.stringify({ localReferencePreview: await applyDemoReferences(database.admin, catalog) }));
  }
  await writeFile('.local/preview-database.json', JSON.stringify({ url: database.url, runtime: database.runtime, synthetic: true }), { mode: 0o600 });
} catch (error) { await provider.close(); await database.close(); throw error; }
await mkdir('.local', { recursive: true });
await writeFile('.local/t04-account.json', JSON.stringify({ username: users[0].username, password }, null, 2), { mode: 0o600 });
console.log(`Local account: .local/t04-account.json (generated each start). Open http://127.0.0.1:${webPort}. Synthetic MySQL starts fresh on each run.`);
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(webPort)], {
  stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development', AUTH_PROVIDER: 'local', LOCAL_IDENTITY_URL: provider.url, LOCAL_IDENTITY_SECRET: secret, ISSUANCE_DATABASE_URL: database.url },
});
child.on('exit', async (code) => { await provider.close(); await database.close(); process.exitCode = code ?? 1; });
child.on('error', async () => { await provider.close(); await database.close(); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
