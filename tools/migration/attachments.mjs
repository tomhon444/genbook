import https from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import { link, mkdir, open, readFile, realpath, rename, stat, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { readDump } from './dump.mjs';

export const LEGACY_UPLOAD_BASE = 'https://infor.eng.psu.ac.th/generate_bookno/book/uploads/';
const digest = value => createHash('sha256').update(value).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = message => new Error(message);
const agent = new https.Agent({ keepAlive: true, maxSockets: 4, ciphers: 'DEFAULT:!DHE', minVersion: 'TLSv1.2' });

/** Legacy server offers weak DHE. Exclude DHE, keep certificate verification and TLS >= 1.2. */
export async function fetchLegacyAttachment(url, { signal } = {}) {
  if (typeof url !== 'string' || !url.startsWith(LEGACY_UPLOAD_BASE) ||
      !/^[23]\d{3}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,199}\.pdf$/i.test(url.slice(LEGACY_UPLOAD_BASE.length)) ||
      url.includes('..')) throw fail('Unapproved attachment URL');
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: 'GET', agent, signal }, response => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
      }
      if ([204, 205, 304].includes(response.statusCode)) {
        response.resume(); resolve(new Response(null, { status: response.statusCode, headers }));
      } else resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers }));
    });
    request.once('error', reject);
    request.end();
  });
}
export function closeAttachmentTransport() { agent.destroy(); }

/** Inventory is archival provenance, not permission to expose any legacy file. */
export function buildAttachmentInventory(dump) {
  if (!hex(dump?.sourceSha256) || !Array.isArray(dump?.tables?.genbook?.records)) throw fail('Invalid source snapshot');
  const seen = new Set();
  const entries = dump.tables.genbook.records.map(row => {
    const sourceId = row.gen_book_id;
    if (typeof sourceId !== 'string' || !/^\d+$/.test(sourceId) || seen.has(sourceId)) throw fail('Invalid or duplicate document source ID');
    seen.add(sourceId);
    const base = { sourceId };
    if (row.document_file === null || row.document_file === undefined || row.document_file === '') return { ...base, status: 'missing_reference' };
    const year = row.gen_book_year, filename = row.document_file, extension = row.document_extension;
    if (typeof year !== 'string' || !/^[23]\d{3}$/.test(year) || typeof filename !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(filename) || filename.includes('..') ||
        typeof extension !== 'string' || !/^\.pdf$/i.test(extension)) return { ...base, status: 'invalid_reference' };
    return { ...base, status: 'pending', sourcePath: `${year}/${filename}${extension}` };
  });
  const inventory = { version: 1, sourceSha256: dump.sourceSha256, baseUrl: LEGACY_UPLOAD_BASE, entries };
  return { ...inventory, inventorySha256: digest(JSON.stringify(inventory)) };
}

async function privateRoot(root) {
  if (!path.isAbsolute(root)) throw fail('Attachment archive requires an absolute private directory');
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (path.resolve(await realpath(root)).toLowerCase() !== path.resolve(root).toLowerCase()) throw fail('Archive root must not be redirected');
  for (const name of ['blobs', 'temporary']) {
    const directory = path.join(root, name);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (path.resolve(await realpath(directory)).toLowerCase() !== path.resolve(directory).toLowerCase()) throw fail('Archive directory must not be redirected');
  }
}

async function bindInventory(root, inventory) {
  const expected = JSON.stringify(inventory);
  const filename = path.join(root, 'inventory.json');
  const temporary = path.join(root, `inventory.${randomBytes(8).toString('hex')}.tmp`);
  await writeNewFile(temporary, expected);
  try { await link(temporary, filename); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  finally { await unlink(temporary); }
  await assertDirectFile(filename);
  if (await readFile(filename, 'utf8') !== expected) throw fail('Archive belongs to a different source inventory');
}
async function assertDirectFile(filename) {
  if (path.resolve(await realpath(filename)).toLowerCase() !== path.resolve(filename).toLowerCase()) throw fail('Archive file must not be redirected');
}
async function writeNewFile(filename, bytes) {
  const handle = await open(filename, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function blobMatches(root, result) {
  if (!hex(result.sha256) || result.blob !== `blobs/${result.sha256}.pdf` || !Number.isSafeInteger(result.bytes) || result.bytes < 5) return false;
  const filename = path.join(root, 'blobs', `${result.sha256}.pdf`);
  try {
    if (path.resolve(await realpath(filename)).toLowerCase() !== path.resolve(filename).toLowerCase()) return false;
    const bytes = await readFile(filename);
    return bytes.length === result.bytes && digest(bytes) === result.sha256;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// Each complete journal line is committed independently; truncate only an incomplete
// final line after interruption. A malformed complete line is not silently trusted.
async function readJournal(root, inventory) {
  const filename = path.join(root, 'results.jsonl');
  let bytes;
  try { await assertDirectFile(filename); bytes = await readFile(filename); } catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
  const lastNewline = bytes.lastIndexOf(10);
  if (lastNewline !== bytes.length - 1) {
    const handle = await open(filename, 'r+');
    try { await handle.truncate(lastNewline + 1); await handle.sync(); } finally { await handle.close(); }
    bytes = bytes.subarray(0, lastNewline + 1);
  }
  const entries = new Map(inventory.entries.map(entry => [entry.sourceId, entry]));
  const latest = new Map();
  for (const line of bytes.toString('utf8').split('\n').filter(Boolean)) {
    let result;
    try { result = JSON.parse(line); } catch { throw fail('Attachment journal contains a malformed record'); }
    const entry = entries.get(result.sourceId);
    if (result.inventorySha256 !== inventory.inventorySha256 || !entry?.sourcePath || result.sourcePath !== entry.sourcePath ||
        !['downloaded', 'failed'].includes(result.status)) throw fail('Attachment journal does not match its inventory');
    latest.set(result.sourceId, result);
  }
  return latest;
}

async function downloadFile({ root, entry, fetchImpl, maxBytes, timeoutMs }) {
  const temporary = path.join(root, 'temporary', `${randomBytes(20).toString('hex')}.part`);
  let file;
  try {
    const response = await fetchImpl(`${LEGACY_UPLOAD_BASE}${entry.sourcePath}`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      return { status: 'failed', error: response.status >= 300 && response.status < 400 ? 'REDIRECT_REFUSED' : `HTTP_${response.status}` };
    }
    if (!response.body) return { status: 'failed', error: 'EMPTY_BODY' };
    const length = response.headers?.get('content-length');
    if (length && Number(length) > maxBytes) { await response.body.cancel(); return { status: 'failed', error: 'FILE_TOO_LARGE' }; }
    file = await open(temporary, 'wx', 0o600);
    const hash = createHash('sha256');
    let bytes = 0;
    let prefix = Buffer.alloc(0);
    for await (const chunk of response.body) {
      const value = Buffer.from(chunk);
      bytes += value.length;
      if (bytes > maxBytes) throw fail('FILE_TOO_LARGE');
      if (prefix.length < 5) prefix = Buffer.concat([prefix, value.subarray(0, 5 - prefix.length)]);
      hash.update(value);
      await file.writeFile(value);
    }
    if (bytes === 0 || prefix.toString('ascii') !== '%PDF-') throw fail('NOT_A_PDF');
    if (length && Number(length) !== bytes) throw fail('INCOMPLETE_BODY');
    await file.sync(); await file.close(); file = undefined;
    const sha256 = hash.digest('hex');
    const result = { status: 'downloaded', bytes, sha256, blob: `blobs/${sha256}.pdf`, basicPdfHeaderChecked: true };
    const destination = path.join(root, 'blobs', `${sha256}.pdf`);
    try {
      await stat(destination);
      if (!await blobMatches(root, result)) throw fail('BLOB_CONFLICT');
      await unlink(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Content-addressed destination, then verify. Never replace an existing
      // different blob; concurrent same-hash downloads have identical bytes.
      try { await link(temporary, destination); }
      catch (linkError) { if (linkError.code !== 'EEXIST') throw linkError; }
      if (!await blobMatches(root, result)) throw fail('BLOB_CONFLICT');
      await unlink(temporary);
    }
    return result;
  } catch (error) {
    const known = ['FILE_TOO_LARGE', 'NOT_A_PDF', 'INCOMPLETE_BODY', 'BLOB_CONFLICT'];
    return { status: 'failed', error: known.includes(error.message) ? error.message : 'NETWORK_OR_STORAGE_ERROR' };
  } finally {
    await file?.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Private archival downloader only. This does not register files with app APIs. */
export async function downloadInventory({ inventory, root, concurrency = 4, maxFiles = Infinity, maxBytes = 32 * 1024 * 1024,
  timeoutMs = 20_000, minFreeBytes = 2 * 1024 * 1024 * 1024, fetchImpl = fetchLegacyAttachment, progress = () => {} }) {
  if (!hex(inventory?.inventorySha256) || !hex(inventory?.sourceSha256) || inventory.baseUrl !== LEGACY_UPLOAD_BASE ||
      !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8 ||
      !(maxFiles === Infinity || (Number.isSafeInteger(maxFiles) && maxFiles >= 0)) || !Number.isSafeInteger(maxBytes) || maxBytes < 5 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(minFreeBytes) || minFreeBytes < 0) throw fail('Invalid attachment import options');
  // Recompute inventory digest so mutations cannot substitute source paths.
  const { inventorySha256, ...payload } = inventory;
  if (digest(JSON.stringify(payload)) !== inventorySha256 || !Array.isArray(inventory.entries)) throw fail('Invalid inventory digest');
  const ids = new Set();
  for (const entry of inventory.entries) {
    if (!/^\d+$/.test(entry.sourceId) || ids.has(entry.sourceId) ||
        !['pending', 'missing_reference', 'invalid_reference'].includes(entry.status) ||
        (entry.status === 'pending' && !/^[23]\d{3}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,199}\.pdf$/i.test(entry.sourcePath ?? '')) ||
        entry.sourcePath?.includes('..')) throw fail('Invalid attachment inventory entry');
    ids.add(entry.sourceId);
  }
  await privateRoot(root);
  // A crash may leave this lock. An operator must confirm the prior importer is
  // stopped before removing it; concurrent journal truncation is never permitted.
  const lockName = path.join(root, 'import.lock');
  const lock = await open(lockName, 'wx', 0o600);
  let journal;
  let writeQueue = Promise.resolve();
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid })); await lock.sync();
    await bindInventory(root, inventory);
    const latest = await readJournal(root, inventory);
    const groups = new Map();
    for (const entry of inventory.entries) if (entry.status === 'pending') {
      const group = groups.get(entry.sourcePath) ?? [];
      group.push(entry); groups.set(entry.sourcePath, group);
    }
    const verifiedBlobs = new Map();
    const invalidated = [];
    let resumed = 0;
    const pending = [];
    for (const entries of groups.values()) {
      let reused;
      for (const entry of entries) {
        const result = latest.get(entry.sourceId);
        if (result?.status === 'downloaded') {
          const key = `${result.sha256}:${result.bytes}`;
          if (!verifiedBlobs.has(key)) verifiedBlobs.set(key, await blobMatches(root, result));
          if (verifiedBlobs.get(key)) { reused = result; break; }
          const invalid = { ...result, status: 'failed', error: 'BLOB_VERIFICATION_FAILED' };
          latest.set(entry.sourceId, invalid); invalidated.push(invalid);
        }
      }
      if (reused) {
        for (const entry of entries) {
          const previous = latest.get(entry.sourceId);
          if (previous?.status === 'downloaded' && previous.sha256 === reused.sha256 && previous.bytes === reused.bytes) resumed++;
          else pending.push({ entries: [entry], reused });
        }
      } else pending.push({ entries });
    }
    journal = await open(path.join(root, 'results.jsonl'), 'a', 0o600);
    let cursor = 0, attempted = 0, completed = resumed;
    let paused = false, stopped = false;
    const append = async result => {
      latest.set(result.sourceId, result);
      writeQueue = writeQueue.then(async () => { await journal.writeFile(`${JSON.stringify(result)}\n`); await journal.sync(); });
      await writeQueue;
    };
    for (const invalid of invalidated) await append(invalid);
    const workers = Array.from({ length: concurrency }, async () => {
      while (cursor < pending.length && !paused && !stopped) {
        const group = pending[cursor++];
        if (!group.reused && attempted >= maxFiles) continue;
        if (!group.reused) {
          const free = await statfs(root, { bigint: true });
          if (free.bavail * free.bsize < BigInt(minFreeBytes) + BigInt(concurrency * maxBytes)) { paused = true; break; }
          if (paused || stopped || attempted >= maxFiles) continue;
          attempted++;
        }
        const result = group.reused ?? await downloadFile({ root, entry: group.entries[0], fetchImpl, maxBytes, timeoutMs });
        for (const entry of group.entries) {
          await append({ ...result, inventorySha256, sourceId: entry.sourceId, sourcePath: entry.sourcePath });
          completed++;
        }
        progress({ attemptedFiles: attempted, completedDocuments: completed, totalDocuments: inventory.entries.length });
      }
    }).map(worker => worker.catch(error => { stopped = true; throw error; }));
    // Do not release the archive lock/journal while sibling downloads can still
    // publish blobs or append records, including when a progress callback fails.
    const settled = await Promise.allSettled(workers);
    const rejected = settled.find(result => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    await writeQueue;
    const totals = { version: 1, sourceSha256: inventory.sourceSha256, inventorySha256, totalDocuments: inventory.entries.length,
      uniqueReferencedFiles: groups.size, downloadedDocuments: 0, failedDocuments: 0, pendingDocuments: 0,
      missingReferences: 0, invalidReferences: 0, attemptedFiles: attempted, resumedDocuments: resumed, paused,
      pauseReason: paused ? 'LOW_DISK_SPACE' : null, basicHeaderCheckOnly: true, appDownloadReady: false };
    for (const entry of inventory.entries) {
      if (entry.status === 'missing_reference') totals.missingReferences++;
      else if (entry.status === 'invalid_reference') totals.invalidReferences++;
      else {
        const result = latest.get(entry.sourceId);
        if (result?.status === 'downloaded') totals.downloadedDocuments++;
        else if (result?.status === 'failed') totals.failedDocuments++;
        else totals.pendingDocuments++;
      }
    }
    const temporary = path.join(root, `summary.${randomBytes(8).toString('hex')}.tmp`);
    await writeNewFile(temporary, JSON.stringify(totals, null, 2));
    await rename(temporary, path.join(root, 'summary.json'));
    return totals;
  } finally {
    await writeQueue.catch(() => {});
    await journal?.close(); await lock.close(); await unlink(lockName);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, source, target, ...args] = process.argv.slice(2);
  try {
    if (!['inventory', 'download'].includes(command) || !source || !target) throw fail('Usage: inventory|download <snapshot.sql.gz> <private-root> [--limit N]');
    const inventory = buildAttachmentInventory(await readDump(source));
    const limitIndex = args.indexOf('--limit');
    const maxFiles = command === 'inventory' ? 0 : limitIndex < 0 ? Infinity : Number(args[limitIndex + 1]);
    let lastProgress = 0;
    const summary = await downloadInventory({ inventory, root: path.resolve(target), maxFiles, progress: value => {
      if (Date.now() - lastProgress >= 5000) { console.log(JSON.stringify(value)); lastProgress = Date.now(); }
    } });
    console.log(JSON.stringify(summary));
  } catch { console.error('Attachment import did not finish. Source and completed private blobs were retained; inspect local state before retry.'); process.exitCode = 1; }
  finally { closeAttachmentTransport(); }
}
