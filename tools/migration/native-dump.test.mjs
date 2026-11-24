import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { inspectNativeDump, verifyNativeDump } from './native-dump.mjs';
import { assertNativeInstance } from './import-native.mjs';

const fixture = extra => gzipSync(`
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";
/*!40101 SET NAMES utf8 */;
CREATE TABLE IF NOT EXISTS \`bookdept\` (\`id\` int NOT NULL) ENGINE=MyISAM;
INSERT INTO \`bookdept\` (\`id\`) VALUES (1);
CREATE TABLE IF NOT EXISTS \`genbook\` (\`id\` int, \`subject\` text) ENGINE=InnoDB;
INSERT INTO \`genbook\` (\`id\`, \`subject\`) VALUES (1,'Text; DROP DATABASE other;'),(1,'Text; DROP DATABASE other;');
${extra ?? ''}
`);

test('native restore parses all literal rows and inert SQL-like text without executing comments', () => {
  const plan = inspectNativeDump(fixture());
  assert.equal(plan.tables.length, 2);
  assert.equal(plan.tables.find(table => table.name === 'genbook').records.length, 2);
  assert.equal(plan.commands.length, 6);
  assert.match(plan.sourceSha256, /^[a-f0-9]{64}$/);
});

test('native restore refuses database switches, privileged SQL, expressions and extra INSERT suffixes', () => {
  for (const command of ['USE mysql;', 'DROP DATABASE other;', 'SET GLOBAL local_infile=1;', 'CREATE USER evil;', "INSERT INTO `genbook` (`id`, `subject`) VALUES (2,LOAD_FILE('/secret'));", "INSERT INTO `genbook` (`id`, `subject`) VALUES (2,'x') ON DUPLICATE KEY UPDATE subject='x';"]) {
    assert.throws(() => inspectNativeDump(fixture(command)));
  }
});

test('native restore refuses unsafe DDL and inconsistent columns before creating the target', () => {
  assert.throws(() => inspectNativeDump(fixture('CREATE TABLE `remote` (`id` int) ENGINE=FEDERATED;')));
  assert.throws(() => inspectNativeDump(fixture("INSERT INTO `genbook` (`subject`, `id`) VALUES ('x',2);")));
  for (const reference of ['other_db.other_table', '`other_db`.other_table', 'other_db.`other_table`', 'other_db/**/.other_table', 'other_db -- hidden\n .other_table']) {
    assert.throws(() => inspectNativeDump(fixture(`CREATE TABLE \`external\` (\`id\` int, FOREIGN KEY (id) REFERENCES ${reference}(id)) ENGINE=InnoDB;`)));
  }
});

test('native destination requires both receipt data directory and matching instance UUID', async () => {
  const expected = { dataDirectory: 'C:/private/owned/data', instanceId: 'owned-instance' };
  let directory = expected.dataDirectory;
  let marker = expected.instanceId;
  let port = 3306;
  const db = { query: async sql => sql.includes('@@datadir') ? [[{ port, version: '8.0.30', data_directory: directory }]] : [[{ instance_uuid: marker }]] };
  await assertNativeInstance(db, expected);
  directory = 'C:/private/other/data';
  await assert.rejects(assertNativeInstance(db, expected));
  directory = expected.dataDirectory; marker = 'another-instance';
  await assert.rejects(assertNativeInstance(db, expected));
  marker = expected.instanceId; port = 3338;
  await assert.rejects(assertNativeInstance(db, expected));
});

test('full-field reconciliation preserves duplicate multiplicity and detects modified fields', async () => {
  const plan = inspectNativeDump(fixture());
  let corrupted = false;
  const db = {
    execute: async sql => sql.includes('COLUMNS') ? [[
      { TABLE_NAME: 'bookdept', COLUMN_NAME: 'id', DATA_TYPE: 'int' },
      { TABLE_NAME: 'genbook', COLUMN_NAME: 'id', DATA_TYPE: 'int' },
      { TABLE_NAME: 'genbook', COLUMN_NAME: 'subject', DATA_TYPE: 'text' },
    ]] : [[{ TABLE_NAME: 'bookdept' }, { TABLE_NAME: 'genbook' }]],
    query: async sql => sql.includes('FROM `bookdept`') ? [[{ id: '1' }]] : [[
      { id: '1', subject: 'Text; DROP DATABASE other;' },
      { id: '1', subject: corrupted ? 'changed' : 'Text; DROP DATABASE other;' },
    ]],
  };
  assert.equal((await verifyNativeDump(db, plan, 'Genbookno_db')).totalRows, 3);
  corrupted = true;
  await assert.rejects(verifyNativeDump(db, plan, 'Genbookno_db'), /stored field mismatch/);
});
