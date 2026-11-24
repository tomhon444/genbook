import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { exportSourceSnapshot, readSnapshotManifest } from './source-snapshot.mjs';
import { hash, readDump } from './dump.mjs';

const coreKeys = { book: 'idbook', bookdept: 'bookdept_id', genbook: 'gen_book_id', genbook_inform: 'gen_book_inform_id', genbook_dept: 'gen_book_dept_id', typebook: 'idtypebook' };
function fixture({ missing, engine = 'InnoDB', readOnly = true, isolation = 'REPEATABLE-READ', isolationFallback = false, conversionWarning = false, failOnTable, changeCount, bufferText = false } = {}) {
  const calls = [];
  const data = Object.fromEntries(Object.entries(coreKeys).map(([table, key]) => [table, [{ [key]: '1', text: table === 'genbook' ? "ภาษาไทย 'quote' \\ backslash\nnew\0line\r\t\b\x1a; -- INSERT INTO `genbook`" : 'label', optional: null }]]));
  data.genbook.push({ gen_book_id: '2', text: 'second', optional: '999999999999999999999999999999' });
  if (bufferText) data.genbook[0].text = Buffer.from([0xff, 0xfe]);
  data.extra_blobs = [{ id: '1', bytes: Buffer.from([0, 255, 128, 39, 92]) }];
  data.extra_without_pk = [{ note: 'a' }, { note: 'b' }];
  if (missing) delete data[missing];
  let reads = 0;
  let rolledBack = 0;
  let pendingWarning = false;
  const connection = {
    query: async sql => {
      calls.push({ sql });
      if (sql === 'SHOW WARNINGS' && pendingWarning) { pendingWarning = false; return [[{ Level: 'Warning', Code: 1300, Message: 'Synthetic invalid character: NEVER-EXPOSE' }], []]; }
      return [[], []];
    },
    rollback: async () => { rolledBack++; calls.push({ sql: 'ROLLBACK' }); },
    execute: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('AS isolationLevel')) {
        if (isolationFallback && sql.includes('transaction_isolation')) throw Object.assign(new Error('Unknown variable'), { code: 'ER_UNKNOWN_SYSTEM_VARIABLE' });
        return [[{ isolationLevel: isolation }], []];
      }
      if (sql.includes('AS flag')) return [[{ flag: readOnly ? 1 : 0 }], []];
      if (sql.includes('AS clientCharset')) return [[{ clientCharset: 'utf8mb4', resultsCharset: 'utf8mb4', timeZone: '+07:00' }], []];
      if (sql.includes('information_schema.TABLES')) return [Object.keys(data).sort().map(name => ({ name, engine, collation: 'utf8mb4_unicode_ci' })), []];
      if (sql.includes('information_schema.COLUMNS')) return [Object.entries(data).flatMap(([tableName, records]) => Object.keys(records[0]).map((name, index) => ({ tableName, name, dataType: name === 'bytes' ? 'blob' : name === coreKeys[tableName] || name === 'id' ? 'bigint' : 'varchar', columnType: 'synthetic', nullable: 'YES', defaultValue: null, extra: '', charset: name === 'bytes' ? null : 'utf8mb4', collation: null, position: index + 1 }))), []];
      if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return [Object.keys(data).filter(name => name !== 'extra_without_pk').map(tableName => ({ tableName, name: coreKeys[tableName] ?? 'id', position: 1 })), []];
      const table = /`synthetic`\.`([a-z_]+)`/.exec(sql)?.[1];
      if (!table) throw new Error('Unexpected synthetic query');
      if (sql.startsWith('SHOW CREATE TABLE')) return [[{ 'Create Table': `CREATE TABLE \`${table}\` (synthetic)` }], []];
      if (sql.startsWith('SELECT COUNT')) {
        reads++;
        return [[{ total: String(data[table].length + (changeCount && reads > Object.keys(data).length && table === 'genbook' ? 1 : 0)) }], []];
      }
      if (failOnTable === table) throw new Error('credential=NEVER-EXPOSE row-text');
      const limit = sql.includes(' OFFSET ?') ? params.at(-2) : params.at(-1);
      let selected = data[table];
      if (sql.includes(' WHERE ')) {
        const key = coreKeys[table] ?? 'id';
        selected = selected.filter(row => BigInt(row[key]) > BigInt(params[0]));
      }
      if (sql.includes(' OFFSET ?')) selected = selected.slice(params.at(-1));
      if (conversionWarning && table === 'genbook') pendingWarning = true;
      return [selected.slice(0, limit), []];
    },
  };
  return { connection, calls, data, rolledBack: () => rolledBack };
}
async function destination(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'genbook-source-export-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return path.join(root, 'source.sql.gz');
}

test('all tables export with complete columns, exact escaping, binary bytes and parser reconciliation', async t => {
  const f = fixture();
  const outputFile = await destination(t);
  const report = await exportSourceSnapshot({ connection: f.connection, schema: 'synthetic', outputFile, batchSize: 1 });
  const bytes = await readFile(outputFile);
  assert.equal(report.sourceSha256, hash(bytes));
  assert.equal(report.compressedBytes, bytes.length);
  const sql = gunzipSync(bytes).toString('utf8');
  assert.equal(report.uncompressedSha256, hash(sql));
  assert.match(sql, /INSERT INTO `genbook` \(`gen_book_id`,`text`,`optional`\) VALUES/);
  assert.match(sql, /X'00ff80275c'/);
  const parsed = await readDump(outputFile);
  assert.deepEqual(parsed.tables.genbook.records, f.data.genbook);
  assert.equal(report.tables.length, 8);
  assert.equal(report.totalRows, Object.values(f.data).reduce((sum, records) => sum + records.length, 0));
  assert.ok(report.tables.every(table => table.countBefore === table.countExported && table.countBefore === table.countAfter));
  assert.equal(report.consistencyGuaranteed, true);
  assert.equal(report.isolationLevel, 'REPEATABLE-READ');
  const isolationSet = f.calls.findIndex(call => call.sql === 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  const isolationRead = f.calls.findIndex(call => call.sql.includes('AS isolationLevel'));
  const snapshotStart = f.calls.findIndex(call => call.sql === 'START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT');
  assert.ok(isolationSet >= 0 && isolationRead > isolationSet && snapshotStart > isolationRead);
  assert.equal(f.rolledBack(), 1);
  assert.equal((await readSnapshotManifest(report.manifestFile)).sourceSha256, report.sourceSha256);
  assert.ok(f.calls.some(call => call.sql.includes(' WHERE (`gen_book_id`) > (?)')));
  assert.ok(f.calls.some(call => call.sql.includes(' OFFSET ?')));
  assert.ok(f.calls.every(call => /^(SELECT|SHOW|SET SESSION TRANSACTION (READ ONLY|ISOLATION LEVEL REPEATABLE READ)|SET NAMES utf8mb4|SET SESSION character_set_results|START TRANSACTION READ ONLY|ROLLBACK)/.test(call.sql)));
});

test('nontransactional engines are honestly reported rather than claimed consistent', async t => {
  const f = fixture({ engine: 'MyISAM' });
  const report = await exportSourceSnapshot({ connection: f.connection, schema: 'synthetic', outputFile: await destination(t) });
  assert.equal(report.consistencyGuaranteed, false);
  assert.equal(report.nonTransactionalTables.length, 8);
  assert.match(report.limitations.join(' '), /Equal before\/after counts do not prove unchanged/);
});

test('unsafe schema/options, missing required table and unconfirmed read-only mode refuse without publishing', async t => {
  const outputFile = await destination(t);
  for (const [schema, options, code] of [
    ['synthetic; DROP', {}, 'IDENTIFIER_UNSUPPORTED'],
    ['synthetic', { missing: 'genbook' }, 'REQUIRED_TABLE_MISSING'],
    ['synthetic', { readOnly: false }, 'READ_ONLY_NOT_CONFIRMED'],
    ['synthetic', { isolation: 'READ-COMMITTED' }, 'ISOLATION_NOT_CONFIRMED'],
  ]) {
    const f = fixture(options);
    await assert.rejects(exportSourceSnapshot({ connection: f.connection, schema, outputFile }), { code });
    assert.deepEqual(await readdir(path.dirname(outputFile)), []);
  }
});

test('existing snapshot or manifest is never overwritten', async t => {
  const outputFile = await destination(t);
  await writeFile(outputFile, 'original');
  await assert.rejects(exportSourceSnapshot({ connection: fixture().connection, schema: 'synthetic', outputFile }), { code: 'DESTINATION_EXISTS' });
  assert.equal(await readFile(outputFile, 'utf8'), 'original');
  const other = path.join(path.dirname(outputFile), 'other.sql.gz');
  await writeFile(`${other}.manifest.json`, 'existing manifest');
  await assert.rejects(exportSourceSnapshot({ connection: fixture().connection, schema: 'synthetic', outputFile: other }), { code: 'DESTINATION_EXISTS' });
  assert.equal(await readFile(`${other}.manifest.json`, 'utf8'), 'existing manifest');
});

test('driver error, count drift, unsafe buffers and size limit roll back and leave no final/partial data', async t => {
  const directoryFile = await destination(t);
  for (const [index, options, extra, code] of [
    [0, { failOnTable: 'genbook' }, {}, 'EXPORT_FAILED'],
    [1, { changeCount: true }, {}, 'SOURCE_COUNT_CHANGED'],
    [2, { bufferText: true }, {}, 'UNDECODED_TEXT_BUFFER'],
    [3, {}, { maxSqlBytes: 20 }, 'PARSER_SIZE_LIMIT'],
    [4, { conversionWarning: true }, {}, 'SOURCE_WARNING'],
  ]) {
    const f = fixture(options);
    const outputFile = path.join(path.dirname(directoryFile), `failure-${index}.sql.gz`);
    await assert.rejects(exportSourceSnapshot({ connection: f.connection, schema: 'synthetic', outputFile, ...extra }), error => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /NEVER-EXPOSE|row-text/);
      return true;
    });
    assert.ok(f.rolledBack() >= 1);
    assert.deepEqual(await readdir(path.dirname(directoryFile)), []);
  }
});

test('legacy isolation variable fallback works and progress exceptions do not invalidate published archive', async t => {
  const f = fixture({ isolationFallback: true });
  const outputFile = await destination(t);
  const report = await exportSourceSnapshot({ connection: f.connection, schema: 'synthetic', outputFile, onProgress: () => { throw new Error('Advisory callback failed'); } });
  assert.equal(report.isolationVariable, 'tx_isolation');
  assert.equal(report.sourceWarningChecks, 'after-each-read');
  assert.equal(report.physicalTextBytesCaptured, false);
  assert.match(report.limitations.join(' '), /misdeclared but valid legacy encodings require a separate binary audit/);
  assert.equal((await readSnapshotManifest(report.manifestFile)).sourceSha256, report.sourceSha256);
  assert.equal((await readDump(outputFile)).sourceSha256, report.sourceSha256);
});
