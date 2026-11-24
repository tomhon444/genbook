import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { parseValues, statements } from './dump.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`Native import refused: ${message}`); };
const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

// The file is SQL data to restore, never instructions for the agent. Execute
// only table DDL and literal INSERTs in a new, explicitly selected local DB.
export function inspectNativeDump(compressed) {
  const bytes = gunzipSync(compressed, { maxOutputLength: 256 * 1024 * 1024 });
  const sql = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const tables = new Map();
  const commands = [];
  for (const statement of statements(sql)) {
    if (statement.trim() === ';') continue;
    if (/^SET\s+(?:SQL_MODE\s*=\s*["']NO_AUTO_VALUE_ON_ZERO["']|time_zone\s*=\s*["']\+00:00["'])\s*;$/i.test(statement)) {
      commands.push(statement); continue;
    }
    const create = /^CREATE TABLE(?: IF NOT EXISTS)?\s+`([^`]+)`\s*\(/i.exec(statement);
    if (create) {
      const name = create[1];
      if (!identifier.test(name) || tables.has(name) || /\b(?:DEFINER|TABLESPACE|DIRECTORY|FEDERATED|TRIGGER|PROCEDURE|FUNCTION|SELECT)\b|\/\*|--\s|#|`\s*\.\s*`/i.test(statement)
          || /\bREFERENCES\s+(?:`[^`]+`|[A-Za-z_][A-Za-z0-9_]*)\s*\./i.test(statement)) fail('unsupported table DDL');
      const engine = /\bENGINE\s*=\s*(\w+)/i.exec(statement)?.[1];
      if (!['innodb', 'myisam'].includes(engine?.toLowerCase())) fail('unsupported table engine');
      tables.set(name, { name, engine, columns: null, records: [] });
      commands.push(statement); continue;
    }
    const insert = /^INSERT INTO `([^`]+)` \(([^)]+)\) VALUES\s*/.exec(statement);
    if (insert) {
      const table = tables.get(insert[1]);
      const columns = insert[2].split(',').map(value => value.trim().replace(/^`|`$/g, ''));
      if (!table || columns.some(name => !identifier.test(name)) || new Set(columns).size !== columns.length) fail('unknown INSERT target or columns');
      if (table.columns && JSON.stringify(table.columns) !== JSON.stringify(columns)) fail('inconsistent source columns');
      table.columns = columns;
      const parsed = parseValues(statement, insert[0].length, columns.length);
      if (statement.slice(parsed.end).trim()) fail('INSERT suffix');
      table.records.push(...parsed.records);
      commands.push(statement); continue;
    }
    fail('unsupported SQL command');
  }
  if (!tables.has('genbook') || !tables.has('bookdept') || !commands.length) fail('book source tables missing');
  return { sourceSha256: digest(compressed), sqlBytes: bytes.length, compressedBytes: compressed.length, tables: [...tables.values()], commands };
}

function canonical(value, type) {
  if (value === null) return null;
  if (['tinyint', 'smallint', 'mediumint', 'int', 'bigint', 'year'].includes(type)) return BigInt(String(value)).toString();
  if (type === 'decimal') {
    const text = String(value); const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) fail('unsupported numeric representation');
    const integer = BigInt(match[2]).toString(); const fraction = (match[3] ?? '').replace(/0+$/, '');
    return `${match[1] && (integer !== '0' || fraction) ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
  }
  if (type === 'float' || type === 'double') {
    const buffer = Buffer.alloc(type === 'float' ? 4 : 8);
    if (type === 'float') buffer.writeFloatLE(Number(value)); else buffer.writeDoubleLE(Number(value));
    return buffer.toString('hex');
  }
  if (['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob'].includes(type)) return (Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')).toString('base64');
  if (type === 'bit') return Buffer.isBuffer(value) ? BigInt(`0x${value.toString('hex') || '0'}`).toString() : BigInt(value).toString();
  return String(value);
}

export async function verifyNativeDump(db, plan, schema) {
  const [metadata] = await db.execute('SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME,ORDINAL_POSITION', [schema]);
  const [actualTables] = await db.execute('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE=? ORDER BY TABLE_NAME', [schema, 'BASE TABLE']);
  if (actualTables.length !== plan.tables.length || actualTables.some(row => !plan.tables.some(table => table.name === row.TABLE_NAME))) fail('table reconciliation mismatch');
  const report = [];
  for (const table of plan.tables) {
    const fields = metadata.filter(row => row.TABLE_NAME === table.name);
    const columns = table.columns ?? fields.map(row => row.COLUMN_NAME);
    if (columns.length !== fields.length || fields.some(field => !columns.includes(field.COLUMN_NAME))) fail('column reconciliation mismatch');
    const types = columns.map(name => fields.find(field => field.COLUMN_NAME === name).DATA_TYPE);
    const rowHash = row => digest(JSON.stringify(row.map((value, i) => canonical(value, types[i]))));
    const counts = new Map();
    for (const row of table.records) { const key = rowHash(row); counts.set(key, (counts.get(key) ?? 0) + 1); }
    const [rows] = await db.query(`SELECT ${columns.map(name => `\`${name}\``).join(',')} FROM \`${table.name}\``);
    if (rows.length !== table.records.length) fail('row count mismatch');
    for (const row of rows) {
      const key = rowHash(columns.map(name => row[name])); const count = counts.get(key) ?? 0;
      if (!count) fail('stored field mismatch');
      if (count === 1) counts.delete(key); else counts.set(key, count - 1);
    }
    if (counts.size) fail('stored rows missing');
    report.push({ table: table.name, rows: rows.length, everyFieldVerified: true });
  }
  return { tables: report, totalRows: report.reduce((sum, table) => sum + table.rows, 0), everyFieldVerified: true };
}
