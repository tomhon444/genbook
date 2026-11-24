import { readFile, writeFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { loadDemoReferences, applyDemoReferences } from './reference-data.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Local preview refuses production');
const settings = JSON.parse(await readFile('.local/preview-database.json', 'utf8'));
const url = new URL(settings.url);
if (settings.synthetic !== true || url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' || url.port !== '3315'
    || url.pathname !== '/t05_synthetic' || url.username !== 't05_app' || url.search || url.hash) throw new Error('The active isolated demo settings are required');
const catalog = await loadDemoReferences(process.argv[2] ?? '.local/t12-persistent/legacy-78629b14/source.sql.gz');
const db = await mysql.createConnection(settings.url);
try {
  const summary = await applyDemoReferences(db, catalog);
  await writeFile('.local/legacy-reference-preview.json', JSON.stringify({ ...catalog, applied: summary }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(summary));
} finally { await db.end(); }
