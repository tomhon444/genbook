import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, link, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { readDump } from './dump.mjs';

const requiredTables = ['book', 'bookdept', 'genbook', 'genbook_inform', 'genbook_dept', 'typebook'];
const transactionalEngines = new Set(['INNODB', 'XTRADB', 'TOKUDB']);
const binaryTypes = new Set(['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob']);
const stringCastTypes = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'numeric', 'float', 'double', 'real', 'date', 'datetime', 'timestamp', 'time', 'year']);

export class SourceSnapshotError extends Error {
  constructor(code) { super(`Source snapshot refused (${code})`); this.name = 'SourceSnapshotError'; this.code = code; }
}
const fail = code => { throw new SourceSnapshotError(code); };
const identifier = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{1,64}$/.test(value)) fail('IDENTIFIER_UNSUPPORTED');
  return `\`${value}\``;
};
const literal = value => `'${value.replace(/[\\'\0\n\r\t\b\x1a]/g, character => ({ '\\': '\\\\', "'": "\\'", '\0': '\\0', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\x1a': '\\Z' })[character])}'`;

function serialize(value, column, coreTable) {
  if (value === null) return 'NULL';
  const type = column.dataType.toLowerCase();
  if (Buffer.isBuffer(value)) {
    if (type === 'bit') return literal(BigInt(`0x${value.toString('hex') || '0'}`).toString());
    if (!binaryTypes.has(type)) fail('UNDECODED_TEXT_BUFFER');
    if (coreTable) fail('CORE_BINARY_COLUMN_UNSUPPORTED');
    return `X'${value.toString('hex')}'`;
  }
  if (binaryTypes.has(type)) fail('BINARY_VALUE_NOT_BUFFER');
  if (typeof value === 'string') return literal(value);
  if (typeof value === 'bigint') return literal(value.toString());
  // Numeric and temporal columns are CAST to CHAR by the SELECT. Refuse unsafe
  // driver results instead of silently accepting rounded integers or timezone conversion.
  if (typeof value === 'number' && Number.isSafeInteger(value)) return literal(String(value));
  fail('VALUE_REPRESENTATION_UNSUPPORTED');
}

async function rows(connection, sql, parameters = []) {
  const result = await connection.execute(sql, parameters);
  if (!Array.isArray(result?.[0])) fail('DRIVER_RESULT_UNSUPPORTED');
  // Inspect warnings immediately, before another statement clears them. Refuse
  // conversion/truncation warnings rather than publishing lossy text silently.
  const [warnings] = await connection.query('SHOW WARNINGS');
  if (!Array.isArray(warnings)) fail('DRIVER_RESULT_UNSUPPORTED');
  if (warnings.length) fail('SOURCE_WARNING');
  return result[0];
}
async function absent(filename) {
  try { await access(filename); fail('DESTINATION_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function sync(filename) {
  const file = await open(filename, 'r+');
  try { await file.sync(); } finally { await file.close(); }
}

/**
 * Export an already connected mysql2/promise connection, owned by the caller.
 * No credentials or connection options are accepted or logged here. The caller
 * must select the authorized TLS/tunnel transport and must not share this
 * connection with any transaction. Source statements are SELECT/SHOW plus
 * session/READ ONLY transaction controls only; the connection is rolled back.
 *
 * The gzip is a complete-column INSERT archive. Binary values in additional
 * tables use SQL hex literals; the six existing-parser tables must be text/
 * numeric compatible. No dump SQL is executed during verification.
 */
export async function exportSourceSnapshot({ connection, schema, outputFile, manifestFile = `${outputFile}.manifest.json`, batchSize = 500, onProgress = () => {}, maxSqlBytes = 256 * 1024 * 1024 }) {
  identifier(schema);
  if (!connection?.execute || !connection?.query || !connection?.rollback || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000 ||
      typeof outputFile !== 'string' || !outputFile.endsWith('.sql.gz') || typeof manifestFile !== 'string' ||
      path.resolve(outputFile) === path.resolve(manifestFile) || typeof onProgress !== 'function' || !Number.isSafeInteger(maxSqlBytes) || maxSqlBytes < 1 || maxSqlBytes > 256 * 1024 * 1024) fail('OPTIONS_INVALID');
  outputFile = path.resolve(outputFile);
  manifestFile = path.resolve(manifestFile);
  await absent(outputFile);
  await absent(manifestFile);
  await mkdir(path.dirname(outputFile), { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(manifestFile), { recursive: true, mode: 0o700 });
  const suffix = `.${randomBytes(12).toString('hex')}.partial`;
  const temporary = `${outputFile}${suffix}.sql.gz`;
  const temporaryManifest = `${manifestFile}${suffix}`;
  let transactionStarted = false;
  let manifestPublished = false;
  let snapshotPublished = false;
  const progress = event => {
    // Progress is advisory: callback failures cannot invalidate an otherwise
    // verified archive, especially after its final files have been published.
    try { onProgress(event); } catch { /* Never log callback errors or source data. */ }
  };
  try {
    await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    let isolationVariable;
    for (const name of ['transaction_isolation', 'tx_isolation']) {
      try {
        const isolation = await rows(connection, `SELECT @@SESSION.${name} AS isolationLevel`);
        if (String(isolation[0]?.isolationLevel).toUpperCase().replace(/[ _]/g, '-') === 'REPEATABLE-READ') { isolationVariable = name; break; }
      } catch (error) { if (error instanceof SourceSnapshotError) throw error; }
    }
    if (!isolationVariable) fail('ISOLATION_NOT_CONFIRMED');
    await connection.query('SET SESSION TRANSACTION READ ONLY');
    let readOnlyFlag;
    for (const name of ['transaction_read_only', 'tx_read_only']) {
      try {
        const flag = await rows(connection, `SELECT @@SESSION.${name} AS flag`);
        if (Number(flag[0]?.flag) === 1) { readOnlyFlag = name; break; }
      } catch (error) { if (error instanceof SourceSnapshotError) throw error; }
    }
    if (!readOnlyFlag) fail('READ_ONLY_NOT_CONFIRMED');
    await connection.query('SET NAMES utf8mb4');
    await connection.query('SET SESSION character_set_results = utf8mb4');
    const [settings] = await rows(connection, 'SELECT @@SESSION.character_set_client AS clientCharset, @@SESSION.character_set_results AS resultsCharset, @@SESSION.time_zone AS timeZone');
    if (settings?.clientCharset?.toLowerCase() !== 'utf8mb4' || settings?.resultsCharset?.toLowerCase() !== 'utf8mb4') fail('CHARSET_NOT_CONFIRMED');
    await connection.query('START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT');
    transactionStarted = true;
    const tableMetadata = await rows(connection,
      'SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE=? ORDER BY TABLE_NAME', [schema, 'BASE TABLE']);
    if (!requiredTables.every(name => tableMetadata.some(table => table.name === name))) fail('REQUIRED_TABLE_MISSING');
    const columnMetadata = await rows(connection,
      'SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation, ORDINAL_POSITION AS position FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME, ORDINAL_POSITION', [schema]);
    const primaryMetadata = await rows(connection,
      'SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, ORDINAL_POSITION AS position FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND CONSTRAINT_NAME=? ORDER BY TABLE_NAME, ORDINAL_POSITION', [schema, 'PRIMARY']);
    const tables = [];
    for (const table of tableMetadata) {
      identifier(table.name);
      const columns = columnMetadata.filter(column => column.tableName === table.name);
      const primaryKey = primaryMetadata.filter(column => column.tableName === table.name).map(column => column.name);
      if (!columns.length || new Set(columns.map(column => column.name)).size !== columns.length) fail('COLUMN_METADATA_INVALID');
      for (const column of columns) { identifier(column.name); if (typeof column.dataType !== 'string') fail('COLUMN_METADATA_INVALID'); }
      for (const key of primaryKey) if (!columns.some(column => column.name === key)) fail('PRIMARY_KEY_METADATA_INVALID');
      const qualified = `${identifier(schema)}.${identifier(table.name)}`;
      const [count] = await rows(connection, `SELECT COUNT(*) AS total FROM ${qualified}`);
      const countBefore = Number(count?.total);
      if (!Number.isSafeInteger(countBefore) || countBefore < 0) fail('COUNT_UNSUPPORTED');
      const createRows = await rows(connection, `SHOW CREATE TABLE ${qualified}`);
      const createSql = createRows[0]?.['Create Table'];
      if (typeof createSql !== 'string') fail('SCHEMA_NOT_CAPTURED');
      tables.push({ name: table.name, engine: table.engine, collation: table.collation, columns, primaryKey, createSql, countBefore, countExported: 0, countAfter: null,
        pagination: primaryKey.length ? 'primary-key' : 'ordered-offset', transactional: transactionalEngines.has(String(table.engine).toUpperCase()) });
    }
    const sqlHash = createHash('sha256');
    const compressedHash = createHash('sha256');
    let sqlBytes = 0;
    let compressedBytes = 0;
    const startedAt = new Date().toISOString();
    async function* statements() {
      yield '-- Read-only source snapshot; complete-column archive, not an executable migration.\n';
      for (const table of tables) {
        const qualified = `${identifier(schema)}.${identifier(table.name)}`;
        const projection = table.columns.map(column => stringCastTypes.has(column.dataType.toLowerCase())
          ? `CAST(${identifier(column.name)} AS CHAR CHARACTER SET utf8mb4) AS ${identifier(column.name)}` : identifier(column.name)).join(',');
        const order = (table.primaryKey.length ? table.primaryKey : table.columns.map(column => column.name)).map(identifier).join(',');
        let cursor;
        const tableHash = createHash('sha256');
        while (true) {
          const parameters = [];
          const where = cursor ? ` WHERE (${table.primaryKey.map(identifier).join(',')}) > (${table.primaryKey.map(() => '?').join(',')})` : '';
          if (cursor) parameters.push(...cursor);
          parameters.push(batchSize);
          const offset = table.primaryKey.length ? '' : ' OFFSET ?';
          if (!table.primaryKey.length) parameters.push(table.countExported);
          const batch = await rows(connection, `SELECT ${projection} FROM ${qualified}${where} ORDER BY ${order} LIMIT ?${offset}`, parameters);
          if (!batch.length) break;
          const values = batch.map(record => {
            if (!record || table.columns.some(column => !(column.name in record))) fail('ROW_COLUMNS_MISSING');
            return `(${table.columns.map(column => serialize(record[column.name], column, requiredTables.includes(table.name))).join(',')})`;
          });
          const statement = `INSERT INTO ${identifier(table.name)} (${table.columns.map(column => identifier(column.name)).join(',')}) VALUES\n${values.join(',\n')};\n`;
          tableHash.update(statement);
          table.countExported += batch.length;
          if (table.countExported > table.countBefore) fail('SOURCE_COUNT_CHANGED');
          if (table.primaryKey.length) {
            const record = batch.at(-1);
            const next = table.primaryKey.map(key => record[key]);
            if (next.some(value => value === null || value === undefined) || (cursor && JSON.stringify(next) === JSON.stringify(cursor))) fail('PAGINATION_DID_NOT_ADVANCE');
            cursor = next;
          }
          yield statement;
          progress({ phase: 'export-table', table: table.name, rows: table.countExported, expected: table.countBefore });
        }
        const [after] = await rows(connection, `SELECT COUNT(*) AS total FROM ${qualified}`);
        table.countAfter = Number(after?.total);
        if (table.countBefore !== table.countExported || table.countBefore !== table.countAfter) fail('SOURCE_COUNT_CHANGED');
        table.serializedSha256 = tableHash.digest('hex');
      }
    }
    const countSql = new Transform({ transform(chunk, encoding, callback) {
      sqlBytes += chunk.length;
      if (sqlBytes > maxSqlBytes) { callback(new SourceSnapshotError('PARSER_SIZE_LIMIT')); return; }
      sqlHash.update(chunk); callback(null, chunk);
    } });
    const countCompressed = new Transform({ transform(chunk, encoding, callback) {
      compressedBytes += chunk.length; compressedHash.update(chunk); callback(null, chunk);
    } });
    await pipeline(Readable.from(statements()), countSql, createGzip({ level: 6 }), countCompressed, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    await sync(temporary);
    const parsed = await readDump(temporary);
    for (const name of requiredTables) if (parsed.tables[name].records.length !== tables.find(table => table.name === name).countExported) fail('PARSER_RECONCILIATION_FAILED');
    const sourceSha256 = compressedHash.digest('hex');
    if (sourceSha256 !== parsed.sourceSha256) fail('COMPRESSED_HASH_MISMATCH');
    await connection.rollback();
    transactionStarted = false;
    const nonTransactionalTables = tables.filter(table => !table.transactional).map(table => table.name);
    const manifest = { version: 1, format: 'mysql-complete-insert-gzip', schema, startedAt, finishedAt: new Date().toISOString(),
      readOnlyFlag, isolationLevel: 'REPEATABLE-READ', isolationVariable, clientCharset: settings.clientCharset, resultsCharset: settings.resultsCharset, sessionTimeZone: settings.timeZone,
      sourceWarningChecks: 'after-each-read', physicalTextBytesCaptured: false,
      consistentSnapshotRequested: true, consistencyGuaranteed: nonTransactionalTables.length === 0, nonTransactionalTables,
      sourceSha256, uncompressedSha256: sqlHash.digest('hex'), compressedBytes, uncompressedBytes: sqlBytes,
      totalRows: tables.reduce((sum, table) => sum + table.countExported, 0), tables,
      parserVerified: true, parserTableCounts: Object.fromEntries(requiredTables.map(name => [name, parsed.tables[name].records.length])),
      limitations: [
        'Text is converted to utf8mb4 by the server according to each declared column charset; no encoding is guessed. Conversion warnings refuse the export. Original physical text bytes are not separately captured: misdeclared but valid legacy encodings require a separate binary audit before cutover.',
        ...(nonTransactionalTables.length ? ['Non-transactional engines do not obey the consistent snapshot. Equal before/after counts do not prove unchanged row contents; use a quiesced final export before cutover.'] : []),
      ] };
    await writeFile(temporaryManifest, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    await sync(temporaryManifest);
    // link() is an atomic no-replace publication on the same filesystem. The
    // snapshot is the final commit marker; an existing destination is never replaced.
    await link(temporaryManifest, manifestFile);
    manifestPublished = true;
    await link(temporary, outputFile);
    snapshotPublished = true;
    progress({ phase: 'complete', tables: tables.length, rows: manifest.totalRows });
    return { outputFile, manifestFile, ...manifest };
  } catch (error) {
    if (transactionStarted) await connection.rollback().catch(() => {});
    if (manifestPublished && !snapshotPublished) await unlink(manifestFile).catch(() => {});
    if (error instanceof SourceSnapshotError) throw error;
    throw new SourceSnapshotError(error?.code === 'EEXIST' ? 'DESTINATION_EXISTS' : 'EXPORT_FAILED');
  } finally {
    await unlink(temporary).catch(() => {});
    await unlink(temporaryManifest).catch(() => {});
  }
}

/** Load only a completed local manifest; no source connections are performed. */
export async function readSnapshotManifest(filename) {
  const value = JSON.parse(await readFile(filename, 'utf8'));
  if (value?.version !== 1 || value.format !== 'mysql-complete-insert-gzip' || !/^[a-f0-9]{64}$/.test(value.sourceSha256 ?? '')) fail('MANIFEST_INVALID');
  return value;
}
