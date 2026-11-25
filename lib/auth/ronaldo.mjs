import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

const validToken = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const reply = (status, body = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;

// Imported only by the server-only auth boundary. Never import into a client component.
export function createRonaldoIdentity({ serviceUrl, secret, nodeEnv, sessionDirectory, fetchImpl = fetch, now = Date.now, ttlMs = 30 * 60 * 1000 }) {
  const url = new URL(serviceUrl);
  const local = nodeEnv === 'development' || nodeEnv === 'test';
  if (url.origin !== serviceUrl || url.username || url.password ||
      !(url.protocol === 'https:' || (local && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))) ||
      typeof secret !== 'string' || secret.length < 32 || /\s/.test(secret) ||
      !path.isAbsolute(sessionDirectory) || !Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error('Invalid Ronaldo identity configuration');
  }
  const filename = token => path.join(sessionDirectory, `${hash(token)}.json`);
  let lastSweep = 0;

  async function remove(token) {
    if (!validToken(token)) return;
    await unlink(filename(token)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  async function session(token) {
    if (!validToken(token)) return null;
    let record;
    try { record = JSON.parse(await readFile(filename(token), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!text(record.staffId) || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= now()) {
      await remove(token);
      return null;
    }
    return record;
  }
  async function reserveSession(token, record, previousToken) {
    await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
    // Bound disk usage. Only hash-named records in this dedicated directory are touched.
    const files = (await readdir(sessionDirectory)).filter(file => /^[a-f0-9]{64}\.json$/.test(file));
    if (now() - lastSweep >= 60_000 || files.length >= 10_000) {
      for (const file of files) {
        try {
          const value = JSON.parse(await readFile(path.join(sessionDirectory, file), 'utf8'));
          if (!value || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now()) await unlink(path.join(sessionDirectory, file));
        } catch (error) {
          if (error instanceof SyntaxError) {
            await rename(path.join(sessionDirectory, file), path.join(sessionDirectory, `${file}.${randomBytes(8).toString('hex')}.corrupt`))
              .catch(moveError => { if (moveError.code !== 'ENOENT') throw moveError; });
          } else if (error.code !== 'ENOENT') throw error;
        }
      }
      lastSweep = now();
    }
    if ((await readdir(sessionDirectory)).filter(file => /^[a-f0-9]{64}\.json$/.test(file)).length >= 10_000) throw new Error('Session capacity exceeded');
    const temporary = `${filename(token)}.${randomBytes(8).toString('hex')}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try {
      try { await file.writeFile(JSON.stringify(record)); await file.sync(); }
      finally { await file.close(); }
      // Publish a complete record atomically; concurrent sweeps never read partial JSON.
      await rename(temporary, filename(token));
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
    try { await remove(previousToken); }
    catch (error) { await remove(token); throw error; }
  }
  async function remote(endpoint, body) {
    const response = await fetchImpl(`${serviceUrl}/api/v1/identity/${endpoint}`, {
      method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) return [401, 429].includes(response.status) ? reply(response.status) : null;
    if (!response.body) return null;
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) { await reader.cancel(); return null; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!(result.provider === 'central' || (local && result.provider === 'fake'))) return null;
    const identity = result.identity;
    if (!identity || !['staffId', 'displayName', 'departmentId', 'departmentName'].every(key => text(identity[key]))) return null;
    const uniStaffId = identity.uniStaffId == null ? null : identity.uniStaffId;
    if (uniStaffId !== null && (!text(uniStaffId) || uniStaffId.length > 128)) return null;
    // Copy the contract fields only: no roles, passwords or extra upstream data.
    return reply(200, { identity: { ...Object.fromEntries(['staffId', 'displayName', 'departmentId', 'departmentName'].map(key => [key, identity[key]])), ...(uniStaffId ? { uniStaffId: uniStaffId.trim() } : {}) } });
  }

  return async (endpoint, body) => {
    try {
      if (endpoint === '/login') {
        if (!text(body.username) || body.username.length > 100 || typeof body.password !== 'string' || !body.password || body.password.length > 256) return reply(400);
        const result = await remote('authenticate', { username: body.username, password: body.password });
        if (!result?.ok) return result;
        const { identity } = await result.json();
        const token = randomBytes(32).toString('hex');
        const expiresAt = now() + ttlMs;
        await reserveSession(token, { staffId: identity.staffId, expiresAt }, body.previousToken);
        return reply(200, { token, expiresAt });
      }
      if (endpoint === '/logout') {
        await remove(body.token);
        return reply(200, { ok: true });
      }
      if (endpoint === '/session') {
        const record = await session(body.token);
        if (!record) return reply(401);
        const result = await remote('status', { staffId: record.staffId });
        if (!result?.ok) {
          if (result?.status === 401) await remove(body.token);
          return result;
        }
        const { identity } = await result.json();
        if (identity.staffId !== record.staffId) return null;
        // Recheck revocation/expiry after the network operation.
        if (!await session(body.token)) return reply(401);
        return reply(200, { identity, expiresAt: record.expiresAt });
      }
      return reply(404);
    } catch { return null; }
  };
}

let handler;
function configuredHandler() {
  return handler ??= createRonaldoIdentity({
      serviceUrl: process.env.RONALDO_SERVICE_URL,
      secret: process.env.RONALDO_IDENTITY_SECRET,
      nodeEnv: process.env.NODE_ENV,
      sessionDirectory: process.env.AUTH_SESSION_DIRECTORY ?? (process.env.NODE_ENV === 'development' ? path.resolve('.local/auth-sessions') : ''),
  });
}
export function isRonaldoIdentityConfigured() {
  try { configuredHandler(); return true; } catch { return false; }
}
export async function handleCentralRequest(endpoint, body) {
  try {
    return await configuredHandler()(endpoint, body);
  } catch { return null; }
}
