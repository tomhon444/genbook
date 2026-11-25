import { getSession, json } from '@/lib/auth/server';
import { failure, genbookno } from '@/lib/genbookno/client';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  const params = new URL(request.url).searchParams;
  try {
    if (params.has('sourceId') || params.has('snapshot')) {
      const sourceId = params.get('sourceId') ?? '', snapshot = params.get('snapshot') ?? '';
      if (!/^\d{1,11}$/.test(sourceId) || !/^[a-f0-9]{64}$/.test(snapshot)) return json({ error: 'ไม่พบรายการ' }, 404);
      return json(await genbookno('detail', session.identity.staffId, { snapshot, sourceId }));
    }
    const q = params.get('q') ?? '', page = params.get('page') ?? '1';
    if (q.length > 200 || !/^[1-9]\d{0,4}$/.test(page)) return json({ error: 'คำค้นหรือหน้าไม่ถูกต้อง' }, 400);
    return json(await genbookno('history', session.identity.staffId, { q, page: Number(page) }));
  } catch (error) { return failure(error, 'ประวัติหนังสือยังไม่พร้อมใช้งาน'); }
}
