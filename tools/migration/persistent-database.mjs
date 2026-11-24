import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = path.join(project, '.local/t12-persistent');
const defaultBinary = 'C:/laragon/bin/mysql/mysql-8.0.30-winx64/bin/mysqld.exe';
const secret = () => randomBytes(32).toString('hex');
const safeError = message => new Error(`Persistent migration database: ${message}`);
const normalized = value => path.resolve(value).toLowerCase();
async function inside(location, expected) {
  if (normalized(await realpath(location)) !== normalized(expected)) throw safeError('unexpected filesystem redirection');
}
async function privateFile(file, { allowMissing = false } = {}) {
  let stat;
  try { stat = await lstat(file); }
  catch (error) { if (allowMissing && error.code === 'ENOENT') return; throw safeError('private file missing'); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw safeError('private file redirection refused');
  await inside(file, file);
}
async function atomicMetadata(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  await rename(temporary, file);
}
function launch(binary, args, log) {
  const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
  let exited = false;
  const finished = new Promise(resolve => {
    child.once('error', () => { exited = true; resolve(-1); });
    child.once('exit', code => { exited = true; resolve(code); });
  });
  return { child, finished, get exited() { return exited; } };
}

// A separate retained destination, never a legacy-server connection and never
// the disposable dev:local database. Failures preserve files for investigation.
export async function openPersistentDatabase({ name = 'legacy', port = 3336, createIfMissing = true, binary = process.env.T05_MYSQLD ?? defaultBinary } = {}) {
  if (process.env.NODE_ENV === 'production') throw safeError('production is refused');
  // The owner moved the existing managed instance to 3306. Never initialize a
  // new instance there or attach to Laragon: only reopen its verified receipt.
  const managedDefaultPort = port === 3306 && name === 'genbook-db' && createIfMissing === false;
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(name) || !Number.isInteger(port) || port < 1024 || port > 65535 || (port === 3306 && !managedDefaultPort) || typeof createIfMissing !== 'boolean') throw safeError('invalid name or port');
  const runtime = path.join(base, name), data = path.join(runtime, 'data');
  await mkdir(base, { recursive: true });
  await inside(base, path.join(await realpath(project), '.local/t12-persistent'));
  if (!createIfMissing) {
    try { await realpath(runtime); }
    catch { throw safeError('destination does not exist; creation is disabled'); }
  }
  let fresh = false;
  if (createIfMissing) {
    try { await mkdir(runtime); fresh = true; }
    catch (error) { if (error.code !== 'EEXIST') throw safeError('cannot create destination'); }
  }
  await inside(runtime, path.join(base, name));
  const lockFile = path.join(runtime, 'runtime.lock');
  let lock;
  try { lock = await open(lockFile, 'wx', 0o600); }
  catch { throw safeError('destination locked; do not remove lock until its process is confirmed stopped'); }
  let log, server, admin;
  const metadataFile = path.join(runtime, 'connection.json');
  let metadata;
  const release = async () => {
    await log?.close().catch(() => {});
    await lock.close().catch(() => {});
    await unlink(lockFile).catch(() => {});
  };
  const stopOwnProcess = async (graceful = false) => {
    if (server && !server.exited) {
      if (graceful) {
        let timer;
        await Promise.race([server.finished, new Promise(resolve => { timer = setTimeout(resolve, 10000); })]);
        clearTimeout(timer);
        if (server.exited) return;
      }
      server.child.kill();
      await server.finished;
    }
  };
  try {
    if (fresh) {
      metadata = { version: 1, name, port, runtime, instanceId: randomUUID(), rootPassword: secret(), appPassword: secret(), ready: false };
      await writeFile(metadataFile, JSON.stringify(metadata, null, 2), { flag: 'wx', mode: 0o600 });
    } else {
      await privateFile(metadataFile);
      try { metadata = JSON.parse(await readFile(metadataFile, 'utf8')); }
      catch { throw safeError('missing or invalid metadata; automatic reinitialization is refused'); }
      const expectedKeys = ['version', 'name', 'port', 'runtime', 'instanceId', 'rootPassword', 'appPassword', 'ready'];
      if (!metadata || Object.keys(metadata).length !== expectedKeys.length || Object.keys(metadata).some(key => !expectedKeys.includes(key))
        || metadata.version !== 1 || metadata.name !== name || metadata.port !== port || typeof metadata.runtime !== 'string' || normalized(metadata.runtime) !== normalized(runtime)
        || metadata.ready !== true || !/^[a-f0-9-]{36}$/.test(metadata.instanceId ?? '')
        || !/^[a-f0-9]{64}$/.test(metadata.rootPassword ?? '') || !/^[a-f0-9]{64}$/.test(metadata.appPassword ?? '')) throw safeError('incomplete or mismatched destination metadata');
      await inside(data, path.join(runtime, 'data'));
    }
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', () => reject(safeError('port occupied or unavailable; refusing to attach')));
      probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
    const logFile = path.join(runtime, 'server.log');
    await privateFile(logFile, { allowMissing: true });
    log = await open(logFile, 'a', 0o600);
    const common = ['--no-defaults', `--basedir=${path.resolve(binary, '../..')}`, `--datadir=${data}`,
      '--innodb-redo-log-capacity=8388608', '--innodb-buffer-pool-size=33554432',
      '--innodb-temp-data-file-path=ibtmp1:12M:autoextend:max:32M'];
    if (fresh) {
      const initialize = launch(binary, [...common, '--initialize-insecure', '--console'], log);
      if (await initialize.finished !== 0) throw safeError('initialization failed; retained files require review');
      await inside(data, path.join(runtime, 'data'));
    }
    server = launch(binary, [...common, '--console', '--bind-address=127.0.0.1', `--port=${port}`,
      '--mysqlx=OFF', '--skip-log-bin', '--local-infile=OFF', '--secure-file-priv=NULL'], log);
    for (let attempt = 0; attempt < 200; attempt++) {
      if (server.exited) throw safeError('server exited; inspect the private server log');
      try {
        admin = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: fresh ? '' : metadata.rootPassword,
          multipleStatements: true, timezone: 'Z', dateStrings: true, connectTimeout: 1000 });
        break;
      } catch { await new Promise(resolve => setTimeout(resolve, 150)); }
    }
    if (!admin) throw safeError('startup timed out');
    const [[identity]] = await admin.query('SELECT @@datadir data_directory, @@port port');
    if (normalized(identity.data_directory) !== normalized(data) || Number(identity.port) !== port) throw safeError('server destination identity mismatch');
    if (fresh) {
      await admin.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?", [metadata.rootPassword]);
      await admin.query('CREATE DATABASE t05_synthetic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
      await admin.query('USE t05_synthetic');
      await admin.query(await readFile(path.join(project, 'tools/issuance/schema.sql'), 'utf8'));
      const migrationSchema = await readFile(path.join(project, 'tools/migration/schema.sql'), 'utf8');
      const closedSchema = migrationSchema.replace("VALUES (1,'open')", "VALUES (1,'blocked')");
      if (closedSchema === migrationSchema) throw safeError('closed-gate schema initialization could not be verified');
      await admin.query(closedSchema);
      await admin.query('CREATE TABLE migration_instance (id TINYINT PRIMARY KEY, instance_uuid CHAR(36) NOT NULL) ENGINE=InnoDB');
      await admin.execute('INSERT INTO migration_instance(id,instance_uuid) VALUES (1,?)', [metadata.instanceId]);
      await admin.query("CREATE USER 't12_reader'@'127.0.0.1' IDENTIFIED BY ?", [metadata.appPassword]);
      for (const table of ['legacy_documents', 'legacy_document_details', 'legacy_number_reservations', 'legacy_reservation_links', 'issuance_migration_gate', 'issuance_series', 'issuance_departments']) {
        await admin.query(`GRANT SELECT ON t05_synthetic.${table} TO 't12_reader'@'127.0.0.1'`);
      }
      metadata.ready = true;
      await atomicMetadata(metadataFile, metadata);
    } else {
      await admin.query('USE t05_synthetic');
      const [[marker]] = await admin.query('SELECT instance_uuid FROM migration_instance WHERE id=1');
      if (marker?.instance_uuid !== metadata.instanceId) throw safeError('persisted instance marker mismatch');
    }
    const [[gate]] = await admin.query('SELECT state FROM issuance_migration_gate WHERE id=1');
    if (gate?.state !== 'blocked') throw safeError('issuance gate must remain blocked');
    let closing;
    return { admin, runtime, settingsFile: metadataFile,
      url: `mysql://t12_reader:${metadata.appPassword}@127.0.0.1:${port}/t05_synthetic`,
      close: () => closing ??= (async () => {
        try { await admin.query('SHUTDOWN'); }
        catch { /* Stop only the process this call spawned, never another server. */ }
        finally {
          await admin.end().catch(() => {});
          await stopOwnProcess(true);
          await release();
        }
      })(),
    };
  } catch (error) {
    await admin?.end().catch(() => {});
    await stopOwnProcess();
    await release();
    if (error.message?.startsWith('Persistent migration database:')) throw error;
    throw safeError('operation failed; destination files retained; inspect private log');
  }
}
