import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { investigateReferenceRows, investigateReferenceExceptions } from './investigate-reference-exceptions.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const table = (name, columns, records) => ({ name, columns, records });
const plan = () => ({ tables: [
  table('bookdept', ['bookdept_id', 'book_number', 'book_idbook', 'sub_dept'], [['00069', 'อว 6801.1001(2)\t', '68', 'context'], ['00015', 'มอ 208.5', '22', 'context']]),
  table('book', ['idbook', 'status', 'typebook_idtypebook'], [['68', '0', '5']]),
  table('typebook', ['idtypebook', 'typebook'], [['5', 'อว']]),
  table('genbook', ['bookdept', 'gen_book_year'], [['69', '2569'], ['00015', '2568'], ['15', '2568']]),
] });
const reviews = () => ({ rows: [
  { kind: 'series', itemId: 'series:00069', sourceId: '00069', exceptions: [{ field: 'displayName' }] },
  { kind: 'series', itemId: 'series:00015', sourceId: '00015', exceptions: [{ field: 'documentType' }] },
] });

test('trailing TAB yields only a display proposal; inactive parent and prefix stay intact', () => {
  const input = plan();
  const result = investigateReferenceRows(input, reviews());
  const row = result.rows[0];
  assert.equal(row.source.originalPrefix, 'อว 6801.1001(2)\t');
  assert.equal(row.source.parent.status, '0');
  assert.equal(row.source.type.name, 'อว');
  assert.deepEqual(row.controls.map(control => control.codePoint), ['U+0009']);
  assert.equal(row.fields[0].proposedValue, 'อว 6801.1001(2)');
  assert.equal(row.fields[0].decision, 'pending');
  assert.equal(input.tables[0].records[0][1], 'อว 6801.1001(2)\t');
});

test('missing parent is unresolved despite a familiar prefix; counts are raw snapshot history', () => {
  const result = investigateReferenceRows(plan(), reviews());
  const row = result.rows[1];
  assert.equal(row.source.parentMatches, 0); assert.equal(row.source.type, null);
  assert.equal(row.fields[0].finding, 'parent-row-absent'); assert.equal(row.fields[0].proposedValue, null);
  assert.deepEqual(row.history, { records: 2, years: { 2568: 2 } });
  assert.deepEqual(result.missingParentGroups, [{ bookId: '22', seriesIds: ['00015'], historyRecords: 2 }]);
  assert.throws(() => investigateReferenceRows(plan(), { rows: [reviews().rows[0], reviews().rows[0]] }), /REVIEW_SCOPE/);
});

test('embedded or multiple control characters never produce an automatic cleanup candidate', () => {
  const input = plan(); input.tables[0].records[0][1] = 'bad\ntext\t';
  assert.equal(investigateReferenceRows(input, reviews()).rows[0].fields[0].proposedValue, null);
});

test('file workflow binds source/hash, escapes output, preserves inputs and rejects changed packets', async () => {
  const directory = `.local/t12/reference-investigation-test-${randomUUID()}`;
  await mkdir(directory, { recursive: true });
  const source = gzipSync(plan().tables.map(table => `CREATE TABLE \`${table.name}\` (\`x\` text) ENGINE=InnoDB;\nINSERT INTO \`${table.name}\` (${table.columns.map(column => `\`${column}\``).join(',')}) VALUES ${table.records.map(record => `(${record.map(value => `'${value.replaceAll('\\', '\\\\').replaceAll('\t', '\\t')}'`).join(',')})`).join(',')};`).join('\n'));
  const sourceFile = path.join(directory, 'source.sql.gz');
  await writeFile(sourceFile, source);
  const referenceRows = reviews().rows.map(row => ({ ...row, decision: 'pending', reviewer: null,
    fieldReviews: row.exceptions.map(exception => ({ field: exception.field, decision: 'pending', reviewer: null })) }));
  const values = { 'reference-decisions.json': JSON.stringify({ sourceSha256: hash(source), executable: false, rows: referenceRows }),
    'grant-decisions.json': '{}', 'summary.json': '{}', 'REVIEW.md': 'fixture' };
  const files = {};
  for (const [name, bytes] of Object.entries(values)) { await writeFile(path.join(directory, name), bytes); files[name] = hash(bytes); }
  const manifest = { schemaVersion: 1, sourceSha256: hash(source), executable: false, ac2Approved: false, productionReady: false,
    databaseWritesPerformed: false, grantsCreated: 0, files };
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  const result = await investigateReferenceExceptions(sourceFile, directory);
  assert.equal(result.seriesInvestigated, 2); assert.equal(result.missingParentIds, 1); assert.equal(result.decisionsRecorded, 0);
  const markdown = await readFile(path.join(result.directory, 'REVIEW.md'), 'utf8');
  assert.match(markdown, /\\t/); assert.match(markdown, /pending/);
  const outputManifest = JSON.parse(await readFile(path.join(result.directory, 'manifest.json')));
  for (const [name, digest] of Object.entries(outputManifest.files)) assert.equal(hash(await readFile(path.join(result.directory, name))), digest);
  assert.deepEqual(await readFile(sourceFile), source);
  await writeFile(path.join(directory, 'REVIEW.md'), 'changed');
  await assert.rejects(investigateReferenceExceptions(sourceFile, directory), /DIGEST/);
  await writeFile(sourceFile, gzipSync('different source'));
  await assert.rejects(investigateReferenceExceptions(sourceFile, directory), /MANIFEST/);
});
