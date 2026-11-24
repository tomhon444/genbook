import test from 'node:test';
import assert from 'node:assert/strict';
import { promotionFixture } from './promotion-fixture.mjs';
import { mappingTemplate, mappingPlan } from './mapping.mjs';
import { collectSourceReferences, buildIdentityEvidence } from './identity-evidence.mjs';
import { buildAc2Review } from './ac2-review.mjs';
import { prepareAc2Review } from './prepare-ac2-review.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { inspectNativeDump } from './native-dump.mjs';
import { readDump } from './dump.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const digest = value => createHash('sha256').update(value).digest('hex');

function fixture() {
  const { dump, mapping: approved } = promotionFixture();
  dump.tables.book.records = [{ idbook: '1', book: 'Source book', dept_id: '204', alias_dept: '<source alias>|', status: '1', typebook_idtypebook: '1' }];
  dump.tables.typebook.records = [{ idtypebook: '1', typebook: 'Source type', typesecret: '0' }];
  Object.assign(dump.tables.bookdept.records[0], { dept_id: '204', book_idbook: '1', sub_dept: 'Source series' });
  dump.tables.genbook.records[0].user_request = '0001';
  const mapping = mappingTemplate(dump);
  mapping.review = approved.review; mapping.policies = approved.policies;
  for (const kind of ['owners', 'departments', 'series']) for (const row of mapping[kind]) {
    row.review = approved.review; row.decision = kind === 'series' && row.sourceId !== '00001' ? 'hold' : 'map';
    row.targetId = row.decision === 'hold' ? '' : kind === 'series' ? 'TEST-S1' : row.sourceId;
    if (kind === 'series') row.yearBasis = row.decision === 'hold' ? '' : 'calendar';
  }
  const native = { sourceSha256: dump.sourceSha256, tables: Object.entries(dump.tables).map(([name, table]) => {
    const columns = [...new Set(table.records.flatMap(row => Object.keys(row)))];
    return { name, columns, records: table.records.map(row => columns.map(column => row[column])) };
  }) };
  native.tables.push({ name: 'bookdept_user', columns: ['bookdept_user_id', 'staff_id', 'bookdept_id', 'dept_id'], records: [
    ['1', 'TEST-001', '1', '204'], ['2', '0001', '1', '0204'], ['3', 'TEST-001', '96', '204'],
    ['4', 'MISSING', '1', '204'], ['5', 'TEST-001', '1', '0204'],
  ] }, { name: 'user_tb', columns: ['staff_id', 'level', 'password'], records: [['TEST-001', '1', 'NEVER-SERIALIZE-PASSWORD']] });
  const packet = { schemaVersion: 1, sourceSha256: dump.sourceSha256, completedAt: '2026-11-19T00:00:00Z',
    approvals: null, readyForLocalPromotion: false, productionReady: false,
    central: { provider: 'central', readOnlyFlag: 'tx_read_only', characterSetResults: 'utf8mb4', consistentSnapshot: false,
      consistencyNote: 'Nontransactional directory evidence; recheck before cutover.',
      tables: [{ TABLE_NAME: 'STAFF_INFO', ENGINE: 'MyISAM' }, { TABLE_NAME: 'DEPT', ENGINE: 'MyISAM' }],
      selectedColumns: { staff: ['STAFF_ID', 'DEPT_ID', 'ACTIVE'], departments: ['DEPT_ID', 'STATUS'] } },
    evidence: buildIdentityEvidence(collectSourceReferences(native), [
      { STAFF_ID: 'TEST-001', DEPT_ID: '204', ACTIVE: '1' }, { STAFF_ID: '0001', DEPT_ID: '0204', ACTIVE: '0' },
    ], [{ DEPT_ID: '204', STATUS: '1' }, { DEPT_ID: '0204', STATUS: '0' }]) };
  const plan = mappingPlan(dump, mapping);
  const targets = { sourceSha256: dump.sourceSha256, mappingFingerprint: plan.mappingFingerprint,
    preservationApprovalReference: 'Synthetic preservation approval', review: approved.review,
    series: [{ id: 'TEST-S1', name: 'T12 rehearsal series', documentType: 'T12 rehearsal type' }], departments: [{ id: '204', name: 'T12 rehearsal department' }] };
  return { dump, native, mapping, targets, packet };
}

test('offline AC2 packet lists source candidates and all grants without approving names or permissions', () => {
  const input = fixture(), original = structuredClone(input);
  const result = buildAc2Review(input);
  assert.deepEqual(input, original);
  assert.equal(result.summary.sourceDocuments, 6);
  assert.equal(result.summary.mappedSeries, 1);
  assert.equal(result.summary.legacyGrantRows, 5);
  assert.equal(result.summary.grantsCreated, 0);
  assert.equal(result.summary.ac2Approved, false);
  assert.equal(result.summary.productionReady, false);
  assert.equal(result.summary.databaseWritesPerformed, false);
  assert.equal(result.references.series[0].sourceCandidate.name, 'Source series');
  assert.equal(result.references.series[0].sourceCandidate.documentType, 'Source type');
  assert.equal(result.references.series[0].displayName, '');
  assert.equal(result.references.series[0].review, null);
  assert.equal(result.references.departments[0].nameVerified, false);
  assert.equal(result.grants.rows[1].staffId, '0001');
  assert.equal(result.grants.rows[1].sourceDepartmentId, '0204');
  assert.ok(result.grants.rows[1].reasons.includes('staff-inactive'));
  assert.ok(result.grants.rows[2].reasons.includes('source-series-missing'));
  assert.ok(result.grants.rows[3].reasons.includes('staff-missing'));
  assert.ok(result.grants.rows[3].reasons.includes('owner-mapping-required'));
  assert.ok(result.grants.rows[0].reasons.includes('duplicate-staff-series'));
  assert.ok(result.grants.rows.every(row => row.decision === 'pending' && row.review === null && row.enabled === false));
  assert.doesNotMatch(JSON.stringify(result), /NEVER-SERIALIZE-PASSWORD/);
});

test('source or directory evidence changes are rejected rather than accepted as permission decisions', () => {
  for (const change of [
    value => { value.native.sourceSha256 = '0'.repeat(64); },
    value => { value.packet.sourceSha256 = '0'.repeat(64); },
    value => { value.targets.mappingFingerprint = '0'.repeat(64); },
    value => { value.mapping.review = null; },
    value => { value.packet.evidence.grants[0].staffId = 'replacement'; },
    value => { value.packet.evidence.staffIds.find(row => row.currentDepartmentMatch.status === 'active').currentDepartmentMatch.status = 'inactive'; },
  ]) {
    const value = fixture(); change(value);
    assert.throws(() => buildAc2Review(value));
  }
});

test('file references and unknown times remain source bound and do not attest bytes or timezone', () => {
  const input = fixture(), result = buildAc2Review(input);
  assert.equal(result.attachments.sourceSha256, input.dump.sourceSha256);
  assert.equal(result.summary.attachmentDocuments, 6);
  assert.equal(result.summary.downloadsAttempted, 0);
  assert.equal(result.summary.attachmentBytesVerified, 0);
  assert.equal(result.summary.attachmentMissingReferences, 5);
  assert.equal(result.summary.attachmentInvalidReferences, 1);
  assert.equal(result.times.raw.recordedAtUnknown, 2);
  assert.equal(result.times.promoted.recordedAtUnknown, 1);
  assert.equal(result.times.timestampTimeZone, 'unverified');
  assert.equal(result.times.utcConversionPerformed, false);
  assert.equal(result.summary.promotedPdfPending, 2);
  assert.ok(result.acceptance.checks.every(row => row.decision === 'pending' && row.review === null));
});

test('genuine source-bound time-display approval accepts only text display and never verifies timezone or AC2', () => {
  const input = fixture();
  input.timeDisplayApproval = { schemaVersion: 1, sourceSha256: input.dump.sourceSha256, mappingFingerprint: input.targets.mappingFingerprint,
    scope: 'historical-time-display-only', policy: 'preserve-source-text-with-unverified-timezone-and-unknown-missing',
    review: { by: 'Fixture explicit user confirmation', at: '2026-11-23', evidence: 'Fixture response reference' },
    userResponse: 'แสดงข้อความเวลาเดิมพร้อมระบุว่ายังไม่ยืนยันเขตเวลา และคงค่าที่หายเป็นไม่ทราบ (แนะนำ)' };
  const result = buildAc2Review(input);
  assert.equal(result.times.displayPolicyApproved, true);
  assert.equal(result.times.actualTimezoneVerified, false);
  assert.equal(result.times.timestampTimeZone, 'unverified');
  assert.equal(result.times.utcConversionPerformed, false);
  assert.equal(result.summary.pendingAcceptanceChecks, 6);
  assert.equal(result.summary.ac2Approved, false);
  assert.deepEqual(result.acceptance.checks.filter(row => row.decision === 'accepted').map(row => row.id), ['time-display-policy']);
  for (const change of [
    row => { row.sourceSha256 = '0'.repeat(64); },
    row => { row.mappingFingerprint = '0'.repeat(64); },
    row => { row.scope = 'actual-timezone'; },
    row => { row.policy = 'convert-all-to-UTC'; },
    row => { row.review.by = ''; },
    row => { row.review.at = '2026-02-30'; },
    row => { row.userResponse = 'prepare next step'; },
    row => { row.userResponse = row.userResponse.replace(/[^\x00-\x7F]/g, '?'); },
    row => { row.productionReady = true; },
  ]) {
    const modified = structuredClone(input); change(modified.timeDisplayApproval);
    assert.throws(() => buildAc2Review(modified), /time display approval/);
  }
});

test('CLI creates exclusive private source-bound review packets and rejects changed evidence receipts', async () => {
  const input = fixture(), directory = `.local/t12/ac2-cli-test-${randomUUID()}`;
  await mkdir(directory, { recursive: true });
  const literal = value => value === undefined || value === null ? 'NULL' : `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  const sql = input.native.tables.map(table => {
    const columns = table.columns.length ? table.columns : ['unused'];
    return `CREATE TABLE \`${table.name}\` (${columns.map(column => `\`${column}\` varchar(1000) DEFAULT NULL`).join(',')}) ENGINE=InnoDB;\n`
      + (table.records.length ? `INSERT INTO \`${table.name}\` (${columns.map(column => `\`${column}\``).join(',')}) VALUES ${table.records.map(row => `(${row.map(literal).join(',')})`).join(',')};` : '');
  }).join('\n');
  const compressed = gzipSync(sql), sourceFile = `${directory}/source.sql.gz`;
  await writeFile(sourceFile, compressed);
  const dump = await readDump(sourceFile), native = inspectNativeDump(compressed), mapping = mappingTemplate(dump);
  mapping.review = input.mapping.review; mapping.policies = input.mapping.policies;
  for (const kind of ['owners', 'departments', 'series']) for (const row of mapping[kind]) Object.assign(row, input.mapping[kind].find(item => item.sourceId === row.sourceId));
  const targets = { ...input.targets, sourceSha256: dump.sourceSha256, mappingFingerprint: mappingPlan(dump, mapping).mappingFingerprint };
  const packet = { ...input.packet, sourceSha256: dump.sourceSha256, evidence: buildIdentityEvidence(collectSourceReferences(native), [
    { STAFF_ID: 'TEST-001', DEPT_ID: '204', ACTIVE: '1' }, { STAFF_ID: '0001', DEPT_ID: '0204', ACTIVE: '0' },
  ], [{ DEPT_ID: '204', STATUS: '1' }, { DEPT_ID: '0204', STATUS: '0' }]) };
  const evidence = JSON.stringify(packet, null, 2);
  for (const [name, value] of [['mapping.json', mapping], ['targets.json', targets], ['summary.json', { sourceSha256: dump.sourceSha256, evidenceSha256: digest(evidence) }]]) await writeFile(`${directory}/${name}`, JSON.stringify(value, null, 2));
  await writeFile(`${directory}/evidence.json`, evidence);
  const args = [sourceFile, `${directory}/mapping.json`, `${directory}/targets.json`, directory];
  const first = await prepareAc2Review(...args);
  const manifest = JSON.parse(await readFile(`${first.directory}/manifest.json`, 'utf8'));
  assert.equal(manifest.sourceSha256, dump.sourceSha256);
  assert.equal(manifest.evidenceSha256, digest(evidence));
  assert.equal(manifest.mappingSha256, digest(await readFile(args[1])));
  const saved = await readFile(`${first.directory}/references.json`, 'utf8');
  const secondOutput = await run(process.execPath, ['tools/migration/prepare-ac2-review.mjs', ...args]);
  assert.doesNotMatch(secondOutput.stdout, /TEST-001|MISSING|NEVER-SERIALIZE-PASSWORD|source alias/);
  const second = JSON.parse(secondOutput.stdout);
  assert.notEqual(second.directory, first.directory);
  assert.equal(await readFile(`${first.directory}/references.json`, 'utf8'), saved);
  assert.equal(await readFile(`${directory}/evidence.json`, 'utf8'), evidence);
  const referenceMarkdown = await readFile(`${first.directory}/REFERENCES.md`, 'utf8');
  assert.doesNotMatch(referenceMarkdown, /<source alias>/);
  const acceptance = JSON.parse(await readFile(`${first.directory}/acceptance.json`, 'utf8'));
  assert.equal(acceptance.ac2Approved, false);
  const approval = { schemaVersion: 1, sourceSha256: dump.sourceSha256, mappingFingerprint: targets.mappingFingerprint,
    scope: 'historical-time-display-only', policy: 'preserve-source-text-with-unverified-timezone-and-unknown-missing',
    review: { by: 'Fixture explicit user confirmation', at: '2026-11-23', evidence: 'Fixture conversation response' },
    userResponse: 'แสดงข้อความเวลาเดิมพร้อมระบุว่ายังไม่ยืนยันเขตเวลา และคงค่าที่หายเป็นไม่ทราบ (แนะนำ)' };
  await writeFile(`${directory}/approval.json`, JSON.stringify(approval));
  const approved = JSON.parse((await run(process.execPath, ['tools/migration/prepare-ac2-review.mjs', ...args, '--time-display-approval', `${directory}/approval.json`])).stdout);
  const approvedTimes = JSON.parse(await readFile(`${approved.directory}/time-review.json`, 'utf8'));
  const approvedManifest = JSON.parse(await readFile(`${approved.directory}/manifest.json`, 'utf8'));
  assert.equal(approvedTimes.displayPolicyApproved, true);
  assert.equal(approvedTimes.actualTimezoneVerified, false);
  assert.equal(approvedManifest.timeDisplayApproval.sha256, digest(await readFile(`${directory}/approval.json`)));
  await writeFile(`${directory}/summary.json`, JSON.stringify({ sourceSha256: dump.sourceSha256, evidenceSha256: '0'.repeat(64) }));
  await assert.rejects(prepareAc2Review(...args), /receipt/);
  await assert.rejects(run(process.execPath, ['tools/migration/prepare-ac2-review.mjs', ...args]), error => {
    assert.match(error.stderr, /AC2 review preparation refused/);
    assert.doesNotMatch(error.stderr, /TEST-001|NEVER-SERIALIZE-PASSWORD/);
    return true;
  });
});
