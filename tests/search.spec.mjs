import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { startIdentity } from '../tools/local-auth/provider.mjs';
import { startDatabase } from '../tools/issuance/database.mjs';

registerHooks({ resolve(specifier, context, next) {
  if (specifier === './input' && context.parentURL?.endsWith('/lib/issuance/search.ts')) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
const { parseSearch } = await import('../lib/issuance/search.ts');

const origin = 'http://127.0.0.1:3111', password = 'Synthetic-T08-only-42', snapshot = 'b'.repeat(64);
let database, provider, child, logs, sequence;
async function login(request, username = 'owner') {
  const response = await request.post(origin + '/api/auth/login', { headers: { Origin: origin, Cookie: '' }, data: { username, password } });
  expect(response.status(), await response.text()).toBe(200);
  return response.headers()['set-cookie'].split(';')[0];
}
async function search(request, cookie, params = {}) {
  const response = await request.get(`${origin}/api/search?${new URLSearchParams(params)}`, { headers: { Cookie: cookie } });
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  return response.json();
}
async function seed(overrides = {}) {
  const n = ++sequence;
  const row = { id: randomUUID(), legacy: false, owner: 'TEST-001', department: '204', series: 'TEST-S1', year: 2568, main: n, sub: 0, prefix: 'ค้นหา', date: '2025-04-05', subject: `หนังสือค้นหา ${n}`, confidential: false, published: false, cancelled: false, ...overrides };
  if (row.legacy) {
    row.id = String(n);
    await database.admin.query('INSERT INTO legacy_documents(source_sha256,source_id,owner_id,owner_department_id,series_id,number_year,main_number,sub_number,prefix,subject,document_date,confidential,published,cancelled,pdf_pending) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,FALSE)', [snapshot, row.id, row.owner, row.department, row.series, row.year, row.main, row.sub, row.prefix, row.subject, row.date, row.confidential, row.published, row.cancelled]);
  } else {
    await database.admin.query(`INSERT INTO issuance_documents(id,owner_id,owner_department_id,request_key,payload_hash,series_id,number_year,main_number,sub_number,prefix,document_date,issued_at,subject,recipients,recipient_department_ids,external_organization,signer,confidential,published) VALUES (?,?,?,?,?,?,?,?,?,?,?,'2025-04-04 17:00:00',?,'["ผู้รับ"]','[]','องค์กรทดสอบ','ผู้ลงนาม',?,?)`, [row.id, row.owner, row.department, randomUUID(), 'c'.repeat(64), row.series, row.year, row.main, row.sub, row.prefix, row.date, row.subject, row.confidential, row.published]);
  }
  return row;
}

test.beforeAll(async () => {
  test.setTimeout(120000);
  database = await startDatabase({ port: 3325 });
  const secret = randomBytes(32).toString('hex');
  provider = await startIdentity({ secret, ttlMs: 600000, users: ['owner', 'peer', 'outsider'].map((username, index) => ({ username, password, staffId: `TEST-00${index + 1}`, displayName: username, departmentId: index === 2 ? 'TEST-D1' : '204', departmentName: 'หน่วยงานทดสอบ', active: true, faculty: true })) });
  await mkdir('.local', { recursive: true });
  logs = createWriteStream('.local/t08-e2e-server.log');
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3111'], { windowsHide: true, env: { ...process.env, NODE_ENV: 'development', NEXT_TEST_DIST: 't08', AUTH_PROVIDER: 'local', LOCAL_IDENTITY_URL: provider.url, LOCAL_IDENTITY_SECRET: secret, ISSUANCE_DATABASE_URL: database.url }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(logs); child.stderr.pipe(logs);
  await expect.poll(async () => { try { return (await fetch(origin + '/login')).status; } catch { return 0; } }, { timeout: 90000 }).toBe(200);
});
test.afterAll(async () => { child?.kill(); await provider?.close(); await database?.close(); logs?.end(); });
test.beforeEach(async () => {
  sequence = 0;
  await database.admin.query('DELETE FROM issuance_audit; DELETE FROM issuance_documents; DELETE FROM legacy_documents; DELETE FROM legacy_dispositions; DELETE FROM legacy_number_reservations; DELETE FROM legacy_staging; DELETE FROM legacy_batches; UPDATE issuance_series SET enabled=TRUE; UPDATE issuance_grants SET active=TRUE');
  await database.admin.query('INSERT INTO legacy_batches(source_sha256,manifest_sha256,report) VALUES (?,?,?)', [snapshot, snapshot, '{}']);
  await database.admin.query("UPDATE issuance_series SET document_type='หนังสือทั่วไป' WHERE id='TEST-S1'; UPDATE issuance_series SET document_type='คำสั่ง' WHERE id='TEST-S2'");
});

test('each main filter and combined filters preserve stored Buddhist year, literal subnumber, inclusive dates and disabled series', async ({ request }) => {
  const cookie = await login(request);
  const target = await seed({ year: 2560, main: 42, sub: 10, subject: "ประชุม %_ ' ทดสอบ", owner: 'TEST-002' });
  await seed({ series: 'TEST-S2', year: 2561, date: '2025-04-06', subject: 'อีกเรื่อง' });
  await database.admin.query("UPDATE issuance_series SET enabled=FALSE WHERE id='TEST-S1'; UPDATE issuance_grants SET active=FALSE");
  for (const params of [{ year: '2560' }, { type: 'หนังสือทั่วไป' }, { number: '0042.10' }, { subject: "%_ '" }, { requester: 'TEST-002' }, { from: '2025-04-05', to: '2025-04-05' }, { year: '2560', type: 'หนังสือทั่วไป', number: 'ค้นหา/0042.10', subject: 'ประชุม', requester: 'TEST-002', from: '2025-04-05', to: '2025-04-05' }]) {
    const result = await search(request, cookie, params);
    expect(result.total, JSON.stringify(params)).toBe(1);
    expect(result.documents[0]).toMatchObject({ id: target.id, numberYear: 2560, number: 'ค้นหา/0042.10' });
  }
  expect((await search(request, cookie, { from: '2025-04-06' })).total).toBe(1);
  expect((await search(request, cookie, { to: '2025-04-04' })).total).toBe(0);
  expect((await search(request, cookie, { subject: "' OR 1=1 --" })).total).toBe(0);
  expect((await search(request, cookie, { requester: 'TEST-00' })).total).toBe(0);
});

test('authorization matrix protects rows totals type choices and both detail endpoints', async ({ request }) => {
  const owner = await login(request), peer = await login(request, 'peer'), outsider = await login(request, 'outsider');
  const fixtures = [];
  for (const legacy of [false, true]) for (const confidential of [false, true]) for (const published of [false, true]) fixtures.push(await seed({ legacy, confidential, published }));
  // A type belonging exclusively to confidential documents must never leak.
  await seed({ confidential: true, series: 'TEST-S2' });
  const own = await search(request, owner), same = await search(request, peer), other = await search(request, outsider);
  expect(own.total).toBe(9); expect(same.total).toBe(4); expect(other.total).toBe(2);
  expect(same.types).toEqual(['หนังสือทั่วไป']); expect(other.types).toEqual(['หนังสือทั่วไป']);
  for (const [cookie, visible] of [[peer, fixtures.filter(row => !row.confidential)], [outsider, fixtures.filter(row => !row.confidential && row.published)]]) {
    const result = await search(request, cookie);
    expect(result.documents.map(row => row.id).sort()).toEqual(visible.map(row => row.id).sort());
    for (const row of fixtures) {
      const url = row.legacy ? `/api/history?${new URLSearchParams({ snapshot, sourceId: row.id })}` : `/api/issuance/${row.id}`;
      const response = await request.get(origin + url, { headers: { Cookie: cookie } });
      expect(response.status()).toBe(visible.includes(row) ? 200 : 404);
      if (response.ok()) expect(await response.json()).not.toHaveProperty('audit');
    }
  }
  expect((await search(request, outsider, { type: 'คำสั่ง' })).total).toBe(0);
});

test('bounded stable pages exclude hidden rows from counts and retain distinct cancelled legacy history', async ({ request }) => {
  const cookie = await login(request, 'peer');
  for (let i = 0; i < 45; i++) await seed({ confidential: true, date: '2026-01-01' });
  for (let i = 0; i < 25; i++) await seed({ legacy: i % 2 === 0, cancelled: true });
  const one = await search(request, cookie), two = await search(request, cookie, { page: '2' });
  expect(one).toMatchObject({ total: 25, page: 1, pageSize: 20, hasMore: true });
  expect(one.documents).toHaveLength(20); expect(two.documents).toHaveLength(5); expect(two.hasMore).toBe(false);
  expect(new Set([...one.documents, ...two.documents].map(row => `${row.kind}:${row.snapshot}:${row.id}`)).size).toBe(25);
  expect((await search(request, cookie)).documents).toEqual(one.documents);
  expect((await search(request, cookie, { page: '10000' }))).toMatchObject({ total: 25, documents: [], hasMore: false });
  const legacy = one.documents.find(row => row.kind === 'legacy');
  const response = await request.get(`${origin}/api/history?${new URLSearchParams({ snapshot, sourceId: legacy.id })}`, { headers: { Cookie: cookie } });
  expect((await response.json()).cancelled).toBe(true);
});

test('rejects malformed duplicate unknown and overlong input; accepts leap date; requires session', async ({ request }) => {
  const cookie = await login(request);
  // Next normalizes __proto__ out of request URLs before the route runs. Exercise
  // the raw parser too, so the allowlist remains safe independently of Next.
  for (const key of ['constructor', 'toString', '__proto__']) expect(() => parseSearch(new URLSearchParams(`${key}=x`))).toThrow('ตัวกรองไม่ถูกต้อง');
  for (const query of ['constructor=x', 'toString=x', 'page=0', 'page=10001', 'page=1.5', 'page=01', 'year=202', 'year=abcd', 'from=2025-02-29', 'to=2024-04-31', 'from=0000-01-01', 'from=2025-04-06&to=2025-04-05', 'year=2568&year=2569', 'owner=TEST-001', 'q=one&q=two', `q=${'x'.repeat(201)}`, `subject=${'x'.repeat(201)}`, `requester=${'x'.repeat(65)}`, `type=${'x'.repeat(101)}`, `number=${'x'.repeat(101)}`]) {
    const response = await request.get(`${origin}/api/search?${query}`, { headers: { Cookie: cookie } });
    expect(response.status(), query).toBe(400);
  }
  expect((await search(request, cookie, { from: '2024-02-29', to: '2024-02-29' })).total).toBe(0);
  const response = await request.get(origin + '/api/search', { headers: { Cookie: '' } });
  expect(response.status()).toBe(401); expect(response.headers()['cache-control']).toContain('no-store');
});

test('raw restricted history and reservations never contribute; historical duplicates remain separate', async ({ request }) => {
  const cookie = await login(request);
  await database.admin.query('INSERT INTO legacy_staging(source_sha256,source_table,source_id,payload) VALUES (?,\'genbook\',\'900\',?)', [snapshot, JSON.stringify({ subject: 'ข้อมูลเก็บแยก', owner_id: 'TEST-001', confidential: false, published: true })]);
  await database.admin.query("INSERT INTO legacy_dispositions(source_sha256,source_table,source_id,handling,reasons) VALUES (?,'genbook','900','restricted','[]')", [snapshot]);
  await database.admin.query("INSERT INTO legacy_number_reservations(source_sha256,source_id,legacy_series_id,number_year,main_number,series_reference_present) VALUES (?,'900','00001',2568,999,TRUE)", [snapshot]);
  expect((await search(request, cookie))).toMatchObject({ documents: [], total: 0, types: [] });
  await seed({ legacy: true, main: 42 }); await seed({ legacy: true, main: 42 });
  const result = await search(request, cookie, { number: '0042' });
  expect(result.total).toBe(2); expect(result.documents[0].id).not.toBe(result.documents[1].id);
});

test('browser filters keyboard pagination details mobile layout and permission revocation', async ({ page }) => {
  await seed({ subject: 'เป้าหมายค้นหา', main: 42, sub: 2, published: true });
  for (let i = 0; i < 21; i++) await seed({ subject: `แบ่งหน้า ${i}`, published: true });
  await login(page.request, 'outsider');
  await page.goto(origin + '/workspace/search');
  await expect(page).toHaveURL(url => url.pathname === '/workspace');
  const panel = page.getByRole('region', { name: 'รายละเอียดจากผลค้นหา' });
  const section = page.locator('section[aria-labelledby="search-heading"]');
  await expect(section.getByText('พบ 22 รายการ · หน้า 1')).toBeVisible();
  await expect(section.getByLabel('ปีเลข (พ.ศ.)')).toHaveValue('');
  await expect(section.getByLabel('ประเภทหนังสือ', { exact: true })).not.toBeVisible();
  await expect(section.getByLabel('ปีเลข (พ.ศ.)').locator('option')).toHaveText(['ทุกปี', '2568']);
  await section.getByRole('button', { name: 'ผลค้นหาหน้าถัดไป' }).click();
  await expect(section.getByText('พบ 22 รายการ · หน้า 2')).toBeVisible();
  await section.getByLabel('เลขหนังสือหรือชื่อเรื่อง', { exact: true }).fill('เป้าหมาย');
  await expect(section.getByText('พบ 22 รายการ · หน้า 2')).toBeVisible();
  await section.getByRole('button', { name: /^ตัวกรอง/ }).click();
  await section.getByLabel('ปีเลข (พ.ศ.)').selectOption('2568');
  await section.getByLabel('เลขหนังสือหรือชื่อเรื่อง', { exact: true }).fill('0042.2');
  await section.getByLabel('วันที่หนังสือตั้งแต่').fill('2025-04-05');
  await section.getByLabel('วันที่หนังสือถึง').fill('2025-04-05');
  await section.getByLabel('ผู้ขอเลข (รหัสบุคลากรตรงตัว)').fill('TEST-001');
  await section.getByLabel('ประเภทหนังสือ', { exact: true }).selectOption({ label: 'หนังสือทั่วไป' });
  await section.getByRole('button', { name: 'ใช้ตัวกรอง', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(section.getByText('พบ 1 รายการ · หน้า 1')).toBeVisible();
  const button = section.getByRole('button', { name: /^ค้นหา\/0042.2/ });
  await button.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/workspace\/documents\/issuance\//);
  await expect(section).not.toBeVisible();
  await expect(panel.getByText('เป้าหมายค้นหา')).toBeVisible();
  await expect(panel.getByText(/Asia\/Bangkok/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/t08-search-mobile.png', fullPage: true });
  await database.admin.query('UPDATE issuance_documents SET confidential=TRUE');
  await page.reload();
  await expect(page.locator('section[aria-labelledby="document-page-heading"]').getByRole('alert')).toContainText('ไม่พบ');
  await expect(panel).toHaveCount(0);
  await page.getByRole('link', { name: 'กลับหน้ารายการ', exact: true }).click();
  await section.getByRole('button', { name: /^ตัวกรอง/ }).click();
  await section.getByRole('button', { name: 'ล้างตัวกรอง' }).click();
  await expect(section.getByText('พบ 0 รายการ · หน้า 1')).toBeVisible();
  await expect(section.getByLabel('เลขหนังสือหรือชื่อเรื่อง', { exact: true })).toHaveValue('');
  await expect(section.getByLabel('ปีเลข (พ.ศ.)')).toHaveValue('');
});

test('browser announces loading and search errors after returning from a detail page and retries', async ({ page }) => {
  await seed({ subject: 'โหลดทดสอบ' }); await login(page.request);
  await page.goto(origin + '/workspace/search');
  await expect(page).toHaveURL(url => url.pathname === '/workspace');
  const section = page.locator('section[aria-labelledby="search-heading"]');
  await section.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
  await section.getByRole('button', { name: /^ค้นหา\/0001/ }).click();
  await expect(page.getByRole('region', { name: 'รายละเอียดจากผลค้นหา' })).toBeVisible();
  await page.getByRole('link', { name: 'กลับหน้ารายการ', exact: true }).click();
  await expect(section.getByText('พบ 1 รายการ · หน้า 1')).toBeVisible();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/search?**', async route => { await gate; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'ค้นหาไม่สำเร็จ กรุณาลองใหม่' }) }); });
  await section.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
  await expect(section.getByRole('status')).toHaveText('กำลังโหลดผลค้นหา…');
  await expect(section.getByRole('region', { name: 'รายละเอียดจากผลค้นหา' })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true })).toBeDisabled();
  release();
  await expect(section.getByRole('alert')).toContainText('ค้นหาไม่สำเร็จ');
  await page.getByRole('alertdialog').getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  await page.unroute('**/api/search?**');
  await section.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
  await expect(section.getByText('พบ 1 รายการ · หน้า 1')).toBeVisible();
});

test('browser opens a legacy result and removes it after its permission is revoked', async ({ page }) => {
  const document = await seed({ legacy: true, cancelled: true, subject: 'ประวัติจากผลค้นหา', published: true });
  await login(page.request, 'outsider'); await page.goto(origin + '/workspace/search');
  await expect(page).toHaveURL(url => url.pathname === '/workspace');
  const section = page.locator('section[aria-labelledby="search-heading"]');
  await section.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
  await section.getByRole('button', { name: /^ค้นหา\/0001/ }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/documents/legacy/${document.id}\\?`));
  const detail = page.getByRole('region', { name: 'รายละเอียดประวัติหนังสือ' });
  await expect(detail).toContainText('ประวัติจากผลค้นหา');
  await expect(detail).toContainText('ยกเลิก');
  await expect(detail).toContainText(document.id);
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await detail.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('1px');
    expect(await detail.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)');
    const paper = await detail.boundingBox();
    expect(paper.width).toBeLessThanOrEqual(880);
    expect(Math.abs(paper.x - (width - paper.width) / 2)).toBeLessThanOrEqual(1);
    expect(await detail.locator('dl').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(width > 760 ? 2 : 1);
    await page.screenshot({ path: `.local/legacy-detail-${name}.png`, fullPage: true });
  }
  await database.admin.query('UPDATE legacy_documents SET confidential=TRUE');
  await page.reload();
  await expect(page.locator('section[aria-labelledby="document-page-heading"]').getByRole('alert')).toContainText('ไม่พบ');
  await expect(detail).toHaveCount(0);
});


test('Home loads unified readable history immediately and clearing criteria restores latest documents', async ({ page }) => {
  await seed({ subject: 'หนังสือปัจจุบันล่าสุด', date: '2026-05-01' });
  await seed({ legacy: true, subject: 'ประวัติเดิมที่อ่านได้', date: '2025-04-05' });
  await seed({ owner: 'TEST-002', confidential: true, subject: 'หนังสือลับผู้อื่น', date: '2026-06-01' });
  await login(page.request);
  await page.goto(origin + '/workspace');
  const section = page.locator('section[aria-labelledby="search-heading"]');
  await expect(section.getByText('พบ 2 รายการ · หน้า 1')).toBeVisible();
  const rows = section.getByRole('grid').getByRole('row');
  await expect(rows.nth(1)).toContainText('หนังสือปัจจุบันล่าสุด');
  await expect(rows.nth(2)).toContainText('ประวัติเดิมที่อ่านได้');
  await expect(section).not.toContainText('หนังสือลับผู้อื่น');
  await section.getByLabel('เลขหนังสือหรือชื่อเรื่อง', { exact: true }).fill('ประวัติเดิม');
  await section.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
  await expect(section.getByText('พบ 1 รายการ · หน้า 1')).toBeVisible();
  await section.getByRole('button', { name: /^ตัวกรอง/ }).click();
  await section.getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click();
  await expect(section.getByLabel('เลขหนังสือหรือชื่อเรื่อง', { exact: true })).toHaveValue('');
  await expect(section.getByText('พบ 2 รายการ · หน้า 1')).toBeVisible();
  await page.goto(origin + '/workspace/history');
  await expect(page).toHaveURL(url => url.pathname === '/workspace');
  await expect(section.getByText('พบ 2 รายการ · หน้า 1')).toBeVisible();
});

// Query branches must remain grouped inside the server-side visibility rule.
test('combined query matches number or subject and year choices never disclose unreadable history', async ({ request }) => {
  const cookie = await login(request, 'outsider');
  const numberMatch = await seed({ prefix: 'bridge', year: 2568, main: 42, published: true, subject: 'number branch' });
  const subjectMatch = await seed({ legacy: true, year: 2560, published: true, subject: 'subject bridge branch' });
  await seed({ year: 2568, published: true, subject: 'unrelated' });
  await seed({ year: 2559, series: 'TEST-S2', prefix: 'bridge', confidential: true, published: true });
  await seed({ legacy: true, year: 2557, subject: 'bridge', confidential: true, published: true });
  await seed({ year: 2558, subject: 'bridge', published: false });
  const result = await search(request, cookie, { q: ' bridge ' });
  expect(result.documents.map(row => row.id).sort()).toEqual([numberMatch.id, subjectMatch.id].sort());
  expect(result.total).toBe(2);
  expect(result.years).toEqual([2568, 2560]);
  expect(result.types).toEqual(['หนังสือทั่วไป']);
  const scoped = await search(request, cookie, { q: 'bridge', year: '2560', type: 'หนังสือทั่วไป' });
  expect(scoped.documents.map(row => row.id)).toEqual([subjectMatch.id]);
  expect(scoped.years).toEqual([2568, 2560]);
  expect((await search(request, cookie, { q: 'bridge', year: '2568' })).documents.map(row => row.id)).toEqual([numberMatch.id]);
  expect((await search(request, cookie, { q: 'no-match' }))).toMatchObject({ total: 0, years: [2568, 2560] });
  expect((await search(request, cookie, { q: '   ' })).total).toBe(3);
});

test('combined query retains literal matching and validates its length', async ({ request }) => {
  const cookie = await login(request);
  await seed({ subject: "literal %_ ' text", main: 42, sub: 10 });
  await seed({ legacy: true, year: 2567, subject: 'ordinary' });
  expect((await search(request, cookie, { q: "%_ '" })).total).toBe(1);
  expect((await search(request, cookie, { q: '0042.10' })).total).toBe(1);
  expect((await search(request, cookie, { q: "' OR 1=1 --" })).total).toBe(0);
  expect((await search(request, cookie, { q: 'x'.repeat(200) })).total).toBe(0);
  for (const query of [`q=${'x'.repeat(201)}`, 'q=a&q=b']) {
    expect((await request.get(`${origin}/api/search?${query}`, { headers: { Cookie: cookie } })).status()).toBe(400);
  }
  expect(parseSearch(new URLSearchParams({ q: '  bridge  ' })).q).toBe('bridge');
});

test('year choice remains explicit when access changes and compact search fits desktop and mobile', async ({ page }) => {
  await seed({ year: 2560, published: true });
  await login(page.request, 'outsider');
  await page.goto(origin + '/workspace');
  const section = page.locator('section[aria-labelledby="search-heading"]');
  const year = section.getByLabel('ปีเลข (พ.ศ.)');
  await expect(section.getByText('พบ 1 รายการ · หน้า 1')).toBeVisible();
  await expect(section.getByRole('button', { name: /^ตัวกรอง/ })).toHaveAttribute('aria-expanded', 'false');
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await section.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await section.screenshot({ path: `.local/compact-search-${name}.png` });
  }
  await section.getByRole('button', { name: /^ตัวกรอง/ }).click();
  await year.selectOption('2560');
  await section.getByRole('button', { name: 'ใช้ตัวกรอง', exact: true }).click();
  await expect(section.getByText('พบ 1 รายการ · หน้า 1')).toBeVisible();
  await database.admin.query('UPDATE issuance_documents SET confidential=TRUE');
  await section.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
  await expect(section.getByText('พบ 0 รายการ · หน้า 1')).toBeVisible();
  await section.getByRole('button', { name: /^ตัวกรอง/ }).click();
  await expect(year).toHaveValue('2560');
  await expect(year.locator('option:checked')).toHaveText('2560 (ไม่พบรายการที่อ่านได้)');
  await expect(year.locator('option:checked')).toBeDisabled();
  await section.getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click();
  await expect(year).toHaveValue('');
  await expect(year.locator('option')).toHaveText(['ทุกปี']);
});

test('search shows four columns, Buddhist dates, aligned compact layout and an issuance shortcut', async ({ page }) => {
  await seed({ subject: 'วันที่ล่าสุด', date: '2026-11-18', year: 2560 });
  await seed({ legacy: true, subject: 'วันที่ก่อนหน้า', date: '2025-12-31' });
  await login(page.request);
  await page.goto(origin + '/workspace');
  const section = page.getByRole('region', { name: 'ค้นหาหนังสือตามสิทธิ์', exact: true });
  const grid = section.getByRole('grid');
  await expect(grid.getByRole('columnheader')).toHaveCount(4);
  for (const name of ['เลขหนังสือ / ปี', 'วันที่หนังสือ', 'เรื่อง', 'รายละเอียด']) {
    await expect(grid.getByRole('columnheader', { name, exact: true })).toBeVisible();
  }
  await expect(grid.getByRole('row').nth(1)).toContainText('18-11-2569');
  await expect(grid.getByRole('row').nth(1)).toContainText('ปี 2560');
  await grid.getByRole('columnheader', { name: 'วันที่หนังสือ', exact: true }).click();
  await expect(grid.getByRole('row').nth(1)).toContainText('31-12-2568');
  const issue = section.getByRole('link', { name: 'ออกเลขหนังสือ', exact: true });
  await expect(issue).toHaveAttribute('href', '/workspace/issuance');
  await expect(page.getByRole('navigation', { name: 'หมวดหมู่งาน' }).getByRole('link')).toHaveCount(2);
  for (const width of [1440, 1200, 1024, 937, 760, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const content = await section.boundingBox();
    const menu = await page.getByRole('navigation', { name: 'หมวดหมู่งาน' }).getByRole('link').first().boundingBox();
    expect(content.width).toBeLessThanOrEqual(1120);
    expect(Math.abs(content.x - menu.x)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(issue).toBeVisible();
    const action = await issue.boundingBox();
    const filters = await section.locator('.search-command-bar').boundingBox();
    expect(action.y + action.height).toBeLessThanOrEqual(filters.y);
    if (width > 760) {
      const heading = await section.getByRole('heading', { level: 1 }).boundingBox();
      expect(action.y).toBeLessThanOrEqual(heading.y + heading.height);
    }
    if ([1440, 937, 390].includes(width)) await page.screenshot({ path: `.local/search-ui-${width}.png`, fullPage: true });
  }
  await issue.click();
  await expect(page).toHaveURL(url => url.pathname === '/workspace/issuance');
});

test('AG Grid sorts all readable results, preserves sorting across pages and supports resizing', async ({ page }) => {
  for (let index = 0; index < 25; index++) await seed({ subject: `Grid ${String(index).padStart(2, '0')}`, main: index + 1 });
  await seed({ subject: 'Grid hidden', owner: 'TEST-002', confidential: true });
  await login(page.request);
  await page.goto(origin + '/workspace');
  const section = page.locator('section[aria-labelledby="search-heading"]');
  const grid = section.getByRole('grid');
  await expect(grid).toBeVisible();
  await expect(section.getByText('พบ 25 รายการ · หน้า 1')).toBeVisible();
  await grid.getByRole('columnheader', { name: 'เรื่อง', exact: true }).click();
  await expect(grid.getByRole('row').nth(1)).toContainText('Grid 00');
  await section.getByRole('button', { name: 'ผลค้นหาหน้าถัดไป' }).click();
  await expect(section.getByText('พบ 25 รายการ · หน้า 2')).toBeVisible();
  await expect(grid.getByRole('row').nth(1)).toContainText('Grid 20');
  await grid.getByRole('columnheader', { name: 'เรื่อง', exact: true }).click();
  await expect(section.getByText('พบ 25 รายการ · หน้า 1')).toBeVisible();
  await expect(grid.getByRole('row').nth(1)).toContainText('Grid 24');
  const header = grid.getByRole('columnheader', { name: 'เลขหนังสือ / ปี', exact: true });
  const before = await header.boundingBox();
  const handle = await header.locator('.ag-header-cell-resize').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down(); await page.mouse.move(handle.x + 70, handle.y + handle.height / 2); await page.mouse.up();
  expect((await header.boundingBox()).width).toBeGreaterThan(before.width + 40);
  const resizedWidth = (await header.boundingBox()).width;
  await section.getByRole('button', { name: 'ผลค้นหาหน้าถัดไป' }).click();
  await expect(grid.getByRole('row').nth(1)).toContainText('Grid 04');
  expect((await header.boundingBox()).width).toBe(resizedWidth);
  await section.getByRole('button', { name: 'ผลค้นหาหน้าก่อน' }).click();
  await expect(grid.getByRole('row').nth(1)).toContainText('Grid 24');
  expect(await grid.locator('.ag-cell').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  await expect(page.locator('.workspace-header')).not.toContainText('คณะวิศวกรรมศาสตร์');
  await expect(page.locator('.header-profile small')).toHaveCount(0);
  await page.screenshot({ path: '.local/ag-grid-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/ag-grid-mobile.png', fullPage: true });
});

test('keyboard detail navigation and back restore query filters page size sorting and page after reload', async ({ page }) => {
  for (let index = 0; index < 53; index++) await seed({ subject: `Return ${String(index).padStart(2, '0')}`, main: index + 1 });
  await seed({ subject: 'Other year', year: 2560 });
  await login(page.request);
  await page.goto(origin + '/workspace');
  const section = page.locator('section[aria-labelledby="search-heading"]');
  await expect(section.getByText('พบ 54 รายการ · หน้า 1')).toBeVisible();
  await section.getByLabel('เลขหนังสือหรือชื่อเรื่อง', { exact: true }).fill('Return');
  await section.getByRole('button', { name: /^ตัวกรอง/ }).click();
  await section.getByLabel('ปีเลข (พ.ศ.)').selectOption('2568');
  await section.getByRole('button', { name: 'ใช้ตัวกรอง', exact: true }).click();
  await expect(section.getByText('พบ 53 รายการ · หน้า 1')).toBeVisible();
  await section.getByLabel('จำนวนรายการต่อหน้า').selectOption('50');
  const grid = page.getByRole('grid');
  await grid.getByRole('columnheader', { name: 'เรื่อง', exact: true }).click();
  await expect(grid.getByRole('row').nth(1)).toContainText('Return 00');
  await section.getByRole('button', { name: 'หน้าที่ 2', exact: true }).click();
  await expect(grid.getByRole('row').nth(1)).toContainText('Return 50');
  const listUrl = page.url();
  const cell = grid.locator('.ag-row').first().locator('[col-id="number"]');
  await cell.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/workspace\/documents\/issuance\//);
  await expect(section).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'รายละเอียดจากผลค้นหา' })).toContainText('Return 50');
  await page.reload();
  await expect(page.getByRole('region', { name: 'รายละเอียดจากผลค้นหา' })).toContainText('Return 50');
  await page.getByRole('link', { name: 'กลับหน้ารายการ', exact: true }).click();
  await expect(page).toHaveURL(listUrl);
  await expect(section.getByLabel('เลขหนังสือหรือชื่อเรื่อง', { exact: true })).toHaveValue('Return');
  await expect(section.getByLabel('จำนวนรายการต่อหน้า')).toHaveValue('50');
  await expect(section.getByText('พบ 53 รายการ · หน้า 2')).toBeVisible();
  await expect(grid.getByRole('columnheader', { name: 'เรื่อง', exact: true })).toHaveAttribute('aria-sort', 'ascending');
  await expect(grid.getByRole('row').nth(1)).toContainText('Return 50');
  await page.reload();
  await expect(section.getByText('พบ 53 รายการ · หน้า 2')).toBeVisible();
  await expect(grid.getByRole('row').nth(1)).toContainText('Return 50');
});

test('reference filter popover applies drafts explicitly, dismisses accessibly and keeps query results until Enter', async ({ page }) => {
  await seed({ subject: 'เอกสารปีใหม่', year: 2568 });
  await seed({ subject: 'เอกสารปีเก่า', year: 2560 });
  await login(page.request);
  await page.goto(origin + '/workspace');
  const section = page.locator('section[aria-labelledby="search-heading"]');
  const trigger = section.getByRole('button', { name: /^ตัวกรอง/ });
  const popover = section.getByRole('dialog', { name: 'ตัวกรองหนังสือ' });
  await expect(section.getByText('พบ 2 รายการ · หน้า 1')).toBeVisible();
  await trigger.click();
  await expect(popover).toBeVisible();
  await popover.getByLabel('ปีเลข (พ.ศ.)').selectOption('2560');
  await expect(section.getByText('พบ 2 รายการ · หน้า 1')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(popover.getByLabel('ปีเลข (พ.ศ.)')).toHaveValue('');
  await popover.getByLabel('ปีเลข (พ.ศ.)').selectOption('2560');
  await popover.getByRole('button', { name: 'ใช้ตัวกรอง', exact: true }).click();
  await expect(popover).not.toBeVisible();
  await expect(trigger).toContainText('1');
  await expect(section.getByText('พบ 1 รายการ · หน้า 1')).toBeVisible();
  await expect(section.getByRole('grid')).toContainText('เอกสารปีเก่า');
  await trigger.click();
  await popover.getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click();
  await expect(section.getByText('พบ 2 รายการ · หน้า 1')).toBeVisible();
  const query = section.getByLabel('เลขหนังสือหรือชื่อเรื่อง', { exact: true });
  await query.fill('เอกสารปีใหม่');
  await expect(section.getByText('พบ 2 รายการ · หน้า 1')).toBeVisible();
  await query.press('Enter');
  await expect(section.getByText('พบ 1 รายการ · หน้า 1')).toBeVisible();
  await expect(section.getByRole('grid')).not.toContainText('เอกสารปีเก่า');
});

test('reference grid page sizes, numbered pagination, detail actions and font size fit desktop and mobile', async ({ page }) => {
  for (let index = 0; index < 53; index++) await seed({ subject: `รายการทดสอบ ${String(index).padStart(2, '0')}` });
  await login(page.request);
  await page.goto(origin + '/workspace');
  const section = page.locator('section[aria-labelledby="search-heading"]');
  const grid = section.getByRole('grid');
  await expect(section.getByText('พบ 53 รายการ · หน้า 1')).toBeVisible();
  await expect(grid.locator('.ag-row')).toHaveCount(20);
  await section.getByRole('button', { name: 'หน้าที่ 2', exact: true }).click();
  await expect(section.getByText('พบ 53 รายการ · หน้า 2')).toBeVisible();
  await section.getByLabel('จำนวนรายการต่อหน้า').selectOption('50');
  await expect(section.getByText('พบ 53 รายการ · หน้า 1')).toBeVisible();
  await expect(grid.locator('.ag-row')).toHaveCount(50);
  await section.getByRole('button', { name: 'หน้าที่ 2', exact: true }).click();
  await expect(grid.locator('.ag-row')).toHaveCount(3);
  await section.getByLabel('จำนวนรายการต่อหน้า').selectOption('100');
  await expect(grid.locator('.ag-row')).toHaveCount(53);
  await expect(section.getByRole('button', { name: 'ผลค้นหาหน้าถัดไป' })).toBeDisabled();
  await section.getByLabel('จำนวนรายการต่อหน้า').selectOption('20');
  await expect(grid.locator('.ag-row')).toHaveCount(20);
  expect((await grid.boundingBox()).height).toBeGreaterThan(1100);
  expect(await grid.locator('.ag-cell').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(17);
  await grid.getByRole('button', { name: /^ดูรายละเอียด/ }).first().click();
  await expect(page.getByRole('region', { name: 'รายละเอียดจากผลค้นหา' })).toBeVisible();
  await page.getByRole('link', { name: 'กลับหน้ารายการ', exact: true }).click();
  await expect(section.getByText('พบ 53 รายการ · หน้า 1')).toBeVisible();
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await section.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.local/reference-table-${name}.png`, fullPage: true });
    await section.getByRole('button', { name: /^ตัวกรอง/ }).click();
    const panel = section.getByRole('dialog', { name: 'ตัวกรองหนังสือ' });
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `.local/reference-filters-${name}.png` });
    await page.keyboard.press('Escape');
  }
});

test('filter popover closes on page scrolling but stays open during internal scrolling', async ({ page }) => {
  for (let index = 0; index < 20; index++) await seed({ subject: `Scroll ${index}` });
  await login(page.request);
  await page.goto(origin + '/workspace');
  const section = page.locator('section[aria-labelledby="search-heading"]');
  const trigger = section.getByRole('button', { name: /^ตัวกรอง/ });
  const popover = section.getByRole('dialog', { name: 'ตัวกรองหนังสือ' });
  await expect(section.getByText('พบ 20 รายการ · หน้า 1')).toBeVisible();
  await trigger.click();
  await expect(popover).toBeVisible();
  await page.evaluate(() => window.scrollBy(0, 500));
  await expect(popover).not.toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

  await page.setViewportSize({ width: 390, height: 620 });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(popover).toBeVisible();
  await popover.evaluate(element => { element.scrollTop = 100; });
  await expect.poll(() => popover.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(popover).toBeVisible();
  await popover.getByLabel('ผู้ขอเลข (รหัสบุคลากรตรงตัว)').fill('TEST-001');
  await expect(popover).toBeVisible();
  await expect(popover.getByLabel('ผู้ขอเลข (รหัสบุคลากรตรงตัว)')).toHaveValue('TEST-001');
});

test('standalone direct detail URLs recheck both document kinds after identity changes', async ({ page }) => {
  const modern = await seed({ subject: 'Private modern direct', confidential: true });
  const legacy = await seed({ legacy: true, subject: 'Private legacy direct', confidential: true });
  await login(page.request);
  const modernUrl = `${origin}/workspace/documents/issuance/${modern.id}`;
  const legacyUrl = `${origin}/workspace/documents/legacy/${legacy.id}?${new URLSearchParams({ snapshot })}`;
  await page.goto(modernUrl);
  await expect(page.getByRole('region', { name: 'รายละเอียดจากผลค้นหา' })).toContainText(modern.subject);
  await page.reload();
  await expect(page.getByRole('region', { name: 'รายละเอียดจากผลค้นหา' })).toContainText(modern.subject);
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const detail = page.getByRole('region', { name: 'รายละเอียดจากผลค้นหา' });
    const paper = await detail.boundingBox();
    expect(paper.width).toBeLessThanOrEqual(880);
    expect(Math.abs(paper.x - (width - paper.width) / 2)).toBeLessThanOrEqual(1);
    expect(await detail.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('1px');
    expect(await detail.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)');
    expect(await detail.locator('dl').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(width > 760 ? 2 : 1);
    await page.screenshot({ path: `.local/document-detail-${name}.png`, fullPage: true });
  }
  await page.goto(legacyUrl);
  await expect(page.getByRole('region', { name: 'รายละเอียดประวัติหนังสือ' })).toContainText(legacy.subject);
  await login(page.request, 'outsider');
  await page.reload();
  await expect(page.locator('section[aria-labelledby="document-page-heading"]').getByRole('alert')).toContainText('ไม่พบ');
  await expect(page.locator('body')).not.toContainText(legacy.subject);
  await page.goto(modernUrl);
  await expect(page.locator('section[aria-labelledby="document-page-heading"]').getByRole('alert')).toContainText('ไม่พบ');
  await expect(page.locator('body')).not.toContainText(modern.subject);
});

test('standalone details reject malformed routes and keep external return targets local', async ({ page }) => {
  const document = await seed({ subject: 'Safe return detail' });
  await page.goto(`${origin}/workspace/documents/issuance/${document.id}`);
  await expect(page).toHaveURL(url => url.pathname === '/login');
  await expect(page.locator('body')).not.toContainText(document.subject);
  await login(page.request);
  for (const suffix of [
    '/unknown/1', '/issuance/not-an-id', '/legacy/1', `/legacy/1?snapshot=${'g'.repeat(64)}`,
  ]) {
    await page.goto(origin + '/workspace/documents' + suffix);
    await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(document.subject);
  }
  for (const returnTo of ['https://evil.example/path', '//evil.example/path', '/workspace/issuance']) {
    await page.goto(`${origin}/workspace/documents/issuance/${document.id}?${new URLSearchParams({ returnTo })}`);
    await expect(page.getByRole('region', { name: 'รายละเอียดจากผลค้นหา' })).toContainText(document.subject);
    await expect(page.getByRole('link', { name: 'กลับหน้ารายการ', exact: true })).toHaveAttribute('href', '/workspace');
  }
});

test('standalone details show loading and retry a transient protected API failure', async ({ page }) => {
  const document = await seed({ subject: 'Detail retry target' });
  await login(page.request);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let attempts = 0;
  let unavailable = true;
  await page.route(`**/api/issuance/${document.id}`, async route => {
    attempts++;
    if (!unavailable) return route.continue();
    await gate;
    return route.fulfill({ status: 503, json: { error: 'บริการทดสอบไม่พร้อม กรุณาลองใหม่' } });
  });
  try {
    const request = page.waitForRequest(`**/api/issuance/${document.id}`);
    await page.goto(`${origin}/workspace/documents/issuance/${document.id}`);
    await request;
    await expect(page.getByRole('status')).toContainText('กำลังโหลด');
  } finally { release(); }
  await expect(page.locator('section[aria-labelledby="document-page-heading"]').getByRole('alert')).toContainText('ไม่พร้อม');
  await expect(page.getByRole('region', { name: 'รายละเอียดจากผลค้นหา' })).toHaveCount(0);
  unavailable = false;
  await page.getByRole('button', { name: 'ลองใหม่', exact: true }).click();
  await expect(page.getByRole('region', { name: 'รายละเอียดจากผลค้นหา' })).toContainText(document.subject);
  expect(attempts).toBeGreaterThanOrEqual(2);
});
