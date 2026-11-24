import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { collectReferenceNames } from './reference-names.mjs';
import { groupGrantRows, prepareDecisionReview } from './prepare-decision-review.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const grant = index => ({ sourceTable: 'bookdept_user', sourceRowIndex: index, sourceId: `000${index}`, staffId: 'PRIVATE-FIXTURE',
  centralStaffStatus: 'active', currentDepartmentStatus: 'active', sourceDepartmentStatus: 'unresolved',
  reasons: ['source-department-unresolved'], enabled: false, decision: 'pending', review: null });

async function fixture() {
  const directory = `.local/t12/decision-review-test-${randomUUID()}`;
  await mkdir(directory, { recursive: true });
  const sourceSha256 = 'a'.repeat(64);
  const references = { sourceSha256, executable: false, review: null,
    series: [{ sourceId: '00001', targetId: 'S1', sourceCandidate: { documentType: '', provenance: { originalPrefix: '<bad>|\nname' } }, displayName: '', documentType: '', enabled: false, decision: 'pending', review: null }],
    departments: [{ sourceId: '0204', targetId: 'D1', displayName: '', nameVerified: false, decision: 'pending', review: null }],
    documentTypes: [{ sourceId: '1', sourceCandidateName: 'หนังสือ', displayName: '', decision: 'pending', review: null }] };
  const files = { 'references.json': references, 'grants-review.json': { sourceSha256, executable: false, rows: [grant(0), grant(1)] },
    ...Object.fromEntries(['summary.json', 'attachments-inventory.json', 'time-review.json', 'acceptance.json'].map(name => [name, { sourceSha256 }])),
    'REVIEW.md': 'fixture', 'REFERENCES.md': 'fixture' };
  const hashes = {};
  for (const [name, value] of Object.entries(files)) {
    const bytes = typeof value === 'string' ? value : JSON.stringify(value);
    await writeFile(path.join(directory, name), bytes); hashes[name] = digest(bytes);
  }
  const manifest = { schemaVersion: 1, sourceSha256, mappingSha256: 'b'.repeat(64), mappingFingerprint: 'c'.repeat(64),
    targetsSha256: 'd'.repeat(64), evidenceSha256: 'e'.repeat(64), evidenceReceiptSha256: 'f'.repeat(64),
    ac2Approved: false, productionReady: false, databaseWritesPerformed: false, grantsCreated: 0, files: hashes };
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  const names = await collectReferenceNames(directory, undefined, { loadConfig: () => assert.fail('offline') }, { offline: true });
  return { directory, names: names.directory };
}

test('grant groups cover every row once while independent reason counts can overlap', () => {
  const rows = [grant(0), { ...grant(1), reasons: ['staff-inactive', 'source-department-unresolved', 'staff-inactive'] },
    { ...grant(2), reasons: ['source-department-unresolved', 'staff-inactive'] }];
  const { groups, reasonCounts } = groupGrantRows(rows);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.flatMap(group => group.rowIndexes).sort(), [0, 1, 2]);
  assert.deepEqual(reasonCounts, { 'source-department-unresolved': 3, 'staff-inactive': 2 });
  assert.deepEqual(groupGrantRows([...rows].reverse()).groups.map(group => group.groupId), groups.map(group => group.groupId));
  assert.throws(() => groupGrantRows([grant(0), grant(0)]), /GRANT_SHAPE/);
});

test('offline packet preserves input bytes, every pending decision and full row coverage; output hashes match', async () => {
  const input = await fixture();
  const before = await readFile(path.join(input.directory, 'grants-review.json'));
  const result = await prepareDecisionReview(input.directory, input.names);
  assert.equal(result.grantRows, 2); assert.equal(result.referenceItems, 3); assert.equal(result.referenceItemsWithExceptions, 2);
  assert.equal(result.allPending, true); assert.equal(result.ac2Approved, false);
  const grants = JSON.parse(await readFile(path.join(result.directory, 'grant-decisions.json')));
  const references = JSON.parse(await readFile(path.join(result.directory, 'reference-decisions.json')));
  assert.deepEqual(references.rows[0].fieldReviews.map(row => [row.field, row.decision]), [['displayName', 'pending'], ['documentType', 'pending']]);
  assert.equal(grants.rows.length, 2); assert.deepEqual(grants.groups[0].rowIndexes, [0, 1]);
  for (const row of grants.rows) { assert.equal(row.enabled, false); assert.equal(row.decision, 'pending'); assert.equal(row.currentReview.reviewer, null); }
  assert.deepEqual(await readFile(path.join(input.directory, 'grants-review.json')), before);
  const manifest = JSON.parse(await readFile(path.join(result.directory, 'manifest.json')));
  for (const [name, hash] of Object.entries(manifest.files)) assert.equal(digest(await readFile(path.join(result.directory, name))), hash);
  const markdown = await readFile(path.join(result.directory, 'REVIEW.md'), 'utf8');
  assert.doesNotMatch(markdown, /PRIVATE-FIXTURE/);
  assert.match(markdown, /ยัง pending/);
  assert.notEqual((await prepareDecisionReview(input.directory, input.names)).directory, result.directory);
});

test('refuses cross-packet binding, changed files, and unsafe manifest filenames', async () => {
  const input = await fixture();
  const manifestPath = path.join(input.names, 'manifest.json');
  const original = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(original);
  manifest.inputPacketManifestSha256 = '0'.repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(prepareDecisionReview(input.directory, input.names), /NAMES_BINDING/);
  await writeFile(manifestPath, original);
  await writeFile(path.join(input.names, 'REFERENCES.md'), 'changed');
  await assert.rejects(prepareDecisionReview(input.directory, input.names), /NAMES_DIGEST/);
  manifest.files['../private.json'] = 'a'.repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(prepareDecisionReview(input.directory, input.names), /NAMES_BINDING/);
});

test('refuses invented reference text even when output digests are recomputed', async () => {
  const input = await fixture();
  const referencePath = path.join(input.names, 'references.json');
  const references = JSON.parse(await readFile(referencePath));
  references.series[0].displayName = 'invented';
  const bytes = JSON.stringify(references);
  await writeFile(referencePath, bytes);
  const manifestPath = path.join(input.names, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath));
  manifest.files['references.json'] = digest(bytes);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(prepareDecisionReview(input.directory, input.names), /REFERENCE_CONTENT/);
});
