import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fillReferenceNames, readReferencePacket, collectReferenceNames } from './reference-names.mjs';

const references = () => ({ sourceSha256: 'a'.repeat(64), executable: false, review: null,
  series: [{ sourceId: '00001', targetId: 'S1', sourceCandidate: { name: 'ชื่อย่อชุดเดิม', documentType: 'หนังสือ', provenance: { table: 'bookdept', originalPrefix: 'ชุดเดิม' } }, displayName: '', documentType: '', enabled: false, decision: 'pending', review: null }],
  departments: [{ sourceId: '0204', targetId: 'D1', sourceAliases: [{ value: 'ชื่อย่อ' }], displayName: '', nameVerified: false, decision: 'pending', review: null }],
  documentTypes: [{ sourceId: '1', sourceCandidateName: 'หนังสือ', displayName: '', decision: 'pending', review: null }] });

test('fills old series/type text and exact CENTRAL department name while retaining pending decisions', () => {
  const input = references();
  const result = fillReferenceNames(input, [{ DEPT_ID: '0204', DEPT_NAME_TH: 'หน่วยงานเดิม', STATUS: '1' }, { DEPT_ID: '204', DEPT_NAME_TH: 'wrong collation match', STATUS: '1' }]);
  assert.equal(result.references.series[0].displayName, 'ชุดเดิม');
  assert.equal(result.references.documentTypes[0].displayName, 'หนังสือ');
  assert.equal(result.references.departments[0].displayName, 'หน่วยงานเดิม');
  assert.equal(result.references.departments[0].sourceId, '0204');
  assert.equal(result.references.departments[0].decision, 'pending');
  assert.equal(result.references.departments[0].review, null);
  assert.equal(result.references.departments[0].nameVerified, false);
  assert.equal(result.references.series[0].enabled, false);
  assert.equal(input.series[0].displayName, '');
  assert.equal(result.summary.productionReady, false);
});

test('missing, duplicate, invalid and whitespace names remain distinguishable without repairing source text', () => {
  assert.equal(fillReferenceNames(references(), [{ DEPT_ID: '204', DEPT_NAME_TH: 'wrong', STATUS: 1 }]).summary.departmentNamesFilled, 0);
  const duplicate = fillReferenceNames(references(), [1, 2].map(() => ({ DEPT_ID: '0204', DEPT_NAME_TH: 'same', STATUS: 1 })));
  assert.equal(duplicate.references.departments[0].displayName, '');
  assert.equal(duplicate.summary.exceptionCounts['ambiguous-central-department'], 1);
  for (const name of ['', ' ', '\uFFFD', 'bad\nname']) {
    assert.equal(fillReferenceNames(references(), [{ DEPT_ID: '0204', DEPT_NAME_TH: name, STATUS: 1 }]).summary.departmentNamesFilled, 0);
  }
  const spaced = fillReferenceNames(references(), [{ DEPT_ID: '0204', DEPT_NAME_TH: ' retained ', STATUS: 0 }]);
  assert.equal(spaced.references.departments[0].displayName, ' retained ');
  assert.equal(spaced.summary.exceptionCounts['source-name-whitespace-preserved'], 1);
  assert.equal(spaced.summary.exceptionCounts['inactive-central-department'], 1);
});

test('offline output does not claim missing CENTRAL records or use aliases as official department names', () => {
  const result = fillReferenceNames(references(), [], { departmentLookupPerformed: false });
  assert.equal(result.summary.seriesNamesFilled, 1);
  assert.equal(result.summary.documentTypeNamesFilled, 1);
  assert.equal(result.summary.departmentNamesFilled, 0);
  assert.equal(result.summary.exceptionCounts['central-lookup-not-performed'], 1);
  assert.equal(result.summary.exceptionCounts['missing-central-department'], undefined);
});

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function packetFixture() {
  const directory = `.local/t12/reference-names-test-${randomUUID()}`;
  await mkdir(directory, { recursive: true });
  const source = 'a'.repeat(64);
  const grantRows = [{ staffId: 'PRIVATE-FIXTURE-ID', enabled: false, decision: 'pending', review: null }];
  const files = {
    'references.json': references(), 'summary.json': { sourceSha256: source },
    'grants-review.json': { sourceSha256: source, executable: false, rows: grantRows },
    'attachments-inventory.json': { sourceSha256: source }, 'time-review.json': { sourceSha256: source },
    'acceptance.json': { sourceSha256: source }, 'REVIEW.md': 'Fixture review', 'REFERENCES.md': 'Fixture references',
  };
  const hashes = {};
  for (const [file, value] of Object.entries(files)) {
    const bytes = typeof value === 'string' ? value : JSON.stringify(value);
    await writeFile(`${directory}/${file}`, bytes); hashes[file] = digest(bytes);
  }
  const manifest = { schemaVersion: 1, sourceSha256: source, mappingSha256: 'b'.repeat(64), mappingFingerprint: 'c'.repeat(64),
    targetsSha256: 'd'.repeat(64), evidenceSha256: 'e'.repeat(64), evidenceReceiptSha256: 'f'.repeat(64),
    ac2Approved: false, productionReady: false, databaseWritesPerformed: false, grantsCreated: 0, files: hashes };
  await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest));
  return { directory, manifest };
}

test('packet validation rejects changed files and unsafe manifest paths before any collection', async () => {
  const { directory, manifest } = await packetFixture();
  assert.equal((await readReferencePacket(directory)).references.series.length, 1);
  await writeFile(`${directory}/REFERENCES.md`, 'changed');
  await assert.rejects(readReferencePacket(directory), /PACKET_DIGEST/);
  manifest.files['../private.txt'] = 'a'.repeat(64);
  await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest));
  await assert.rejects(readReferencePacket(directory), /PACKET_MANIFEST/);
});

test('bounded read collection selects only department names, filters collation matches, closes and preserves source packet', async () => {
  const { directory } = await packetFixture();
  const sourceBytes = await readFile(`${directory}/references.json`);
  const queries = []; let closed = 0;
  const dependencies = {
    loadConfig: async () => ({ service: { IDENTITY_PROVIDER: 'central', GENBOOKNO_SOURCE_SHA256: 'a'.repeat(64) }, central: { CENTRAL_DB_NAME: 'CENTRAL' } }),
    openSession: async () => ({ readOnlyFlag: 'START TRANSACTION READ ONLY', characterSetResults: 'utf8mb4', consistentSnapshot: true, tlsVerified: true,
      query: async (sql, params) => { queries.push({ sql, params }); return sql.includes('information_schema') ? [{ TABLE_NAME: 'DEPT', ENGINE: 'MyISAM' }] : [
        { DEPT_ID: '0204', DEPT_NAME_TH: '<exact name>', STATUS: '1', PASSWORD: 'NEVER-COPY' },
        { DEPT_ID: '204', DEPT_NAME_TH: 'collation-only', STATUS: '1' },
      ]; }, close: async () => { closed++; } }),
  };
  const result = await collectReferenceNames(directory, undefined, dependencies);
  assert.equal(result.departmentNamesFilled, 1); assert.equal(result.centralConsistentSnapshot, false); assert.equal(closed, 1);
  assert.deepEqual(queries[1].params, ['0204']);
  assert.equal(queries[1].sql, 'SELECT DEPT_ID, DEPT_NAME_TH, STATUS FROM DEPT WHERE DEPT_ID IN (?)');
  const evidence = await readFile(`${result.directory}/central-names.json`, 'utf8');
  assert.doesNotMatch(evidence, /PASSWORD|NEVER-COPY|collation-only/);
  const markdown = await readFile(`${result.directory}/REFERENCES.md`, 'utf8');
  assert.match(markdown, /&lt;exact name&gt;/);
  assert.deepEqual(await readFile(`${directory}/references.json`), sourceBytes);
  const again = await collectReferenceNames(directory, undefined, dependencies);
  assert.notEqual(result.directory, again.directory);
  const outputManifest = JSON.parse(await readFile(`${result.directory}/manifest.json`, 'utf8'));
  for (const [file, hash] of Object.entries(outputManifest.files)) assert.equal(digest(await readFile(`${result.directory}/${file}`)), hash);
});

test('source mismatch and unverified transport refuse names and close any opened session', async () => {
  const { directory } = await packetFixture(); let opened = 0, closed = 0;
  const dependencies = {
    loadConfig: async () => ({ service: { IDENTITY_PROVIDER: 'central', GENBOOKNO_SOURCE_SHA256: '0'.repeat(64) }, central: {} }),
    openSession: async () => { opened++; return { readOnlyFlag: true, characterSetResults: 'utf8mb4', consistentSnapshot: true, tlsVerified: false, close: async () => { closed++; } }; },
  };
  await assert.rejects(collectReferenceNames(directory, undefined, dependencies), /SERVICE_SOURCE/); assert.equal(opened, 0);
  dependencies.loadConfig = async () => ({ service: { IDENTITY_PROVIDER: 'central', GENBOOKNO_SOURCE_SHA256: 'a'.repeat(64) }, central: {} });
  await assert.rejects(collectReferenceNames(directory, undefined, dependencies), /READ_ONLY_SESSION/); assert.equal(closed, 1);
});

test('offline collection records the transport blocker as reported and never opens a connection', async () => {
  const { directory } = await packetFixture();
  const result = await collectReferenceNames(directory, undefined, { loadConfig: () => { throw new Error('must not connect'); } }, { offline: true, departmentBlocker: 'TLS_NOT_AVAILABLE' });
  assert.equal(result.departmentNamesFilled, 0);
  assert.equal(result.departmentCollection.status, 'not-collected');
  assert.match(result.departmentCollection.reasonEvidence, /operator-reported/);
  assert.equal(result.productionReady, false);
});
