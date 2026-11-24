import { NextRequest, NextResponse } from 'next/server';
import { identityRequest, isSameLocalOrigin, isSessionCookieSecure, json, SESSION_COOKIE } from '@/lib/auth/server';

export async function POST(request: NextRequest) {
  if (!isSameLocalOrigin(request)) return json({ error: 'ไม่สามารถออกจากระบบจากช่องทางนี้ได้' }, 403);
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const result = await identityRequest('/logout', { token });
    if (!result?.ok) return json({ error: 'ยังออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง' }, 503);
  }
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: isSessionCookieSecure(), path: '/', maxAge: 0 });
  return response;
}
