import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, open, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultBinary = 'C:/laragon/bin/mysql/mysql-8.0.30-winx64/bin/mysqld.exe';
const secret = () => randomBytes(24).toString('hex');
async function removeStoppedData(data) {
  const resolved = await realpath(data);
  const expected = path.resolve(root, '.local/t05-mysql');
  const relative = path.relative(expected, resolved);
  if (!/^[a-f0-9]{12}[\\/]data$/.test(relative)) throw new Error('Refusing database cleanup outside synthetic runtime');
  await rm(resolved, { recursive: true });
}

// Always creates a new, synthetic-only instance. Never connects to port 3306 or
// imports legacy data. Logs remain after shutdown; retainData opts into keeping
// synthetic data. By default data is removed only after the process has exited.
export async function startDatabase({ port = 3315, binary = process.env.T05_MYSQLD ?? defaultBinary, retainData = false } = {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('Synthetic database refuses production');
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3306) throw new Error('Invalid isolated MySQL port');
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  const runtime = path.join(root, '.local/t05-mysql', secret().slice(0, 12));
  await mkdir(runtime, { recursive: true });
  const data = path.join(runtime, 'data');
  const log = await open(path.join(runtime, 'server.log'), 'a');
  const common = ['--no-defaults', `--basedir=${path.resolve(binary, '../..')}`, `--datadir=${data}`,
    '--innodb-redo-log-capacity=8388608', '--innodb-buffer-pool-size=33554432',
    '--innodb-temp-data-file-path=ibtmp1:12M:autoextend:max:32M'];
  const initialize = spawn(binary, [...common, '--initialize-insecure', '--console'], { windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
  try {
    await new Promise((resolve, reject) => {
      initialize.once('error', reject);
      initialize.once('exit', code => code === 0 ? resolve() : reject(new Error(`MySQL initialize failed; see ${runtime}/server.log`)));
    });
  } catch (error) {
    await log.close();
    // Initialization process has exited or could not spawn. No server owns data.
    if (!retainData) await removeStoppedData(data).catch(() => {});
    throw error;
  }
  const child = spawn(binary, [...common, '--console', '--bind-address=127.0.0.1', `--port=${port}`,
    '--mysqlx=OFF', '--skip-log-bin', '--local-infile=OFF', '--secure-file-priv=NULL'],
  { windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
  let exited = false;
  child.once('error', () => { exited = true; });
  child.once('exit', () => { exited = true; });
  const mysql = await import('mysql2/promise');
  let admin;
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (exited) throw new Error(`MySQL exited; see ${runtime}/server.log`);
      try { admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: '', multipleStatements: true }); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 150)); }
    }
    if (!admin) throw new Error(`MySQL startup timed out; see ${runtime}/server.log`);
    const rootPassword = secret();
    const appPassword = secret();
    await admin.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?", [rootPassword]);
    await admin.query('CREATE DATABASE t05_synthetic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await admin.query('USE t05_synthetic');
    await admin.query(await readFile(path.join(root, 'tools/issuance/schema.sql'), 'utf8'));
    await admin.query(await readFile(path.join(root, 'tools/migration/schema.sql'), 'utf8'));
    await admin.query(`INSERT INTO issuance_departments(id,name,enabled) VALUES
      ('TEST-D1','หน่วยงานทดสอบหนึ่ง',TRUE),('TEST-D2','หน่วยงานทดสอบสอง',TRUE),
      ('LOCAL-DEPT-01','หน่วยงานตัวอย่าง',TRUE),('204','การเงินทดสอบ',TRUE)`);
    await admin.query("CREATE USER 't05_app'@'127.0.0.1' IDENTIFIED BY ?", [appPassword]);
    for (const table of ['issuance_departments','issuance_series','issuance_grants','issuance_owner_locks','issuance_counters','issuance_subcounters','issuance_documents','issuance_audit']) {
      await admin.query(`GRANT SELECT, INSERT, UPDATE ON t05_synthetic.${table} TO 't05_app'@'127.0.0.1'`);
    }
    // Raw snapshots and restricted dispositions are not readable by the app DB user.
    for (const table of ['legacy_documents','legacy_document_details','legacy_number_reservations','legacy_reservation_links','issuance_migration_gate']) {
      await admin.query(`GRANT SELECT ON t05_synthetic.${table} TO 't05_app'@'127.0.0.1'`);
    }
    await admin.query(`INSERT INTO issuance_series (id,name,document_type,prefix,year_basis,enabled) VALUES
      ('TEST-S1','ชุดเลขทดสอบร่วม','หนังสือทดสอบ','ทดสอบ 001','calendar',TRUE),
      ('TEST-S2','ชุดเลขทดสอบแยก','หนังสือทดสอบ','ทดสอบ 002','calendar',TRUE),
      ('00006','คำสั่งทดสอบ','คำสั่ง','คำสั่ง','document_date',TRUE),
      ('00047','ชุดที่พักเปิดใช้งาน','หนังสือทดสอบ','','calendar',FALSE)`);
    for (const owner of ['LOCAL-001', 'TEST-001', 'TEST-002']) {
      await admin.query('INSERT INTO issuance_grants(owner_id,series_id,active) SELECT ?,id,TRUE FROM issuance_series WHERE enabled=TRUE', [owner]);
    }
    const url = `mysql://t05_app:${appPassword}@127.0.0.1:${port}/t05_synthetic`;
    const settingsFile = path.join(root, '.local/t05-database.json');
    await writeFile(settingsFile, JSON.stringify({ url, runtime, synthetic: true }, null, 2), { mode: 0o600 });
    let closing;
    return { url, runtime, settingsFile, admin, close: () => closing ??= (async () => {
      try { await admin.query('SHUTDOWN'); } catch (error) { if (!['PROTOCOL_CONNECTION_LOST', 'ECONNRESET'].includes(error.code)) throw error; }
      finally { await admin.end().catch(() => {}); }
      if (!exited) await new Promise(resolve => child.once('exit', resolve));
      await log.close();
      if (!retainData) await removeStoppedData(data);
    })() };
  } catch (error) {
    await admin?.end().catch(() => {});
    child.kill();
    if (!exited) await new Promise(resolve => child.once('exit', resolve));
    await log.close();
    if (!retainData) await removeStoppedData(data).catch(() => {});
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const database = await startDatabase();
  console.log('Synthetic MySQL ready on 127.0.0.1:3315. Settings: .local/t05-database.json');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await database.close(); process.exitCode = 0; });
}
