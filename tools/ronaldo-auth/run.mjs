import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDatabase } from '../issuance/database.mjs';
import { createRonaldoIdentity } from '../../lib/auth/ronaldo.mjs';
import { openLocalGenbookDatabase } from '../migration/managed-local.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Development runner only');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root);
const demo = process.argv.includes('--demo');
if (!demo) {
  const envFile = existsSync('.env.local') ? '.env.local' : '.env';
  if (existsSync(envFile)) loadEnvFile(envFile);
}
const env = { ...process.env, NODE_ENV: 'development', AUTH_PROVIDER: 'central', AUTH_ORIGIN: 'http://127.0.0.1:3000' };
let identity;
let database;
let next;
async function close() {
  next?.kill();
  identity?.kill();
  await database?.close();
}
try {
  if (demo) {
    const serviceRoot = path.resolve(root, '../ronaldo-service');
    const entry = path.join(serviceRoot, 'dist/core/identity/identity-server.js');
    await access(entry).catch(() => { throw new Error('Build ronaldo-service first: npm.cmd --prefix ../ronaldo-service run build'); });
    const cwd = path.join(root, '.local/ronaldo-demo');
    await mkdir(path.join(cwd, 'fixtures'), { recursive: true, mode: 0o700 });
    const password = randomBytes(18).toString('base64url');
    const secret = randomBytes(32).toString('hex');
    await writeFile(path.join(cwd, 'fixtures/fake-directory.json'), JSON.stringify({
      departments: [{ centralDeptId: 'LOCAL-DEPT-01', nameTh: 'หน่วยงานทดสอบ', active: true }],
      staff: [{ centralStaffId: 'LOCAL-001', uniStaffId: null, login: 'demo.staff', password, displayName: 'ผู้ใช้ทดสอบบริการกลาง', email: null, centralDeptId: 'LOCAL-DEPT-01', active: true }],
    }), { mode: 0o600 });
    await writeFile('.local/ronaldo-account.json', JSON.stringify({ username: 'demo.staff', password }, null, 2), { mode: 0o600 });
    env.RONALDO_SERVICE_URL = 'http://127.0.0.1:3001';
    env.RONALDO_IDENTITY_SECRET = secret;
    identity = spawn(process.execPath, [entry], { cwd, windowsHide: true, stdio: 'inherit', env: {
      ...env, PORT: '3001', IDENTITY_PROVIDER: 'fake', IDENTITY_API_SECRET: secret, JWT_SECRET: randomBytes(32).toString('hex'), TRUST_PROXY: 'false',
    } });
    let exited = false;
    identity.once('exit', () => { exited = true; });
    identity.once('error', () => { exited = true; });
    let ready = false;
    for (let attempt = 0; attempt < 100 && !exited; attempt++) {
      try {
        const result = await fetch(`${env.RONALDO_SERVICE_URL}/api/v1/identity/status`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: JSON.stringify({ staffId: 'LOCAL-001' }), signal: AbortSignal.timeout(1000),
        });
        ready = result.ok;
      } catch { /* startup */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error('Ronaldo identity service failed to start');
    console.log('Ronaldo demo: synthetic identity only. Account: .local/ronaldo-account.json');
  }
  env.AUTH_SESSION_DIRECTORY ||= path.join(root, '.local/ronaldo-sessions');
  // Validate server URL and credentials before starting any database.
  createRonaldoIdentity({ serviceUrl: env.RONALDO_SERVICE_URL, secret: env.RONALDO_IDENTITY_SECRET, nodeEnv: env.NODE_ENV, sessionDirectory: env.AUTH_SESSION_DIRECTORY });
  if (!demo && env.BOOK_DATA_PROVIDER === 'ronaldo') {
    database = await openLocalGenbookDatabase();
    // In this mode all book reads go through Ronaldo to genbookno_db. The
    // retained runtime also hosts the unrelated older preservation DB.
    delete env.ISSUANCE_DATABASE_URL;
  } else if (!env.ISSUANCE_DATABASE_URL) {
    database = await startDatabase();
    env.ISSUANCE_DATABASE_URL = database.url;
  } else {
    const configured = new URL(env.ISSUANCE_DATABASE_URL);
    if (configured.protocol !== 'mysql:' || configured.hostname !== '127.0.0.1' || configured.port !== '3306' || configured.pathname !== '/genbook_db' || configured.search || configured.hash) throw new Error('Persistent development database must be the configured local genbook_db on port 3306');
    if (configured.port === '3306') {
      database = await openLocalGenbookDatabase();
      if (database.url !== env.ISSUANCE_DATABASE_URL) throw new Error('Persistent database configuration does not match its local receipt');
    }
  }
  next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3000'], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  next.once('error', async () => { await close(); process.exitCode = 1; });
  next.once('exit', async code => { await close(); process.exitCode = code ?? 1; });
  identity?.once('exit', () => { if (next?.exitCode === null) next.kill(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close(); });
} catch (error) {
  await close();
  throw error;
}
