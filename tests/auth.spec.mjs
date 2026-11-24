import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { startIdentity } from '../tools/local-auth/provider.mjs';

const origin = 'http://127.0.0.1:3104';
const credentials = { username: 'test.staff', password: 'Synthetic-test-only-42' };
let provider;
let child;
let logs;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  const secret = randomBytes(32).toString('hex');
  const base = { ...credentials, staffId: 'TEST-001', departmentId: 'TEST-D1', displayName: 'ผู้ใช้ทดสอบ', departmentName: 'หน่วยงานทดสอบ', active: true, faculty: true };
  provider = await startIdentity({ secret, ttlMs: 10_000, users: [base,
    { ...base, username: 'inactive', active: false }, { ...base, username: 'external', faculty: false }, { ...base, username: 'no-dept', departmentId: '' },
  ] });
  await mkdir('.local', { recursive: true });
  logs = createWriteStream('.local/t04-e2e-server.log');
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3104'], {
    env: { ...process.env, NODE_ENV: 'development', NEXT_TEST_DIST: 't04', AUTH_PROVIDER: 'local', LOCAL_IDENTITY_URL: provider.url, LOCAL_IDENTITY_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(logs); child.stderr.pipe(logs);
  await expect.poll(async () => { try { return (await fetch(`${origin}/login`)).status; } catch { return 0; } }, { timeout: 90_000 }).toBe(200);
  await fetch(`${origin}/api/me`);
});
test.afterAll(async () => { child?.kill(); await provider?.close(); logs?.end(); });

test('anonymous and forged identity cannot open protected web or HTTP', async ({ request }) => {
  const result = await request.get('/api/me', { headers: { 'x-user-id': 'admin', 'x-role': 'admin', Cookie: 'genbook_session=fake', 'x-dept-id': 'TEST-D1' } });
  expect(result.status()).toBe(401);
  for (const path of ['/workspace', '/workspace/issuance', '/workspace/search', '/workspace/history', '/workspace/profile']) {
    const page = await request.get(path, { maxRedirects: 0 });
    // With streaming Server Components the redirect may be carried in the HTML.
    expect([200, 307]).toContain(page.status());
    if (page.status() === 200) expect(await page.text()).toContain('/login?reason=session');
    else expect(page.headers().location).toContain('/login');
  }
});

test('credentials, eligibility, malformed input and cross-origin calls are rejected', async ({ request }) => {
  for (const username of ['unknown', 'inactive', 'external', 'no-dept']) {
    expect((await request.post('/api/auth/login', { headers: { Origin: origin }, data: { ...credentials, username } })).status()).toBe(401);
  }
  expect((await request.post('/api/auth/login', { headers: { Origin: origin }, data: { ...credentials, password: 'wrong' } })).status()).toBe(401);
  expect((await request.post('/api/auth/login', { headers: { Origin: origin }, data: { username: { role: 'admin' } } })).status()).toBe(400);
  expect((await request.post('/api/auth/login', { headers: { Origin: 'https://example.com' }, data: credentials })).status()).toBe(403);
});

test('HTTP session rotates, rejects cross-origin logout and is revoked on logout', async ({ request }) => {
  const login = () => request.post('/api/auth/login', { headers: { Origin: origin }, data: credentials });
  const first = await login(); expect(first.status()).toBe(200);
  const oldCookie = first.headers()['set-cookie'].split(';')[0];
  expect(first.headers()['set-cookie']).toMatch(/HttpOnly/i);
  expect(first.headers()['set-cookie']).toMatch(/SameSite=lax/i);
  const second = await login(); expect(second.status()).toBe(200);
  const cookie = second.headers()['set-cookie'].split(';')[0];
  expect(cookie).not.toBe(oldCookie);
  expect((await request.get('/api/me', { headers: { Cookie: oldCookie } })).status()).toBe(401);
  const me = await request.get('/api/me', { headers: { Cookie: cookie } });
  expect(me.status()).toBe(200); expect(me.headers()['cache-control']).toContain('no-store');
  expect((await me.json()).identity).toEqual({ staffId: 'TEST-001', displayName: 'ผู้ใช้ทดสอบ', departmentId: 'TEST-D1', departmentName: 'หน่วยงานทดสอบ' });
  expect((await request.post('/api/auth/logout', { headers: { Origin: 'https://example.com', Cookie: cookie } })).status()).toBe(403);
  expect((await request.get('/api/me', { headers: { Cookie: cookie } })).status()).toBe(200);
  expect((await request.post('/api/auth/logout', { headers: { Origin: origin, Cookie: cookie } })).status()).toBe(200);
  expect((await request.get('/api/me', { headers: { Cookie: cookie } })).status()).toBe(401);
});

test('absolute expiry rejects the original cookie and redirects in browser', async ({ request, page, context }) => {
  const login = await request.post('/api/auth/login', { headers: { Origin: origin }, data: credentials });
  const cookie = login.headers()['set-cookie'].split(';')[0];
  await context.addCookies([{ name: 'genbook_session', value: cookie.split('=')[1], url: origin }]);
  await expect.poll(async () => (await request.get('/api/me', { headers: { Cookie: cookie } })).status(), { timeout: 15_000, intervals: [1000] }).toBe(401);
  await page.goto('/workspace'); await expect(page).toHaveURL(/\/login\?reason=session/);
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('mobile keyboard login, loading, errors, identity and logout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/login');
  await expect(page.getByLabel('ชื่อบัญชี')).toBeVisible();
  await page.screenshot({ path: '.local/t04-desktop-login.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await expect(page.getByLabel('ชื่อบัญชี')).toBeVisible();
  await page.screenshot({ path: '.local/t04-mobile-login.png', fullPage: true });
  await page.getByLabel('ชื่อบัญชี').fill(credentials.username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill('wrong');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/auth/login', async (route) => { await gate; await route.continue(); }, { times: 1 });
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await expect(page.getByRole('button', { name: 'กำลังเข้าสู่ระบบ…' })).toBeDisabled();
  release();
  await expect(page.getByRole('alert').filter({ hasText: 'ไม่ถูกต้อง' })).toBeVisible();
  const errorPopup = page.getByRole('alertdialog');
  await expect(errorPopup).toBeVisible();
  await expect(errorPopup.getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true })).toBeFocused();
  // Native dialog focus may first move to Chromium chrome; the background stays inert.
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('ชื่อบัญชี')).not.toBeFocused();
  await expect(page.getByLabel('รหัสผ่าน', { exact: true })).not.toBeFocused();
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true })).not.toBeFocused();
  await page.keyboard.press('Tab');
  await expect(errorPopup.getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(errorPopup).toHaveCount(0);
  // This suite exercises authentication/navigation without a database server.
  await page.route('**/api/issuance', route => route.fulfill({ status: 200, json: { series: [{ id: 'AUTH-NAV', label: 'Synthetic navigation fixture', prefix: 'TEST' }], documents: [], sharedDocuments: [], departments: [], today: '2026-11-13' } }));
  await page.route('**/api/search?**', route => route.fulfill({ json: { documents: [], total: 0, page: 1, hasMore: false, types: [] } }));
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(credentials.password);
  await page.getByLabel('รหัสผ่าน', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/workspace$/);
  const navigation = page.getByRole('navigation', { name: 'หมวดหมู่งาน' });
  await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute('href', '/workspace');
  await expect(navigation.getByRole('link')).toHaveCount(2);
  await expect(navigation.getByRole('link', { name: 'หน้าหลัก', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'หน้าออกเลขเอกสาร', exact: true })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="search-heading"]')).toBeVisible();
  await expect(page.getByText('พบ 0 รายการ · หน้า 1')).toBeVisible();
  await expect(page.locator('a[href="/workspace/profile"]')).toHaveCount(0);
  await expect(page.locator('.header-profile')).toContainText('ผู้ใช้ทดสอบ');
  await expect(page.locator('.header-profile')).not.toContainText('หน่วยงานทดสอบ');
  await expect(page.locator('.workspace-header')).not.toContainText('คณะวิศวกรรมศาสตร์');
  await navigation.getByRole('link', { name: 'หน้าออกเลขเอกสาร', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/issuance$/);
  await expect(navigation.locator('a[aria-current="page"]')).toHaveAttribute('href', '/workspace/issuance');
  await expect(page.locator('section[aria-labelledby="issuance-heading"]')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'เลขหนังสือ', exact: true })).toHaveValue('AUTH-NAV');
  await expect(page.getByRole('radio', { name: 'ไม่เผยแพร่', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'ไม่ลับ', exact: true })).toBeChecked();
  await expect(page.getByLabel('วันที่', { exact: true })).toHaveAttribute('readonly', '');
  const fieldOrder = await page.locator('.issuance-card--form [id]').evaluateAll(elements => elements.map(element => element.id));
  expect(fieldOrder.indexOf('seriesId')).toBeLessThan(fieldOrder.indexOf('issuance-mode'));
  const orderedFields = ['seriesId', 'issuance-mode', 'unpublished', 'non-confidential', 'document-date', 'subject', 'recipient-0', 'target-external', 'signer', 'requester'];
  for (const id of orderedFields) expect(fieldOrder).toContain(id);
  for (let index = 1; index < orderedFields.length; index++) expect(fieldOrder.indexOf(orderedFields[index - 1])).toBeLessThan(fieldOrder.indexOf(orderedFields[index]));
  await page.getByLabel('ผู้รับ 1', { exact: true }).fill('ผู้รับที่คงไว้');
  await page.getByRole('button', { name: 'เพิ่มผู้รับ', exact: true }).click();
  await page.getByLabel('ผู้รับ 2', { exact: true }).fill('ผู้รับที่จะลบ');
  await page.getByRole('button', { name: 'ลบผู้รับ 2', exact: true }).click();
  await expect(page.getByLabel('ผู้รับ 2', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('ผู้รับ 1', { exact: true })).toHaveValue('ผู้รับที่คงไว้');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/t04-mobile-workspace.png', fullPage: true });
  await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?loggedOut=1/);
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.goto('/workspace'); await expect(page).toHaveURL(/\/login\?reason=session/);
});

test('provider outage fails closed and logout does not claim success', async ({ request }) => {
  const login = await request.post('/api/auth/login', { headers: { Origin: origin }, data: credentials });
  const cookie = login.headers()['set-cookie'].split(';')[0];
  await provider.close();
  expect((await request.get('/api/me', { headers: { Cookie: cookie } })).status()).toBe(401);
  expect((await request.post('/api/auth/login', { headers: { Origin: origin }, data: credentials })).status()).toBe(503);
  expect((await request.post('/api/auth/logout', { headers: { Origin: origin, Cookie: cookie } })).status()).toBe(503);
});
