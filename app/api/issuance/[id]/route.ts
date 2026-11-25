import { getSession, isSameLocalOrigin, json } from '@/lib/auth/server';
import { failure, genbookno, isBookId, readJson } from '@/lib/genbookno/client';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  const { id } = await context.params;
  if (!isBookId(id)) return json({ error: 'ไม่พบรายการ' }, 404);
  try { return json(await genbookno('books/detail', session.identity.staffId, { id })); }
  catch (error) { return failure(error, 'ระบบออกเลขยังไม่พร้อมใช้งาน'); }
}

export async function PATCH(request: Request, context: Context) {
  if (!isSameLocalOrigin(request)) return json({ error: 'ไม่สามารถแก้ไขจากช่องทางนี้ได้' }, 403);
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  const { id } = await context.params;
  if (!isBookId(id)) return json({ error: 'ไม่พบรายการ' }, 404);
  try {
    const input = await readJson(request);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400);
    return json(await genbookno('books/amend', session.identity.staffId, { id, input }));
  } catch (error) { return failure(error, 'ยังยืนยันผลการแก้ไขไม่ได้ กรุณาโหลดรายการใหม่เพื่อตรวจสอบ'); }
}
