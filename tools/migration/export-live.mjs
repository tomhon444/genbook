import mysql from 'mysql2/promise';
import { loadEnvFile } from 'node:process';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { mkdir, statfs } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportSourceSnapshot } from './source-snapshot.mjs';

// No password arguments and no automatic TLS downgrade. VPN is an explicit
// operator assertion; SSH mode connects only to an established loopback forward.
export function transportOptions({ vpn = false, tunnel, port, privatePlaintext = false }) {
  if ([vpn, Boolean(tunnel), privatePlaintext].filter(Boolean).length > 1) throw new Error('Choose one source route');
  if (tunnel) {
    if (!['127.0.0.1', '::1'].includes(tunnel) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a loopback SSH forward with a valid port');
    return { host: tunnel, port };
  }
  return { host: 'infor.eng.psu.ac.th', port: 3306, ...(vpn || privatePlaintext ? {} : { ssl: { rejectUnauthorized: true, verifyIdentity: true } }) };
}

export async function exportLive(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--vpn' || key === '--inspect' || key === '--private-network-no-tls') options[key.slice(2)] = true;
    else if (['--env-file', '--output', '--schema', '--tunnel', '--port'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) options[key.slice(2)] = args[++i];
    else throw new Error('Invalid export arguments');
  }
  if (!options['env-file'] || (!options.inspect && !options.output)) throw new Error('Require --env-file and --output (or --inspect)');
  loadEnvFile(options['env-file']);
  if (process.env.LEGACY_DB_HOST !== 'infor.eng.psu.ac.th' || process.env.LEGACY_DB_USER !== 'userGen' || !process.env.LEGACY_DB_PASSWORD) throw new Error('Unexpected legacy source configuration');
  const schema = options.schema ?? process.env.LEGACY_DB_NAME;
  if (!['Genbook_DB', 'GenBookno_DB'].includes(schema)) throw new Error('Select the explicitly identified Genbook schema');
  const transport = transportOptions({ vpn: options.vpn, tunnel: options.tunnel, port: options.port === undefined ? undefined : Number(options.port), privatePlaintext: options['private-network-no-tls'] });
  if (options['private-network-no-tls']) {
    const addresses = await lookup(transport.host, { all: true });
    const privateAddress = address => {
      if (isIP(address) !== 4) return false;
      const [a, b] = address.split('.').map(Number);
      return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    };
    if (!addresses.length || addresses.some(({ address }) => !privateAddress(address))) throw new Error('Explicit plaintext mode requires a private network destination');
    transport.host = addresses[0].address;
  }
  let connection;
  try {
    connection = await mysql.createConnection({ ...transport, user: process.env.LEGACY_DB_USER, password: process.env.LEGACY_DB_PASSWORD,
      connectTimeout: 15_000, multipleStatements: false, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
      decimalNumbers: false, charset: 'UTF8MB4_UNICODE_CI', timezone: 'Z' });
    await connection.query('SET SESSION TRANSACTION READ ONLY');
    await connection.query('START TRANSACTION READ ONLY');
    const [available] = await connection.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?,?)', ['Genbook_DB', 'GenBookno_DB']);
    const names = available.map(row => row.SCHEMA_NAME);
    await connection.rollback();
    if (options.inspect) {
      console.log(JSON.stringify({ phase: 'source-schemas', available: names, requestedSchemaFound: names.includes(schema), route: options.tunnel ? 'ssh-loopback' : options.vpn ? 'operator-confirmed-vpn' : options['private-network-no-tls'] ? 'user-authorized-private-network' : 'verified-tls' }));
      return;
    }
    if (!names.includes(schema)) throw new Error('Requested schema was not found; inspect and explicitly select the correct schema');
    await mkdir(path.dirname(path.resolve(options.output)), { recursive: true, mode: 0o700 });
    const free = await statfs(path.dirname(path.resolve(options.output)));
    if (free.bavail * free.bsize < 2 * 1024 ** 3) throw new Error('Insufficient free disk space');
    const result = await exportSourceSnapshot({ connection, schema, outputFile: path.resolve(options.output), onProgress: progress => console.log(JSON.stringify(progress)) });
    console.log(JSON.stringify({ phase: 'export-verified', sourceSha256: result.sourceSha256, tables: result.tables.length, rows: result.totalRows, parserVerified: result.parserVerified, consistencyGuaranteed: result.consistencyGuaranteed }));
    return result;
  } finally { await connection?.end().catch(() => {}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  exportLive().catch(error => {
    const code = typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'EXPORT_FAILED';
    console.error(`Legacy export did not complete (${code}). Check the source route, credentials, schema and local destination. No credentials or source rows were printed.`);
    process.exitCode = 1;
  });
}
