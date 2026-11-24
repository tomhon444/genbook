import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { approveLocalGenbookTarget, isApprovedLocalGenbookTarget } from './local-target.mjs';
import { assertIsolated } from './import.mjs';

test('database name alone does not authorize a local migration; bound instance is rechecked', async () => {
  const instanceId = randomUUID();
  let marker = instanceId;
  const db = { config: { host: '127.0.0.1', port: 3306 }, query: async sql => sql.includes('DATABASE()')
    ? [[{ name: 'genbook_db', port: 3306 }]] : [[{ instance_uuid: marker }]] };
  await assert.rejects(assertIsolated(db));
  await approveLocalGenbookTarget(db, instanceId);
  await assertIsolated(db);
  assert.equal(await isApprovedLocalGenbookTarget(db), true);
  marker = randomUUID();
  await assert.rejects(assertIsolated(db));
  assert.equal(await isApprovedLocalGenbookTarget(db), false);
});

test('remote targets and retired ports never receive a migration capability', async () => {
  for (const config of [{ host: 'remote.example', port: 3306 }, { host: '127.0.0.1', port: 3336 }, { host: '127.0.0.1', port: 3338 }]) {
    const db = { config, query: () => { throw new Error('Must refuse before any query'); } };
    await assert.rejects(approveLocalGenbookTarget(db, randomUUID()));
  }
});

test('the relocated port still refuses another instance and rechecks the server port', async () => {
  const instanceId = randomUUID();
  let serverPort = 3306;
  let marker = randomUUID();
  const db = { config: { host: '127.0.0.1', port: 3306 }, query: async sql => sql.includes('DATABASE()')
    ? [[{ name: 'genbook_db', port: serverPort }]] : [[{ instance_uuid: marker }]] };
  await assert.rejects(approveLocalGenbookTarget(db, instanceId));
  marker = instanceId;
  await approveLocalGenbookTarget(db, instanceId);
  serverPort = 3338;
  assert.equal(await isApprovedLocalGenbookTarget(db), false);
  await assert.rejects(approveLocalGenbookTarget(db, instanceId));
});
