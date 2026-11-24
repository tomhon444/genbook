import { NextResponse } from 'next/server';
import { identityRequest, isSameLocalOrigin, isSessionCookieSecure, json, SESSION_COOKIE } from '@/lib/auth/server';

export async function POST(request: Request) {
  if (!isSameLocalOrigin(request)) return json({ error: 'ไม่สามารถเข้าสู่ระบบจากช่องทางนี้ได้' }, 403);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400);
    body = JSON.parse(raw);
  } catch { return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400); }
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string'
      || body.username.length > 100 || body.password.length > 256 || !body.username || !body.password) {
    return json({ error: 'กรุณากรอกชื่อบัญชีและรหัสผ่าน' }, 400);
  }
  const previousToken = request.headers.get('cookie')?.match(/(?:^|;\s*)genbook_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const result = await identityRequest('/login', { username: body.username, password: body.password, previousToken });
  if (!result) return json({ error: 'ระบบยืนยันตัวตนไม่พร้อมใช้งาน กรุณาลองใหม่' }, 503);
  if (!result.ok) {
    if (result.status >= 500) return json({ error: 'ระบบยืนยันตัวตนไม่พร้อมใช้งาน กรุณาลองใหม่' }, 503);
    return json({ error: 'ชื่อบัญชี รหัสผ่าน หรือสิทธิ์เข้าใช้งานไม่ถูกต้อง' }, result.status === 429 ? 429 : 401);
  }
  const { token, expiresAt } = await result.json();
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: isSessionCookieSecure(), path: '/', expires: new Date(expiresAt),
  });
  return response;
}
