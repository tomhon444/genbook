import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { promotionFixture } from './promotion-fixture.mjs';
import { readDump } from './dump.mjs';
import { collectSourceReferences, buildIdentityEvidence } from './identity-evidence.mjs';

const run = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('proposal CLI creates an unapproved source-bound packet and preserves earlier packets', async () => {
  const directory = `.local/t12/proposal-cli-test-${randomUUID()}`;
  await mkdir(directory, { recursive: true });
  const { dump: fixture } = promotionFixture();
  const literal = value => value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  const sql = Object.entries(fixture.tables).filter(([, table]) => table.records.length).map(([name, table]) => {
    const fields = [...new Set(table.records.flatMap(row => Object.keys(row)))];
    return `INSERT INTO \`${name}\` (${fields.map(field => `\`${field}\``).join(',')}) VALUES ${table.records.map(row => `(${fields.map(field => literal(row[field])).join(',')})`).join(',')};`;
  }).join('\n');
  const snapshot = `${directory}/source.sql.gz`;
  await writeFile(snapshot, gzipSync(sql));
  const dump = await readDump(snapshot);
  const tables = Object.entries(dump.tables).map(([name, table]) => {
    const columns = [...new Set(table.records.flatMap(row => Object.keys(row)))];
    return { name, columns, records: table.records.map(row => columns.map(column => row[column])) };
  });
  const source = collectSourceReferences({ sourceSha256: dump.sourceSha256, tables });
  const packet = { schemaVersion: 1, sourceSha256: dump.sourceSha256, completedAt: '2026-11-19T00:00:00Z',
    approvals: null, readyForLocalPromotion: false, productionReady: false,
    central: { provider: 'central', readOnlyFlag: 'tx_read_only', characterSetResults: 'utf8mb4', consistentSnapshot: false, consistencyNote: 'MyISAM is not a consistent snapshot.',
      tables: [{ TABLE_NAME: 'STAFF_INFO', ENGINE: 'MyISAM' }, { TABLE_NAME: 'DEPT', ENGINE: 'MyISAM' }],
      selectedColumns: { staff: ['STAFF_ID', 'DEPT_ID', 'ACTIVE'], departments: ['DEPT_ID', 'STATUS'] } },
    evidence: buildIdentityEvidence(source, [{ STAFF_ID: 'TEST-001', DEPT_ID: '204', ACTIVE: '1' }], [{ DEPT_ID: '204', STATUS: '1' }]) };
  const bytes = JSON.stringify(packet, null, 2);
  await writeFile(`${directory}/evidence.json`, bytes);
  await writeFile(`${directory}/summary.json`, JSON.stringify({ sourceSha256: dump.sourceSha256, evidenceSha256: digest(bytes) }));
  const args = ['tools/migration/prepare-mapping-proposal.mjs', snapshot, directory];
  const first = await run(process.execPath, args);
  assert.doesNotMatch(first.stdout, /TEST-001|Restricted synthetic raw|LEGACY-ACTOR/);
  const output = JSON.parse(first.stdout);
  const mapping = JSON.parse(await readFile(`${output.directory}/mapping.json`, 'utf8'));
  assert.equal(mapping.sourceSha256, dump.sourceSha256);
  assert.equal(mapping.review, null);
  assert.ok(['owners', 'departments', 'series'].every(kind => mapping[kind].every(row => row.review === null)));
  assert.ok(Object.values(mapping.policies).every(value => value === 'pending'));
  assert.equal(output.validation.readyForLocalPromotion, false);
  assert.equal(output.validation.historyDocuments, 0);
  assert.equal(output.validation.counterScopes, 0);
  assert.ok(output.validation.blockers > 0);
  const saved = await readFile(`${output.directory}/mapping.json`, 'utf8');
  const second = JSON.parse((await run(process.execPath, args)).stdout);
  assert.notEqual(second.directory, output.directory);
  assert.equal(await readFile(`${output.directory}/mapping.json`, 'utf8'), saved);
  assert.equal(await readFile(`${directory}/evidence.json`, 'utf8'), bytes);

  await writeFile(`${directory}/summary.json`, JSON.stringify({ sourceSha256: dump.sourceSha256, evidenceSha256: '0'.repeat(64) }));
  await assert.rejects(run(process.execPath, args), error => {
    assert.match(error.stderr, /Mapping proposal refused/);
    assert.doesNotMatch(error.stderr, /TEST-001|Restricted synthetic raw/);
    return true;
  });
});
