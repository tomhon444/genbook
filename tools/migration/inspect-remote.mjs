import { mkdir, writeFile } from 'node:fs/promises';
import { withReadOnlySource } from './remote-source.mjs';

// Credentials are supplied only through the process environment. Do not log
// connection errors verbatim: drivers can include SQL or connection details.
const sources = [
  { name: 'central', host: 'phoenix.eng.psu.ac.th', database: 'CENTRAL', user: 'usrCentral', password: process.env.CENTRAL_DB_PASSWORD },
  { name: 'genbook', host: 'infor.eng.psu.ac.th', database: 'GenBookno_DB', user: 'userGen', password: process.env.LEGACY_DB_PASSWORD },
];
await mkdir('.local/remote-discovery', { recursive: true });
for (const source of sources) {
  try {
    if (!source.password) throw Object.assign(new Error(), { code: 'MISSING_CREDENTIAL' });
    // This option requires separate operator authorization for transport risk.
    // There is deliberately no automatic TLS downgrade or retry.
    const allowPrivatePlaintext = process.argv.includes('--private-network-no-tls');
    const { tables, columns, transport } = await withReadOnlySource({ ...source, allowPrivatePlaintext }, async connection => {
      const [tables] = await connection.execute('SELECT TABLE_NAME, ENGINE, TABLE_ROWS, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME', [source.database]);
      const [columns] = await connection.execute('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME, ORDINAL_POSITION', [source.database]);
      const [transport] = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
      return { tables, columns, transport };
    });
    const { name } = source;
    await writeFile(`.local/remote-discovery/${name}-schema.json`, JSON.stringify({ collectedAt: new Date().toISOString(), tables, columns, transport }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ source: name, status: 'ok', tables: tables.length, columns: columns.length }));
  } catch (error) {
    console.log(JSON.stringify({ source: source.name, status: 'failed', code: error.code ?? 'CONNECTION_FAILED' }));
    process.exitCode = 1;
  }
}
