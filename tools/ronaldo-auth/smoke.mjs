import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Run against dev:ronaldo:demo only. Never takes real faculty credentials.
const origin = 'http://127.0.0.1:3000';
const credentials = JSON.parse(await readFile('.local/ronaldo-account.json', 'utf8'));
assert.equal(credentials.username, 'demo.staff');
const login = async (body = credentials, requestOrigin = origin, cookie) => fetch(`${origin}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
});
assert.equal((await fetch(`${origin}/api/me`)).status, 401);
assert.equal((await login(credentials, 'https://example.com')).status, 403);
assert.equal((await login({ ...credentials, password: 'wrong-synthetic-password' })).status, 401);
const first = await login();
assert.equal(first.status, 200);
const firstCookie = first.headers.get('set-cookie').split(';')[0];
assert.match(first.headers.get('set-cookie'), /HttpOnly/i);
const second = await login(credentials, origin, firstCookie);
assert.equal(second.status, 200);
const cookie = second.headers.get('set-cookie').split(';')[0];
assert.notEqual(cookie, firstCookie);
assert.equal((await fetch(`${origin}/api/me`, { headers: { Cookie: firstCookie } })).status, 401);
const me = await fetch(`${origin}/api/me`, { headers: { Cookie: cookie } });
assert.equal(me.status, 200);
assert.equal((await me.json()).identity.staffId, 'LOCAL-001');
assert.equal((await fetch(`${origin}/api/issuance`, { headers: { Cookie: cookie } })).status, 200);
const logout = await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { Origin: origin, Cookie: cookie } });
assert.equal(logout.status, 200);
assert.equal((await fetch(`${origin}/api/me`, { headers: { Cookie: cookie } })).status, 401);
console.log('PASS: Next.js -> Ronaldo Core HTTP -> FakeDirectory; login, origin, rotation, protected API, logout, replay. No CENTRAL/Repair connection.');
