import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBookClient, isRonaldoBookMode } from '../../lib/books/ronaldo.mjs';

const secret = 'synthetic-book-service-secret-32-characters';
const settings = { serviceUrl: 'http://127.0.0.1:3001', secret, nodeEnv: 'test' };
const actor = { staffId: 'TEST-001', departmentId: 'D1' };
const sha = 'a'.repeat(64);
const record = { sourceSha256: sha, sourceId: '1', number: 'TEST/0001', numberYear: 2569, subject: 'Synthetic', documentDate: '2026-11-18', confidential: false, published: true, cancelled: false, ownerId: 'TEST-001', ownerDepartmentId: 'D1', pdfPending: true };

test('search accepts selected page sizes and rejects oversized or mismatched service pages', async () => {
  let body;
  const client = createBookClient({ ...settings, fetchImpl: async () => Response.json(body) });
  for (const pageSize of [20, 50, 100]) {
    const documents = Array.from({ length: pageSize }, (_, index) => ({ kind: 'legacy', snapshot: sha, id: String(index + 1), number: 'TEST/0001', numberYear: 2569, type: 'TEST', subject: 'Synthetic', documentDate: '2026-11-18', ownerId: actor.staffId }));
    body = { documents, total: 105, page: 1, pageSize, hasMore: true, types: [], years: [] };
    assert.equal((await client('search', actor, { filters: { pageSize } })).documents.length, pageSize);
    body.documents.push(documents[0]);
    await assert.rejects(client('search', actor, { filters: { pageSize } }), error => error.status === 503);
    body = { ...body, documents: [], pageSize: pageSize === 20 ? 50 : 20 };
    await assert.rejects(client('search', actor, { filters: { pageSize } }), error => error.status === 503);
  }
});

test('native book mode is server configured and cannot activate in local fixture mode', () => {
  assert.equal(isRonaldoBookMode({ AUTH_PROVIDER: 'central', BOOK_DATA_PROVIDER: 'ronaldo' }), true);
  assert.equal(isRonaldoBookMode({ AUTH_PROVIDER: 'local', BOOK_DATA_PROVIDER: 'ronaldo' }), false);
  assert.equal(isRonaldoBookMode({ AUTH_PROVIDER: 'central' }), false);
});

test('book client sends only server credentials and verified actor, and discards unexpected response fields', async () => {
  const client = createBookClient({ ...settings, fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:3001/api/v1/genbookno/search');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    assert.equal(JSON.parse(options.body).staffId, actor.staffId);
    return Response.json({ documents: [{ kind: 'legacy', snapshot: sha, id: '1', number: 'TEST/0001', numberYear: 2569, type: 'TEST', subject: 'Synthetic', documentDate: '2026-11-18', ownerId: 'TEST-001', document_file: '/secret', password: 'never-forward' }], total: 1, page: 1, pageSize: 20, hasMore: false, types: ['TEST'], years: [2569], raw: 'private' });
  } });
  const result = await client('search', actor, { staffId: 'forged', filters: { page: 1 } });
  assert.equal(result.documents.length, 1);
  assert.ok(!JSON.stringify(result).includes('private') && !JSON.stringify(result).includes('never-forward') && !JSON.stringify(result).includes('/secret'));
});

test('overview must remain read only, details must match requested source and no metadata paths pass through', async () => {
  const overview = { series: [], departments: [], documents: [], sharedDocuments: [], today: '2026-11-18', readOnly: true, legacyTotal: 1 };
  let body = overview;
  const client = createBookClient({ ...settings, fetchImpl: async () => Response.json(body) });
  assert.equal((await client('overview', actor)).readOnly, true);
  body = { ...overview, readOnly: false };
  await assert.rejects(client('overview', actor), error => error.status === 503);
  body = { ...record, details: null, path: '/not-exposed' };
  const detail = await client('detail', actor, { snapshot: sha, sourceId: '1' });
  assert.equal(detail.sourceId, '1'); assert.equal(detail.path, undefined);
  await assert.rejects(client('detail', actor, { snapshot: sha, sourceId: '2' }), error => error.status === 503);
});

test('service errors, network failures, oversized or malformed responses fail closed without fallback', async () => {
  for (const [status, expected] of [[400, 400], [401, 401], [403, 403], [404, 404], [429, 429], [500, 503], [302, 503]]) {
    const client = createBookClient({ ...settings, fetchImpl: async () => new Response('{}', { status }) });
    await assert.rejects(client('search', actor), error => error.status === expected);
  }
  for (const fetchImpl of [async () => { throw new Error('private network text'); }, async () => new Response('x'.repeat(300_000)), async () => Response.json({ documents: [] })]) {
    const client = createBookClient({ ...settings, fetchImpl });
    await assert.rejects(client('search', actor), error => error.status === 503 && !error.message.includes('private'));
  }
});

test('configuration refuses unsafe origins, embedded credentials and unknown operations', async () => {
  for (const serviceUrl of ['http://external.example', 'https://user:pw@example.com', 'https://example.com/path', 'https://example.com?q=x']) assert.throws(() => createBookClient({ ...settings, serviceUrl }));
  assert.throws(() => createBookClient({ ...settings, secret: 'short' }));
  assert.throws(() => createBookClient({ ...settings, nodeEnv: 'production' }));
  const client = createBookClient({ ...settings, fetchImpl: async () => { throw new Error('Must not call'); } });
  await assert.rejects(client('../../outside', actor), error => error.status === 503);
});

test('profile uses verified actor and forwards only the nullable CENTRAL photo identifier', async () => {
  let body = { uniStaffId: ' UNI-001 ', email: 'private', password: 'secret' };
  const client = createBookClient({ ...settings, fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:3001/api/v1/genbookno/profile');
    assert.equal(JSON.parse(options.body).staffId, actor.staffId);
    return Response.json(body);
  } });
  assert.deepEqual(await client('profile', actor, { staffId: 'forged' }), { uniStaffId: 'UNI-001' });
  body = { uniStaffId: null };
  assert.deepEqual(await client('profile', actor), { uniStaffId: null });
  for (body of [{}, { uniStaffId: 123 }, { uniStaffId: '' }, { uniStaffId: 'x'.repeat(129) }]) {
    await assert.rejects(client('profile', actor), error => error.status === 503);
  }
});

test('simultaneous identical reads share only the pending request and do not cache completed data', async () => {
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = createBookClient({ ...settings, fetchImpl: async () => {
    calls++;
    await gate;
    return Response.json({ uniStaffId: null });
  } });
  const requests = Array.from({ length: 4 }, () => client('profile', actor));
  try { assert.equal(calls, 1, 'multiple tabs must not repeat the same pending service read'); }
  finally { release(); await Promise.all(requests); }
  await client('profile', actor);
  assert.equal(calls, 2, 'new reads must reauthorize and fetch fresh data');
  await Promise.all([client('profile', actor), client('profile', { ...actor, staffId: 'OTHER' })]);
  assert.equal(calls, 4, 'different actors cannot share results');
  await Promise.all([client('profile', actor), client('profile', { ...actor, departmentId: 'CHANGED' })]);
  assert.equal(calls, 6, 'a changed verified department must not reuse the previous readable scope');
});

test('a slow valid source response remains usable beyond the previous eight-second cutoff', async () => {
  const client = createBookClient({ ...settings, fetchImpl: async (_url, { signal }) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 8200);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
    return Response.json({ uniStaffId: null });
  } });
  assert.deepEqual(await client('profile', actor), { uniStaffId: null });
});

test('failed shared reads are removed and different filters remain independent', async () => {
  let failed = true, calls = 0;
  const client = createBookClient({ ...settings, fetchImpl: async () => {
    calls++;
    return failed ? new Response('{}', { status: 503 }) : Response.json({ uniStaffId: null });
  } });
  const attempts = await Promise.allSettled([client('profile', actor), client('profile', actor)]);
  assert.ok(attempts.every(result => result.status === 'rejected' && result.reason.status === 503));
  assert.equal(calls, 1);
  failed = false;
  assert.deepEqual(await client('profile', actor), { uniStaffId: null });
  assert.equal(calls, 2);
  await Promise.all([client('profile', actor, { page: 1 }), client('profile', actor, { page: 2 })]);
  assert.equal(calls, 4);
});
