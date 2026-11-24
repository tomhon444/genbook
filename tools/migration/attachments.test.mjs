import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildAttachmentInventory, downloadInventory, fetchLegacyAttachment, LEGACY_UPLOAD_BASE } from './attachments.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const pdf = Buffer.from('%PDF-1.4\nsynthetic archive only\n%%EOF');
const source = rows => ({ sourceSha256: hash('synthetic legacy attachment source'), tables: { genbook: { records: rows } } });
const row = (id, file = 'abc', extension = '.pdf') => ({ gen_book_id: id, gen_book_year: '2569', document_file: file, document_extension: extension, secret: '1' });
async function fixture(t, rows = [row('1')]) {
  const root = await mkdtemp(path.join(tmpdir(), 'legacy-attachments-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, inventory: buildAttachmentInventory(source(rows)), minFreeBytes: 0 };
}
const goodFetch = async () => new Response(pdf, { headers: { 'Content-Length': String(pdf.length) } });

test('inventory preserves each document ID, missing refs and invalid paths without exposing contents', () => {
  const inventory = buildAttachmentInventory(source([row('1'), row('2', ''), row('3', '../secret'), row('4', 'https://evil'), row('5', 'abc', '.doc'), row('6', 'abc', '.PDF')]));
  assert.deepEqual(inventory.entries.map(entry => entry.status), ['pending', 'missing_reference', 'invalid_reference', 'invalid_reference', 'invalid_reference', 'pending']);
  assert.equal(inventory.entries[0].sourcePath, '2569/abc.pdf');
  assert.ok(!JSON.stringify(inventory).includes('secret'));
  assert.throws(() => buildAttachmentInventory(source([row('1'), row('1')])));
});

test('same source filename is downloaded once and separately associated with both documents', async t => {
  const options = await fixture(t, [row('1'), row('2')]);
  let calls = 0;
  const result = await downloadInventory({ ...options, fetchImpl: async (url, request) => {
    calls++;
    assert.equal(url, `${LEGACY_UPLOAD_BASE}2569/abc.pdf`);
    assert.equal(request.redirect, 'error');
    return goodFetch();
  } });
  assert.equal(calls, 1);
  assert.equal(result.downloadedDocuments, 2);
  assert.equal(result.uniqueReferencedFiles, 1);
  assert.equal(result.appDownloadReady, false);
  assert.equal((await readdir(path.join(options.root, 'blobs'))).length, 1);
  const records = (await readFile(path.join(options.root, 'results.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(record => record.sourceId), ['1', '2']);
  assert.equal(records[0].sha256, hash(pdf));
  assert.equal(records[0].bytes, pdf.length);
  assert.equal(records[0].blob, `blobs/${hash(pdf)}.pdf`);
  assert.ok(!JSON.stringify(records).includes('secret'));
});

test('verified replay performs no network calls and can recover an interrupted final journal line', async t => {
  const options = await fixture(t);
  await downloadInventory({ ...options, fetchImpl: goodFetch });
  await appendFile(path.join(options.root, 'results.jsonl'), '{"partial":');
  const replay = await downloadInventory({ ...options, fetchImpl: () => { throw new Error('must not fetch'); } });
  assert.equal(replay.downloadedDocuments, 1);
  assert.equal(replay.resumedDocuments, 1);
  assert.equal(replay.attemptedFiles, 0);
  assert.ok((await readFile(path.join(options.root, 'results.jsonl'), 'utf8')).endsWith('\n'));
});

test('different snapshot or modified inventory never overwrites original archive', async t => {
  const options = await fixture(t);
  await downloadInventory({ ...options, maxFiles: 0 });
  const original = await readFile(path.join(options.root, 'inventory.json'), 'utf8');
  const different = buildAttachmentInventory({ ...source([row('1')]), sourceSha256: hash('different') });
  await assert.rejects(downloadInventory({ ...options, inventory: different, maxFiles: 0 }), /different source inventory/);
  assert.equal(await readFile(path.join(options.root, 'inventory.json'), 'utf8'), original);
  const tampered = structuredClone(options.inventory);
  tampered.entries[0].sourcePath = '../elsewhere.pdf';
  await assert.rejects(downloadInventory({ ...options, inventory: tampered }), /digest/);
});

test('missing and invalid references are counted while HTTP errors and redirects are retained for retry', async t => {
  const options = await fixture(t, [row('1'), row('2', ''), row('3', '../file'), row('4', 'second')]);
  const result = await downloadInventory({ ...options, fetchImpl: async url => new Response(null, { status: url.includes('second') ? 302 : 404 }) });
  assert.deepEqual([result.missingReferences, result.invalidReferences, result.failedDocuments], [1, 1, 2]);
  const journal = await readFile(path.join(options.root, 'results.jsonl'), 'utf8');
  assert.match(journal, /HTTP_404/);
  assert.match(journal, /REDIRECT_REFUSED/);
  const retry = await downloadInventory({ ...options, fetchImpl: goodFetch });
  assert.equal(retry.downloadedDocuments, 2);
  assert.equal(retry.failedDocuments, 0);
});

test('partial responses and HTML pages never publish a blob', async t => {
  const options = await fixture(t);
  const truncated = await downloadInventory({ ...options, fetchImpl: async () => new Response(pdf, { headers: { 'Content-Length': String(pdf.length + 1) } }) });
  assert.equal(truncated.failedDocuments, 1);
  const html = await downloadInventory({ ...options, fetchImpl: async () => new Response('<html>login</html>') });
  assert.equal(html.failedDocuments, 1);
  const broken = await downloadInventory({ ...options, fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(pdf); controller.error(new Error('connection lost')); } })) });
  assert.equal(broken.failedDocuments, 1);
  assert.deepEqual(await readdir(path.join(options.root, 'blobs')), []);
  assert.deepEqual(await readdir(path.join(options.root, 'temporary')), []);
});

test('oversized response refuses both declared length and chunked overflow', async t => {
  const options = await fixture(t);
  const declared = await downloadInventory({ ...options, maxBytes: 5, fetchImpl: goodFetch });
  assert.equal(declared.failedDocuments, 1);
  const streamed = await downloadInventory({ ...options, maxBytes: 5, fetchImpl: async () => new Response(pdf) });
  assert.equal(streamed.failedDocuments, 1);
  assert.deepEqual(await readdir(path.join(options.root, 'blobs')), []);
});

test('corrupt existing blob is invalidated and not silently overwritten or claimed downloaded', async t => {
  const options = await fixture(t);
  await downloadInventory({ ...options, fetchImpl: goodFetch });
  const blob = path.join(options.root, 'blobs', `${hash(pdf)}.pdf`);
  await writeFile(blob, 'corrupt');
  const noNetwork = await downloadInventory({ ...options, maxFiles: 0 });
  assert.equal(noNetwork.downloadedDocuments, 0);
  assert.equal(noNetwork.failedDocuments, 1);
  const attempted = await downloadInventory({ ...options, fetchImpl: goodFetch });
  assert.equal(attempted.downloadedDocuments, 0);
  assert.equal(attempted.failedDocuments, 1);
  assert.equal(await readFile(blob, 'utf8'), 'corrupt');
});

test('file limit holds under concurrent workers and unfinished refs remain pending', async t => {
  const options = await fixture(t, [row('1', 'a'), row('2', 'b'), row('3', 'c'), row('4', 'd')]);
  let calls = 0;
  const result = await downloadInventory({ ...options, concurrency: 4, maxFiles: 1, fetchImpl: async () => { calls++; return goodFetch(); } });
  assert.equal(calls, 1);
  assert.equal(result.downloadedDocuments, 1);
  assert.equal(result.pendingDocuments, 3);
});

test('low disk space pauses before downloading and preserves inventory for resume', async t => {
  const options = await fixture(t);
  let calls = 0;
  const result = await downloadInventory({ ...options, minFreeBytes: Number.MAX_SAFE_INTEGER, fetchImpl: async () => { calls++; return goodFetch(); } });
  assert.equal(calls, 0);
  assert.equal(result.paused, true);
  assert.equal(result.pauseReason, 'LOW_DISK_SPACE');
  assert.equal(result.pendingDocuments, 1);
});

test('malformed complete journal record and concurrent importer lock fail closed', async t => {
  const options = await fixture(t);
  await downloadInventory({ ...options, maxFiles: 0 });
  await writeFile(path.join(options.root, 'results.jsonl'), '{"bad":true}\n');
  await assert.rejects(downloadInventory(options), /does not match/);
  await writeFile(path.join(options.root, 'import.lock'), 'another process');
  await assert.rejects(downloadInventory(options), error => error.code === 'EEXIST');
});

test('default transport refuses traversal and external hosts before issuing requests', async () => {
  await assert.rejects(fetchLegacyAttachment('https://example.com/file.pdf'), /Unapproved/);
  await assert.rejects(fetchLegacyAttachment(`${LEGACY_UPLOAD_BASE}../secret.pdf`), /Unapproved/);
  await assert.rejects(fetchLegacyAttachment(`${LEGACY_UPLOAD_BASE}2569/file.pdf?redirect=evil`), /Unapproved/);
});

test('callback failure retains lock until all in-flight downloads and journal writes settle', async t => {
  const options = await fixture(t, [row('1', 'a'), row('2', 'b')]);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0, callbackCalled;
  const callbackReached = new Promise(resolve => { callbackCalled = resolve; });
  let settled = false;
  const pending = downloadInventory({ ...options, concurrency: 2,
    fetchImpl: async () => { if (++calls === 2) await gate; return goodFetch(); },
    progress: () => { callbackCalled(); throw new Error('synthetic callback failure'); },
  });
  pending.then(() => { settled = true; }, () => { settled = true; });
  await callbackReached;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(settled, false);
  assert.equal((await stat(path.join(options.root, 'import.lock'))).isFile(), true);
  release();
  await assert.rejects(pending, /synthetic callback failure/);
  await assert.rejects(stat(path.join(options.root, 'import.lock')), error => error.code === 'ENOENT');
  const resumed = await downloadInventory({ ...options, fetchImpl: () => { throw new Error('already complete'); } });
  assert.equal(resumed.downloadedDocuments, 2);
});
