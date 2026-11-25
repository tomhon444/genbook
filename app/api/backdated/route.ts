import { getSession, isSameLocalOrigin, json } from '@/lib/auth/server';
import { failure, genbookno, readJson } from '@/lib/genbookno/client';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  const query = new URL(request.url).searchParams;
  const page = query.get('page') ?? '1';
  if (!/^[1-9]\d{0,4}$/.test(page)) return json({ error: 'วันที่ย้อนหลังหรือหน้าไม่ถูกต้อง' }, 400);
  try { return json(await genbookno('books/sources', session.identity.staffId, { date: query.get('date') ?? '', page: Number(page) })); }
  catch (error) { return failure(error, 'ระบบขอเลขย้อนหลังไม่พร้อมใช้งาน กรุณาลองใหม่'); }
}

export async function POST(request: Request) {
  if (!isSameLocalOrigin(request)) return json({ error: 'ไม่สามารถขอเลขจากช่องทางนี้ได้' }, 403);
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  try {
    const input = await readJson(request);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400);
    const result = await genbookno<{ replayed: boolean }>('books/issue-backdated', session.identity.staffId, { input });
    return json(result, result.replayed ? 200 : 201);
  } catch (error) { return failure(error, 'ระบบขอเลขย้อนหลังไม่พร้อมใช้งาน กรุณาลองใหม่ด้วยคำขอเดิม'); }
}
