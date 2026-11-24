import mysql from 'mysql2/promise';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const sources = Object.freeze({
  central: { host: 'phoenix.eng.psu.ac.th', database: 'CENTRAL', user: 'usrCentral' },
  genbook: { host: 'infor.eng.psu.ac.th', database: 'GenBookno_DB', user: 'userGen' },
});
const functions = new Set(['COUNT', 'SUM', 'MIN', 'MAX', 'AVG', 'COALESCE', 'IFNULL', 'NULLIF', 'IF',
  'CONCAT', 'CONCAT_WS', 'LENGTH', 'CHAR_LENGTH', 'TRIM', 'LTRIM', 'RTRIM', 'LOWER', 'UPPER',
  'HEX', 'UNHEX', 'SHA2', 'CAST', 'CONVERT', 'DATE', 'YEAR', 'MONTH', 'DAY', 'DATE_FORMAT',
  'DATABASE', 'VERSION', 'IN', 'EXISTS', 'NOT', 'AND', 'OR', 'AS', 'FROM', 'WHERE', 'SELECT', 'DISTINCT']);

export class ReadOnlySourceError extends Error {
  constructor(code) { super(`Remote source operation refused (${code})`); this.name = 'ReadOnlySourceError'; this.code = code; }
}
const failure = code => new ReadOnlySourceError(code);
const connectionCodes = new Set(['HANDSHAKE_NO_SSL_SUPPORT', 'ECONNREFUSED', 'ETIMEDOUT', 'ER_ACCESS_DENIED_ERROR']);
const privateAddress = address => {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

// This is deliberately a restricted SQL subset, not a general SQL parser. It
// rejects comments, extra statements, variables, writes and unapproved function
// calls before any driver operation. Values belong in bound parameters.
function validateRead(sql) {
  if (typeof sql !== 'string' || !sql.trim() || sql.length > 100_000) throw failure('QUERY_REJECTED');
  let visible = '';
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      let closed = false;
      for (i++; i < sql.length; i++) {
        // Backslash handling changes with NO_BACKSLASH_ESCAPES. Refuse it in
        // SQL literals/identifiers; callers bind such values as parameters.
        if (sql[i] === '\\') throw failure('QUERY_REJECTED');
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i++; continue; }
          closed = true;
          break;
        }
      }
      if (!closed) throw failure('QUERY_REJECTED');
      // Quoted identifiers cannot be used to hide function names.
      if (/^\s*\(/.test(sql.slice(i + 1))) throw failure('QUERY_REJECTED');
      visible += ' quoted ';
    } else {
      if (char === ';' || char === '#' || (char === '-' && sql[i + 1] === '-')
        || (char === '/' && sql[i + 1] === '*') || (char === ':' && sql[i + 1] === '=')
        || (char === '@' && sql[i - 1] !== '@' && sql[i + 1] !== '@')) throw failure('QUERY_REJECTED');
      visible += char;
    }
  }
  const normalized = visible.trim().toUpperCase();
  if (!/^(SELECT|SHOW)\b/.test(normalized)) throw failure('QUERY_REJECTED');
  if (normalized.startsWith('SHOW')) {
    if (!/^SHOW\s+(?:(?:FULL\s+)?(?:TABLES|COLUMNS|FIELDS)|INDEX|INDEXES|KEYS|TABLE\s+STATUS|CREATE\s+TABLE|(?:SESSION\s+)?(?:STATUS|VARIABLES))\b/.test(normalized)) throw failure('QUERY_REJECTED');
  } else if (/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|CALL|DO|SET|INTO|OUTFILE|DUMPFILE|LOCK|UNLOCK|HANDLER|GRANT|REVOKE|PREPARE|EXECUTE|DEALLOCATE|COMMIT|ROLLBACK|START|XA)\b/.test(normalized)) {
    throw failure('QUERY_REJECTED');
  }
  for (const match of normalized.matchAll(/\b([A-Z_][A-Z0-9_]*)\s*\(/g)) {
    // A schema-qualified name could resolve to a stored routine rather than
    // the approved built-in even when its final component has the same name.
    if (!functions.has(match[1]) || normalized.slice(0, match.index).trimEnd().endsWith('.')) throw failure('QUERY_REJECTED');
  }
}

// The optional dependency argument permits unit tests without making a network
// connection. Application callers use the default mysql2/DNS implementations.
export async function openReadOnlySource(config, dependencies = {}) {
  const { name, host, database, user, password, allowPrivatePlaintext = false, charset = 'UTF8MB4_UNICODE_CI' } = config ?? {};
  const approved = sources[name];
  if (!approved || approved.host !== host || approved.database !== database || approved.user !== user
    || typeof password !== 'string' || !password || typeof allowPrivatePlaintext !== 'boolean'
    || !['UTF8MB4_UNICODE_CI', 'UTF8_UNICODE_CI', 'UTF8_GENERAL_CI', 'LATIN1_SWEDISH_CI', 'TIS620_THAI_CI'].includes(charset)) {
    throw failure('CONFIGURATION_INVALID');
  }
  let connection;
  try {
    let connectionHost = host;
    if (allowPrivatePlaintext) {
      const addresses = await (dependencies.lookup ?? lookup)(host, { all: true });
      if (!addresses.length || addresses.some(({ address }) => !privateAddress(address))) throw failure('PRIVATE_NETWORK_REQUIRED');
      // Pin the validated address so a second DNS lookup cannot change it.
      connectionHost = addresses[0].address;
    }
    connection = await (dependencies.createConnection ?? mysql.createConnection)({
      host: connectionHost, database, user, password, port: 3306, connectTimeout: 10_000,
      ...(allowPrivatePlaintext ? {} : { ssl: { rejectUnauthorized: true, verifyIdentity: true } }),
      multipleStatements: false, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
      charset, timezone: 'Z', enableKeepAlive: false,
    });
    await connection.query('START TRANSACTION READ ONLY');
  } catch (error) {
    await connection?.end().catch(() => {});
    throw error instanceof ReadOnlySourceError ? error : failure(connectionCodes.has(error?.code) ? error.code : 'CONNECTION_FAILED');
  }
  let closed = false;
  const read = async (method, sql, values = []) => {
    if (closed) throw failure('SOURCE_CLOSED');
    validateRead(sql);
    if (!Array.isArray(values) || values.some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value))) throw failure('QUERY_REJECTED');
    // mysql2 query() interpolates values using text escaping, whose meaning can
    // change with a legacy server's sql_mode. Bound values use execute() only.
    if (method === 'query' && values.length) throw failure('QUERY_REJECTED');
    try { return await connection[method](sql, values); }
    catch { throw failure('READ_FAILED'); }
  };
  return Object.freeze({
    query: (sql, values) => read('query', sql, values),
    execute: (sql, values) => read('execute', sql, values),
    close: async () => {
      if (closed) return;
      closed = true;
      try { await connection.rollback(); }
      catch { /* Closing never commits, including when rollback fails. */ }
      finally { await connection.end().catch(() => {}); }
    },
  });
}

export async function withReadOnlySource(config, callback, dependencies) {
  const source = await openReadOnlySource(config, dependencies);
  try { return await callback(source); }
  catch (error) { throw error instanceof ReadOnlySourceError ? error : failure('CALLBACK_FAILED'); }
  finally { await source.close(); }
}
