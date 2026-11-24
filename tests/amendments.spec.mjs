import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { PDFDocument } from 'pdf-lib';
import { startIdentity } from '../tools/local-auth/provider.mjs';
import { startDatabase } from '../tools/issuance/database.mjs';

const origin = 'http://127.0.0.1:3112', password = 'Synthetic-T09-only-42';
let database, provider, child, logs, pdf;
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const input = (overrides = {}) => ({ requestId: randomUUID(), seriesId: 'TEST-S1', subject: 'เรื่องต้นฉบับลับ', recipient: 'ผู้รับเดิม', recipientDepartmentIds: [], externalOrganization: 'องค์กรเดิม', signer: 'ผู้ลงนามเดิม', confidential: true, published: false, documentDate: today(), ...overrides });
async function login(request, username = 'owner') {
  const response = await request.post(origin + '/api/auth/login', { headers: { Origin: origin, Cookie: '' }, data: { username, password } });
  expect(response.status(), await response.text()).toBe(200);
  return response.headers()['set-cookie'].split(';')[0];
}
const post = (request, cookie, data, route = '/api/issuance') => request.post(origin + route, { headers: { Origin: origin, Cookie: cookie }, data });
async function issue(request, cookie, overrides) {
  const response = await post(request, cookie, input(overrides));
  expect(response.status(), await response.text()).toBe(201); return (await response.json()).document;
}
const body = (document, overrides = {}) => ({ version: document.version, subject: document.subject, recipient: document.recipient, recipientDepartmentIds: document.recipientDepartmentIds, externalOrganization: document.externalOrganization, signer: document.signer, confidential: document.confidential, published: document.published, ...overrides });
const patch = (request, cookie, document, overrides = {}) => request.patch(`${origin}/api/issuance/${document.id}`, { headers: { Origin: origin, Cookie: cookie }, data: body(document, overrides) });
const get = (request, cookie, id) => request.get(`${origin}/api/issuance/${id}`, { headers: { Cookie: cookie } });
const upload = (request, cookie, document) => request.put(`${origin}/api/issuance/${document.id}/pdf`, { headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/pdf', 'If-Match': String(document.version) }, data: pdf });
async function state(id) {
  const [[row]] = await database.admin.query('SELECT * FROM issuance_documents WHERE id=?', [id]);
  const [audit] = await database.admin.query('SELECT actor_id,event,details FROM issuance_audit WHERE document_id=? ORDER BY id', [id]);
  return { ...row, audit };
}
async function counts() {
  const [[row]] = await database.admin.query('SELECT (SELECT COUNT(*) FROM issuance_documents) documents,(SELECT COUNT(*) FROM issuance_audit) audit,(SELECT COALESCE(SUM(last_number),0) FROM issuance_counters) main,(SELECT COALESCE(SUM(last_sub_number),0) FROM issuance_subcounters) sub');
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

test.beforeAll(async () => {
  test.setTimeout(120000);
  const doc = await PDFDocument.create(); doc.addPage([240, 320]); pdf = Buffer.from(await doc.save());
  database = await startDatabase({ port: 3326 });
  const secret = randomBytes(32).toString('hex');
  provider = await startIdentity({ secret, ttlMs: 600000, users: ['owner', 'peer', 'outsider'].map((username, index) => ({ username, password, staffId: `TEST-00${index + 1}`, displayName: username, departmentId: index === 2 ? 'TEST-D1' : '204', departmentName: 'หน่วยงานทดสอบ', active: true, faculty: true })) });
  await mkdir('.local', { recursive: true }); logs = createWriteStream('.local/t09-e2e-server.log');
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3112'], { windowsHide: true, env: { ...process.env, NODE_ENV: 'development', NEXT_TEST_DIST: 't09', AUTH_PROVIDER: 'local', LOCAL_IDENTITY_URL: provider.url, LOCAL_IDENTITY_SECRET: secret, ISSUANCE_DATABASE_URL: database.url }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(logs); child.stderr.pipe(logs);
  await expect.poll(async () => { try { return (await fetch(origin + '/login')).status; } catch { return 0; } }, { timeout: 90000 }).toBe(200);
});
test.afterAll(async () => { child?.kill(); await provider?.close(); await database?.close(); logs?.end(); });
test.beforeEach(async () => {
  await database.admin.query('DROP TRIGGER IF EXISTS t09_fail_audit');
  await database.admin.query('DELETE FROM issuance_audit; DELETE FROM issuance_documents; DELETE FROM issuance_subcounters; DELETE FROM issuance_counters; DELETE FROM issuance_owner_locks; UPDATE issuance_departments SET enabled=TRUE; UPDATE issuance_series SET enabled=TRUE; UPDATE issuance_grants SET active=TRUE');
});

test('allowed fields amend atomically with actor and before/after while immutable identifiers and original retry remain intact', async ({ request }) => {
  const cookie = await login(request), original = input();
  const created = await post(request, cookie, original), document = (await created.json()).document;
  const before = await state(document.id);
  const response = await patch(request, cookie, document, { subject: ' เรื่องใหม่ ', recipient: 'ก\nข', recipientDepartmentIds: ['TEST-D2', 'TEST-D1', 'TEST-D1'], externalOrganization: '', signer: 'ผู้ลงนามใหม่', confidential: false, published: true });
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const result = await response.json();
  expect(result).toMatchObject({ subject: 'เรื่องใหม่', recipient: 'ก\nข', recipientDepartmentIds: ['TEST-D1', 'TEST-D2'], externalOrganization: '', signer: 'ผู้ลงนามใหม่', confidential: false, published: true, version: 2, pdfPending: true });
  const event = result.audit.at(-1);
  expect(event).toMatchObject({ actorId: 'TEST-001', event: 'amended', details: { previousVersion: 1, version: 2, before: { subject: original.subject, confidential: true }, after: { subject: 'เรื่องใหม่', recipients: ['ก', 'ข'], confidential: false } } });
  expect(Date.now() - Date.parse(event.createdAt)).toBeLessThan(30000);
  const after = await state(document.id);
  for (const field of ['id', 'owner_id', 'owner_department_id', 'request_key', 'payload_hash', 'series_id', 'number_year', 'main_number', 'sub_number', 'prefix', 'document_date', 'issued_at', 'pdf_path']) expect(after[field], field).toEqual(before[field]);
  const replay = await post(request, cookie, original);
  expect(replay.status()).toBe(200); expect((await replay.json()).document).toMatchObject({ id: document.id, subject: 'เรื่องใหม่', version: 2 });
  expect((await state(document.id)).audit).toHaveLength(2);
});

test('forbidden and malformed fields reject the entire amendment without data version audit or counter changes', async ({ request }) => {
  const cookie = await login(request), document = await issue(request, cookie), before = await state(document.id), totals = await counts();
  for (const field of ['id', 'ownerId', 'ownerDepartmentId', 'seriesId', 'number', 'numberYear', 'mainNumber', 'subNumber', 'prefix', 'documentDate', 'issuedAt', 'source', 'requestId', 'payloadHash', 'pdf_path', 'pdfPath', 'allocationStatus', 'cancelled', 'audit', '__proto__']) {
    const data = JSON.stringify({ ...body(document), subject: 'ห้ามเปลี่ยนแม้มีฟิลด์ถูกต้อง', [field]: 'forged' });
    const response = await request.patch(`${origin}/api/issuance/${document.id}`, { headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, data });
    expect(response.status(), field).toBe(400);
  }
  for (const changes of [{ version: 0 }, { version: '1' }, { version: 1.5 }, { version: 4294967296 }, { version: null }, { published: undefined }, { published: 'true' }, { confidential: null }, { subject: ' ' }, { subject: 'x'.repeat(501) }, { recipient: Array(21).fill('ก').join('\n') }, { recipient: 'x'.repeat(201) }, { recipientDepartmentIds: ['UNKNOWN'], externalOrganization: '' }, { recipientDepartmentIds: [], externalOrganization: '' }, { recipientDepartmentIds: ['TEST-D1'], externalOrganization: 'ทั้งสอง' }]) expect((await patch(request, cookie, document, changes)).status(), JSON.stringify(changes)).toBe(400);
  for (const data of ['{', 'null', '[]', 'x'.repeat(16385)]) expect((await request.patch(`${origin}/api/issuance/${document.id}`, { headers: { Origin: origin, Cookie: cookie }, data })).status()).toBe(400);
  for (const documentDate of [null, {}, { toString: null, valueOf: null }, 20261113]) expect((await post(request, cookie, input({ documentDate }))).status()).toBe(400);
  expect(await state(document.id)).toEqual(before); expect(await counts()).toEqual(totals);
});

test('only owners amend; shared readers never receive audit including prior secret values after publication', async ({ request }) => {
  const cookie = await login(request), peer = await login(request, 'peer'), outsider = await login(request, 'outsider');
  const document = await issue(request, cookie);
  expect((await patch(request, peer, document)).status()).toBe(404);
  expect((await patch(request, outsider, document)).status()).toBe(404);
  const updated = await patch(request, cookie, document, { subject: 'ข้อมูลเผยแพร่ใหม่', recipient: 'ผู้รับเผยแพร่ใหม่', confidential: false, published: true });
  expect(updated.status()).toBe(200);
  for (const reader of [peer, outsider]) {
    const response = await get(request, reader, document.id), json = await response.json();
    expect(response.status()).toBe(200); expect(json).not.toHaveProperty('audit'); expect(JSON.stringify(json)).not.toContain('เรื่องต้นฉบับลับ');
    expect((await patch(request, reader, { ...document, version: 2 }, { subject: 'แก้แทน' })).status()).toBe(404);
  }
  expect((await request.patch(`${origin}/api/issuance/${document.id}`, { headers: { Origin: origin, Cookie: '' }, data: body(document) })).status()).toBe(401);
  for (const extra of [{ Origin: 'https://example.com' }, { Origin: '', 'Sec-Fetch-Site': 'cross-site' }]) expect((await request.patch(`${origin}/api/issuance/${document.id}`, { headers: { Origin: origin, Cookie: cookie, ...extra }, data: body(document) })).status()).toBe(403);
  expect((await get(request, peer, randomUUID())).status()).toBe(404);
  expect((await patch(request, cookie, { ...document, id: 'invalid' })).status()).toBe(404);
});

test('concurrent amendments and PDF writes share a version without silent overwrites', async ({ request }) => {
  const cookie = await login(request), document = await issue(request, cookie);
  const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => patch(request, cookie, document, { subject: `ฉบับ ${i}` })));
  expect(responses.map(response => response.status()).sort()).toEqual([200, ...Array(9).fill(409)]);
  const amended = await responses.find(response => response.status() === 200).json();
  expect(amended.version).toBe(2); expect(amended.audit).toHaveLength(2);
  expect((await upload(request, cookie, document)).status()).toBe(409);
  const attached = await upload(request, cookie, amended); expect(attached.status()).toBe(200);
  const withPdf = await attached.json(); expect(withPdf.version).toBe(3);
  expect((await patch(request, cookie, amended, { subject: 'version เก่าหลังแนบไฟล์' })).status()).toBe(409);
  const pdfBefore = await state(document.id);
  const race = await Promise.all([patch(request, cookie, withPdf, { subject: 'แข่งกับ PDF' }), upload(request, cookie, withPdf)]);
  expect(race.map(response => response.status()).sort()).toEqual([200, 409]);
  const final = await state(document.id); expect(Number(final.version)).toBe(4); expect(final.audit).toHaveLength(4);
  const download = await request.get(`${origin}/api/issuance/${document.id}/pdf`, { headers: { Cookie: cookie } });
  expect(download.status()).toBe(200); expect(createHash('sha256').update(await download.body()).digest('hex')).toBe(createHash('sha256').update(pdf).digest('hex'));
  if (race[0].status() === 200) expect(final.pdf_path).toBe(pdfBefore.pdf_path);
});

test('audit insertion failure rolls back metadata and version together, retry commits once', async ({ request }) => {
  const cookie = await login(request), document = await issue(request, cookie), before = await state(document.id);
  await database.admin.query("CREATE TRIGGER t09_fail_audit BEFORE INSERT ON issuance_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic T09 rollback'");
  expect((await patch(request, cookie, document, { subject: 'ต้อง rollback', confidential: false })).status()).toBe(503);
  expect(await state(document.id)).toEqual(before);
  await database.admin.query('DROP TRIGGER t09_fail_audit');
  expect((await patch(request, cookie, document, { subject: 'บันทึกใหม่' })).status()).toBe(200);
  expect((await state(document.id)).audit).toHaveLength(2);
});

test('secret to nonsecret keeps number but blocks both issuance paths until valid PDF is attached', async ({ request }) => {
  const cookie = await login(request), document = await issue(request, cookie), next = await issue(request, cookie);
  const response = await patch(request, cookie, document, { confidential: false });
  expect(response.status()).toBe(200); const edited = await response.json(); expect(edited.pdfPending).toBe(true);
  const totals = await counts();
  expect((await post(request, cookie, input())).status()).toBe(409);
  expect((await post(request, cookie, { ...input(), source: { kind: 'issuance', id: next.id } }, '/api/backdated')).status()).toBe(409);
  expect(await counts()).toEqual(totals);
  const uploaded = await upload(request, cookie, edited); expect(uploaded.status()).toBe(200);
  expect((await post(request, cookie, input())).status()).toBe(201);
  expect((await get(request, cookie, document.id)).status()).toBe(200);
});

test('owner mutex orders secret transition before concurrent issuance pending-file check', async ({ request }) => {
  const cookie = await login(request), document = await issue(request, cookie), totals = await counts();
  const mutex = await mysql.createConnection({ uri: database.url });
  try {
    await mutex.beginTransaction(); await mutex.execute('SELECT owner_id FROM issuance_owner_locks WHERE owner_id=? FOR UPDATE', ['TEST-001']);
    const amendment = patch(request, cookie, document, { confidential: false });
    const waits = async () => { const [[row]] = await database.admin.query('SELECT COUNT(*) n FROM performance_schema.data_lock_waits'); return Number(row.n); };
    await expect.poll(waits).toBeGreaterThanOrEqual(1);
    const issuance = post(request, cookie, input());
    await expect.poll(waits).toBeGreaterThanOrEqual(2);
    await mutex.commit();
    expect((await amendment).status()).toBe(200); expect((await issuance).status()).toBe(409);
    expect(await counts()).toEqual({ ...totals, audit: totals.audit + 1 });
  } finally { await mutex.rollback(); await mutex.end(); }
});

test('disabled original targets and series remain editable; new disabled targets reject; backdated identity stays fixed', async ({ request }) => {
  const cookie = await login(request), source = await issue(request, cookie);
  const response = await post(request, cookie, { ...input({ recipientDepartmentIds: ['TEST-D1'], externalOrganization: '' }), source: { kind: 'issuance', id: source.id } }, '/api/backdated');
  expect(response.status()).toBe(201); const document = (await response.json()).document, before = await state(document.id);
  await database.admin.query("UPDATE issuance_departments SET enabled=FALSE WHERE id IN ('TEST-D1','TEST-D2'); UPDATE issuance_series SET enabled=FALSE; UPDATE issuance_grants SET active=FALSE");
  const amended = await patch(request, cookie, document, { subject: 'คงหน่วยงานเดิม' });
  expect(amended.status()).toBe(200); const edited = await amended.json();
  expect(edited).toMatchObject({ number: document.number, subNumber: 1, numberYear: document.numberYear, documentDate: document.documentDate, issuedAt: document.issuedAt });
  expect((await patch(request, cookie, edited, { recipientDepartmentIds: ['TEST-D2'] })).status()).toBe(400);
  for (const field of ['series_id', 'number_year', 'main_number', 'sub_number', 'prefix', 'issued_at', 'document_date', 'payload_hash']) expect((await state(document.id))[field]).toEqual(before[field]);
});

async function openInBrowser(page, document) {
  await page.goto(origin + '/workspace/issuance');
  await page.getByRole('button', { name: document.number, exact: false }).first().click();
  const detail = page.locator('section[aria-labelledby="document-result-heading"]');
  await expect(detail).toBeVisible(); return detail;
}
test('mobile keyboard editor saves allowed fields and exposes owner audit before/after', async ({ page }) => {
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  const cookie = await login(page.request), document = await issue(page.request, cookie);
  const detail = await openInBrowser(page, document);
  await page.setViewportSize({ width: 390, height: 844 });
  await detail.getByRole('button', { name: 'แก้ไขข้อมูล', exact: true }).focus(); await page.keyboard.press('Enter');
  const editor = detail.getByRole('region', { name: 'แก้ไขข้อมูลหนังสือ', exact: true });
  await expect(editor.getByLabel('แก้ไขเรื่อง', { exact: true })).toBeFocused();
  await editor.getByLabel('แก้ไขเรื่อง', { exact: true }).fill('แก้จากมือถือ');
  await editor.getByLabel('แก้ไขผู้รับ (หนึ่งคนต่อบรรทัด)').fill('ผู้รับใหม่\nผู้รับคนที่สอง');
  await editor.getByLabel('แก้ไขปลายทางหนังสือ').selectOption('internal');
  await editor.getByLabel('แก้ไขหน่วยงานรับเรื่องภายใน').selectOption(['TEST-D1', 'TEST-D2']);
  await editor.getByLabel('แก้ไขผู้ลงนาม').fill('ผู้ลงนามใหม่');
  await editor.getByLabel('แก้ไขเป็นหนังสือลับ').uncheck(); await editor.getByLabel('แก้ไขการเผยแพร่ภายในคณะ').check();
  await editor.getByRole('button', { name: 'บันทึกการแก้ไข', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(editor.getByRole('status').filter({ hasText: 'บันทึกการแก้ไขสำเร็จ' })).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  await expect(detail.getByRole('heading', { name: document.number })).toBeVisible();
  const audit = detail.getByRole('region', { name: 'ประวัติของหนังสือ', exact: true });
  await expect(audit.getByText(/ผู้ดำเนินการ TEST-001/).last()).toBeVisible();
  await audit.locator('summary').last().click();
  await expect(audit.getByText('เรื่องต้นฉบับลับ', { exact: true })).toBeVisible();
  await expect(audit.getByText('แก้จากมือถือ', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/t09-amendment-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('two browser tabs conflict explicitly and reload without overwriting the winner', async ({ page }) => {
  const cookie = await login(page.request), document = await issue(page.request, cookie);
  const other = await page.context().newPage();
  const first = await openInBrowser(page, document), second = await openInBrowser(other, document);
  for (const detail of [first, second]) await detail.getByRole('button', { name: 'แก้ไขข้อมูล', exact: true }).click();
  await first.getByLabel('แก้ไขเรื่อง', { exact: true }).fill('ผู้ชนะ');
  await second.getByLabel('แก้ไขเรื่อง', { exact: true }).fill('ข้อมูลเก่าห้ามทับ');
  await first.getByRole('button', { name: 'บันทึกการแก้ไข', exact: true }).click();
  await expect(first.getByRole('status').filter({ hasText: 'บันทึกการแก้ไขสำเร็จ' })).toBeVisible();
  await second.getByRole('button', { name: 'บันทึกการแก้ไข', exact: true }).click();
  await expect(second.getByRole('alert')).toContainText('ข้อมูลเปลี่ยนแล้ว');
  await other.getByRole('alertdialog').getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  await expect(second.getByRole('button', { name: 'บันทึกการแก้ไข', exact: true })).toBeDisabled();
  await second.getByRole('button', { name: 'โหลดข้อมูลล่าสุดเพื่อแก้ไข' }).click();
  await expect(other.getByRole('alertdialog').getByRole('status')).toContainText('โหลดข้อมูลล่าสุดแล้ว');
  await other.getByRole('alertdialog').getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  await second.getByRole('button', { name: 'แก้ไขข้อมูล', exact: true }).click();
  await expect(second.getByLabel('แก้ไขเรื่อง', { exact: true })).toHaveValue('ผู้ชนะ');
  expect((await state(document.id)).audit).toHaveLength(2); await other.close();
});

test('same-page PDF refresh cannot advance an open editor base version and bypass conflict', async ({ page }) => {
  const cookie = await login(page.request), document = await issue(page.request, cookie);
  const detail = await openInBrowser(page, document);
  await detail.getByRole('button', { name: 'แก้ไขข้อมูล', exact: true }).click();
  await detail.getByLabel('แก้ไขเรื่อง', { exact: true }).fill('แบบฟอร์มก่อนแนบ PDF');
  await detail.getByLabel('แนบ PDF', { exact: true }).setInputFiles({ name: 'valid.pdf', mimeType: 'application/pdf', buffer: pdf });
  await detail.getByRole('button', { name: 'บันทึก PDF', exact: true }).click();
  await expect(detail.getByText('บันทึก PDF สำเร็จ', { exact: true })).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  await detail.getByRole('button', { name: 'บันทึกการแก้ไข', exact: true }).click();
  await expect(detail.getByRole('alert')).toContainText('ข้อมูลเปลี่ยนแล้ว');
  expect((await state(document.id)).subject).toBe('เรื่องต้นฉบับลับ');
});

test('editor announces loading, handles failed response and requires explicit reload before retry', async ({ page }) => {
  const cookie = await login(page.request), document = await issue(page.request, cookie), detail = await openInBrowser(page, document);
  await detail.getByRole('button', { name: 'แก้ไขข้อมูล', exact: true }).click();
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**/api/issuance/${document.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await gate; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'ระบบไม่พร้อม' }) });
  });
  await detail.getByRole('button', { name: 'บันทึกการแก้ไข', exact: true }).click();
  await expect(detail.getByRole('status').filter({ hasText: 'กำลังดำเนินการแก้ไข…' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'บันทึกการแก้ไข', exact: true })).toBeDisabled();
  release(); await expect(detail.getByRole('alert')).toContainText('ระบบไม่พร้อม');
  await page.getByRole('alertdialog').getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  await page.unroute(`**/api/issuance/${document.id}`);
  await detail.getByRole('button', { name: 'โหลดข้อมูลล่าสุดเพื่อแก้ไข' }).click();
  await expect(page.getByRole('alertdialog').getByRole('status')).toContainText('โหลดข้อมูลล่าสุดแล้ว');
  await page.getByRole('alertdialog').getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  await detail.getByRole('button', { name: 'แก้ไขข้อมูล', exact: true }).click();
  await detail.getByLabel('แก้ไขเรื่อง', { exact: true }).fill('ลองใหม่สำเร็จ');
  await detail.getByRole('button', { name: 'บันทึกการแก้ไข', exact: true }).click();
  await expect(detail.getByRole('status').filter({ hasText: 'บันทึกการแก้ไขสำเร็จ' })).toBeVisible();
});

test('owner edits from search while a shared reader has no editor or private audit', async ({ page, browser }) => {
  const cookie = await login(page.request), document = await issue(page.request, cookie, { confidential: false, published: true });
  await page.goto(origin + '/workspace/search');
  const section = page.locator('section[aria-labelledby="search-heading"]');
  await section.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
  await section.getByRole('button', { name: new RegExp(document.number) }).click();
  const detail = section.getByRole('region', { name: 'รายละเอียดจากผลค้นหา' });
  await detail.getByRole('button', { name: 'แก้ไขข้อมูล', exact: true }).click();
  await detail.getByLabel('แก้ไขเรื่อง', { exact: true }).fill('แก้จากการค้นหา');
  await detail.getByRole('button', { name: 'บันทึกการแก้ไข', exact: true }).click();
  await expect(detail.getByRole('status').filter({ hasText: 'บันทึกการแก้ไขสำเร็จ' })).toBeVisible();
  const context = await browser.newContext(), peerPage = await context.newPage();
  await login(peerPage.request, 'peer');
  const shared = await openInBrowser(peerPage, document);
  await expect(shared.getByRole('button', { name: 'แก้ไขข้อมูล', exact: true })).toHaveCount(0);
  await expect(shared.getByRole('region', { name: 'ประวัติของหนังสือ', exact: true })).toHaveCount(0);
  await context.close();
});


test('delayed Home editor save cannot reopen a detail after search criteria change', async ({ page }) => {
  const cookie = await login(page.request), document = await issue(page.request, cookie);
  await page.goto(origin + '/workspace');
  const section = page.locator('section[aria-labelledby="search-heading"]');
  await section.getByRole('button', { name: new RegExp(document.number) }).click();
  const detail = section.getByRole('region', { name: 'รายละเอียดจากผลค้นหา' });
  await detail.getByRole('button', { name: 'แก้ไขข้อมูล', exact: true }).click();
  await detail.getByLabel('แก้ไขเรื่อง', { exact: true }).fill('บันทึกสำเร็จหลังเปลี่ยนตัวกรอง');
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const committed = new Promise(resolve => { started = resolve; });
  await page.route('**/api/issuance/' + document.id, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    started();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await detail.getByRole('button', { name: 'บันทึกการแก้ไข', exact: true }).click();
    await committed;
    await section.getByLabel('เรื่อง (บางส่วน)', { exact: true }).fill('ไม่มีรายการที่ตรงตัวกรองใหม่นี้');
    await expect(detail).toHaveCount(0);
    await expect(section.getByRole('region', { name: 'แก้ไขข้อมูลหนังสือ', exact: true })).toHaveCount(0);
    await section.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
    await expect(section.getByText('พบ 0 รายการ · หน้า 1')).toBeVisible();
    const delivered = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/api/issuance/' + document.id));
    release();
    await (await delivered).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect((await state(document.id)).subject).toBe('บันทึกสำเร็จหลังเปลี่ยนตัวกรอง');
    await expect(detail).toHaveCount(0);
    await expect(section.getByText('พบ 0 รายการ · หน้า 1')).toBeVisible();
    await expect(section.getByLabel('เรื่อง (บางส่วน)', { exact: true })).toHaveValue('ไม่มีรายการที่ตรงตัวกรองใหม่นี้');
  } finally { release(); }
});
