import { createServer } from 'node:http';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest('hex');
export async function startIdentity({ secret, users, ttlMs = 30 * 60 * 1000, port = 0 }) {
  if (process.env.NODE_ENV === 'production') throw new Error('Synthetic identity is development-only');
  if (!secret || secret.length < 32 || ttlMs < 1) throw new Error('Invalid local auth configuration');
  const sessions = new Map();
  const attempts = new Map();
  const accounts = users.map(({ password, ...user }) => {
    const salt = randomBytes(16);
    return { ...user, salt, digest: scryptSync(password, salt, 32) };
  });
  const dummySalt = randomBytes(16);
  const server = createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${secret}` || req.headers.origin) return send(403, {});
    let body;
    try {
      let raw = '';
      for await (const part of req) {
        raw += part;
        if (raw.length > 4096) return send(413, {});
      }
      body = JSON.parse(raw);
      if (!body || typeof body !== 'object') return send(400, {});
    } catch { return send(400, {}); }
    const now = Date.now();
    for (const [key, value] of sessions) if (value.expiresAt <= now) sessions.delete(key);
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const eligible = (user) => user?.active === true && user.faculty === true && user.staffId && user.departmentId && user.displayName && user.departmentName;
    const identity = (user) => ({ staffId: user.staffId, displayName: user.displayName, departmentId: user.departmentId, departmentName: user.departmentName });
    if (req.url === '/login') {
      if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.username.length > 100 || body.password.length > 256) return send(400, {});
      // One aggregate local limiter prevents unbounded attacker-controlled username maps.
      const attempt = attempts.get('login') ?? { count: 0, until: now + 60_000 };
      attempts.set('login', attempt);
      if (++attempt.count > 30) return send(429, {});
      const user = accounts.find((user) => user.username === body.username);
      const digest = scryptSync(body.password, user?.salt ?? dummySalt, 32);
      if (!user || !timingSafeEqual(digest, user.digest) || !eligible(user)) return send(401, {});
      if (typeof body.previousToken === 'string') sessions.delete(hash(body.previousToken));
      const token = randomBytes(32).toString('hex');
      const expiresAt = now + ttlMs;
      sessions.set(hash(token), { username: user.username, expiresAt });
      return send(200, { token, expiresAt });
    }
    if (req.url === '/logout') {
      if (typeof body.token === 'string') sessions.delete(hash(body.token));
      return send(200, { ok: true });
    }
    if (req.url === '/session') {
      if (typeof body.token !== 'string') return send(401, {});
      const session = sessions.get(hash(body.token));
      const user = session && accounts.find((user) => user.username === session.username);
      if (!session || !eligible(user)) return send(401, {});
      return send(200, { identity: identity(user), expiresAt: session.expiresAt });
    }
    send(404, {});
  });
  server.requestTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
