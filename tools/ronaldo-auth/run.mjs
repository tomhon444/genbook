import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRonaldoIdentity } from '../../lib/auth/ronaldo.mjs';

// Development runner: genbook talks only to a running ronaldo-service (no local mock servers).
if (process.env.NODE_ENV === 'production') throw new Error('Development runner only');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root);
const envFile = existsSync('.env.local') ? '.env.local' : '.env';
if (existsSync(envFile)) loadEnvFile(envFile);
// Loopback only. GENBOOK_HOST/GENBOOK_PORT let the app avoid another local service on 3000.
const host = process.env.GENBOOK_HOST ?? '127.0.0.1';
const port = process.env.GENBOOK_PORT ?? '3000';
if (!['127.0.0.1', 'localhost'].includes(host) || !/^\d{2,5}$/.test(port)) throw new Error('GENBOOK_HOST must be 127.0.0.1 or localhost and GENBOOK_PORT a port number');
const env = { ...process.env, NODE_ENV: 'development', AUTH_PROVIDER: 'central', AUTH_ORIGIN: `http://${host}:${port}` };
env.AUTH_SESSION_DIRECTORY ||= path.join(root, '.local/ronaldo-sessions');
// Validate the ronaldo-service URL and credentials before starting Next.js.
createRonaldoIdentity({ serviceUrl: env.RONALDO_SERVICE_URL, secret: env.RONALDO_IDENTITY_SECRET, nodeEnv: env.NODE_ENV, sessionDirectory: env.AUTH_SESSION_DIRECTORY });
const next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', host, '--port', port], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
next.once('error', () => { process.exitCode = 1; });
next.once('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { next.kill(); });
