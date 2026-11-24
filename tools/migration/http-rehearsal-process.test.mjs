import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { stopApp } from './http-rehearsal-process.mjs';

const origin = 'http://127.0.0.1:3115';
const portIsFree = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(3115, '127.0.0.1', () => probe.close(resolve));
});
const startApp = () => spawn(process.execPath, ['tools/migration/http-rehearsal-app.mjs', '3115'], {
  windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  env: { ...process.env, NODE_ENV: 'development', AC4_HTTP_REHEARSAL: '1', NEXT_TEST_DIST: 't12-details', AUTH_PROVIDER: 'local', BOOK_DATA_PROVIDER: 'local', LOCAL_IDENTITY_URL: 'http://127.0.0.1:1', LOCAL_IDENTITY_SECRET: 'synthetic-process-smoke-secret-only', ISSUANCE_DATABASE_URL: '', RONALDO_SERVICE_URL: '', RONALDO_GENBOOKNO_SECRET: '', NEXT_TELEMETRY_DISABLED: '1' },
});

// Exercises the real Next CLI and HTTP worker without a database, real identity
// connector or process-tree enumeration. Before the IPC shutdown wrapper this
// environment refused taskkill and leaked the worker's listening port.
test('owned Next app shuts down its HTTP worker through IPC and releases the port', { timeout: 120000 }, async () => {
  await portIsFree();
  const child = startApp();
  try {
    let ready = false;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, 'owned CLI exited before readiness');
      assert.equal(child.signalCode, null, 'owned CLI was terminated before readiness');
      try { ready = (await fetch(`${origin}/login`, { signal: AbortSignal.timeout(3000) })).status === 200; } catch { /* Startup polling only. */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(ready, true, 'own app must serve HTTP before the shutdown check');
  } finally { await stopApp(child); }
  assert.notEqual(child.exitCode, null, 'CLI must exit, rather than merely acknowledge shutdown');
  await portIsFree();
});

test('a stop requested immediately after spawn is retained until Next installs its signal handler', { timeout: 30000 }, async () => {
  await portIsFree();
  const child = startApp();
  await stopApp(child);
  assert.notEqual(child.exitCode, null, 'queued startup shutdown must actually exit the CLI');
  await portIsFree();
});
