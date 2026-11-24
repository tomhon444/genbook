import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import mysql from 'mysql2/promise';
import { bangkokNow, parseInput } from '../../lib/issuance/input.ts';
import { startDatabase } from './database.mjs';

registerHooks({ resolve(specifier, context, next) {
  if (specifier === './input' && context.parentURL?.endsWith('/lib/issuance/service.ts')) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
const { issue } = await import('../../lib/issuance/service.ts');
const body = (changes = {}) => ({ requestId: randomUUID(), seriesId: 'TEST-S1', subject: 'ทดสอบ', recipient: 'ผู้รับหนึ่ง\nผู้รับสอง', recipientDepartmentIds: [], externalOrganization: 'องค์กรจำลอง', signer: 'ผู้ลงนามจำลอง', confidential: true, documentDate: '2026-11-12', ...changes });
const actor = { staffId: 'TEST-001', departmentId: '202', displayName: 'จำลอง', departmentName: 'จำลอง' };

test('Bangkok calendar boundaries include year rollover independently of host timezone', () => {
  assert.deepEqual(bangkokNow(new Date('2026-12-31T16:59:59.000Z')), { today: '2026-12-31', seconds: 86399, year: 2569 });
  assert.deepEqual(bangkokNow(new Date('2026-12-31T17:00:00.000Z')), { today: '2027-01-01', seconds: 0, year: 2570 });
});

test('content validation rejects forged identity, impossible dates and incomplete recipients', () => {
  for (const changes of [{ ownerId: 'FORGED' }, { published: "true" }, { documentDate: '2026-02-30' }, { confidential: 'false' }, { recipient: ' ' }, { signer: '' }, { externalOrganization: '' }, { recipientDepartmentIds: ['202'] }, { requestId: 'same' }]) {
    assert.throws(() => parseInput(body(changes)), error => error.status === 400);
  }
  const parsed = parseInput(body());
  assert.deepEqual(parsed.recipients, ['ผู้รับหนึ่ง', 'ผู้รับสอง']);
  assert.equal(parseInput(body({ requestId: randomUUID() })).payloadHash, parsed.payloadHash);
});

test('real MySQL allocation time, overflow formatting, rollback and year rules', { timeout: 120000 }, async (t) => {
  const database = await startDatabase({ port: 3317 });
  const pool = mysql.createPool({ uri: database.url, timezone: 'Z', dateStrings: true, connectionLimit: 10 });
  try {
    await t.test('exact ordinary time edges, weekend allowed, department 204 exception', async () => {
      await assert.rejects(issue(pool, actor, body({ recipientDepartmentIds: ['UNKNOWN'], externalOrganization: '' }), () => new Date('2026-11-12T03:00:00Z')), error => error.status === 400);
      await issue(pool, actor, body({ recipientDepartmentIds: ['TEST-D1', 'TEST-D2'], externalOrganization: '' }), () => new Date('2026-11-12T03:00:00Z'));
      for (const [iso, expected] of [
        ['2026-11-11T23:59:59Z', false], ['2026-11-12T00:00:00Z', true],
        ['2026-11-12T15:30:59Z', true], ['2026-11-12T15:31:00Z', false],
      ]) {
        const action = issue(pool, actor, body(), () => new Date(iso));
        if (expected) await action; else await assert.rejects(action, error => error.status === 403);
      }
      await issue(pool, actor, body({ documentDate: '2026-11-14' }), () => new Date('2026-11-14T03:00:00Z'));
      await issue(pool, { ...actor, departmentId: '204' }, body(), () => new Date('2026-11-11T18:00:00Z'));
    });
    await t.test('time is checked after waiting on the shared counter', async () => {
      let now = new Date('2026-11-12T15:30:59Z');
      const holder = await pool.getConnection();
      await holder.beginTransaction();
      await holder.query("SELECT * FROM issuance_counters WHERE series_id='TEST-S1' AND number_year=2569 FOR UPDATE");
      const waiting = issue(pool, actor, body(), () => now);
      await new Promise(resolve => setTimeout(resolve, 150));
      now = new Date('2026-11-12T15:31:00Z');
      await holder.commit();
      holder.release();
      await assert.rejects(waiting, error => error.status === 403);
    });
    await t.test('padding expands beyond 9999 and BE years partition series', async () => {
      await database.admin.query("INSERT INTO issuance_counters(series_id,number_year,last_number) VALUES ('TEST-S2',2569,9999)");
      const expanded = await issue(pool, actor, body({ seriesId: 'TEST-S2' }), () => new Date('2026-11-12T03:00:00Z'));
      assert.equal(expanded.document.number, 'ทดสอบ 002/10000');
      const nextYear = await issue(pool, actor, body({ seriesId: 'TEST-S2', documentDate: '2027-01-01' }), () => new Date('2027-01-01T03:00:00Z'));
      assert.equal(nextYear.document.numberYear, 2570);
      assert.equal(nextYear.document.number, 'ทดสอบ 002/0001');
      const order = await issue(pool, actor, body({ seriesId: '00006' }), () => new Date('2026-11-12T03:00:00Z'));
      assert.equal(order.document.numberYear, 2569);
    });
    await t.test('committed replay works after time closes; changed payload conflicts', async () => {
      const request = body({ confidential: false });
      const first = await issue(pool, actor, request, () => new Date('2026-11-12T03:00:00Z'));
      const replay = await issue(pool, actor, request, () => new Date('2026-11-12T18:00:00Z'));
      assert.equal(replay.document.id, first.document.id);
      assert.equal(replay.replayed, true);
      await assert.rejects(issue(pool, actor, { ...request, subject: 'เปลี่ยน' }), error => error.status === 409);
      await assert.rejects(issue(pool, actor, body(), () => new Date('2026-11-12T03:00:00Z')), error => error.status === 409);
    });
  } finally { await pool.end(); await database.close(); }
});
