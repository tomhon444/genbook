import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startIdentity } from './provider.mjs';

const secret = 'synthetic-test-service-secret-32-characters';
const user = {
  username: 'owner', password: 'local-test-password', staffId: 'TEST-A',
  departmentId: 'TEST-X', displayName: 'Synthetic Owner', departmentName: 'Synthetic Department',
  active: true, faculty: true,
};

async function fixture(t, options = {}) {
  const provider = await startIdentity({ secret, users: [user], ...options });
  t.after(() => provider.close());
  async function request(path, body = {}, options = {}) {
    const response = await fetch(`${provider.url}${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...options.headers },
      body: JSON.stringify(body), ...options,
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  const login = (extra = {}) => request('/login', { username: user.username, password: user.password, ...extra });
  const session = (token) => request('/session', { token });
  return { provider, request, login, session };
}

test('successful identity returns narrow server-controlled fields and opaque sessions', async (t) => {
  const { login, session } = await fixture(t);
  const result = await login({ staffId: 'ATTACKER', departmentId: 'OTHER', role: 'admin' });
  assert.equal(result.status, 200);
  assert.match(result.body.token, /^[a-f0-9]{64}$/);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const current = await session(result.body.token);
  assert.equal(current.status, 200);
  assert.deepEqual(current.body.identity, {
    staffId: user.staffId, displayName: user.displayName,
    departmentId: user.departmentId, departmentName: user.departmentName,
  });
  assert.equal(current.body.expiresAt, result.body.expiresAt);
  assert.equal(JSON.stringify(current.body).includes(user.password), false);
});

test('wrong credentials, unknown users, inactive and incomplete identities are denied', async (t) => {
  const invalid = [
    { username: 'inactive', active: false }, { username: 'external', faculty: false },
    { username: 'no-id', staffId: '' }, { username: 'no-dept', departmentId: '' },
    { username: 'no-name', displayName: '' }, { username: 'no-dept-name', departmentName: '' },
  ];
  const { login, request } = await fixture(t, { users: [user, ...invalid.map((changes) => ({ ...user, ...changes }))] });
  for (const input of [
    { username: user.username, password: 'wrong' },
    { username: 'unknown', password: user.password },
    ...invalid.map(({ username }) => ({ username, password: user.password })),
  ]) {
    const result = await request('/login', input);
    assert.equal(result.status, 401, input.username);
    assert.deepEqual(result.body, {});
  }
  assert.equal((await login()).status, 200);
});

test('logout revokes the server session and old-cookie replay is denied', async (t) => {
  const { login, session, request } = await fixture(t);
  const { body: { token } } = await login();
  assert.equal((await session(token)).status, 200);
  assert.equal((await request('/logout', { token })).status, 200);
  assert.equal((await session(token)).status, 401);
  assert.equal((await request('/logout', { token })).status, 200);
  assert.equal((await session(token)).status, 401);
});

test('reauthentication rotates the token and revokes the previous token', async (t) => {
  const { login, session } = await fixture(t);
  const first = await login();
  const second = await login({ previousToken: first.body.token });
  assert.equal(second.status, 200);
  assert.notEqual(second.body.token, first.body.token);
  assert.equal((await session(first.body.token)).status, 401);
  assert.equal((await session(second.body.token)).status, 200);
});

test('expired sessions cannot be replayed or renewed through session reads', async (t) => {
  const { login, session } = await fixture(t, { ttlMs: 300 });
  const result = await login();
  assert.equal((await session(result.body.token)).status, 200);
  await delay(Math.max(0, result.body.expiresAt - Date.now()) + 20);
  assert.equal((await session(result.body.token)).status, 401);
  assert.equal((await session(result.body.token)).status, 401);
});

test('service requires its secret, denies browser origins and listens only on loopback', async (t) => {
  const { provider, request } = await fixture(t);
  assert.match(provider.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  for (const headers of [{}, { Authorization: 'Bearer wrong' }, { Authorization: `Bearer ${secret}`, Origin: 'http://127.0.0.1:3000' }]) {
    assert.equal((await request('/login', { username: user.username, password: user.password }, { headers })).status, 403);
  }
  const response = await fetch(`${provider.url}/session`, { headers: { Authorization: `Bearer ${secret}` } });
  assert.equal(response.status, 403);
});

test('invalid requests and forged sessions are rejected without issuing identity', async (t) => {
  const { provider, request, session } = await fixture(t);
  for (const body of [null, 'not-an-object', {}, { username: 12, password: 'x' }, { username: 'x'.repeat(101), password: 'x' }]) {
    assert.equal((await request('/login', body)).status, 400);
  }
  const malformed = await fetch(`${provider.url}/login`, {
    method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: '{broken',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await request('/login', { username: 'x'.repeat(5000), password: 'x' })).status, 413);
  for (const token of [undefined, null, 123, '', 'a'.repeat(64), { staffId: user.staffId }]) {
    assert.equal((await session(token)).status, 401);
  }
  assert.equal((await request('/unknown')).status, 404);
});

test('aggregate login limiter blocks repeated attempts across arbitrary usernames', async (t) => {
  const { request, login } = await fixture(t);
  for (let i = 0; i < 30; i++) {
    assert.equal((await request('/login', { username: `unknown-${i}`, password: 'wrong' })).status, 401);
  }
  assert.equal((await login()).status, 429);
});

test('provider refuses production mode and unsafe basic configuration', async () => {
  await assert.rejects(startIdentity({ secret: 'short', users: [user] }), /configuration/);
  await assert.rejects(startIdentity({ secret, users: [user], ttlMs: 0 }), /configuration/);
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    await assert.rejects(startIdentity({ secret, users: [user] }), /development-only/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
