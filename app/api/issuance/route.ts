import { getSession, isSameLocalOrigin, json } from '@/lib/auth/server';
import { failure, genbookno, readJson } from '@/lib/genbookno/client';

export async function GET() {
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  try { return json(await genbookno('books/overview', session.identity.staffId)); }
  catch (error) { return failure(error, 'ระบบออกเลขไม่พร้อมใช้งาน กรุณาลองใหม่'); }
}

export async function POST(request: Request) {
  if (!isSameLocalOrigin(request)) return json({ error: 'ไม่สามารถขอเลขจากช่องทางนี้ได้' }, 403);
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  try {
    const input = await readJson(request);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400);
    const result = await genbookno<{ replayed: boolean }>('books/issue', session.identity.staffId, { input });
    return json(result, result.replayed ? 200 : 201);
  } catch (error) { return failure(error, 'ระบบออกเลขไม่พร้อมใช้งาน กรุณาลองใหม่ด้วยคำขอเดิม'); }
}
