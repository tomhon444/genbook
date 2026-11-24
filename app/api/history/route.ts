import { getSession, json } from '@/lib/auth/server';
import { getIssuancePool } from '@/lib/issuance/database';
import { IssuanceError } from '@/lib/issuance/input';
import { history, historyDetail } from '@/lib/issuance/history';
import { usesRonaldoBooks, readRonaldoBooks } from '@/lib/books/server';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' },401);
  const params = new URL(request.url).searchParams;
  try {
    if (params.has('sourceId') || params.has('snapshot')) {
      const id = params.get('sourceId') ?? '', snapshot = params.get('snapshot') ?? '';
      if (!/^\d{1,64}$/.test(id) || !/^[a-f0-9]{64}$/.test(snapshot)) return json({ error: 'ไม่พบรายการ' },404);
      return json(usesRonaldoBooks() ? await readRonaldoBooks('detail', session.identity, { snapshot, sourceId: id }) : await historyDetail(getIssuancePool(),session.identity,snapshot,id));
    }
    return json(usesRonaldoBooks() ? await readRonaldoBooks('history', session.identity, { q: params.get('q') ?? '', page: params.get('page') ?? 1 }) : await history(getIssuancePool(),session.identity,params.get('q') ?? '',Number(params.get('page') ?? 1)));
  } catch (error) { return error instanceof IssuanceError ? json({ error: error.message },error.status) : json({ error: 'ประวัติหนังสือยังไม่พร้อมใช้งาน' },503); }
}
