import { getSession, json } from '@/lib/auth/server';
import { failure, genbookno } from '@/lib/genbookno/client';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  const params = new URL(request.url).searchParams;
  const filters: Record<string, string> = {};
  for (const key of params.keys()) {
    if (params.getAll(key).length !== 1) return json({ error: 'ตัวกรองไม่ถูกต้องหรือยาวเกินกำหนด' }, 400);
    filters[key] = params.get(key)!.trim();
  }
  // The service validates every filter against its allowlist and limits.
  try { return json(await genbookno('search', session.identity.staffId, { filters })); }
  catch (error) { return failure(error, 'ค้นหาไม่สำเร็จ กรุณาลองใหม่'); }
}
