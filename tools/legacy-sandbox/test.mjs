import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { spawnSync } from 'node:child_process';
const runtime = new URL('../../.local/legacy-sandbox/', import.meta.url);
const settings = JSON.parse(await readFile(new URL('private-settings.json', runtime), 'utf8'));
const base = 'http://127.0.0.1:18082/';
if (process.env.NODE_ENV === 'production') throw new Error('No sandbox tests in production');
const results = [];
async function request(route, options = {}) {
  const response = await fetch(new URL(route, base), { redirect: 'manual', signal: AbortSignal.timeout(20000), ...options });
  const body = await response.text();
  assert(!/Fatal error|A PHP Error|A Database Error|Uncaught/i.test(body), 'No PHP/database errors expected');
  const location = response.headers.get('location');
  if (location) assert.equal(new URL(location, base).origin, new URL(base).origin, 'Redirect stays isolated');
  return { response, body };
}
const cookieFrom = response => [...new Map(response.headers.getSetCookie().map(value => {
  const pair = value.split(';')[0]; const equals = pair.indexOf('=');
  return [pair.slice(0, equals), pair];
})).values()].join('; ');
async function login(username, password) {
  return request('user/authen', { method: 'POST', body: new URLSearchParams({ uname: username, upass: password }) });
}
const unauthed = await request('genbook/form');
assert.equal(unauthed.response.status, 302);
results.push('Unauthenticated form redirects to login');
const identityDenied = await request('sandbox_identity');
assert.equal(identityDenied.response.status, 401);
results.push('Identity inspection rejects unauthenticated requests');
const home = await request('');
assert.equal(home.response.status, 200);
assert.match(home.body, /type\s*=\s*["']password["']/i);
results.push('Legacy login form renders');
for (const name of ['t02_owner', 't02_other', 't02_manager']) {
  const account = settings.accounts.find(item => item.username === name);
  const result = await login(name, account.password);
  assert.equal(result.response.status, 302, `${name}: successful login redirects`);
  assert.equal(new URL(result.response.headers.get('location'), base).pathname, '/genbook');
  const cookie = cookieFrom(result.response);
  assert(cookie, 'Login should set a session cookie');
  const identity = await request('sandbox_identity', { headers: { Cookie: cookie } });
  assert.equal(identity.response.status, 200);
  const data = JSON.parse(identity.body);
  assert.equal(data.staffId, { t02_owner: 'T02-OWNER', t02_other: 'T02-OTHER', t02_manager: 'T02-MANAGER' }[name]);
  assert.equal(data.departmentId, name === 't02_other' ? 'T02' : 'T01');
  assert.equal(data.role, name === 't02_manager' ? '3' : '');
  const dashboard = await request('genbook', { headers: { Cookie: cookie } });
  assert.equal(dashboard.response.status, 200);
  const logout = await request('user/logout', { headers: { Cookie: cookie } });
  assert.equal(logout.response.status, 302);
  const afterLogout = await request('sandbox_identity', { headers: { Cookie: cookieFrom(logout.response) } });
  assert.equal(afterLogout.response.status, 401);
  const replayAfterLogout = await request('sandbox_identity', { headers: { Cookie: cookie } });
  assert.equal(replayAfterLogout.response.status, 401, 'Sandbox harness rejects original pre-logout cookie');
  const decoratedReplay = await request('sandbox_identity', { headers: { Cookie: `unrelated=1; ${cookie}` } });
  assert.equal(decoratedReplay.response.status, 401, 'Adding unrelated cookies must not bypass revocation');
  results.push(`${name}: legacy login/mapping/dashboard, cookie clearing and sandbox-harness logout replay protection pass`);
}
const owner = settings.accounts.find(item => item.username === 't02_owner');
for (const [label, username, password] of [
  ['Wrong password', owner.username, 'intentionally-wrong-synthetic-password'],
  ...settings.accounts.filter(item => ['t02_inactive', 't02_no_start', 't02_no_prefix'].includes(item.username)).map(item => [item.username, item.username, item.password]),
]) {
  const result = await login(username, password);
  const identity = await request('sandbox_identity', { headers: { Cookie: cookieFrom(result.response) } });
  assert.equal(identity.response.status, 401, `${label}: should not authenticate`);
  results.push(`${label}: login denied`);
}
for (const route of ['genbook/save', 'welcome/test', 'application/config/database.php']) {
  assert.equal((await request(route)).response.status, 403);
}
assert.equal((await request('user/authen', { method: 'POST', body: new URLSearchParams({ uname: 'non_fixture_user', upass: 'none' }) })).response.status, 403);
const foreignHostStatus = await new Promise((resolve, reject) => {
  const probe = httpRequest(base, { headers: { Host: 'example.invalid' } }, response => {
    response.resume(); resolve(response.statusCode);
  });
  probe.once('error', reject); probe.end();
});
assert.equal(foreignHostStatus, 403);
assert.match(home.response.headers.get('content-security-policy'), /form-action 'self'/);
results.push('Mutation/debug/config routes, non-fixture accounts and foreign Host are blocked');
const production = spawnSync(process.execPath, [fileURLToPath(new URL('start.mjs', import.meta.url)), '--resume'], {
  env: { ...process.env, NODE_ENV: 'production' }, windowsHide: true, encoding: 'utf8',
});
assert.notEqual(production.status, 0);
assert.match(production.stderr, /Sandbox refuses production environment/);
results.push('Launcher refuses production mode before opening a listener or database');
console.log(JSON.stringify({ passed: results.length, results, scope: 'Synthetic localhost compatibility only; no faculty integration or numbering allocation tested. Original legacy logout replay was observed; mitigation belongs to sandbox harness only.', tool: fileURLToPath(import.meta.url) }, null, 2));
