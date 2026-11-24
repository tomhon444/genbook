import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

for (const port of [3336, 3338]) test(`development runner refuses retired port ${port} before starting MySQL or Next`, async () => {
  await assert.rejects(run(process.execPath, ['tools/ronaldo-auth/run.mjs'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    timeout: 5000,
    windowsHide: true,
    env: { ...process.env, NODE_ENV: 'development', BOOK_DATA_PROVIDER: '',
      RONALDO_SERVICE_URL: 'http://127.0.0.1:3001', RONALDO_IDENTITY_SECRET: 'synthetic-runner-test-secret-32-characters',
      ISSUANCE_DATABASE_URL: `mysql://synthetic:synthetic@127.0.0.1:${port}/genbook_db` },
  }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Persistent development database must be the configured local genbook_db on port 3306/);
    assert.doesNotMatch(error.stdout, /Ready|Local account|Ronaldo demo/);
    return true;
  });
});
