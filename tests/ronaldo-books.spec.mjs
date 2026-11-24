import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:3116';
const identity = { staffId: 'TEST-001', departmentId: 'TEST-D1', displayName: 'Synthetic RPC reader', departmentName: 'Synthetic department' };
const sha = 'b'.repeat(64);
const credentials = { username: 'synthetic.book', password: 'Synthetic-test-only-42' };
let provider, child, logs, sessions, bookRequests = [], bookOutage = false;
let uniStaffId = 'UNI-PHOTO-001';

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const identitySecret = randomBytes(32).toString('hex'), bookSecret = randomBytes(32).toString('hex');
  provider = createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const book = req.url.startsWith('/api/v1/genbookno/');
    if (req.headers.authorization !== `Bearer ${book ? bookSecret : identitySecret}` || req.headers.origin) return send(403, {});
    if (!book) {
      if (req.url.endsWith('/authenticate') && (body.username !== credentials.username || body.password !== credentials.password)) return send(401, {});
      return send(200, { provider: 'fake', identity });
    }
    bookRequests.push({ path: req.url, body });
    if (bookOutage) return send(503, {});
    if (body.staffId !== identity.staffId) return send(401, {});
    if (req.url.endsWith('/profile')) return send(200, { uniStaffId, email: 'never-forward' });
    if (req.url.endsWith('/history') && !/^\d+$/.test(String(body.page ?? 1))) return send(400, {});
    if (req.url.endsWith('/overview')) return send(200, { readOnly: true, legacyTotal: 1, series: [], departments: [], documents: [], sharedDocuments: [], today: '2026-11-18' });
    if (req.url.endsWith('/search')) return send(200, { documents: [{ kind: 'legacy', snapshot: sha, id: '111', number: 'TEST/0001', numberYear: 2569, type: 'Synthetic', subject: 'SOURCE-ONLY-TITLE', documentDate: '2026-11-18', ownerId: identity.staffId }], total: 1, page: 1, pageSize: 20, hasMore: false, types: ['Synthetic'], years: [2569] });
    if (req.url.endsWith('/detail')) return send(200, { sourceSha256: sha, sourceId: '111', number: 'TEST/0001', numberYear: 2569, subject: 'SOURCE-ONLY-TITLE', documentDate: '2026-11-18', ownerId: identity.staffId, ownerDepartmentId: identity.departmentId, confidential: false, published: false, cancelled: false, pdfPending: true, details: null });
    send(404, {});
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  await mkdir('.local', { recursive: true });
  sessions = path.resolve('.local', `test-ronaldo-books-${randomUUID()}`);
  logs = createWriteStream('.local/ronaldo-books-e2e.log');
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3116'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'development', NEXT_TEST_DIST: 't04', AUTH_PROVIDER: 'central', AUTH_ORIGIN: origin,
      BOOK_DATA_PROVIDER: 'ronaldo', RONALDO_SERVICE_URL: `http://127.0.0.1:${provider.address().port}`, RONALDO_IDENTITY_SECRET: identitySecret,
      RONALDO_GENBOOKNO_SECRET: bookSecret, AUTH_SESSION_DIRECTORY: sessions, ISSUANCE_DATABASE_URL: '' },
  });
  child.stdout.pipe(logs); child.stderr.pipe(logs);
  await expect.poll(async () => { try { return (await fetch(origin + '/login')).status; } catch { return 0; } }, { timeout: 90_000 }).toBe(200);
});

test.afterAll(async () => {
  if (child && child.exitCode === null) {
    // Use the process handle owned by this test. Next closes its server when
    // the launcher's IPC connection ends; the check below verifies closure.
    child.kill();
  }
  await finishCleanup();
});

async function finishCleanup() {
  await expect.poll(async () => { try { await fetch(origin + '/login', { signal: AbortSignal.timeout(1000) }); return true; } catch { return false; } }).toBe(false);
  await new Promise(resolve => provider?.close(resolve)); logs?.end();
  if (sessions && /^test-ronaldo-books-[a-f0-9-]+$/.test(path.relative(path.resolve('.local'), sessions))) await rm(sessions, { recursive: true, force: true });
}

async function login(request) {
  const response = await request.post(origin + '/api/auth/login', { headers: { Origin: origin }, data: credentials });
  expect(response.status()).toBe(200);
  return response.headers()['set-cookie'].split(';')[0];
}

test('anonymous or forged identities cannot query the book source', async ({ request }) => {
  bookRequests = [];
  const result = await request.get(origin + '/api/search?requester=TEST-001', { headers: { 'x-staff-id': identity.staffId, Cookie: 'genbook_session=forged' } });
  expect(result.status()).toBe(401); expect(bookRequests).toHaveLength(0);
  expect((await request.get(origin + '/api/profile', { headers: { Cookie: 'genbook_session=forged', 'x-staff-id': identity.staffId } })).status()).toBe(401);
  expect(bookRequests).toHaveLength(0);
});

test('verified sessions read source search and detail via Ronaldo, with writes closed', async ({ request }) => {
  const cookie = await login(request);
  const headers = { Cookie: cookie, 'x-staff-id': 'forged-admin' };
  const overview = await request.get(origin + '/api/issuance', { headers });
  expect(overview.status()).toBe(200); expect((await overview.json()).readOnly).toBe(true);
  const search = await request.get(origin + '/api/search?q=SOURCE', { headers });
  expect(search.status()).toBe(200); expect((await search.json()).documents[0].subject).toBe('SOURCE-ONLY-TITLE');
  expect(bookRequests.at(-1).body.staffId).toBe(identity.staffId);
  const detail = await request.get(origin + `/api/history?snapshot=${sha}&sourceId=111`, { headers });
  expect(detail.status()).toBe(200); expect((await detail.json()).sourceId).toBe('111');
  expect((await request.get(origin + '/api/search?staffId=forged', { headers })).status()).toBe(400);
  for (const page of ['garbage', 'Infinity']) {
    expect((await request.get(origin + '/api/history?page=' + page, { headers })).status()).toBe(400);
    expect(bookRequests.at(-1).body.page).toBe(page);
  }
  const issue = await request.post(origin + '/api/issuance', { headers: { ...headers, Origin: origin }, data: {} });
  expect(issue.status()).toBe(503); expect((await issue.json()).error).toContain('ยังไม่เปิดใช้งาน');
});

test('browser reads historical records and does not show a misleading issuance permission error', async ({ page }) => {
  await page.goto(origin + '/login');
  await page.getByLabel('ชื่อบัญชี').fill(credentials.username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === '/workspace');
  await expect(page.getByText('SOURCE-ONLY-TITLE', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /^TEST\/0001/ }).click();
  await expect(page).toHaveURL(/\/workspace\/documents\/legacy\/111\?/);
  await expect(page.getByRole('grid')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'รายละเอียดประวัติหนังสือ' })).toContainText('SOURCE-ONLY-TITLE');
  await page.reload();
  await expect(page.getByRole('region', { name: 'รายละเอียดประวัติหนังสือ' })).toContainText('SOURCE-ONLY-TITLE');
  await page.getByRole('link', { name: 'กลับหน้ารายการ', exact: true }).click();
  await expect(page.getByRole('grid')).toContainText('SOURCE-ONLY-TITLE');
  await page.goto(origin + '/workspace/issuance');
  await expect(page.getByText('การขอเลขใหม่และแก้ไขข้อมูลยังไม่เปิดใช้งาน')).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const content = await page.getByRole('region', { name: 'ขอเลขหนังสือ', exact: true }).boundingBox();
    const menu = await page.getByRole('navigation', { name: 'หมวดหมู่งาน' }).getByRole('link').first().boundingBox();
    expect(content.width).toBeLessThanOrEqual(1120);
    expect(Math.abs(content.x - menu.x)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.local/issuance-width-${width}.png`, fullPage: true });
  }
  await expect(page.getByText('ยังไม่มีชุดเลขที่ได้รับสิทธิ์ กรุณาติดต่อผู้ดูแลระบบ')).toHaveCount(0);
  await expect(page.locator('form[aria-busy]')).toHaveCount(0);
});

test('source outage returns unavailable instead of reading the old database', async ({ request }) => {
  const cookie = await login(request); bookOutage = true;
  try { expect((await request.get(origin + '/api/search', { headers: { Cookie: cookie } })).status()).toBe(503); }
  finally { bookOutage = false; }
});

test('header photo uses CENTRAL UNI_STAFF_ID and falls back for missing or failed photos', async ({ page }) => {
  await login(page.request);
  const photoUrl = 'https://apis.eng.psu.ac.th/personnel/v1/photo/UNI-PHOTO-001.jpg';
  let imageStatus = 200;
  await page.route(photoUrl, route => route.fulfill(imageStatus === 200
    ? { status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a98sAAAAASUVORK5CYII=', 'base64') }
    : { status: 404, contentType: 'text/plain', body: 'Not found' }));
  await page.goto(origin + '/workspace');
  const avatar = page.locator('.header-profile .profile-avatar');
  const photo = avatar.locator('img');
  await expect(photo).toHaveAttribute('src', photoUrl);
  await expect.poll(() => photo.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(bookRequests.filter(request => request.path.endsWith('/profile')).at(-1).body.staffId).toBe(identity.staffId);
  const response = await page.request.get(origin + '/api/profile', { headers: { 'x-staff-id': 'FORGED' } });
  expect(await response.json()).toEqual({ uniStaffId: 'UNI-PHOTO-001' });
  await page.screenshot({ path: '.local/header-photo-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(photo).toBeVisible();
  await page.screenshot({ path: '.local/header-photo-mobile.png' });

  imageStatus = 404;
  const failedPhoto = page.waitForResponse(photoUrl);
  await page.reload();
  expect((await failedPhoto).status()).toBe(404);
  await expect(avatar).toHaveText(identity.displayName.slice(0, 1));
  await expect(photo).toHaveCount(0);

  uniStaffId = null;
  try {
    const emptyProfile = page.waitForResponse(origin + '/api/profile');
    await page.reload();
    expect(await (await emptyProfile).json()).toEqual({ uniStaffId: null });
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveText(identity.displayName.slice(0, 1));
    await expect(photo).toHaveCount(0);
  } finally { uniStaffId = 'UNI-PHOTO-001'; }
});

test('profile source outage returns an optional empty photo without blocking the workspace', async ({ page }) => {
  await login(page.request);
  bookOutage = true;
  try {
    const response = await page.request.get(origin + '/api/profile');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(await response.json()).toEqual({ uniStaffId: null });
    await page.goto(origin + '/workspace');
    await expect(page.locator('.header-profile')).toContainText(identity.displayName);
    await expect(page.locator('.header-profile .profile-avatar img')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'ออกจากระบบ', exact: true })).toBeVisible();
  } finally { bookOutage = false; }
});
