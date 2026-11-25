import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

test('development runner refuses a non-ronaldo-service configuration before starting Next', async () => {
  await assert.rejects(run(process.execPath, ['tools/ronaldo-auth/run.mjs'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    timeout: 5000,
    windowsHide: true,
    env: { ...process.env, NODE_ENV: 'development', RONALDO_SERVICE_URL: 'http://127.0.0.1:3001', RONALDO_IDENTITY_SECRET: 'short' },
  }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Invalid Ronaldo identity configuration/);
    assert.doesNotMatch(error.stdout, /Ready/);
    return true;
  });
});
