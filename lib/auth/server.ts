import 'server-only';
import { cookies } from 'next/headers';
import { isRonaldoIdentityConfigured } from './ronaldo.mjs';

export const SESSION_COOKIE = 'genbook_session';
export type Identity = { staffId: string; displayName: string; departmentId: string; departmentName: string };
export type Session = { identity: Identity; expiresAt: number };

// The synthetic provider is a separate process, never imported into the app bundle.
export function isLocalIdentityEnabled() {
  return process.env.NODE_ENV === 'development' && process.env.AUTH_PROVIDER === 'local'
    && /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.LOCAL_IDENTITY_URL ?? '')
    && (process.env.LOCAL_IDENTITY_SECRET?.length ?? 0) >= 32;
}

export function isIdentityEnabled() {
  return isLocalIdentityEnabled() || (process.env.AUTH_PROVIDER === 'central'
    && centralOrigin() !== null && isRonaldoIdentityConfigured());
}

export async function identityRequest(path: string, body: Record<string, unknown>) {
  if (process.env.AUTH_PROVIDER === 'central') {
    try {
      const { handleCentralRequest } = await import('./ronaldo.mjs');
      return await handleCentralRequest(path, body);
    } catch { return null; }
  }
  if (!isLocalIdentityEnabled()) return null;
  try {
    return await fetch(`${process.env.LOCAL_IDENTITY_URL}${path}`, {
      method: 'POST', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(3000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LOCAL_IDENTITY_SECRET}` },
      body: JSON.stringify(body),
    });
  } catch { return null; }
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const response = await identityRequest('/session', { token });
  if (!response?.ok) return null;
  const session: Session = await response.json();
  return session.expiresAt > Date.now() ? session : null;
}

export function isSameLocalOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (process.env.AUTH_PROVIDER === 'central') {
    const configured = centralOrigin();
    return configured !== null && origin === configured.origin
      && request.headers.get('host') === configured.host;
  }
  if (!origin || !isLocalIdentityEnabled()) return false;
  const url = new URL(request.url);
  // Next normalizes the internal URL hostname to localhost. Validate the browser's
  // literal loopback Host and Origin against the bound port, never forwarded headers.
  const host = `127.0.0.1${url.port ? `:${url.port}` : ''}`;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
    && origin === `http://${host}` && request.headers.get('host') === host;
}

// Only an explicitly configured public origin controls CENTRAL requests and
// cookie security. Never derive either from proxy-supplied forwarding headers.
function centralOrigin(): URL | null {
  try {
    const value = process.env.AUTH_ORIGIN;
    if (!value) return null;
    const url = new URL(value);
    if (value !== url.origin || url.username || url.password) return null;
    const developmentLoopback = process.env.NODE_ENV === 'development'
      && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    return url.protocol === 'https:' || developmentLoopback ? url : null;
  } catch { return null; }
}

export function isSessionCookieSecure() {
  return process.env.AUTH_PROVIDER === 'central' && centralOrigin()?.protocol === 'https:';
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } });
}
