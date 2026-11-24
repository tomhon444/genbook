import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import mysql from 'mysql2/promise';
import { startDatabase } from './database.mjs';

registerHooks({ resolve(specifier, context, next) {
  if (specifier === './input' && context.parentURL?.endsWith('/lib/issuance/search.ts')) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
const { parseSearch, searchDocuments } = await import('../../lib/issuance/search.ts');
const actor = { staffId: 'TEST-001', departmentId: '204' };

test('sort validation allows only paired known columns and directions', () => {
  assert.equal(parseSearch(new URLSearchParams()).sort, '');
  assert.equal(parseSearch(new URLSearchParams({ sort: '', direction: '' })).sort, '');
  for (const sort of ['number', 'documentDate', 'subject', 'ownerId', 'type']) {
    for (const direction of ['asc', 'desc']) assert.equal(parseSearch(new URLSearchParams({ sort, direction })).sort, sort);
  }
  for (const query of ['sort=subject', 'direction=asc', 'sort=constructor&direction=asc', 'sort=__proto__&direction=asc', 'sort=subject&direction=DESC', 'sort=subject&direction=asc&direction=desc', 'sort=subject%20DESC&direction=asc', 'sort=subject&direction=asc;DROP']) {
    assert.throws(() => parseSearch(new URLSearchParams(query)), error => error.status === 400);
  }
});

test('page size defaults to twenty and allows only bounded predefined choices', () => {
  assert.equal(parseSearch(new URLSearchParams()).pageSize, 20);
  for (const pageSize of ['20', '50', '100']) assert.equal(parseSearch(new URLSearchParams({ pageSize })).pageSize, Number(pageSize));
  for (const query of ['pageSize=', 'pageSize=0', 'pageSize=1', 'pageSize=101', 'pageSize=050', 'pageSize=50.0', 'pageSize=true', 'pageSize=50&pageSize=100']) {
    assert.throws(() => parseSearch(new URLSearchParams(query)), error => error.status === 400);
  }
});

test('SQL sorts all readable matches before pagination and preserves stable default and numeric number order', { timeout: 120000 }, async () => {
  const database = await startDatabase({ port: 3346 });
  const pool = mysql.createPool({ uri: database.url, timezone: 'Z', dateStrings: true });
  const ids = [];
  async function seed(main, changes = {}) {
    const row = { id: randomUUID(), sub: 0, owner: actor.staffId, department: actor.departmentId, subject: `Subject ${String(30 - main).padStart(2, '0')}`, confidential: false, ...changes };
    await database.admin.query(`INSERT INTO issuance_documents(id,owner_id,owner_department_id,request_key,payload_hash,series_id,number_year,main_number,sub_number,prefix,document_date,issued_at,subject,recipients,recipient_department_ids,external_organization,signer,confidential,published) VALUES (?,?,?,?,?,'TEST-S1',2569,?,?,'PREFIX','2026-11-18','2026-11-18 01:00:00',?,'["recipient"]','[]','external','signer',?,FALSE)`, [row.id, row.owner, row.department, randomUUID(), 'a'.repeat(64), main, row.sub, row.subject, row.confidential]);
    return row;
  }
  try {
    for (let n = 1; n <= 25; n++) ids.push((await seed(n)).id);
    const hidden = await seed(99, { owner: 'TEST-002', confidential: true, subject: 'AAA hidden' });
    const result = await searchDocuments(pool, actor, new URLSearchParams({ sort: 'subject', direction: 'asc' }));
    assert.equal(result.total, 25);
    assert.equal(result.documents.length, 20);
    assert.equal(result.documents[0].id, ids[24]);
    assert.ok(!result.documents.some(row => row.id === hidden.id));
    const second = await searchDocuments(pool, actor, new URLSearchParams({ sort: 'subject', direction: 'asc', page: '2' }));
    assert.deepEqual([...result.documents, ...second.documents].map(row => row.id), ids.toReversed());
    const descending = await searchDocuments(pool, actor, new URLSearchParams({ sort: 'subject', direction: 'desc' }));
    assert.equal(descending.documents[0].id, ids[0]);
    const defaults = await searchDocuments(pool, actor, new URLSearchParams());
    assert.deepEqual(defaults.documents.map(row => row.id), ids.toReversed().slice(0, 20));
    const subTwo = await seed(2, { sub: 2 });
    const subTen = await seed(2, { sub: 10 });
    const numeric = await searchDocuments(pool, actor, new URLSearchParams({ sort: 'number', direction: 'asc' }));
    assert.deepEqual(numeric.documents.slice(0, 5).map(row => row.id), [ids[0], ids[1], subTwo.id, subTen.id, ids[2]]);
    for (const sort of ['documentDate', 'ownerId', 'type']) {
      const first = await searchDocuments(pool, actor, new URLSearchParams({ sort, direction: 'asc' }));
      const repeat = await searchDocuments(pool, actor, new URLSearchParams({ sort, direction: 'asc' }));
      assert.equal(first.total, 27);
      assert.deepEqual(first.documents.map(row => row.id), repeat.documents.map(row => row.id));
    }
    const pageIds = [];
    for (let n = 1; n <= 105; n++) pageIds.push((await seed(200 + n, { subject: `Page size ${n}` })).id);
    const hiddenPage = await seed(999, { subject: 'Page size hidden', owner: 'TEST-002', confidential: true });
    for (const pageSize of [50, 100]) {
      const pages = [];
      for (let page = 1; page <= Math.ceil(105 / pageSize); page++) {
        const result = await searchDocuments(pool, actor, new URLSearchParams({ q: 'Page size', page: String(page), pageSize: String(pageSize), sort: 'number', direction: 'asc' }));
        assert.equal(result.pageSize, pageSize);
        assert.equal(result.total, 105);
        assert.equal(result.hasMore, page * pageSize < 105);
        assert.equal(result.documents.length, Math.min(pageSize, 105 - (page - 1) * pageSize));
        pages.push(...result.documents.map(row => row.id));
      }
      assert.deepEqual(pages, pageIds);
      assert.ok(!pages.includes(hiddenPage.id));
    }
  } finally { await pool.end(); await database.close(); }
});
