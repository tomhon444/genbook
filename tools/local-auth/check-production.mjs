import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';

async function verifyTraces(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await verifyTraces(path);
    else if (entry.name.endsWith('.nft.json')) {
      const { files } = JSON.parse(await readFile(path, 'utf8'));
      assert(!files.some((file) => /tools[\\/](local-auth|issuance)|t04-account|t05-database|auth\.spec|issuance\.spec|provider\.test|rules\.test/.test(file)), `Synthetic fixture traced: ${path}`);
    }
  }
}
await verifyTraces('.next/server');
console.log('PASS production traces exclude local provider and synthetic fixtures');

const baseEnv = { ...process.env, NODE_ENV: 'production' };
for (const key of ['AUTH_PROVIDER', 'LOCAL_IDENTITY_URL', 'LOCAL_IDENTITY_SECRET']) delete baseEnv[key];
const run = (extra, port) => {
  const process = spawn(globalThis.process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...baseEnv, ...extra }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { process, output: '', exited: false };
  process.stdout.on('data', (data) => { state.output += data; });
  process.stderr.on('data', (data) => { state.output += data; });
  process.on('exit', () => { state.exited = true; });
  return state;
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
const forbidden = run({ AUTH_PROVIDER: 'local', LOCAL_IDENTITY_URL: 'http://127.0.0.1:1', LOCAL_IDENTITY_SECRET: 'x'.repeat(64) }, 3105);
try {
  const end = Date.now() + 15_000;
  while (!forbidden.exited && Date.now() < end) await pause();
  assert(forbidden.exited && forbidden.output.includes('Local identity configuration is forbidden in production'), 'Production failed to reject local config');
  console.log('PASS production startup rejects local adapter configuration');
} finally { forbidden.process.kill(); }

const normal = run({}, 3105);
try {
  let ready = false;
  const end = Date.now() + 20_000;
  while (!normal.exited && Date.now() < end) {
    try { ready = (await fetch('http://127.0.0.1:3105/login')).ok; } catch { /* startup */ }
    if (ready) break;
    await pause();
  }
  assert(ready, 'Production failed to start');
  const headers = { Origin: 'http://127.0.0.1:3105', 'Content-Type': 'application/json', 'x-user-id': 'admin', 'x-role': 'admin', Cookie: `genbook_session=${'a'.repeat(64)}` };
  const login = await fetch('http://127.0.0.1:3105/api/auth/login?user=admin', { method: 'POST', headers, body: JSON.stringify({ username: 'demo.staff', password: 'fake', role: 'admin' }) });
  assert.equal(login.status, 403);
  assert.equal(login.headers.get('set-cookie'), null);
  assert.equal((await fetch('http://127.0.0.1:3105/api/me?user=admin', { headers })).status, 401);
  assert.equal((await fetch('http://127.0.0.1:3105/api/issuance', { headers })).status, 401);
  assert.equal((await fetch('http://127.0.0.1:3105/api/issuance/forged', { headers })).status, 401);
  assert.equal((await fetch('http://127.0.0.1:3105/api/issuance', { method: 'POST', headers, body: '{}' })).status, 403);
  const workspace = await fetch('http://127.0.0.1:3105/workspace', { headers });
  assert(workspace.url.includes('/login') || (await workspace.text()).includes('/login?reason=session'));
  console.log('PASS production rejects synthetic credentials and forged identity on web/HTTP');
} finally { normal.process.kill(); }
