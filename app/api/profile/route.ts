import { getSession, json } from '@/lib/auth/server';

export async function GET() {
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  // CENTRAL identity (via ronaldo-service) carries UNI_STAFF_ID for the staff photo.
  return json({ uniStaffId: process.env.AUTH_PROVIDER === 'central' ? session.identity.uniStaffId ?? null : null });
}
