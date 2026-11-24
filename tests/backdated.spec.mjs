import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { startIdentity } from '../tools/local-auth/provider.mjs';
import { startDatabase } from '../tools/issuance/database.mjs';

const origin = 'http://127.0.0.1:3110', password = 'Synthetic-T10-only-42';
const snapshot = 'a'.repeat(64);
let database, provider, child, logs, pdf;
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const tomorrow = () => new Date(Date.now() + 31 * 3600000).toISOString().slice(0, 10);
const year = () => Number(today().slice(0, 4)) + 543;
const input = (overrides = {}) => ({ requestId: randomUUID(), seriesId: 'TEST-S1', subject: 'หนังสือย้อนหลังทดสอบ', recipient: 'ผู้รับทดสอบ', recipientDepartmentIds: [], externalOrganization: 'องค์กรทดสอบ', signer: 'ผู้ลงนามทดสอบ', confidential: true, documentDate: today(), ...overrides });
async function login(request, username = 'owner') {
  const response = await request.post(origin + '/api/auth/login', { headers: { Origin: origin, Cookie: '' }, data: { username, password } });
  expect(response.status(), await response.text()).toBe(200);
  return response.headers()['set-cookie'].split(';')[0];
}
const post = (request, cookie, data, route = '/api/backdated') => request.post(origin + route, { headers: { Origin: origin, Cookie: cookie }, data });
const getSources = (request, cookie, date, extra = '') => request.get(`${origin}/api/backdated?date=${date}${extra}`, { headers: { Cookie: cookie } });
const backdated = (source, overrides = {}) => input({ seriesId: source.seriesId, documentDate: source.documentDate, source: source.source, ...overrides });
async function source(request, cookie, overrides = {}) {
  const issued = await post(request, cookie, input({ confidential: true, subject: 'ต้นทางหนังสือ' }), '/api/issuance');
  expect(issued.status(), await issued.text()).toBe(201);
  const document = (await issued.json()).document;
  const row = { seriesId: 'TEST-S1', documentDate: today(), numberYear: year(), main: Number(document.number.split('/')[1]), sub: 0, prefix: 'ทดสอบ 001', confidential: false, published: true, ...overrides };
  await database.admin.query('UPDATE issuance_documents SET series_id=?,document_date=?,number_year=?,main_number=?,sub_number=?,prefix=?,confidential=?,published=?,pdf_path=? WHERE id=?', [row.seriesId, row.documentDate, row.numberYear, row.main, row.sub, row.prefix, row.confidential, row.published, row.confidential ? null : 'synthetic-source-complete.pdf', document.id]);
  return { ...row, id: document.id, source: { kind: 'issuance', id: document.id } };
}
async function legacy({ id = '1', main = 42, sub = 0, documentDate = '2025-04-05', numberYear = 2568, confidential = false, published = true, cancelled = false, ...rest } = {}) {
  await database.admin.query('INSERT IGNORE INTO legacy_batches(source_sha256,manifest_sha256,report) VALUES (?,?,?)', [snapshot, snapshot, '{}']);
  await database.admin.query('INSERT INTO legacy_documents(source_sha256,source_id,owner_id,owner_department_id,series_id,number_year,main_number,sub_number,prefix,subject,document_date,confidential,published,cancelled,pdf_pending) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [snapshot, id, 'TEST-001', '204', 'TEST-S1', numberYear, main, sub, 'เลขเดิม', 'ต้นทางประวัติ ' + id, documentDate, confidential, published, cancelled, false]);
  return { seriesId: 'TEST-S1', documentDate, numberYear, main, sub, ...rest, source: { kind: 'legacy', snapshot, id } };
}
async function totals() {
  const [[row]] = await database.admin.query('SELECT (SELECT COUNT(*) FROM issuance_documents) documents,(SELECT COUNT(*) FROM issuance_audit) audit,(SELECT COALESCE(SUM(last_number),0) FROM issuance_counters) main,(SELECT COALESCE(SUM(last_sub_number),0) FROM issuance_subcounters) sub');
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

test.beforeAll(async () => {
  test.setTimeout(120000);
  const doc = await PDFDocument.create(); doc.addPage([240, 320]); pdf = Buffer.from(await doc.save());
  database = await startDatabase({ port: 3324 });
  const secret = randomBytes(32).toString('hex');
  provider = await startIdentity({ secret, ttlMs: 600000, users: ['owner', 'peer', 'outsider'].map((username, index) => ({ username, password, staffId: `TEST-00${index + 1}`, displayName: username, departmentId: index === 2 ? 'TEST-D1' : '204', departmentName: 'หน่วยงานทดสอบ', active: true, faculty: true })) });
  await mkdir('.local', { recursive: true });
  logs = createWriteStream('.local/t10-e2e-server.log');
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3110'], { windowsHide: true, env: { ...process.env, NODE_ENV: 'development', NEXT_TEST_DIST: 't10', AUTH_PROVIDER: 'local', LOCAL_IDENTITY_URL: provider.url, LOCAL_IDENTITY_SECRET: secret, ISSUANCE_DATABASE_URL: database.url }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(logs); child.stderr.pipe(logs);
  await expect.poll(async () => { try { return (await fetch(origin + '/login')).status; } catch { return 0; } }, { timeout: 90000 }).toBe(200);
});
test.afterAll(async () => { child?.kill(); await provider?.close(); await database?.close(); logs?.end(); });
test.beforeEach(async () => {
  await database.admin.query('DROP TRIGGER IF EXISTS t10_fail_audit');
  await database.admin.query('DELETE FROM issuance_audit; DELETE FROM issuance_documents; DELETE FROM issuance_subcounters; DELETE FROM issuance_counters; DELETE FROM issuance_owner_locks; DELETE FROM legacy_documents; DELETE FROM legacy_number_reservations; DELETE FROM legacy_reservation_links; DELETE FROM legacy_dispositions; DELETE FROM legacy_staging; DELETE FROM legacy_preservation_batches; DELETE FROM legacy_batches; UPDATE issuance_migration_gate SET state="open"; UPDATE issuance_grants SET active=TRUE');
  await database.admin.query("UPDATE issuance_series SET enabled=TRUE,prefix='ทดสอบ 001' WHERE id='TEST-S1'");
});

test('backdating keeps source year/date/prefix/main and records actual allocation time without changing main counter', async ({ request }) => {
  const cookie = await login(request), original = await source(request, cookie, { documentDate: '2025-04-05', numberYear: 2568, main: 42, prefix: 'คงเดิม', sub: 1 });
  const before = await totals();
  const response = await post(request, cookie, backdated(original));
  expect(response.status(), await response.text()).toBe(201);
  const document = (await response.json()).document;
  expect(document).toMatchObject({ number: 'คงเดิม/0042.2', numberYear: 2568, documentDate: '2025-04-05', issuanceKind: 'backdated', ownerId: 'TEST-001', ownerDepartmentId: '204', pdfPending: false });
  expect(Date.now() - Date.parse(document.issuedAt)).toBeLessThan(30000);
  expect(Date.parse(document.issuedAt)).toBeGreaterThan(Date.parse('2025-04-05'));
  expect((await totals()).main).toBe(before.main);
  expect(document.audit.at(-1).event).toBe('issued_backdated');
  const ownDetail = await request.get(`${origin}/api/issuance/${document.id}`, { headers: { Cookie: cookie } });
  expect((await ownDetail.json()).number).toBe(document.number);
});

test('simultaneous shared-source requests allocate integer subnumbers once and leave next ordinary main number intact', async ({ request }) => {
  const owner = await login(request), peer = await login(request, 'peer'), original = await source(request, owner, { main: 42 });
  await database.admin.query('UPDATE issuance_counters SET last_number=42 WHERE series_id=? AND number_year=?', ['TEST-S1', year()]);
  const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => post(request, index % 2 ? peer : owner, backdated(original))));
  for (const response of responses) expect(response.status(), await response.text()).toBe(201);
  const docs = await Promise.all(responses.map(async response => (await response.json()).document));
  expect(docs.map(document => Number(document.number.split('.')[1])).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  expect(new Set(docs.map(document => document.number)).size).toBe(12);
  const regular = await post(request, owner, input(), '/api/issuance');
  expect(regular.status()).toBe(201);
  expect((await regular.json()).document.number).toBe('ทดสอบ 001/0043');
});

test('same request retries replay the committed document, changed source/data and cross-mode key reuse conflict', async ({ request }) => {
  const cookie = await login(request), original = await source(request, cookie), second = await source(request, cookie);
  const data = backdated(original, { confidential: false });
  const responses = await Promise.all(Array.from({ length: 5 }, () => post(request, cookie, data)));
  expect(responses.map(response => response.status()).sort()).toEqual([200, 200, 200, 200, 201]);
  const documents = await Promise.all(responses.map(async response => (await response.json()).document));
  expect(new Set(documents.map(document => document.id)).size).toBe(1);
  const before = await totals();
  expect((await post(request, cookie, { ...data, subject: 'เปลี่ยนข้อมูล' })).status()).toBe(409);
  expect((await post(request, cookie, { ...data, source: second.source })).status()).toBe(409);
  const { source: ignoredSource, ...regular } = data;
  expect(ignoredSource).toBeTruthy();
  expect((await post(request, cookie, regular, '/api/issuance')).status()).toBe(409);
  expect(await totals()).toEqual(before);
});

test('audit failure rolls back document and subcounter together and retry does not skip a subnumber', async ({ request }) => {
  const cookie = await login(request), original = await source(request, cookie), data = backdated(original);
  const before = await totals();
  await database.admin.query("CREATE TRIGGER t10_fail_audit BEFORE INSERT ON issuance_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic T10 rollback'");
  expect((await post(request, cookie, data)).status()).toBe(503);
  expect(await totals()).toEqual(before);
  await database.admin.query('DROP TRIGGER t10_fail_audit');
  const response = await post(request, cookie, data);
  expect(response.status()).toBe(201);
  expect((await response.json()).document.number).toBe('ทดสอบ 001/0001.1');
});

test('source lookup filters date, readability and active grant; forged/future/unknown source requests never allocate', async ({ request }) => {
  const owner = await login(request), peer = await login(request, 'peer'), outsider = await login(request, 'outsider');
  const visible = await source(request, owner, { documentDate: '2025-04-05', numberYear: 2568, published: false });
  const hidden = await source(request, owner, { confidential: true, published: true });
  const future = await source(request, owner, { documentDate: tomorrow() });
  expect((await getSources(request, '', today())).status()).toBe(401);
  expect((await getSources(request, owner, '2026-02-30')).status()).toBe(400);
  expect((await getSources(request, owner, today(), '&page=-1')).status()).toBe(400);
  const found = await getSources(request, peer, visible.documentDate);
  expect(found.status()).toBe(200);
  expect((await found.json()).sources.map(item => item.source.id)).toContain(visible.id);
  expect(found.headers()['cache-control']).toContain('no-store');
  expect((await (await getSources(request, peer, today())).json()).sources.map(item => item.source.id)).not.toContain(hidden.id);
  expect((await (await getSources(request, outsider, visible.documentDate)).json()).sources).toEqual([]);
  const before = await totals();
  for (const [cookie, data] of [[peer, backdated(hidden)], [outsider, backdated(visible)], [owner, backdated(future)], [owner, backdated(visible, { documentDate: '2025-04-06' })], [owner, backdated(visible, { seriesId: 'TEST-S2' })], [owner, backdated(visible, { source: { kind: 'issuance', id: randomUUID() } })], [owner, backdated(visible, { mainNumber: 999 })], [owner, backdated(visible, { source: { ...visible.source, main: 999 } })]]) {
    const response = await post(request, cookie, data);
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
    expect(await totals()).toEqual(before);
  }
  expect((await request.post(origin + '/api/backdated', { headers: { Origin: 'https://example.com', Cookie: owner }, data: backdated(visible) })).status()).toBe(403);
  expect((await post(request, '', backdated(visible))).status()).toBe(401);
  await database.admin.query("UPDATE issuance_grants SET active=FALSE WHERE owner_id='TEST-002'");
  expect((await (await getSources(request, peer, visible.documentDate)).json()).sources).toEqual([]);
  expect((await post(request, peer, backdated(visible))).status()).toBeGreaterThanOrEqual(400);
  expect(await totals()).toEqual(before);
});

test('normalized legacy source and mapped reservations retain integer floors including hidden/cancelled historical subnumbers', async ({ request }) => {
  const cookie = await login(request), original = await legacy();
  await legacy({ id: '2', sub: 4, confidential: true, cancelled: true });
  await database.admin.query('INSERT INTO legacy_staging(source_sha256,source_table,source_id,payload) VALUES (?,"genbook","3","{}")', [snapshot]);
  await database.admin.query('INSERT INTO legacy_preservation_batches(source_sha256,policy,approval_reference,report) VALUES (?,"synthetic","T10 synthetic approval","{}")', [snapshot]);
  await database.admin.query('INSERT INTO legacy_reservation_links(source_sha256,legacy_series_id,series_id,reviewed_by) VALUES (?,"00001","TEST-S1","synthetic")', [snapshot]);
  await database.admin.query('INSERT INTO legacy_number_reservations(source_sha256,source_id,legacy_series_id,number_year,main_number,sub_number,original_status,series_reference_present) VALUES (?,"3","00001",2568,42,9,"cancelled",TRUE)', [snapshot]);
  const list = await getSources(request, cookie, original.documentDate);
  expect((await list.json()).sources.some(item => item.source.kind === 'legacy' && item.source.id === '1')).toBe(true);
  const response = await post(request, cookie, backdated(original));
  expect(response.status(), await response.text()).toBe(201);
  expect((await response.json()).document).toMatchObject({ number: 'เลขเดิม/0042.10', numberYear: 2568, documentDate: '2025-04-05' });
  const canceled = backdated({ ...original, source: { kind: 'legacy', snapshot, id: '2' } });
  expect((await post(request, cookie, canceled)).status()).toBeGreaterThanOrEqual(400);
  const rawSource = backdated({ ...original, source: { kind: 'legacy', snapshot, id: '3' } });
  expect((await post(request, cookie, rawSource)).status()).toBe(404);
});

test('source pagination authorizes before LIMIT and publication never bypasses confidentiality or missing series grant', async ({ request }) => {
  const peer = await login(request, 'peer'), outsider = await login(request, 'outsider');
  for (let index = 1; index <= 25; index++) await legacy({ id: String(index), main: index, confidential: true, published: true });
  for (let index = 101; index <= 121; index++) await legacy({ id: String(index), main: index });
  const first = await (await getSources(request, peer, '2025-04-05')).json();
  expect(first.sources).toHaveLength(20);
  expect(first.hasMore).toBe(true);
  expect(first.sources.map(item => item.source.id)).toEqual(Array.from({ length: 20 }, (_, index) => String(index + 101)));
  const second = await (await getSources(request, peer, '2025-04-05', '&page=2')).json();
  expect(second.sources.map(item => item.source.id)).toEqual(['121']);
  expect(second.hasMore).toBe(false);
  expect((await (await getSources(request, outsider, '2025-04-05')).json()).sources).toEqual([]);
  await database.admin.query("INSERT INTO issuance_grants(owner_id,series_id,active) VALUES ('TEST-003','TEST-S1',TRUE)");
  const shared = await (await getSources(request, outsider, '2025-04-05')).json();
  expect(shared.sources.map(item => item.source.id)).toEqual(first.sources.map(item => item.source.id));
  await database.admin.query('UPDATE legacy_documents SET published=FALSE WHERE source_sha256=? AND source_id=?', [snapshot, '101']);
  const limited = await (await getSources(request, outsider, '2025-04-05')).json();
  expect(limited.sources).toHaveLength(20);
  expect(limited.hasMore).toBe(false);
  expect(limited.sources.map(item => item.source.id)).not.toContain('101');
});

test('nonsecret backdated PDF gate applies to both issuance paths and actual T07 upload restores eligibility', async ({ request }) => {
  const cookie = await login(request), original = await source(request, cookie);
  const response = await post(request, cookie, backdated(original, { confidential: false }));
  expect(response.status()).toBe(201);
  const document = (await response.json()).document;
  expect(document.pdfPending).toBe(true);
  const before = await totals();
  expect((await post(request, cookie, backdated(original))).status()).toBe(409);
  expect((await post(request, cookie, input(), '/api/issuance')).status()).toBe(409);
  expect(await totals()).toEqual(before);
  const attached = await request.put(`${origin}/api/issuance/${document.id}/pdf`, { headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/pdf', 'If-Match': '1' }, data: pdf });
  expect(attached.status(), await attached.text()).toBe(200);
  expect((await attached.json()).pdfPending).toBe(false);
  const download = await request.get(`${origin}/api/issuance/${document.id}/pdf`, { headers: { Cookie: cookie } });
  expect(await download.body()).toEqual(pdf);
  expect((await post(request, cookie, backdated(original))).status()).toBe(201);
  expect((await post(request, cookie, input(), '/api/issuance')).status()).toBe(201);
});

test('migration gate and exhausted integer subcounter reject allocation without modifying history', async ({ request }) => {
  const cookie = await login(request), original = await source(request, cookie);
  const before = await totals();
  await database.admin.query('UPDATE issuance_migration_gate SET state="blocked"');
  expect((await post(request, cookie, backdated(original))).status()).toBe(503);
  expect(await totals()).toEqual(before);
  await database.admin.query('UPDATE issuance_migration_gate SET state="open"');
  await database.admin.query('INSERT INTO issuance_subcounters(series_id,number_year,main_number,last_sub_number) VALUES (?,?,?,4294967295)', [original.seriesId, original.numberYear, original.main]);
  const full = await totals();
  expect((await post(request, cookie, backdated(original))).status()).toBe(409);
  expect(await totals()).toEqual(full);
});

test('mobile browser selects date/source, validates no matches, issues a backdated number and opens complete details', async ({ page, request }) => {
  const cookie = await login(request), original = await source(request, cookie, { documentDate: '2025-04-05', numberYear: 2568, main: 42 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/login');
  await page.getByLabel('ชื่อบัญชี').fill('owner');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByLabel('รหัสผ่าน', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/workspace$/);
  await page.getByRole('link', { name: 'หน้าออกเลขเอกสาร', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/issuance$/);
  await page.getByLabel('วิธีขอเลข', { exact: true }).selectOption('backdated');
  await page.getByLabel('วันที่หนังสือย้อนหลัง', { exact: true }).fill('2025-04-06');
  await page.getByRole('button', { name: 'ค้นหาต้นทาง', exact: true }).click();
  await expect(page.getByText(/ไม่พบ.*ต้นทาง/)).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  await page.getByLabel('วันที่หนังสือย้อนหลัง', { exact: true }).fill(original.documentDate);
  await page.getByRole('button', { name: 'ค้นหาต้นทาง', exact: true }).click();
  const selector = page.getByLabel('หนังสือต้นทาง', { exact: true });
  await expect(selector.locator('option')).toHaveCount(2);
  await selector.selectOption({ index: 1 });
  await page.getByLabel('เรื่อง', { exact: true }).fill('ย้อนหลังจากมือถือ T10');
  await page.getByLabel('ผู้รับ 1', { exact: true }).fill('ผู้รับย้อนหลัง');
  await page.getByLabel('หน่วยงานรับเรื่องภายนอกคณะ').fill('องค์กรย้อนหลัง');
  await page.getByLabel('ผู้ลงนาม', { exact: true }).fill('ผู้ลงนามย้อนหลัง');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/backdated', async route => { if (route.request().method() === 'POST') await gate; await route.continue(); }, { times: 1 });
  await page.getByRole('button', { name: 'ยืนยันขอเลข', exact: true }).click();
  await expect(page.getByRole('button', { name: 'กำลังดำเนินการ…', exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('alertdialog').getByRole('status')).toContainText('ออกเลขสำเร็จ');
  await page.getByRole('alertdialog').getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ทดสอบ 001/0042.1', exact: true })).toBeVisible();
  const detail = page.locator('.document-detail');
  await expect(detail).toContainText('2025-04-05 / 2568');
  await expect(detail).toContainText('ย้อนหลังจากมือถือ T10');
  await expect(detail).toContainText('รอแนบ PDF');
  await page.getByLabel('แนบ PDF', { exact: true }).setInputFiles({ name: 'backdated.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByRole('button', { name: 'บันทึก PDF', exact: true }).click();
  await expect(page.getByRole('alertdialog').getByRole('status')).toContainText('บันทึก PDF สำเร็จ');
  await page.getByRole('alertdialog').getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  await expect(page.getByRole('link', { name: 'ดาวน์โหลด PDF', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /ทดสอบ 001\/0042\.1.*ย้อนหลังจากมือถือ T10/ }).click();
  await expect(detail).toContainText('ย้อนหลังจากมือถือ T10');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/t10-mobile-backdated.png', fullPage: true });
});
