import { getSession, json } from '@/lib/auth/server';

export async function GET() {
  const session = await getSession();
  return session ? json(session) : json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
}
