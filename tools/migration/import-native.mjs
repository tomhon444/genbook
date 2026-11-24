import mysql from 'mysql2/promise';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, inspectNativeDump, verifyNativeDump } from './native-dump.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = 'Genbookno_db';
const readConfig = async () => {
  const metadata = JSON.parse(await readFile(path.join(project, '.local/t12-persistent/genbook-db/connection.json'), 'utf8'));
  const runtime = path.join(project, '.local/t12-persistent/genbook-db');
  if (!metadata.ready || metadata.port !== 3306 || metadata.name !== 'genbook-db' || path.resolve(metadata.runtime).toLowerCase() !== runtime.toLowerCase() || !/^[a-f0-9-]{36}$/.test(metadata.instanceId ?? '')) throw new Error('Managed MySQL 8 instance receipt mismatch');
  return { instanceId: metadata.instanceId, dataDirectory: path.join(runtime, 'data'), connection: { host: '127.0.0.1', port: 3306, user: 'root', password: metadata.rootPassword, multipleStatements: false, dateStrings: true, timezone: 'Z',
    charset: 'UTF8MB4_UNICODE_CI', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false,
    typeCast: (field, next) => ['TINY', 'SHORT', 'LONG', 'LONGLONG', 'INT24', 'DECIMAL', 'NEWDECIMAL', 'FLOAT', 'DOUBLE', 'YEAR'].includes(field.type) ? field.string() : next() } };
};

export async function assertNativeInstance(db, expected) {
  const [[identity]] = await db.query('SELECT @@port port,VERSION() version,@@datadir data_directory');
  if (Number(identity.port) !== 3306 || !identity.version.startsWith('8.0.') || path.resolve(identity.data_directory).toLowerCase() !== path.resolve(expected.dataDirectory).toLowerCase()) throw new Error('Unexpected native import destination');
  const [[marker]] = await db.query('SELECT instance_uuid FROM t05_synthetic.migration_instance WHERE id=1');
  if (marker?.instance_uuid !== expected.instanceId) throw new Error('Native import instance identity mismatch');
}

export async function importNative(file) {
  if (process.env.NODE_ENV === 'production' || !file) throw new Error('Local native import only; source file required');
  const compressed = await readFile(file);
  const plan = inspectNativeDump(compressed);
  const directory = path.join(project, '.local/legacy-import', `native-${plan.sourceSha256.slice(0, 12)}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const sourceFile = path.join(directory, 'source.sql.gz');
  try { await writeFile(sourceFile, compressed, { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (digest(await readFile(sourceFile)) !== plan.sourceSha256) throw new Error('Retained native source hash mismatch');
  const expected = await readConfig();
  const config = expected.connection;
  let db = await mysql.createConnection(config);
  const receiptFile = path.join(directory, 'import.json');
  let report;
  try {
    await assertNativeInstance(db, expected);
    const [existing] = await db.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE LOWER(SCHEMA_NAME)=?', [target.toLowerCase()]);
    if (existing.length) {
      const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
      if (!receipt.complete || receipt.sourceSha256 !== plan.sourceSha256 || receipt.database.toLowerCase() !== target.toLowerCase()) throw new Error('Existing database retained; unverified overwrite refused');
      await db.end(); db = await mysql.createConnection({ ...config, database: target });
      await assertNativeInstance(db, expected);
      const actual = await verifyNativeDump(db, plan, target.toLowerCase());
      console.log(JSON.stringify({ database: target, port: 3306, replayVerified: true, ...actual }));
      return actual;
    }
    report = { version: 1, database: target, host: '127.0.0.1', port: 3306, sourceSha256: plan.sourceSha256, complete: false, createdAt: new Date().toISOString() };
    const receipt = await open(receiptFile, 'wx', 0o600);
    try { await receipt.writeFile(JSON.stringify(report, null, 2)); await receipt.sync(); } finally { await receipt.close(); }
    await db.query(`CREATE DATABASE \`${target}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await db.end(); db = await mysql.createConnection({ ...config, database: target });
    await assertNativeInstance(db, expected);
    await db.query("SET SESSION sql_mode='NO_AUTO_VALUE_ON_ZERO'");
    let lastProgress = 0;
    for (let i = 0; i < plan.commands.length; i++) {
      await db.query(plan.commands[i]);
      if (Date.now() - lastProgress >= 5000) { console.log(JSON.stringify({ phase: 'native-import', statements: i + 1, totalStatements: plan.commands.length })); lastProgress = Date.now(); }
    }
    const verified = await verifyNativeDump(db, plan, target.toLowerCase());
    report = { ...report, ...verified, complete: true, finishedAt: new Date().toISOString() };
    const temporary = `${receiptFile}.complete.tmp`;
    await writeFile(temporary, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    await rename(temporary, receiptFile);
    console.log(JSON.stringify(report));
    return report;
  } finally { await db.end().catch(() => {}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  importNative(process.argv[2]).catch(error => {
    console.error(`Native import did not complete (${error.code ?? 'IMPORT_OR_VERIFICATION_FAILED'}). Source and any created database were retained; no existing database was overwritten.`);
    process.exitCode = 1;
  });
}
