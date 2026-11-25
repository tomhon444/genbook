import 'server-only';
import { cookies } from 'next/headers';
import { isRonaldoIdentityConfigured } from './ronaldo.mjs';

export const SESSION_COOKIE = 'genbook_session';
export type Identity = { staffId: string; displayName: string; departmentId: string; departmentName: string; uniStaffId?: string | null };
export type Session = { identity: Identity; expiresAt: number };

export function isIdentityEnabled() {
  return process.env.AUTH_PROVIDER === 'central'
    && centralOrigin() !== null && isRonaldoIdentityConfigured();
}

export async function identityRequest(path: string, body: Record<string, unknown>) {
  if (process.env.AUTH_PROVIDER !== 'central') return null;
  try {
    const { handleCentralRequest } = await import('./ronaldo.mjs');
    return await handleCentralRequest(path, body);
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
  if (process.env.AUTH_PROVIDER !== 'central') return false;
  const configured = centralOrigin();
  return configured !== null && origin === configured.origin
    && request.headers.get('host') === configured.host;
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
