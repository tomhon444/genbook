import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createRonaldoIdentity } from '../../lib/auth/ronaldo.mjs';

const identity = { staffId: 'TEST-001', displayName: 'ทดสอบ', departmentId: 'TEST-D1', departmentName: 'หน่วยงานทดสอบ' };
const secret = 'test-only-identity-secret-32-characters';
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'genbook-auth-'));
  const state = { active: true, outage: false, provider: 'fake', identity, calls: [] };
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    state.calls.push({ url: req.url, body, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    if (state.outage) { res.statusCode = 503; res.end('{}'); return; }
    if (!state.active || (req.url.endsWith('authenticate') && body.password !== 'valid')) { res.statusCode = 401; res.end('{}'); return; }
    res.end(JSON.stringify({ provider: state.provider, identity: state.identity }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  let time = 100_000;
  const settings = { serviceUrl: `http://127.0.0.1:${server.address().port}`, secret, nodeEnv: 'test', sessionDirectory: directory, now: () => time, ttlMs: 1000 };
  return { directory, state, settings, handler: createRonaldoIdentity(settings), advance: () => { time += 1001; } };
}

test('HTTP auth delegates to Ronaldo, persists only token hash, rotates and revokes', async t => {
  const f = await fixture(t);
  const login = await f.handler('/login', { username: 'staff', password: 'valid', role: 'admin' });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.match(token, /^[a-f0-9]{64}$/);
  const [file] = await readdir(f.directory);
  assert.ok(!file.includes(token));
  const stored = await readFile(path.join(f.directory, file), 'utf8');
  assert.ok(!stored.includes('valid') && !stored.includes(token));
  assert.deepEqual(f.state.calls[0], { url: '/api/v1/identity/authenticate', body: { username: 'staff', password: 'valid' }, authorization: `Bearer ${secret}` });
  // A new adapter/process can read the same persisted session.
  const restarted = createRonaldoIdentity(f.settings);
  assert.deepEqual((await (await restarted('/session', { token })).json()).identity, identity);
  const next = await (await f.handler('/login', { username: 'staff', password: 'valid', previousToken: token })).json();
  assert.equal((await f.handler('/session', { token })).status, 401);
  assert.equal((await f.handler('/session', { token: next.token })).status, 200);
  assert.equal((await restarted('/logout', { token: next.token })).status, 200);
  assert.equal((await f.handler('/session', { token: next.token })).status, 401);
});

test('invalid credentials do not create sessions; expiry and deactivation reject replay', async t => {
  const f = await fixture(t);
  assert.equal((await f.handler('/login', { username: 'staff', password: 'wrong' })).status, 401);
  const a = await (await f.handler('/login', { username: 'staff', password: 'valid' })).json();
  f.advance();
  assert.equal((await f.handler('/session', a)).status, 401);
  const b = await (await f.handler('/login', { username: 'staff', password: 'valid' })).json();
  f.state.active = false;
  assert.equal((await f.handler('/session', b)).status, 401);
  f.state.active = true;
  assert.equal((await f.handler('/session', b)).status, 401);
});

test('outage fails closed; local revocation still works while Ronaldo is unavailable', async t => {
  const f = await fixture(t);
  const credentials = { username: 'staff', password: 'valid' };
  const session = await (await f.handler('/login', credentials)).json();
  f.state.outage = true;
  assert.equal(await f.handler('/login', credentials), null);
  assert.equal(await f.handler('/session', session), null);
  assert.equal((await f.handler('/logout', session)).status, 200);
  f.state.outage = false;
  assert.equal((await f.handler('/session', session)).status, 401);
});

test('invalid upstream identity or mismatched subject fails closed', async t => {
  const f = await fixture(t);
  const credentials = { username: 'staff', password: 'valid' };
  f.state.identity = { ...identity, departmentId: '' };
  assert.equal(await f.handler('/login', credentials), null);
  f.state.identity = identity;
  const session = await (await f.handler('/login', credentials)).json();
  f.state.identity = { ...identity, staffId: 'OTHER' };
  assert.equal(await f.handler('/session', session), null);
  assert.equal((await f.handler('/session', { token: '../../file' })).status, 401);
});

test('production rejects insecure URLs, missing secrets, fake providers and redirects', async t => {
  const f = await fixture(t);
  assert.throws(() => createRonaldoIdentity({ ...f.settings, nodeEnv: 'production' }));
  for (const serviceUrl of ['https://service.test/path', 'https://user:pw@service.test', 'https://service.test?redirect=evil', 'http://remote.test']) {
    assert.throws(() => createRonaldoIdentity({ ...f.settings, serviceUrl }));
  }
  assert.throws(() => createRonaldoIdentity({ ...f.settings, secret: 'short' }));
  const handler = createRonaldoIdentity({ ...f.settings, nodeEnv: 'production', serviceUrl: 'https://service.test', fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, 'error');
    return Response.json({ provider: 'fake', identity });
  } });
  assert.equal(await handler('/login', { username: 'staff', password: 'valid' }), null);
});

test('concurrent login publishes complete records and quarantines a corrupt record', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, `${'a'.repeat(64)}.json`), '');
  const results = await Promise.all(Array.from({ length: 20 }, () => f.handler('/login', { username: 'staff', password: 'valid' })));
  assert.ok(results.every(result => result?.status === 200));
  const tokens = await Promise.all(results.map(result => result.json()));
  assert.equal(new Set(tokens.map(session => session.token)).size, 20);
  for (const session of tokens) assert.equal((await f.handler('/session', session)).status, 200);
  assert.ok((await readdir(f.directory)).some(file => file.endsWith('.corrupt')));
});
