import test from 'node:test';
import assert from 'node:assert/strict';
import { mappingWorkbench, workbenchMarkdown } from './workbench.mjs';
import { promotionFixture } from './promotion-fixture.mjs';
import { mappingTemplate, fingerprint } from './mapping.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readDump } from './dump.mjs';

test('work queue reconciles every group and preserves unreviewed identity blanks', () => {
  const { dump } = promotionFixture(), mapping = mappingTemplate(dump), original = structuredClone(mapping);
  const packet = mappingWorkbench(dump, mapping);
  assert.deepEqual(packet.summary.documentStates, { held: 2, invalid: 0, pending: 4, ready: 0 });
  for (const rows of Object.values(packet.queues)) assert.equal(rows.reduce((sum, row) => sum + row.documentCount, 0), 6);
  assert.deepEqual(mapping, original);
  assert.ok(packet.queues.owners.every(row => row.targetId === '' && row.review === null));
  assert.equal(packet.summary.readyForLocalPromotion, false);
  assert.equal(packet.summary.productionReady, false);
  assert.ok(packet.queues.owners.some(row => row.sourceId === null));
  assert.ok(packet.queues.departments.some(row => row.sourceId === ''));
  assert.doesNotMatch(JSON.stringify(packet), /Restricted synthetic raw|Synthetic orphan|document_file/);
});

test('queue separates source metadata faults, held rows and actor/owner references', () => {
  const { dump } = promotionFixture();
  dump.tables.genbook.records[0].title = '';
  dump.tables.genbook.records[0].user_login = 'ACTOR-ONLY';
  const packet = mappingWorkbench(dump);
  assert.equal(packet.summary.documentStates.invalid, 1);
  assert.equal(packet.summary.documentStates.pending, 3);
  assert.equal(packet.summary.differentActorDocuments, 1);
  assert.equal(packet.summary.missingActorDocuments, 1);
  assert.equal(packet.summary.missingOwnerDocuments, 1);
  assert.ok(packet.centralLookup.staffReferences.includes('ACTOR-ONLY'));
  assert.equal(packet.queues.owners.some(row => row.sourceId === 'ACTOR-ONLY'), false);
  assert.equal(packet.queues.actors.find(row => row.sourceId === 'ACTOR-ONLY').documentStates.invalid, 1);
  assert.ok(packet.sourceIssues.some(row => row.code === 'EMPTY_SOURCE_SUBJECT'));
});

test('reviewed decisions remain exact and mismatched source fingerprints refuse the queue', () => {
  const { dump, mapping } = promotionFixture();
  const before = JSON.stringify(mapping), packet = mappingWorkbench(dump, mapping);
  assert.equal(packet.summary.documentStates.ready, 4);
  assert.equal(JSON.stringify(mapping), before);
  assert.equal(packet.queues.owners.find(row => row.sourceId === 'TEST-001').targetId, 'TEST-001');
  const changed = structuredClone(dump); changed.tables.genbook.records[0].user_request = 'OTHER';
  assert.throws(() => mappingWorkbench(changed, mapping), /exact source/);
});

test('missing unused series and global approvals remain visible despite row-level eligibility', () => {
  const { dump, mapping } = promotionFixture();
  mapping.review = null;
  const packet = mappingWorkbench(dump, mapping);
  assert.equal(packet.summary.documentStates.ready, 4);
  assert.equal(packet.summary.readyForLocalPromotion, false);
  assert.match(workbenchMarkdown(packet), /ยังไม่พร้อม/);
  dump.tables.bookdept.records.push({ bookdept_id: '00002', book_number: 'Synthetic unused series', book_year: 'y' });
  const incomplete = mappingTemplate(dump);
  incomplete.series = incomplete.series.filter(row => row.sourceId !== '00002');
  const missing = mappingWorkbench(dump, incomplete);
  assert.ok(missing.globalBlockers.some(row => row.code === 'MAPPING_MISSING' && row.kind === 'series' && row.sourceId === '00002'));
  assert.equal(missing.unreferencedSeries.find(row => row.sourceId === '00002').decision, 'not-in-mapping');
});

test('readable packet escapes source identifiers and never fabricates review evidence', () => {
  const { dump } = promotionFixture();
  dump.tables.genbook.records[0].user_login = '<script>|`\nactor';
  const packet = mappingWorkbench(dump), markdown = workbenchMarkdown(packet);
  assert.doesNotMatch(markdown, /<script>/);
  assert.match(markdown, /&lt;script&gt;\\\|&#96; actor/);
  assert.equal(packet.sourceFingerprint, fingerprint(dump.tables));
  assert.match(markdown, /ไม่ต้อง dump CENTRAL/);
});

test('CLI creates separate private packets and keeps supplied reviews without printing source identities', async () => {
  const { dump } = promotionFixture(), directory = `.local/t12/workbench-cli-${randomUUID()}`;
  await mkdir(directory, { recursive: true });
  const literal = value => value === null ? 'NULL' : `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  const sql = Object.entries(dump.tables).filter(([, table]) => table.records.length).map(([name, table]) => {
    const fields = Object.keys(table.records[0]);
    return `INSERT INTO \`${name}\` (${fields.map(field => `\`${field}\``).join(',')}) VALUES ${table.records.map(row => `(${fields.map(field => literal(row[field])).join(',')})`).join(',')};`;
  }).join('\n');
  const source = `${directory}/source.sql.gz`;
  await writeFile(source, gzipSync(sql));
  const parsed = await readDump(source), mapping = mappingTemplate(parsed);
  mapping.owners[0].decision = 'hold';
  mapping.owners[0].review = { by: 'Synthetic reviewer', at: '2026-11-16', evidence: 'Synthetic test evidence only' };
  const supplied = `${directory}/supplied.json`;
  await writeFile(supplied, JSON.stringify(mapping));
  const run = promisify(execFile);
  const first = await run(process.execPath, ['tools/migration/prepare-workbench.mjs', source, supplied]);
  const summary = JSON.parse(first.stdout);
  assert.doesNotMatch(first.stdout, /TEST-001|Synthetic reviewer|Synthetic orphan/);
  assert.deepEqual(JSON.parse(await readFile(`${summary.directory}/mapping.json`, 'utf8')), mapping);
  assert.equal(summary.readyForLocalPromotion, false);
  const saved = await readFile(`${summary.directory}/queue.json`, 'utf8');
  const second = JSON.parse((await run(process.execPath, ['tools/migration/prepare-workbench.mjs', source, supplied])).stdout);
  assert.notEqual(summary.directory, second.directory);
  assert.equal(await readFile(`${summary.directory}/queue.json`, 'utf8'), saved);
  assert.deepEqual(JSON.parse(await readFile(supplied, 'utf8')), mapping);
});
