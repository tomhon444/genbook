import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transportOptions } from './export-live.mjs';

test('live export defaults to certificate-verified TLS without downgrade', () => {
  const options = transportOptions({});
  assert.equal(options.host, 'infor.eng.psu.ac.th');
  assert.deepEqual(options.ssl, { rejectUnauthorized: true, verifyIdentity: true });
});

test('only an explicit VPN assertion or established loopback tunnel omits MySQL TLS', () => {
  assert.equal(transportOptions({ vpn: true }).ssl, undefined);
  assert.equal(transportOptions({ privatePlaintext: true }).ssl, undefined);
  assert.throws(() => transportOptions({ privatePlaintext: true, vpn: true }));
  assert.deepEqual(transportOptions({ tunnel: '127.0.0.1', port: 13306 }), { host: '127.0.0.1', port: 13306 });
  for (const input of [{ tunnel: 'external.example', port: 13306 }, { tunnel: '127.0.0.1', port: 3306.5 }, { tunnel: '127.0.0.1', port: 0 }, { vpn: true, tunnel: '127.0.0.1', port: 13306 }]) assert.throws(() => transportOptions(input));
});
