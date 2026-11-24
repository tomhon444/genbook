import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mysql from 'mysql2/promise';
import { startDatabase } from '../issuance/database.mjs';
import { hash, readDump } from './dump.mjs';
import { mappingTemplate, mappingPlan, fingerprint } from './mapping.mjs';
import { promotionFixture } from './promotion-fixture.mjs';
import { preserveSnapshot } from './preservation.mjs';
import { promoteSnapshot } from './promote.mjs';

registerHooks({ resolve(specifier, context, next) {
  if (specifier === './input' && /lib\/issuance\/(service|history)\.ts$/.test(context.parentURL ?? '')) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
const { history, historyDetail } = await import('../../lib/issuance/history.ts');
const run = promisify(execFile);

test('draft mapping binds source and has no inferred targets approvals or executable history', () => {
  const { dump } = promotionFixture(), mapping = mappingTemplate(dump), plan = mappingPlan(dump, mapping);
  assert.equal(mapping.review, null);
  assert.ok(mapping.owners.every(row => row.targetId === '' && row.review === null));
  assert.equal(plan.summary.readyForLocalPromotion, false); assert.equal(plan.summary.productionReady, false);
  assert.deepEqual([plan.summary.sourceDocuments, plan.summary.heldDocuments, plan.summary.unresolvedDocuments, plan.summary.historyDocuments], [6, 2, 4, 0]);
});

test('reviewed plan derives exact source values, preserves duplicates/unknown time and reserves restricted maxima', () => {
  const { dump, mapping } = promotionFixture(), plan = mappingPlan(dump, mapping);
  assert.equal(plan.summary.readyForLocalPromotion, true);
  assert.equal(plan.documents.length, 4); assert.equal(plan.summary.unknownTimeDocuments, 1);
  assert.equal(plan.documents.filter(row => row.main === 42).length, 2);
  assert.equal(plan.counters[0].floor, 90); // restricted row is above readable 70
  assert.equal(plan.documents.find(row => row.sourceId === '1').pdfPending, true);
  assert.equal(plan.documents.find(row => row.sourceId === '2').pdfPending, false);
  assert.equal(plan.documents.find(row => row.sourceId === '6').confidential, true);
  assert.ok(plan.documents.every(row => !Object.hasOwn(row, 'issuedAt')));
});

test('history detail metadata derives ordered source children/references without paths or invented timezone', () => {
  const { dump, mapping } = promotionFixture(), plan = mappingPlan(dump, mapping);
  const first = plan.documents.find(row => row.sourceId === '1').details;
  assert.deepEqual(first.recipients.map(row => row.sourceId), ['10', '20']);
  assert.deepEqual(first.recipients.map(row => row.text), ['First synthetic recipient', 'Second synthetic recipient']);
  assert.deepEqual(first.destinations, [{ sourceId: '10', kind: 'internal', value: '204' }, { sourceId: '20', kind: 'external', value: 'Synthetic external organization' }]);
  assert.deepEqual(first.signer, { kind: 'position', typeCode: '1', reference: 'POSITION-TEST' });
  assert.equal(first.legacyActorId, 'LEGACY-ACTOR');
  assert.equal(first.recordedAtText, '2026-11-13 10:00:00');
  assert.equal(first.updatedAtText, '2026-11-13 11:00:00');
  assert.equal(first.timestampTimeZone, 'unverified');
  assert.equal(first.attachmentVerification, 'unverified');
  assert.equal(plan.documents.find(row => row.sourceId === '4').details.recordedAtText, null);
  assert.equal(plan.documents.find(row => row.sourceId === '6').details.signer.kind, 'staff');
  assert.doesNotMatch(JSON.stringify(plan.documents), /never-expose-secret-path|Synthetic orphan|document_file|document_extension/);
  const unknown = structuredClone(dump); unknown.tables.genbook.records[0].endorser_type = '0';
  const next = { ...mapping, sourceFingerprint: fingerprint(unknown.tables) };
  assert.equal(mappingPlan(unknown, next).documents[0].details.signer.kind, 'unknown');
});

test('detail API projects metadata fields, supports absent old metadata and authorizes before sidecar access', async () => {
  const { dump, mapping } = promotionFixture(), details = mappingPlan(dump, mapping).documents[0].details;
  const document = { source_sha256: dump.sourceSha256, source_id: '1', prefix: 'Synthetic', main_number: 42, sub_number: 0, number_year: 2569, subject: 'Synthetic', document_date: '2026-11-13', confidential: 0, published: 1, cancelled: 0, owner_id: 'TEST-001', owner_department_id: '204', pdf_pending: 1 };
  const actor = { staffId: 'TEST-001', departmentId: '204' };
  const fake = (parentRows, sidecarRows) => ({ calls: 0, async execute() { this.calls++; return [this.calls === 1 ? parentRows : sidecarRows]; } });
  const safe = fake([document], [{ schema_version: 1, payload: { ...details, document_file: 'secret-path-sentinel', PASSWORD: 'credential-sentinel' } }]);
  const result = await historyDetail(safe, actor, dump.sourceSha256, '1');
  assert.deepEqual(result.details, details); assert.doesNotMatch(JSON.stringify(result), /sentinel|PASSWORD|document_file/);
  assert.equal((await historyDetail(fake([document], []), actor, dump.sourceSha256, '1')).details, null);
  const denied = fake([], [{ schema_version: 1, payload: details }]);
  await assert.rejects(historyDetail(denied, actor, dump.sourceSha256, '1'), error => error.status === 404);
  assert.equal(denied.calls, 1);
  await assert.rejects(historyDetail(fake([document], [{ schema_version: 2, payload: details }]), actor, dump.sourceSha256, '1'), error => error.status === 503);
});

test('wrong snapshot, changed raw fields and arbitrary document copies fail closed', () => {
  const { dump, mapping } = promotionFixture();
  assert.throws(() => mappingPlan(dump, { ...mapping, sourceSha256: hash('different') }), /exact source/);
  const altered = structuredClone(dump); altered.tables.genbook.records[0].title = 'tampered';
  assert.throws(() => mappingPlan(altered, mapping), /exact source/);
  assert.throws(() => mappingPlan(dump, { ...mapping, documents: [] }), /exact source/);
  const prefix = structuredClone(mapping); prefix.series[0].sourcePrefix = 'invented';
  assert.throws(() => mappingPlan(dump, prefix), /prefix was changed/);
});

test('missing approvals, policies, mappings and unreviewed holds never become ready', () => {
  const { dump, mapping } = promotionFixture();
  for (const change of [value => { value.review = null; }, value => { value.policies.pdf = 'verified'; }, value => { value.owners[0].review = null; }, value => { value.departments = []; }, value => { value.series[0].decision = 'pending'; value.series[0].targetId = ''; value.series[0].yearBasis = ''; }, value => { value.holds.push({ sourceId: '1', review: null }); }]) {
    const changed = structuredClone(mapping); change(changed); assert.equal(mappingPlan(dump, changed).summary.readyForLocalPromotion, false);
  }
});

test('duplicate/unknown decisions, changed source prefix and unresolved year/prefix cannot be mapped', () => {
  const { dump, mapping } = promotionFixture();
  for (const change of [value => value.owners.push(value.owners[0]), value => { value.departments[0].sourceId = 'unknown'; }, value => { value.series[0].yearBasis = 'document_date'; }, value => { value.series[1].decision = 'map'; value.series[1].targetId = 'TEST-S2'; value.series[1].yearBasis = 'calendar'; }, value => { value.owners[0].extra = true; }]) {
    const changed = structuredClone(mapping); change(changed); assert.throws(() => mappingPlan(dump, changed));
  }
  const changed = structuredClone(dump); changed.tables.genbook.records[3].user_request = 'OTHER';
  const next = mappingTemplate(changed);
  Object.assign(next, { review: mapping.review, policies: mapping.policies, series: mapping.series, departments: mapping.departments });
  next.owners = next.owners.map(row => ({ ...row, decision: 'map', targetId: 'TEST-001', review: mapping.review }));
  assert.throws(() => mappingPlan(changed, next), /distinct explicit/);
});

test('invalid source metadata blocks instead of being silently repaired; reviewed source hold preserves reservation', () => {
  const { dump, mapping } = promotionFixture();
  dump.tables.genbook.records[3].date_request = '2026-02-30'; mapping.sourceFingerprint = fingerprint(dump.tables);
  let plan = mappingPlan(dump, mapping); assert.equal(plan.summary.readyForLocalPromotion, false); assert.equal(plan.summary.invalidDocuments, 1);
  mapping.holds.push({ sourceId: '4', review: mapping.review });
  plan = mappingPlan(dump, mapping); assert.equal(plan.summary.readyForLocalPromotion, true); assert.equal(plan.summary.heldDocuments, 3); assert.equal(plan.summary.sourceReservations, 6);
});

test('metadata is checked before pending identity mappings and empty subjects remain untouched', () => {
  const { dump } = promotionFixture(); dump.tables.genbook.records[0].title = '';
  const before = JSON.stringify(dump), plan = mappingPlan(dump, mappingTemplate(dump));
  assert.equal(plan.summary.invalidDocuments, 1); assert.equal(plan.summary.metadataIssueCounts.EMPTY_SOURCE_SUBJECT, 1);
  assert.equal(plan.summary.historyDocuments, 0); assert.equal(JSON.stringify(dump), before);
});

test('source title whitespace stays verbatim and unknown visibility is restricted rather than public', () => {
  const { dump, mapping } = promotionFixture();
  dump.tables.genbook.records[0].title = '  ต้นฉบับพร้อมช่องว่าง  ';
  dump.tables.genbook.records[5].publish = null; mapping.sourceFingerprint = fingerprint(dump.tables);
  const plan = mappingPlan(dump, mapping);
  assert.equal(plan.documents[0].subject, '  ต้นฉบับพร้อมช่องว่าง  ');
  assert.equal(plan.documents.some(row => row.sourceId === '6'), false); assert.equal(plan.summary.heldDocuments, 3);
});

test('mapping and promotion CLIs preserve drafts and rehearse only an explicit reviewed synthetic mapping', { timeout: 120000 }, async () => {
  const { dump, mapping: reviewed, approvalReference } = promotionFixture(), directory = `.local/t12/mapping-cli-${randomUUID()}`;
  await mkdir(directory, { recursive: true });
  const literal = value => value === null ? 'NULL' : `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  const sql = Object.entries(dump.tables).filter(([, table]) => table.records.length).map(([name, table]) => {
    const columns = Object.keys(table.records[0]);
    return `INSERT INTO \`${name}\` (${columns.map(value => `\`${value}\``).join(',')}) VALUES ${table.records.map(row => `(${columns.map(key => literal(row[key])).join(',')})`).join(',')};`;
  }).join('\n');
  const file = `${directory}/synthetic.sql.gz`; await writeFile(file, gzipSync(sql));
  const actual = await readDump(file), input = `${directory}/draft.json`, template = mappingTemplate(actual);
  await writeFile(input, JSON.stringify(template)); const before = await readFile(input, 'utf8');
  const first = JSON.parse((await run(process.execPath, ['tools/migration/check-mapping.mjs', file, input], { windowsHide: true })).stdout);
  const second = JSON.parse((await run(process.execPath, ['tools/migration/check-mapping.mjs', file], { windowsHide: true })).stdout);
  assert.notEqual(first.directory, second.directory); assert.equal(first.readyForLocalPromotion, false);
  assert.equal(await readFile(input, 'utf8'), before);
  assert.equal(JSON.parse(await readFile(`${first.directory}/mapping.json`, 'utf8')).review, null);
  assert.ok((await readdir(first.directory)).includes('readiness.json'));
  await assert.rejects(run(process.execPath, ['tools/migration/rehearse-promotion.mjs', file, input, 'not-read.json'], { windowsHide: true }), /no database was started/);
  reviewed.sourceSha256 = actual.sourceSha256; reviewed.sourceFingerprint = fingerprint(actual.tables);
  const reviewedFile = `${directory}/reviewed-synthetic.json`, targetsFile = `${directory}/targets.json`;
  await writeFile(reviewedFile, JSON.stringify(reviewed));
  await writeFile(targetsFile, JSON.stringify({ sourceSha256: actual.sourceSha256, mappingFingerprint: fingerprint(reviewed), review: reviewed.review, preservationApprovalReference: approvalReference, series: [{ id: 'TEST-S1', name: 'Synthetic series', documentType: 'Synthetic type' }], departments: [{ id: '204', name: 'Synthetic department' }] }));
  const promoted = JSON.parse((await run(process.execPath, ['tools/migration/rehearse-promotion.mjs', file, reviewedFile, targetsFile], { windowsHide: true })).stdout);
  assert.equal(promoted.historyDocuments, 4); assert.equal(promoted.dryRunVerified, true); assert.equal(promoted.replayVerified, true); assert.equal(promoted.grantsEnabled, 0); assert.equal(promoted.gate, 'blocked');
});

test('source-bound promotion after preservation is atomic, dry-run/replay-safe and private', { timeout: 120000 }, async t => {
  const db = await startDatabase({ port: 3331 }), { dump, mapping, approvalReference } = promotionFixture();
  const pool = mysql.createPool({ uri: db.url, timezone: 'Z', dateStrings: true });
  const totals = async () => { const [[row]] = await db.admin.query('SELECT (SELECT COUNT(*) FROM legacy_staging) rawRows,(SELECT COUNT(*) FROM legacy_documents) history,(SELECT COUNT(*) FROM legacy_document_details) details,(SELECT COUNT(*) FROM legacy_promotions) promotions,(SELECT COUNT(*) FROM issuance_counters) counters,(SELECT COUNT(*) FROM legacy_reservation_links) links'); return Object.values(row).map(Number); };
  try {
    await db.admin.query("UPDATE issuance_series SET enabled=FALSE WHERE id='TEST-S1'");
    await preserveSnapshot(db.admin, dump, { approvalReference }); const preserved = await totals();
    await t.test('dry run rolls back history registry links and counters, retaining preservation', async () => {
      const result = await promoteSnapshot(db.admin, dump, mapping, { approvalReference });
      assert.equal(result.dryRun, true); assert.equal(result.historyDocuments, 4); assert.deepEqual(await totals(), preserved);
    });
    await t.test('pending approval/open gate/target mismatch reject without writes', async () => {
      await assert.rejects(promoteSnapshot(db.admin, dump, mappingTemplate(dump), { approvalReference }), /not ready/);
      await db.admin.query("UPDATE issuance_migration_gate SET state='open'");
      await assert.rejects(promoteSnapshot(db.admin, dump, mapping, { approvalReference }), /closed migration/);
      await db.admin.query("UPDATE issuance_migration_gate SET state='blocked'; UPDATE issuance_series SET prefix='wrong' WHERE id='TEST-S1'");
      await assert.rejects(promoteSnapshot(db.admin, dump, mapping, { approvalReference }), /reviewed disabled/);
      await db.admin.query("UPDATE issuance_series SET prefix='ทดสอบ 001' WHERE id='TEST-S1'"); assert.deepEqual(await totals(), preserved);
    });
    await t.test('mid-import failure rolls back promotion but not preserved source', async () => {
      await db.admin.query("CREATE TRIGGER fail_promotion BEFORE INSERT ON legacy_documents FOR EACH ROW BEGIN IF NEW.source_id='4' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic promotion failure'; END IF; END");
      await assert.rejects(promoteSnapshot(db.admin, dump, mapping, { approvalReference, dryRun: false }));
      await db.admin.query('DROP TRIGGER fail_promotion'); assert.deepEqual(await totals(), preserved);
      await db.admin.query("CREATE TRIGGER fail_detail_promotion BEFORE INSERT ON legacy_document_details FOR EACH ROW BEGIN IF NEW.source_id='4' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic detail failure'; END IF; END");
      await assert.rejects(promoteSnapshot(db.admin, dump, mapping, { approvalReference, dryRun: false }));
      await db.admin.query('DROP TRIGGER fail_detail_promotion'); assert.deepEqual(await totals(), preserved);
    });
    await t.test('commit/replay preserves duplicates and all reservation floors without opening gate or grants', async () => {
      const [[grants]] = await db.admin.query('SELECT SUM(active) n FROM issuance_grants');
      const result = await promoteSnapshot(db.admin, dump, mapping, { approvalReference, dryRun: false }); assert.equal(result.replayed, false);
      assert.equal((await promoteSnapshot(db.admin, dump, mapping, { approvalReference, dryRun: false })).replayed, true);
      const [[counter]] = await db.admin.query("SELECT last_number FROM issuance_counters WHERE series_id='TEST-S1' AND number_year=2569"); assert.equal(counter.last_number, 90);
      const [[gate]] = await db.admin.query('SELECT state FROM issuance_migration_gate'); assert.equal(gate.state, 'blocked');
      const [[after]] = await db.admin.query('SELECT SUM(active) n FROM issuance_grants'); assert.equal(after.n, grants.n);
      assert.equal((await history(pool, { staffId: 'TEST-001', departmentId: '204' }, '', 1)).documents.length, 4);
      assert.equal((await history(pool, { staffId: 'TEST-002', departmentId: '204' }, '', 1)).documents.length, 3);
      assert.equal((await history(pool, { staffId: 'TEST-003', departmentId: 'TEST-D1' }, '', 1)).documents.length, 1);
      await assert.rejects(historyDetail(pool, { staffId: 'TEST-002', departmentId: '204' }, dump.sourceSha256, '6'), error => error.status === 404);
      const detail = await historyDetail(pool, { staffId: 'TEST-001', departmentId: '204' }, dump.sourceSha256, '1');
      assert.deepEqual(detail.details.recipients.map(row => row.sourceId), ['10', '20']);
      assert.equal(detail.pdfPending, true); assert.equal(detail.details.timestampTimeZone, 'unverified');
      assert.equal((await historyDetail(pool, { staffId: 'TEST-001', departmentId: '204' }, dump.sourceSha256, '6')).details.signer.reference, 'STAFF-TEST');
      assert.doesNotMatch(JSON.stringify(detail), /never-expose-secret-path|document_file|payload/);
      assert.equal(Object.hasOwn((await history(pool, { staffId: 'TEST-001', departmentId: '204' }, '', 1)).documents[0], 'details'), false);
      for (const table of ['legacy_staging', 'legacy_dispositions', 'legacy_promotions']) await assert.rejects(pool.query(`SELECT * FROM ${table}`), error => error.code === 'ER_TABLEACCESS_DENIED_ERROR');
    });
    await t.test('changed mapping, history/raw/reservation tampering and rewound counters reject replay', async () => {
      const changed = structuredClone(mapping); changed.review.evidence = 'changed approval';
      await assert.rejects(promoteSnapshot(db.admin, dump, changed, { approvalReference }), /Changed promotion/);
      await db.admin.query("UPDATE legacy_documents SET subject='tampered' WHERE source_id='1'");
      await assert.rejects(promoteSnapshot(db.admin, dump, mapping, { approvalReference }), /payload mismatch/);
      await db.admin.execute("UPDATE legacy_documents SET subject=? WHERE source_id='1'", [dump.tables.genbook.records[0].title]);
      await db.admin.query("UPDATE legacy_document_details SET payload=JSON_SET(payload,'$.legacyActorId','tampered') WHERE source_id='1'");
      await assert.rejects(promoteSnapshot(db.admin, dump, mapping, { approvalReference }), /details payload mismatch/);
      await db.admin.execute("UPDATE legacy_document_details SET payload=? WHERE source_id='1'", [JSON.stringify(mappingPlan(dump, mapping).documents.find(row => row.sourceId === '1').details)]);
      await db.admin.query("UPDATE issuance_counters SET last_number=89 WHERE series_id='TEST-S1'");
      await assert.rejects(promoteSnapshot(db.admin, dump, mapping, { approvalReference }), /counter mismatch/);
      await db.admin.query("UPDATE issuance_counters SET last_number=90 WHERE series_id='TEST-S1'; UPDATE legacy_number_reservations SET main_number=999 WHERE source_id='1'");
      await assert.rejects(promoteSnapshot(db.admin, dump, mapping, { approvalReference }), /Reservation payload/);
      await db.admin.query("UPDATE legacy_number_reservations SET main_number=42 WHERE source_id='1'; UPDATE legacy_staging SET payload=JSON_OBJECT('tampered',true) WHERE source_table='genbook' AND source_id='1'");
      await assert.rejects(promoteSnapshot(db.admin, dump, mapping, { approvalReference }), /Staged payload/);
    });
  } finally { await pool.end(); await db.close(); }
});
