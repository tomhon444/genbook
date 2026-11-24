import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { startIdentity } from '../tools/local-auth/provider.mjs';
import { startDatabase } from '../tools/issuance/database.mjs';

const origin = 'http://127.0.0.1:3109';
const password = 'Synthetic-T07-only-42';
const limit = 2097152;
let database, provider, child, logs, pdf;
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const input = (overrides = {}) => ({ requestId: randomUUID(), seriesId: 'TEST-S1', subject: 'PDF ทดสอบ', recipient: 'ผู้รับทดสอบ', recipientDepartmentIds: [], externalOrganization: 'องค์กรทดสอบ', signer: 'ผู้ลงนาม', confidential: true, documentDate: today(), ...overrides });
async function login(request, username = 'owner') {
  const result = await request.post(origin + '/api/auth/login', { headers: { Origin: origin, Cookie: '' }, data: { username, password } });
  expect(result.status()).toBe(200);
  return result.headers()['set-cookie'].split(';')[0];
}
const post = (request, cookie, data) => request.post(origin + '/api/issuance', { headers: { Origin: origin, Cookie: cookie }, data });
const endpoint = id => `${origin}/api/issuance/${id}/pdf`;
const upload = (request, cookie, id, bytes = pdf, version = 1, headers = {}) => request.put(endpoint(id), { headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/pdf', 'If-Match': String(version), ...headers }, data: bytes });
const download = (request, cookie, id) => request.get(endpoint(id), { headers: { Cookie: cookie } });
async function issue(request, cookie, overrides) {
  const result = await post(request, cookie, input(overrides));
  expect(result.status(), await result.text()).toBe(201);
  return (await result.json()).document;
}
async function state(id) {
  const [[row]] = await database.admin.query('SELECT pdf_path,version FROM issuance_documents WHERE id=?', [id]);
  const [[count]] = await database.admin.query('SELECT COUNT(*) total FROM issuance_audit WHERE document_id=?', [id]);
  return { ...row, audit: Number(count.total) };
}

test.beforeAll(async () => {
  test.setTimeout(120000);
  const doc = await PDFDocument.create(); doc.addPage([240, 320]);
  pdf = Buffer.from(await doc.save({ useObjectStreams: false }));
  database = await startDatabase();
  const secret = randomBytes(32).toString('hex');
  provider = await startIdentity({ secret, ttlMs: 600000, users: ['owner', 'same', 'cross'].map((username, index) => ({ username, password, staffId: `TEST-00${index + 1}`, displayName: username, departmentId: index === 2 ? 'TEST-D1' : '204', departmentName: 'หน่วยงานทดสอบ', active: true, faculty: true })) });
  await mkdir('.local', { recursive: true });
  logs = createWriteStream('.local/t07-e2e-server.log');
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3109'], {
    windowsHide: true, env: { ...process.env, NODE_ENV: 'development', NEXT_TEST_DIST: 't07', AUTH_PROVIDER: 'local', LOCAL_IDENTITY_URL: provider.url, LOCAL_IDENTITY_SECRET: secret, ISSUANCE_DATABASE_URL: database.url }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(logs); child.stderr.pipe(logs);
  await expect.poll(async () => { try { return (await fetch(origin + '/login')).status; } catch { return 0; } }, { timeout: 90000 }).toBe(200);
});
test.afterAll(async () => { child?.kill(); await provider?.close(); await database?.close(); logs?.end(); });
test.beforeEach(async () => {
  await database.admin.query('DROP TRIGGER IF EXISTS t07_fail_audit');
  await database.admin.query('DELETE FROM issuance_audit; DELETE FROM issuance_documents; DELETE FROM issuance_counters; DELETE FROM issuance_owner_locks');
});

test('PDF upload clears pending gate, returns protected bytes and records one atomic audit', async ({ request }) => {
  const cookie = await login(request), document = await issue(request, cookie, { confidential: false });
  expect(document.pdfPending).toBe(true);
  expect((await post(request, cookie, input())).status()).toBe(409);
  const attached = await upload(request, cookie, document.id);
  expect(attached.status(), await attached.text()).toBe(200);
  expect(await attached.json()).toMatchObject({ id: document.id, version: 2, hasPdf: true, pdfPending: false });
  const response = await download(request, cookie, document.id);
  expect(response.status()).toBe(200);
  expect(await response.body()).toEqual(pdf);
  expect(response.headers()).toMatchObject({ 'content-type': 'application/pdf', 'x-content-type-options': 'nosniff' });
  expect(response.headers().vary.split(',').map(value => value.trim())).toContain('Cookie');
  expect(response.headers()['content-disposition']).toContain('attachment;');
  expect(response.headers()['cache-control']).toContain('no-store');
  expect((await state(document.id))).toMatchObject({ version: 2, audit: 2 });
  expect((await post(request, cookie, input())).status()).toBe(201);
  const detail = await (await request.get(`${origin}/api/issuance/${document.id}`, { headers: { Cookie: cookie } })).json();
  expect(detail.audit[1].event).toBe('pdf_attached');
  expect(JSON.stringify(detail)).not.toContain((await state(document.id)).pdf_path);
});

test('download follows confidentiality/department/publication matrix and upload stays owner-only', async ({ request }) => {
  const owner = await login(request), same = await login(request, 'same'), cross = await login(request, 'cross');
  for (const confidential of [false, true]) for (const published of [false, true]) {
    const document = await issue(request, owner, { confidential, published });
    expect((await upload(request, owner, document.id)).status()).toBe(200);
    for (const [cookie, allowed] of [[owner, true], [same, !confidential], [cross, !confidential && published]]) {
      const response = await download(request, cookie, document.id);
      expect(response.status()).toBe(allowed ? 200 : 404);
      if (!allowed) expect((await response.json()).error).toBeTruthy();
    }
    expect((await upload(request, same, document.id, pdf, 2)).status()).toBe(404);
    expect((await upload(request, cross, document.id, pdf, 2)).status()).toBe(404);
    expect((await upload(request, '', document.id)).status()).toBe(401);
    expect((await download(request, '', document.id)).status()).toBe(401);
    expect((await upload(request, owner, document.id, pdf, 2, { Origin: 'https://example.com' })).status()).toBe(403);
  }
  expect((await download(request, owner, randomUUID())).status()).toBe(404);
});

test('invalid content, encrypted and oversized replacements preserve the original PDF and version', async ({ request }) => {
  const owner = await login(request), document = await issue(request, owner);
  expect((await upload(request, owner, document.id)).status()).toBe(200);
  const before = await state(document.id);
  const encrypted = Buffer.from(pdf.toString('latin1').replace(/trailer\s*<</, 'trailer\n<< /Encrypt 1 0 R '), 'latin1');
  expect(encrypted.equals(pdf)).toBe(false);
  const contentDoc = await PDFDocument.create(); contentDoc.addPage().drawText('synthetic content');
  const brokenStream = Buffer.from(await contentDoc.save({ useObjectStreams: false }));
  const begin = brokenStream.indexOf(Buffer.from('stream\n')) + 7;
  brokenStream.fill(65, begin, brokenStream.indexOf(Buffer.from('\nendstream'), begin));
  const missingRefs = [];
  for (const field of ['Contents', 'Resources']) {
    const broken = await PDFDocument.create();
    broken.addPage().node.set(PDFName.of(field), PDFRef.of(9999, 0));
    missingRefs.push(Buffer.from(await broken.save({ useObjectStreams: false })));
  }
  for (const [bytes, contentType, status] of [[Buffer.from('<html>fake.pdf</html>'), 'application/pdf', 400], [Buffer.from('%PDF-1.7\nnot a PDF\n%%EOF'), 'application/pdf', 400], [encrypted, 'application/pdf', 400], [brokenStream, 'application/pdf', 400], ...missingRefs.map(bytes => [bytes, 'application/pdf', 400]), [pdf, 'image/png', 415], [Buffer.alloc(limit + 1), 'application/pdf', 413]]) {
    expect((await upload(request, owner, document.id, bytes, 2, { 'Content-Type': contentType })).status()).toBe(status);
    expect(await state(document.id)).toEqual(before);
    expect(await (await download(request, owner, document.id)).body()).toEqual(pdf);
  }
  expect((await upload(request, owner, document.id, pdf, 2, { 'If-Match': '' })).status()).toBe(400);
});

test('PDF exact 2 MiB boundary is accepted while one additional byte is rejected', async ({ request }) => {
  const owner = await login(request), document = await issue(request, owner, { confidential: false });
  const boundary = Buffer.concat([pdf.subarray(0, pdf.lastIndexOf('%%EOF')), Buffer.alloc(limit - pdf.length, 32), pdf.subarray(pdf.lastIndexOf('%%EOF'))]);
  expect(boundary.length).toBe(limit);
  expect((await upload(request, owner, document.id, Buffer.concat([boundary, Buffer.from(' ')]))).status()).toBe(413);
  expect(await state(document.id)).toMatchObject({ pdf_path: null, version: 1, audit: 1 });
  expect((await post(request, owner, input())).status()).toBe(409);
  expect((await upload(request, owner, document.id, boundary)).status()).toBe(200);
  expect(await (await download(request, owner, document.id)).body()).toEqual(boundary);
});

test('concurrent same-version replacements commit once and stale versions cannot overwrite', async ({ request }) => {
  const owner = await login(request), document = await issue(request, owner);
  const responses = await Promise.all([upload(request, owner, document.id), upload(request, owner, document.id)]);
  expect(responses.map(response => response.status()).sort()).toEqual([200, 409]);
  const before = await state(document.id);
  expect(before).toMatchObject({ version: 2, audit: 2 });
  expect((await upload(request, owner, document.id)).status()).toBe(409);
  expect(await state(document.id)).toEqual(before);
  expect((await upload(request, owner, document.id, pdf, 2)).status()).toBe(200);
  expect(await state(document.id)).toMatchObject({ version: 3, audit: 3 });
  const detail = await (await request.get(`${origin}/api/issuance/${document.id}`, { headers: { Cookie: owner } })).json();
  const digest = createHash('sha256').update(pdf).digest('hex');
  expect(detail.audit[1].details).toMatchObject({ previousSha256: null, previousBytes: null, previousVersion: 1, sha256: digest, bytes: pdf.length, version: 2 });
  expect(detail.audit[2]).toMatchObject({ event: 'pdf_replaced', details: { previousSha256: digest, previousBytes: pdf.length, previousVersion: 2, sha256: digest, bytes: pdf.length, version: 3 } });
});

test('audit failure rolls back pending upload and replacement; retry uses original document', async ({ request }) => {
  const owner = await login(request), document = await issue(request, owner, { confidential: false });
  const fail = () => database.admin.query("CREATE TRIGGER t07_fail_audit BEFORE INSERT ON issuance_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic T07 rollback'");
  await fail();
  expect((await upload(request, owner, document.id)).status()).toBe(503);
  expect(await state(document.id)).toMatchObject({ pdf_path: null, version: 1, audit: 1 });
  expect((await post(request, owner, input())).status()).toBe(409);
  await database.admin.query('DROP TRIGGER t07_fail_audit');
  expect((await upload(request, owner, document.id)).status()).toBe(200);
  const before = await state(document.id);
  await fail();
  expect((await upload(request, owner, document.id, pdf, 2)).status()).toBe(503);
  expect(await state(document.id)).toEqual(before);
  expect(await (await download(request, owner, document.id)).body()).toEqual(pdf);
});

test('storage write failure preserves pending state and missing blob never downloads successfully', async ({ request }) => {
  const owner = await login(request), document = await issue(request, owner, { confidential: false });
  const directory = path.resolve('.local/private-pdf'), held = directory + '-' + randomUUID();
  await mkdir(directory, { recursive: true });
  await rename(directory, held);
  try {
    await writeFile(directory, 'synthetic storage failure');
    expect((await upload(request, owner, document.id)).status()).toBe(503);
    expect(await state(document.id)).toMatchObject({ pdf_path: null, version: 1, audit: 1 });
  } finally { await rm(directory, { force: true }); await rename(held, directory); }
  expect((await upload(request, owner, document.id)).status()).toBe(200);
  const stored = await state(document.id);
  const blob = path.join(directory, stored.pdf_path), moved = blob + '.held';
  await rename(blob, moved);
  try { expect((await download(request, owner, document.id)).status()).toBe(503); }
  finally { await rename(moved, blob); }
  expect((await request.get(origin + '/.local/private-pdf/' + stored.pdf_path)).status()).toBe(404);
});

test('browser selects PDF, announces loading/error, uploads and downloads with accessible controls', async ({ page, request }) => {
  const owner = await login(request), document = await issue(request, owner, { confidential: false, subject: 'แนบ PDF จากมือถือ' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/login');
  await page.getByLabel('ชื่อบัญชี').fill('owner');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByLabel('รหัสผ่าน', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/workspace$/);
  await page.getByRole('link', { name: 'หน้าออกเลขเอกสาร', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/issuance$/);
  await page.getByRole('button', { name: /แนบ PDF จากมือถือ/ }).click();
  const file = page.getByLabel('แนบ PDF', { exact: true });
  await file.setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('fake') });
  await page.getByRole('button', { name: 'บันทึก PDF', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /PDF/ })).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  await file.setInputFiles({ name: 'document.pdf', mimeType: 'application/pdf', buffer: pdf });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/issuance/*/pdf', async route => { if (route.request().method() === 'PUT') await gate; await route.continue(); }, { times: 1 });
  await page.getByRole('button', { name: 'บันทึก PDF', exact: true }).click();
  await expect(page.getByRole('button', { name: 'กำลังแนบ PDF…', exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('alertdialog').getByRole('status')).toContainText('บันทึก PDF สำเร็จ');
  await page.getByRole('alertdialog').getByRole('button', { name: 'ปิดการแจ้งเตือน', exact: true }).click();
  const link = page.getByRole('link', { name: 'ดาวน์โหลด PDF', exact: true });
  await expect(link).toBeVisible();
  const downloading = page.waitForEvent('download'); await link.click();
  expect((await downloading).suggestedFilename()).toBe(`document-${document.id}.pdf`);
  expect(await state(document.id)).toMatchObject({ version: 2, audit: 2 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/t07-mobile-pdf.png', fullPage: true });
});
