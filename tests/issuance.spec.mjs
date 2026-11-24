import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { startIdentity } from '../tools/local-auth/provider.mjs';
import { startDatabase } from '../tools/issuance/database.mjs';

const origin = 'http://127.0.0.1:3106';
const password = 'Synthetic-T05-only-42';
let database, provider, child, logs;
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const input = (overrides = {}) => ({ requestId: randomUUID(), seriesId: 'TEST-S1', subject: 'ทดสอบหนังสือ', recipient: 'ผู้รับทดสอบ', recipientDepartmentIds: [], externalOrganization: 'องค์กรตัวอย่าง', signer: 'ผู้ลงนามทดสอบ', confidential: true, documentDate: today(), ...overrides });
async function login(request, username = 'issuer1') {
  const result = await request.post(`${origin}/api/auth/login`, { headers: { Origin: origin, Cookie: '' }, data: { username, password } });
  expect(result.status()).toBe(200);
  return result.headers()['set-cookie'].split(';')[0];
}
const post = (request, cookie, data) => request.post(`${origin}/api/issuance`, { headers: { Origin: origin, Cookie: cookie }, data });
async function counts() {
  const [[row]] = await database.admin.query('SELECT (SELECT COUNT(*) FROM issuance_documents) documents,(SELECT COUNT(*) FROM issuance_audit) audit,(SELECT COALESCE(SUM(last_number),0) FROM issuance_counters) allocated');
  return { documents: Number(row.documents), audit: Number(row.audit), allocated: Number(row.allocated) };
}

test.beforeAll(async () => {
  test.setTimeout(120000);
  database = await startDatabase();
  const secret = randomBytes(32).toString('hex');
  provider = await startIdentity({ secret, ttlMs: 300000, users: [...[1, 2, 3].map(n => ({ username: `issuer${n}`, password, staffId: `TEST-00${n}`, displayName: `ผู้ออกเลขทดสอบ ${n}`, departmentId: n === 3 ? 'TEST-D1' : '204', departmentName: 'หน่วยงานทดสอบ', active: true, faculty: true })), { username: 'movedOwner', password, staffId: 'TEST-001', displayName: 'เจ้าของย้ายหน่วยงาน', departmentId: 'TEST-D2', departmentName: 'หน่วยงานใหม่', active: true, faculty: true }] });
  logs = createWriteStream('.local/t05-e2e-server.log');
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3106'], {
    windowsHide: true, env: { ...process.env, NODE_ENV: 'development', NEXT_TEST_DIST: 't05', AUTH_PROVIDER: 'local', LOCAL_IDENTITY_URL: provider.url, LOCAL_IDENTITY_SECRET: secret, ISSUANCE_DATABASE_URL: database.url }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(logs); child.stderr.pipe(logs);
  await expect.poll(async () => { try { return (await fetch(`${origin}/login`)).status; } catch { return 0; } }, { timeout: 90000 }).toBe(200);
});
test.afterAll(async () => { child?.kill(); await provider?.close(); await database?.close(); logs?.end(); });
test.beforeEach(async () => {
  await database.admin.query('DROP TRIGGER IF EXISTS t05_fail_audit');
  await database.admin.query('DELETE FROM issuance_audit; DELETE FROM issuance_documents; DELETE FROM issuance_counters; DELETE FROM issuance_owner_locks; UPDATE issuance_grants SET active=TRUE');
});

test('HTTP rejects anonymous, cross-origin, invalid input, unknown series and stale dates without allocation', async ({ request }) => {
  expect((await request.get(`${origin}/api/issuance`)).status()).toBe(401);
  const cookie = await login(request);
  expect((await request.post(`${origin}/api/issuance`, { headers: { Origin: 'https://example.com', Cookie: cookie }, data: input() })).status()).toBe(403);
  for (const data of [input({ ownerId: 'TEST-002' }), input({ subject: '' }), input({ signer: '' }), input({ documentDate: '2000-01-01' }), input({ recipientDepartmentIds: [], externalOrganization: '' }), input({ documentDate: '2026-02-30' })]) expect((await post(request, cookie, data)).status()).toBe(400);
  for (const seriesId of ['unknown', '00047']) expect((await post(request, cookie, input({ seriesId }))).status()).toBe(403);
  await database.admin.query("UPDATE issuance_grants SET active=FALSE WHERE owner_id='TEST-001' AND series_id='TEST-S1'");
  expect((await post(request, cookie, input())).status()).toBe(403);
  expect(await counts()).toEqual({ documents: 0, audit: 0, allocated: 0 });
});

test('MySQL shared-series concurrent HTTP issuance produces unique contiguous numbers and atomic audit', async ({ request }) => {
  const cookies = [await login(request), await login(request, 'issuer2')];
  const results = await Promise.all(Array.from({ length: 16 }, (_, n) => post(request, cookies[n % 2], input({ subject: `พร้อมกัน ${n}` }))));
  for (const result of results) expect(result.status(), await result.text()).toBe(201);
  const documents = await Promise.all(results.map(async result => (await result.json()).document));
  expect(new Set(documents.map(doc => doc.number)).size).toBe(16);
  expect(documents.map(doc => Number(doc.number.split('/')[1])).sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, n) => n + 1));
  expect(await counts()).toEqual({ documents: 16, audit: 16, allocated: 16 });
});

test('identical concurrent retries return one committed record; changed payload conflicts even after pending-file gate', async ({ request }) => {
  const cookie = await login(request);
  const data = input({ confidential: false });
  const results = await Promise.all(Array.from({ length: 8 }, () => post(request, cookie, data)));
  expect(results.map(result => result.status()).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
  const documents = await Promise.all(results.map(async result => (await result.json()).document));
  expect(new Set(documents.map(doc => doc.id)).size).toBe(1);
  expect((await post(request, cookie, { ...data, subject: 'เปลี่ยนข้อมูล' })).status()).toBe(409);
  expect(await counts()).toEqual({ documents: 1, audit: 1, allocated: 1 });
});

test('pending PDF serializes owner across series; other owners and confidential books remain eligible', async ({ request }) => {
  const owner = await login(request), other = await login(request, 'issuer2');
  const results = await Promise.all(['TEST-S1', 'TEST-S2'].map(seriesId => post(request, owner, input({ confidential: false, seriesId }))));
  expect(results.map(result => result.status()).sort()).toEqual([201, 409]);
  // A later secret book must not hide the older pending record.
  expect((await post(request, owner, input())).status()).toBe(409);
  expect((await post(request, other, input())).status()).toBe(201);
  const newer = await post(request, other, input());
  expect(newer.status()).toBe(201);
  const newerId = (await newer.json()).document.id;
  // Synthetic migrated-history fixture: a newer secret item cannot mask an
  // older pending nonsecret item owned by the same person (X11).
  await database.admin.query("UPDATE issuance_documents SET owner_id='TEST-001',issued_at=DATE_ADD(issued_at,INTERVAL 1 SECOND) WHERE id=?", [newerId]);
  expect((await post(request, owner, input())).status()).toBe(409);
  await database.admin.query("UPDATE issuance_documents SET pdf_path='synthetic-fixture.pdf' WHERE owner_id='TEST-001' AND confidential=FALSE");
  expect((await post(request, owner, input())).status()).toBe(201);
  expect(await counts()).toEqual({ documents: 4, audit: 4, allocated: 4 });
});

test('MySQL audit failure rolls back document and counter, retry allocates without a gap', async ({ request }) => {
  const cookie = await login(request), data = input();
  await database.admin.query("CREATE TRIGGER t05_fail_audit BEFORE INSERT ON issuance_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic rollback test'");
  expect((await post(request, cookie, data)).status()).toBe(503);
  expect(await counts()).toEqual({ documents: 0, audit: 0, allocated: 0 });
  await database.admin.query('DROP TRIGGER t05_fail_audit');
  const retry = await post(request, cookie, data);
  expect(retry.status()).toBe(201);
  expect((await retry.json()).document.number).toBe('ทดสอบ 001/0001');
  expect(await counts()).toEqual({ documents: 1, audit: 1, allocated: 1 });
});

test('owner-only detail, latest list and audit do not expose another issuer document', async ({ request }) => {
  const owner = await login(request), other = await login(request, 'issuer2');
  const response = await post(request, owner, input());
  const { document } = await response.json();
  const own = await request.get(`${origin}/api/issuance/${document.id}`, { headers: { Cookie: owner } });
  expect(own.status()).toBe(200);
  expect((await own.json()).audit).toHaveLength(1);
  expect(own.headers()['cache-control']).toContain('no-store');
  expect((await request.get(`${origin}/api/issuance/${document.id}`, { headers: { Cookie: other } })).status()).toBe(404);
  const collection = await request.get(`${origin}/api/issuance`, { headers: { Cookie: other } });
  expect((await collection.json()).documents).toEqual([]);
});

test('mobile keyboard form shows loading, success, latest detail and pending-file rejection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/login`);
  await page.getByLabel('ชื่อบัญชี').fill('issuer1');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByLabel('รหัสผ่าน', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/workspace$/);
  await page.getByRole('link', { name: 'หน้าออกเลขเอกสาร', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/issuance$/);
  await page.getByLabel('เลขหนังสือ', { exact: true }).selectOption('TEST-S1');
  await page.getByLabel('เรื่อง', { exact: true }).fill('หนังสือทดสอบจากมือถือ');
  await page.getByLabel('ผู้รับ 1', { exact: true }).fill('ผู้รับตัวอย่าง');
  await page.getByLabel('หน่วยงานรับเรื่องภายนอกคณะ').fill('องค์กรตัวอย่าง');
  await page.getByLabel('ผู้ลงนาม', { exact: true }).fill('ผู้ลงนามตัวอย่าง');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/issuance', async route => { if (route.request().method() === 'POST') await gate; await route.continue(); }, { times: 1 });
  await page.getByRole('button', { name: 'ยืนยันขอเลข', exact: true }).click();
  await expect(page.getByRole('button', { name: 'กำลังดำเนินการ…' })).toBeDisabled();
  release();
  await expect(page.getByRole('status').filter({ hasText: 'ออกเลขสำเร็จ' })).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ทดสอบ 001/0001' })).toBeVisible();
  await page.getByRole('button', { name: /ทดสอบ 001\/0001.*หนังสือทดสอบจากมือถือ/ }).click();
  await expect(page.locator('.document-detail .eyebrow').filter({ hasText: 'รายละเอียดหนังสือ' })).toBeVisible();
  await page.getByLabel('เรื่อง', { exact: true }).fill('คำขอครั้งถัดไป');
  await page.getByLabel('เลขหนังสือ', { exact: true }).selectOption('TEST-S1');
  await page.getByLabel('ผู้รับ 1', { exact: true }).fill('ผู้รับตัวอย่าง');
  await page.getByLabel('หน่วยงานรับเรื่องภายนอกคณะ').fill('องค์กรตัวอย่าง');
  await page.getByLabel('ผู้ลงนาม', { exact: true }).fill('ผู้ลงนามตัวอย่าง');
  await page.getByRole('button', { name: 'ยืนยันขอเลข', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'ค้างแนบ PDF' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/t05-mobile-issuance.png', fullPage: true });
});

test('internal recipient departments are validated from server configuration', async ({ request }) => {
  const cookie = await login(request);
  const overview = await request.get(`${origin}/api/issuance`, { headers: { Cookie: cookie } });
  expect((await overview.json()).departments.map(item => item.id)).toContain('TEST-D1');
  for (const recipientDepartmentIds of [['unknown'], ['TEST-D1']]) {
    if (recipientDepartmentIds[0] === 'TEST-D1') await database.admin.query("UPDATE issuance_departments SET enabled=FALSE WHERE id='TEST-D1'");
    expect((await post(request, cookie, input({ externalOrganization: '', recipientDepartmentIds }))).status()).toBe(400);
  }
  await database.admin.query("UPDATE issuance_departments SET enabled=TRUE WHERE id='TEST-D1'");
  const result = await post(request, cookie, input({ externalOrganization: '', recipientDepartmentIds: ['TEST-D1', 'TEST-D2'] }));
  expect(result.status()).toBe(201);
  expect((await result.json()).document.recipientDepartmentIds).toEqual(['TEST-D1', 'TEST-D2']);
});

test('lost committed response survives reload and returns original number with the same request key', async ({ page }) => {
  await page.goto(`${origin}/login`);
  await page.getByLabel('ชื่อบัญชี').fill('issuer1');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByLabel('รหัสผ่าน', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/workspace$/);
  await page.getByRole('link', { name: 'หน้าออกเลขเอกสาร', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/issuance$/);
  const fill = async () => {
    await page.getByLabel('เลขหนังสือ', { exact: true }).selectOption('TEST-S1');
    await page.getByLabel('เรื่อง', { exact: true }).fill('ส่งซ้ำหลังตอบกลับหาย');
    await page.getByLabel('ผู้รับ 1', { exact: true }).fill('ผู้รับตัวอย่าง');
    await page.getByLabel('หน่วยงานรับเรื่องภายนอกคณะ').fill('องค์กรตัวอย่าง');
    await page.getByLabel('ผู้ลงนาม', { exact: true }).fill('ผู้ลงนามตัวอย่าง');
  };
  await fill();
  let signalCommitted;
  const committedSignal = new Promise(resolve => { signalCommitted = resolve; });
  await page.route('**/api/issuance', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const committed = await route.fetch();
    expect(committed.status()).toBe(201);
    signalCommitted();
    await route.abort('failed');
  }, { times: 1 });
  await page.getByRole('button', { name: 'ยืนยันขอเลข', exact: true }).click();
  await committedSignal;
  await expect(page.locator('.issuance-section [role="alert"]')).toBeVisible();
  expect(await counts()).toEqual({ documents: 1, audit: 1, allocated: 1 });
  const saved = await page.evaluate(() => sessionStorage.getItem('genbook-issuance-TEST-001'));
  expect(saved).not.toContain('ส่งซ้ำหลังตอบกลับหาย');
  expect(JSON.parse(saved).id).toMatch(/^[a-f0-9-]{36}$/);
  // Restore the exact fingerprint persisted by T05 before publication existed.
  // A UI upgrade must reuse this request key after a committed response is lost.
  const legacyForm = { seriesId: 'TEST-S1', subject: 'ส่งซ้ำหลังตอบกลับหาย', recipient: 'ผู้รับตัวอย่าง', signer: 'ผู้ลงนามตัวอย่าง', recipientDepartmentIds: [], externalOrganization: 'องค์กรตัวอย่าง', confidential: false, documentDate: today() };
  const legacySaved = { ...JSON.parse(saved), payload: createHash('sha256').update(JSON.stringify(legacyForm)).digest('hex') };
  await page.evaluate(value => sessionStorage.setItem('genbook-issuance-TEST-001', JSON.stringify(value)), legacySaved);
  await page.reload();
  await fill();
  const response = page.waitForResponse(result => result.url().endsWith('/api/issuance') && result.request().method() === 'POST');
  await page.getByRole('button', { name: 'ยืนยันขอเลข', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole('alertdialog').getByRole('status')).toContainText('ออกเลขสำเร็จ');
  await page.getByRole('alertdialog').getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ทดสอบ 001/0001' })).toBeVisible();
  expect(await counts()).toEqual({ documents: 1, audit: 1, allocated: 1 });
});

test('successful issuance with failed list refresh keeps success and only retries the list', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/login`);
  await page.getByLabel('ชื่อบัญชี').fill('issuer1');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByLabel('รหัสผ่าน', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/workspace$/);
  await page.getByRole('link', { name: 'หน้าออกเลขเอกสาร', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/issuance$/);
  await page.getByLabel('เลขหนังสือ', { exact: true }).selectOption('TEST-S1');
  await page.getByLabel('เรื่อง', { exact: true }).fill('สำเร็จแต่โหลดรายการไม่ได้');
  await page.getByLabel('ผู้รับ 1', { exact: true }).fill('ผู้รับทดสอบ');
  await page.getByLabel('หน่วยงานรับเรื่องภายนอกคณะ').fill('องค์กรตัวอย่าง');
  await page.getByLabel('ผู้ลงนาม', { exact: true }).fill('ผู้ลงนามทดสอบ');
  await page.getByRole('radio', { name: 'ลับ', exact: true }).check();
  let failed = false;
  await page.route('**/api/issuance', async route => {
    if (route.request().method() === 'GET' && !failed) {
      failed = true;
      return route.fulfill({ status: 503, json: { error: 'Synthetic refresh failure' } });
    }
    return route.continue();
  });
  await page.getByRole('button', { name: 'ยืนยันขอเลข', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ออกเลขสำเร็จแล้ว แต่โหลดรายการล่าสุดไม่สำเร็จ' })).toBeVisible();
  await page.getByRole('button', { name: 'โหลดรายการอีกครั้ง', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'ทดสอบ 001/0001' })).toBeVisible();
  await expect(page.getByLabel('เรื่อง', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: /ทดสอบ 001\/0001.*สำเร็จแต่โหลดรายการไม่ได้/ })).toBeVisible();
  expect(await counts()).toEqual({ documents: 1, audit: 1, allocated: 1 });
  expect(errors).toEqual([]);
});


test('T06 full HTTP read matrix, private audit, current reader department and original document department', async ({ request }) => {
  const owner = await login(request), same = await login(request, 'issuer2'), cross = await login(request, 'issuer3');
  const get = (cookie, id) => request.get(origin + '/api/issuance/' + id, { headers: { Cookie: cookie } });
  const docs = [];
  for (const confidential of [false, true]) for (const published of [false, true]) {
    const result = await post(request, owner, input({ confidential, published, subject: 'matrix-' + confidential + '-' + published, recipient: 'ผู้รับหนึ่ง\nผู้รับสอง', externalOrganization: '', recipientDepartmentIds: ['TEST-D1', 'TEST-D2'] }));
    expect(result.status(), await result.text()).toBe(201);
    const { document } = await result.json(); docs.push(document);
    expect(document).toMatchObject({ ownerId: 'TEST-001', ownerDepartmentId: '204', published, confidential, allocationStatus: 'allocated', recipient: 'ผู้รับหนึ่ง\nผู้รับสอง' });
    expect(document.recipientDepartments.map(d => d.name)).toEqual(['หน่วยงานทดสอบหนึ่ง', 'หน่วยงานทดสอบสอง']);
    expect(document.audit[0].details).toMatchObject({ published, confidential, recipients: ['ผู้รับหนึ่ง', 'ผู้รับสอง'] });
    for (const [cookie, allowed] of [[owner, true], [same, !confidential], [cross, !confidential && published]]) {
      const response = await get(cookie, document.id);
      expect(response.status()).toBe(allowed ? 200 : 404);
      const body = await response.json();
      if (!allowed) expect(body).toEqual({ error: 'ไม่พบรายการ' });
      else if (cookie !== owner) expect(body).not.toHaveProperty('audit');
    }
    // Synthetic attachment fixture, until T07 supplies the upload endpoint.
    await database.admin.query("UPDATE issuance_documents SET pdf_path='synthetic-fixture.pdf' WHERE id=?", [document.id]);
  }
  const list = async cookie => (await (await request.get(origin + '/api/issuance', { headers: { Cookie: cookie } })).json()).sharedDocuments;
  expect((await list(same)).map(d => d.id).sort()).toEqual(docs.filter(d => !d.confidential).map(d => d.id).sort());
  expect((await list(cross)).map(d => d.id)).toEqual([docs.find(d => !d.confidential && d.published).id]);
  expect((await get(owner, randomUUID())).status()).toBe(404);
  expect((await request.get(origin + '/api/issuance/' + docs[0].id, { headers: { Cookie: '' } })).status()).toBe(401);
  const moved = await login(request, 'movedOwner');
  for (const document of docs) expect((await get(moved, document.id)).status()).toBe(200);
  // Reading does not depend on allocation grants, nor recipient department membership.
  await database.admin.query("UPDATE issuance_grants SET active=FALSE WHERE owner_id='TEST-002'");
  expect((await get(same, docs[0].id)).status()).toBe(200);
  expect((await get(cross, docs[0].id)).status()).toBe(404);
  // Disabled reference names remain visible on already-issued books.
  await database.admin.query("UPDATE issuance_departments SET enabled=FALSE WHERE id='TEST-D1'");
  const old = await (await get(owner, docs[0].id)).json();
  expect(old.recipientDepartments[0].name).toBe('หน่วยงานทดสอบหนึ่ง');
  await database.admin.query("UPDATE issuance_departments SET enabled=TRUE WHERE id='TEST-D1'");
});

test('T06 invalid publication, recipient limits and forged metadata roll back without allocation', async ({ request }) => {
  const cookie = await login(request);
  for (const overrides of [{ published: null }, { published: 'false' }, { allocationStatus: 'allocated' }, { ownerDepartmentId: '204' }, { recipient: Array(21).fill('ผู้รับ').join('\n') }, { recipient: 'x'.repeat(201) }, { recipientDepartmentIds: ['TEST-D1'], externalOrganization: 'both' }]) {
    const response = await post(request, cookie, input(overrides));
    expect(response.status(), await response.text()).toBe(400);
  }
  expect(await counts()).toEqual({ documents: 0, audit: 0, allocated: 0 });
  const data = input();
  const first = await post(request, cookie, data);
  expect(first.status()).toBe(201);
  expect((await post(request, cookie, { ...data, published: false })).status()).toBe(200);
  expect((await post(request, cookie, { ...data, published: true })).status()).toBe(409);
  // A committed T05 request used a hash without published. Upgrading must not
  // allocate another number or reject an identical lost-response retry.
  const legacyPayload = { seriesId: data.seriesId, subject: data.subject, recipients: [data.recipient], signer: data.signer, externalOrganization: data.externalOrganization, recipientDepartmentIds: data.recipientDepartmentIds, documentDate: data.documentDate, confidential: data.confidential };
  await database.admin.query('UPDATE issuance_documents SET payload_hash=? WHERE request_key=?', [createHash('sha256').update(JSON.stringify(legacyPayload)).digest('hex'), data.requestId]);
  expect((await post(request, cookie, data)).status()).toBe(200);
  expect((await post(request, cookie, { ...data, published: true })).status()).toBe(409);
  expect(await counts()).toEqual({ documents: 1, audit: 1, allocated: 1 });
});

test('T06 browser captures complete internal details and published secret remains owner-only', async ({ page, request }) => {
  await page.goto(origin + '/login');
  await page.getByLabel('ชื่อบัญชี').fill('issuer1');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByLabel('รหัสผ่าน', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/workspace$/);
  await page.getByRole('link', { name: 'หน้าออกเลขเอกสาร', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/issuance$/);
  await page.getByLabel('เลขหนังสือ', { exact: true }).selectOption('TEST-S1');
  await page.getByLabel('เรื่อง', { exact: true }).fill('รายละเอียดครบ T06');
  await page.getByLabel('ผู้รับ 1', { exact: true }).fill('ผู้รับหนึ่ง');
  await page.getByRole('button', { name: 'เพิ่มผู้รับ', exact: true }).click();
  await page.getByLabel('ผู้รับ 2', { exact: true }).fill('ผู้รับสอง');
  await page.getByRole('radio', { name: 'ภายในคณะ', exact: true }).check();
  await page.getByLabel('หน่วยงานรับเรื่องภายในคณะ (เลือกได้หลายหน่วยงาน)').selectOption(['TEST-D1', 'TEST-D2']);
  await page.getByLabel('ผู้ลงนาม', { exact: true }).fill('ผู้ลงนาม T06');
  await page.getByRole('radio', { name: 'ลับ', exact: true }).check();
  await page.getByRole('radio', { name: 'เผยแพร่', exact: true }).check();
  await page.getByRole('button', { name: 'ยืนยันขอเลข', exact: true }).click();
  await expect(page.getByRole('alertdialog').getByRole('status')).toContainText('ออกเลขสำเร็จ');
  await page.getByRole('alertdialog').getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  const detail = page.locator('.document-detail');
  await expect(detail).toContainText('TEST-001');
  await expect(detail).toContainText('ผู้รับหนึ่ง');
  await expect(detail).toContainText('ผู้รับสอง');
  await expect(detail).toContainText('หน่วยงานทดสอบหนึ่ง, หน่วยงานทดสอบสอง');
  await expect(detail).toContainText('ความลับจำกัดให้เฉพาะเจ้าของอ่าน');
  await expect(detail).toContainText('จัดสรรแล้ว');
  await expect(detail).toContainText('บันทึกและออกเลขหนังสือ');
  const cookie = await login(request, 'issuer2');
  const shared = await (await request.get(origin + '/api/issuance', { headers: { Cookie: cookie } })).json();
  expect(shared.sharedDocuments).toEqual([]);
  await page.screenshot({ path: '.local/t06-document-details.png', fullPage: true });
});


test('T06 browser opens shared books without audit and clears details when access is revoked', async ({ page, request }) => {
  const owner = await login(request);
  const result = await post(request, owner, input({ confidential: false, published: true, subject: 'อ่านร่วมข้ามหน่วยงาน' }));
  expect(result.status()).toBe(201);
  const { document } = await result.json();
  // Many newer hidden books must not crowd authorized records out of the list.
  await database.admin.query("UPDATE issuance_documents SET pdf_path='synthetic-fixture.pdf' WHERE id=?", [document.id]);
  for (let n = 0; n < 11; n++) expect((await post(request, owner, input())).status()).toBe(201);
  await page.goto(origin + '/login');
  await page.getByLabel('ชื่อบัญชี').fill('issuer3');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByLabel('รหัสผ่าน', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/workspace$/);
  await page.getByRole('link', { name: 'หน้าออกเลขเอกสาร', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/issuance$/);
  const button = page.getByRole('button', { name: /อ่านร่วมข้ามหน่วยงาน/ });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('.document-detail')).toContainText('อ่านร่วมข้ามหน่วยงาน');
  await expect(page.getByRole('heading', { name: 'ประวัติของหนังสือ' })).toHaveCount(0);
  // Synthetic amendment fixture; production editing belongs to T09.
  await database.admin.query('UPDATE issuance_documents SET confidential=TRUE WHERE id=?', [document.id]);
  await button.click();
  await expect(page.getByRole('alert').filter({ hasText: 'ไม่พบรายการ' })).toBeVisible();
  await expect(page.locator('.document-detail')).toHaveCount(0);
});


test('series choices follow signed-in account grants, auto-select one choice and disable issuance without grants', async ({ page }) => {
  await login(page.request, 'issuer1');
  await page.goto(origin + '/workspace/issuance');
  const series = page.getByRole('combobox', { name: 'เลขหนังสือ', exact: true });
  await expect(series.locator('option[value="TEST-S1"]')).toHaveCount(1);
  await expect(series.locator('option[value="TEST-S2"]')).toHaveCount(1);
  await expect(series).toHaveValue('');
  await database.admin.query("UPDATE issuance_grants SET active=FALSE WHERE owner_id='TEST-001' AND series_id<>'TEST-S1'");
  await page.reload();
  await expect(series).toHaveValue('TEST-S1');
  await expect(series.locator('option[value="TEST-S2"]')).toHaveCount(0);
  await database.admin.query("UPDATE issuance_grants SET active=FALSE WHERE owner_id='TEST-002' AND series_id<>'TEST-S2'");
  await login(page.request, 'issuer2');
  await page.reload();
  await expect(series).toHaveValue('TEST-S2');
  await expect(series.locator('option[value="TEST-S1"]')).toHaveCount(0);
  await expect(page.getByLabel('ผู้ขอเลข', { exact: true })).toHaveValue('ผู้ออกเลขทดสอบ 2');
  await database.admin.query("UPDATE issuance_grants SET active=FALSE WHERE owner_id='TEST-002'");
  await page.reload();
  await expect(page.getByText('ยังไม่มีชุดเลขที่ได้รับสิทธิ์ กรุณาติดต่อผู้ดูแลระบบ')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ยืนยันขอเลข', exact: true })).toBeDisabled();
  expect(await counts()).toEqual({ documents: 0, audit: 0, allocated: 0 });
});
