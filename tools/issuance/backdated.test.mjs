import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import mysql from 'mysql2/promise';
import { startDatabase } from './database.mjs';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === './input' && context.parentURL?.endsWith('/lib/issuance/service.ts')) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
const { issue, issueBackdated } = await import('../../lib/issuance/service.ts');
const actor = { staffId: 'TEST-001', departmentId: '202', displayName: 'ทดสอบ', departmentName: 'ทดสอบ' };
const input = (changes = {}) => ({ requestId: randomUUID(), seriesId: 'TEST-S1', subject: 'ย้อนหลัง', recipient: 'ผู้รับ', recipientDepartmentIds: [], externalOrganization: 'ภายนอก', signer: 'ผู้ลงนาม', confidential: true, documentDate: '2026-11-12', ...changes });

test('backdated allocation clock, locked scope, rollback, replay and cross-year rules', { timeout: 120000 }, async t => {
  const database = await startDatabase({ port: 3325 });
  const pool = mysql.createPool({ uri: database.url, timezone: 'Z', dateStrings: true, connectionLimit: 10 });
  try {
    const original = (await issue(pool, actor, input(), () => new Date('2026-11-12T03:00:00Z'))).document;
    const body = (changes = {}) => input({ source: { kind: 'issuance', id: original.id }, ...changes });
    const state = async () => {
      const [[row]] = await database.admin.query("SELECT (SELECT COUNT(*) FROM issuance_documents) docs,(SELECT COUNT(*) FROM issuance_audit) audit,(SELECT last_sub_number FROM issuance_subcounters WHERE series_id='TEST-S1' AND number_year=2569 AND main_number=1) sub,(SELECT last_number FROM issuance_counters WHERE series_id='TEST-S1' AND number_year=2569) main");
      return row;
    };
    await t.test('ordinary exact time edges and weekends; finance all hours', async () => {
      for (const [iso, allowed] of [['2026-11-13T23:59:59Z', false], ['2026-11-14T00:00:00Z', true], ['2026-11-14T15:30:59Z', true], ['2026-11-14T15:31:00Z', false]]) {
        const before = await state();
        const action = issueBackdated(pool, actor, body(), () => new Date(iso));
        if (allowed) assert.equal((await action).document.documentDate, '2026-11-12');
        else { await assert.rejects(action, error => error.status === 403); assert.deepEqual(await state(), before); }
      }
      await issueBackdated(pool, { ...actor, departmentId: '204' }, body(), () => new Date('2026-11-14T18:00:00Z'));
    });
    await t.test('allocation rechecks time after waiting on subcounter lock', async () => {
      let now = new Date('2026-11-14T15:30:59Z');
      const holder = await pool.getConnection();
      await holder.beginTransaction();
      await holder.query("SELECT * FROM issuance_subcounters WHERE series_id='TEST-S1' AND number_year=2569 AND main_number=1 FOR UPDATE");
      const before = await state();
      const waiting = issueBackdated(pool, actor, body(), () => now);
      await new Promise(resolve => setTimeout(resolve, 150));
      now = new Date('2026-11-14T15:31:00Z');
      await holder.commit(); holder.release();
      await assert.rejects(waiting, error => error.status === 403);
      assert.deepEqual(await state(), before);
    });
    await t.test('year rollover preserves original tuple and prefix without creating current main counter', async () => {
      const before = await state();
      await database.admin.query("UPDATE issuance_series SET prefix='NEW PREFIX' WHERE id='TEST-S1'");
      const response = await issueBackdated(pool, { ...actor, departmentId: '204' }, body(), () => new Date('2026-12-31T17:00:00Z'));
      assert.equal(response.document.numberYear, 2569);
      assert.equal(response.document.documentDate, '2026-11-12');
      assert.equal(new Date(response.document.issuedAt).toISOString(), '2026-12-31T17:00:00.000Z');
      assert.match(response.document.number, /^ทดสอบ 001\/0001\.\d+$/);
      assert.equal((await state()).main, before.main);
      const [[current]] = await database.admin.query('SELECT COUNT(*) total FROM issuance_counters WHERE number_year=2570');
      assert.equal(Number(current.total), 0);
    });
    await t.test('atomic rollback and committed replay after hours bypass pending gate but retain authorization', async () => {
      const request = body({ confidential: false });
      const before = await state();
      await database.admin.query("CREATE TRIGGER t10_fail_rules BEFORE INSERT ON issuance_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic T10 rollback'");
      await assert.rejects(issueBackdated(pool, actor, request, () => new Date('2026-11-14T03:00:00Z')));
      assert.deepEqual(await state(), before);
      await database.admin.query('DROP TRIGGER t10_fail_rules');
      const first = await issueBackdated(pool, actor, request, () => new Date('2026-11-14T03:00:00Z'));
      const replay = await issueBackdated(pool, actor, request, () => new Date('2026-11-14T18:00:00Z'));
      assert.equal(replay.document.id, first.document.id);
      assert.equal(replay.replayed, true);
      await assert.rejects(issueBackdated(pool, actor, { ...request, subject: 'changed' }), error => error.status === 409);
      await database.admin.query("UPDATE issuance_grants SET active=0 WHERE owner_id='TEST-001' AND series_id='TEST-S1'");
      await assert.rejects(issueBackdated(pool, actor, request), error => error.status === 403);
    });
  } finally { await pool.end(); await database.close(); }
});
