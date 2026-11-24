import { getSession, json } from '@/lib/auth/server';
import { readRonaldoBooks } from '@/lib/books/server';

export async function GET() {
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  if (process.env.AUTH_PROVIDER !== 'central') return json({ uniStaffId: null });
  try {
    const profile = await readRonaldoBooks('profile', session.identity);
    return json({ uniStaffId: 'uniStaffId' in profile ? profile.uniStaffId : null });
  } catch {
    // A profile image is optional; an unavailable directory must not block work.
    return json({ uniStaffId: null });
  }
}
