import test from 'node:test';
import assert from 'node:assert/strict';
import { openReadOnlySource, withReadOnlySource } from './remote-source.mjs';

const config = { name: 'central', host: 'phoenix.eng.psu.ac.th', database: 'CENTRAL', user: 'usrCentral', password: 'synthetic-only-password' };
function fixture(extra = {}) {
  const calls = [];
  const connection = {
    query: async (...args) => { calls.push(['query', ...args]); return [[{ count: 2 }], []]; },
    execute: async (...args) => { calls.push(['execute', ...args]); return [[{ count: 2 }], []]; },
    rollback: async () => { calls.push(['rollback']); },
    end: async () => { calls.push(['end']); },
    ...extra,
  };
  return { calls, connection, dependencies: { createConnection: async options => { calls.push(['connect', options]); return connection; } } };
}

test('TLS verified by default; reads use bound parameters and cleanup always rolls back', async () => {
  const f = fixture();
  const result = await withReadOnlySource(config, async source => {
    assert.deepEqual(Object.keys(source), ['query', 'execute', 'close']);
    await source.execute('SELECT STAFF_ID FROM STAFF_INFO WHERE LOGIN=?', ['synthetic']);
    await source.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    return 'complete';
  }, f.dependencies);
  assert.equal(result, 'complete');
  assert.deepEqual(f.calls[0][1].ssl, { rejectUnauthorized: true, verifyIdentity: true });
  assert.equal(f.calls[0][1].multipleStatements, false);
  assert.deepEqual(f.calls[1], ['query', 'START TRANSACTION READ ONLY']);
  assert.deepEqual(f.calls[2], ['execute', 'SELECT STAFF_ID FROM STAFF_INFO WHERE LOGIN=?', ['synthetic']]);
  assert.deepEqual(f.calls.slice(-2), [['rollback'], ['end']]);
});

test('destination allowlist and options reject before connection', async () => {
  const f = fixture();
  for (const bad of [null, { ...config, host: '127.0.0.1' }, { ...config, database: 'other' }, { ...config, user: 'root' },
    { ...config, name: 'other' }, { ...config, password: '' }, { ...config, allowPrivatePlaintext: 'true' }, { ...config, charset: 'invalid' }]) {
    await assert.rejects(openReadOnlySource(bad, f.dependencies), { code: 'CONFIGURATION_INVALID' });
  }
  assert.equal(f.calls.length, 0);
  const source = await openReadOnlySource({ name: 'genbook', host: 'infor.eng.psu.ac.th', database: 'GenBookno_DB', user: 'userGen', password: 'synthetic' }, f.dependencies);
  await source.close();
});

test('plaintext is explicit, accepts only entirely RFC1918 DNS results and pins address', async () => {
  const f = fixture();
  const lookup = async () => [{ address: '172.16.1.2' }, { address: '10.0.1.2' }];
  const source = await openReadOnlySource({ ...config, allowPrivatePlaintext: true }, { ...f.dependencies, lookup });
  assert.equal(f.calls[0][1].host, '172.16.1.2');
  assert.equal(Object.hasOwn(f.calls[0][1], 'ssl'), false);
  await source.close();
  for (const address of ['127.0.0.1', '172.15.0.1', '172.32.0.1', '192.169.0.1', '1.2.3.4', '::1', '::ffff:10.0.0.1', '10.0.0.999']) {
    const denied = fixture();
    await assert.rejects(openReadOnlySource({ ...config, allowPrivatePlaintext: true }, {
      ...denied.dependencies, lookup: async () => [{ address: '10.0.0.1' }, { address }],
    }), { code: 'PRIVATE_NETWORK_REQUIRED' });
    assert.equal(denied.calls.length, 0);
  }
});

test('SQL writes, locking, comments, files, variables and execution functions never reach driver', async () => {
  const f = fixture();
  const source = await openReadOnlySource(config, f.dependencies);
  const forbidden = ['UPDATE STAFF_INFO SET ACTIVE=0', 'DELETE FROM STAFF_INFO', 'CALL anything()',
    'START TRANSACTION', 'SELECT 1; SELECT 2', 'SELECT 1 INTO OUTFILE ?', 'SELECT 1 INTO DUMPFILE ?',
    'SELECT * FROM STAFF_INFO FOR UPDATE', 'SELECT * FROM STAFF_INFO LOCK IN SHARE MODE',
    'SELECT LOAD_FILE(?)', 'SELECT SLEEP(1)', 'SELECT BENCHMARK(1,1)', 'SELECT GET_LOCK(?,1)',
    'SELECT arbitrary_udf()', 'SELECT CENTRAL.COUNT(1)', 'SELECT CENTRAL . COUNT(1)',
    'SELECT `load_file`(?)', 'SELECT "load_file"(?)', 'SELECT /* comment */ 1', 'SELECT 1 -- comment',
    'SELECT 1 # comment', 'SELECT @secret:=1', 'SELECT @secret', "SELECT 'unterminated", "SELECT 'back\\slash'", 'SHOW GRANTS'];
  for (const sql of forbidden) await assert.rejects(source.query(sql, []), { code: 'QUERY_REJECTED' });
  assert.equal(f.calls.length, 2);
  await assert.rejects(source.query('SELECT STAFF_ID FROM STAFF_INFO WHERE LOGIN=?', ["' OR SLEEP(1) OR '"]), { code: 'QUERY_REJECTED' });
  assert.equal(f.calls.length, 2);
  await source.execute('SELECT COUNT(*), MAX(STAFF_ID) FROM STAFF_INFO WHERE LOGIN IN (?,?)', ['one', 'two']);
  await source.query("SELECT 'UPDATE; LOAD_FILE(1)' AS example, @@version AS version");
  await source.execute('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', ['CENTRAL']);
  await source.close();
  await assert.rejects(source.query('SELECT 1'), { code: 'SOURCE_CLOSED' });
});

test('driver errors are redacted and TLS failure does not retry insecurely', async () => {
  let attempts = 0;
  await assert.rejects(openReadOnlySource(config, { createConnection: async () => { attempts++; throw new Error('password=secret SQL personal-data'); } }), error => {
    assert.equal(error.code, 'CONNECTION_FAILED');
    assert.doesNotMatch(JSON.stringify(error) + error.message, /secret|personal-data/);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(attempts, 1);
  for (const code of ['HANDSHAKE_NO_SSL_SUPPORT', 'ECONNREFUSED', 'ETIMEDOUT', 'ER_ACCESS_DENIED_ERROR']) {
    await assert.rejects(openReadOnlySource(config, { createConnection: async () => { throw Object.assign(new Error('private driver detail'), { code }); } }), error => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /private driver detail/);
      return true;
    });
  }
  const f = fixture({ execute: async () => { throw new Error('SQL private-data'); } });
  await assert.rejects(withReadOnlySource(config, source => source.execute('SELECT STAFF_ID FROM STAFF_INFO'), f.dependencies), { code: 'READ_FAILED' });
  assert.deepEqual(f.calls.slice(-2), [['rollback'], ['end']]);
});

test('failed transaction setup and failed callbacks close connection without commit', async () => {
  const f = fixture({ query: async () => { throw new Error('setup failed'); } });
  await assert.rejects(openReadOnlySource(config, f.dependencies), { code: 'CONNECTION_FAILED' });
  assert.deepEqual(f.calls.at(-1), ['end']);
  const second = fixture();
  await assert.rejects(withReadOnlySource(config, async () => { throw new Error('private data'); }, second.dependencies), { code: 'CALLBACK_FAILED' });
  assert.deepEqual(second.calls.slice(-2), [['rollback'], ['end']]);
  await assert.rejects(withReadOnlySource(config, source => source.query('SELECT ?', [{ toSqlString: () => 'SLEEP(1)' }]), fixture().dependencies), { code: 'QUERY_REJECTED' });
});
