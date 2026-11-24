import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { startIdentity } from '../tools/local-auth/provider.mjs';
import { startDatabase } from '../tools/issuance/database.mjs';
import { preserveSnapshot } from '../tools/migration/preservation.mjs';
import { promoteSnapshot } from '../tools/migration/promote.mjs';
import { promotionFixture } from '../tools/migration/promotion-fixture.mjs';

const origin = 'http://127.0.0.1:3114', password = 'Synthetic-history-details-only-42';
let database, provider, child, logs, snapshot;
async function login(request, username = 'owner') {
  const response = await request.post(`${origin}/api/auth/login`, { headers: { Origin: origin, Cookie: '' }, data: { username, password } });
  expect(response.status()).toBe(200);
  return response.headers()['set-cookie'].split(';')[0];
}
async function historyPage(page) {
  await login(page.request);
  await page.goto(`${origin}/workspace/history`);
  await expect(page).toHaveURL(`${origin}/workspace`);
  return page.locator('section[aria-labelledby="search-heading"]');
}

test.beforeAll(async () => {
  test.setTimeout(120000);
  database = await startDatabase({ port: 3341 });
  await database.admin.query('UPDATE issuance_series SET enabled=FALSE');
  const fixture = promotionFixture();
  snapshot = fixture.dump.sourceSha256;
  await preserveSnapshot(database.admin, fixture.dump, { approvalReference: fixture.approvalReference });
  await promoteSnapshot(database.admin, fixture.dump, fixture.mapping, { approvalReference: fixture.approvalReference, dryRun: false });
  const secret = randomBytes(32).toString('hex');
  provider = await startIdentity({ secret, ttlMs: 300000, users: [
    { username: 'owner', staffId: 'TEST-001', departmentId: '204' },
    { username: 'peer', staffId: 'TEST-002', departmentId: '204' },
    { username: 'outside', staffId: 'TEST-003', departmentId: 'TEST-D1' },
  ].map(user => ({ ...user, password, displayName: 'บุคลากรจำลอง', departmentName: 'หน่วยงานจำลอง', active: true, faculty: true })) });
  logs = createWriteStream('.local/t12-history-details-e2e.log');
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3114'], {
    windowsHide: true,
    env: { ...process.env, NODE_ENV: 'development', NEXT_TEST_DIST: 't12-details', AUTH_PROVIDER: 'local', LOCAL_IDENTITY_URL: provider.url, LOCAL_IDENTITY_SECRET: secret, ISSUANCE_DATABASE_URL: database.url },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(logs); child.stderr.pipe(logs);
  await expect.poll(async () => { try { return (await fetch(`${origin}/login`)).status; } catch { return 0; } }, { timeout: 90000 }).toBe(200);
});

test.afterAll(async () => {
  if (child && child.exitCode === null) {
    const stopped = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await stopped;
  }
  await provider?.close(); await database?.close(); logs?.end();
});

test('history details authorize before returning source-derived metadata and exclude raw attachment paths', async ({ request }) => {
  expect((await request.get(`${origin}/api/history?snapshot=${snapshot}&sourceId=1`)).status()).toBe(401);
  for (const [username, count] of [['owner', 4], ['peer', 3], ['outside', 1]]) {
    const headers = { Cookie: await login(request, username) };
    const listing = await request.get(`${origin}/api/history`, { headers });
    const list = await listing.json();
    expect(list.documents).toHaveLength(count);
    expect(list.documents.every(document => !Object.hasOwn(document, 'details'))).toBe(true);
    const secret = await request.get(`${origin}/api/history?snapshot=${snapshot}&sourceId=6`, { headers });
    expect(secret.status()).toBe(username === 'owner' ? 200 : 404);
    if (username === 'owner') {
      const body = await secret.json();
      expect(body.details.recipients[0].text).toBe('Confidential synthetic recipient');
      expect(JSON.stringify(body)).not.toContain('never-expose-secret-path.pdf');
      expect(JSON.stringify(body)).not.toContain('payload');
    }
    for (const id of ['3', '5']) expect((await request.get(`${origin}/api/history?snapshot=${snapshot}&sourceId=${id}`, { headers })).status()).toBe(404);
  }
  const detail = await request.get(`${origin}/api/history?snapshot=${snapshot}&sourceId=1`, { headers: { Cookie: await login(request) } });
  expect(detail.headers()['cache-control']).toBe('no-store');
  const body = await detail.json();
  expect(body.details.recipients.map(row => row.sourceId)).toEqual(['10', '20']);
  expect(body.details.destinations.map(row => row.sourceId)).toEqual(['10', '20']);
  expect(body.details.timestampTimeZone).toBe('unverified');
  expect(body.details.attachmentVerification).toBe('unverified');
});

test('mobile browser reads recipients, destinations and original timestamp text without edit or download controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await historyPage(page);
  await panel.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
  await panel.getByRole('button', { name: /ทดสอบ 001\/0042/ }).first().click();
  const detail = panel.getByRole('region', { name: 'รายละเอียดประวัติหนังสือ' });
  for (const text of ['อ่านอย่างเดียว', 'First synthetic recipient', 'Second synthetic recipient', 'Synthetic external organization', 'รหัสหน่วยงานภายใน: 204', 'POSITION-TEST', 'LEGACY-ACTOR', '2026-11-13 10:00:00', '2026-11-13 11:00:00', 'ยังไม่ยืนยันเขตเวลา', 'ยังไม่ได้ตรวจย้ายไฟล์แนบเดิม']) {
    await expect(detail).toContainText(text);
  }
  await expect(detail.getByRole('link')).toHaveCount(0);
  await expect(detail.getByRole('button')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('.local/t12', { recursive: true });
  await page.screenshot({ path: '.local/t12/history-details-mobile.png', fullPage: true });
  await panel.getByLabel('เลขหนังสือหรือชื่อเรื่อง', { exact: true }).fill('0030');
  await panel.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
  await panel.getByRole('button', { name: /ทดสอบ 001\/0030/ }).click();
  await expect(detail).toContainText('ไม่ทราบ');
});

test('changing the search discards delayed previous results and clears an open detail immediately', async ({ page }) => {
  const panel = await historyPage(page);
  await panel.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
  await panel.getByRole('button', { name: /ทดสอบ 001\/0042/ }).nth(1).click();
  await expect(panel.getByRole('region', { name: 'รายละเอียดประวัติหนังสือ' })).toContainText('Confidential synthetic recipient');
  const response = await page.request.get(`${origin}/api/search`), oldData = await response.json();
  let begin, release, finish;
  const started = new Promise(resolve => { begin = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const completed = new Promise(resolve => { finish = resolve; });
  await page.route('**/api/search?*', async route => {
    if (new URL(route.request().url()).searchParams.get('q') === 'delayed-query') {
      begin(); await gate;
      try { await route.fulfill({ json: oldData }); } catch { /* A canceled fetch must not update the UI. */ }
      finally { finish(); }
    } else await route.continue();
  });
  try {
    const query = panel.getByLabel('เลขหนังสือหรือชื่อเรื่อง', { exact: true });
    await query.fill('delayed-query');
    await expect(panel.getByRole('region', { name: 'รายละเอียดประวัติหนังสือ' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
    await started;
    await query.fill('no-such-synthetic-history');
    await panel.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
    await expect(panel).toContainText('ไม่พบหนังสือที่คุณอ่านได้ในหน้านี้');
    release(); await completed;
    await expect(panel.getByRole('button', { name: /ทดสอบ 001\// })).toHaveCount(0);
    await expect(panel.getByRole('region', { name: 'รายละเอียดประวัติหนังสือ' })).toHaveCount(0);
  } finally { release(); }
});

test('revoked session removes previously displayed history and redirects to login on the next read', async ({ page }) => {
  const panel = await historyPage(page);
  await panel.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
  await panel.getByRole('button', { name: /ทดสอบ 001\/0042/ }).nth(1).click();
  await expect(panel.getByRole('region', { name: 'รายละเอียดประวัติหนังสือ' })).toContainText('Confidential synthetic recipient');
  const logout = await page.request.post(`${origin}/api/auth/logout`, { headers: { Origin: origin } });
  expect(logout.status()).toBe(200);
  await panel.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?reason=session$/);
  await expect(page.getByText('Confidential synthetic recipient', { exact: true })).toHaveCount(0);
  const [[gate]] = await database.admin.query('SELECT state FROM issuance_migration_gate WHERE id=1');
  expect(gate.state).toBe('blocked');
});
