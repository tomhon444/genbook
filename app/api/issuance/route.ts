import { getSession, isSameLocalOrigin, json } from '@/lib/auth/server';
import { getIssuancePool } from '@/lib/issuance/database';
import { IssuanceError } from '@/lib/issuance/input';
import { collection, issue } from '@/lib/issuance/service';
import { usesRonaldoBooks, readRonaldoBooks } from '@/lib/books/server';

function failure(error: unknown) {
  return error instanceof IssuanceError ? json({ error: error.message }, error.status) : json({ error: 'ระบบออกเลขไม่พร้อมใช้งาน กรุณาลองใหม่ด้วยคำขอเดิม' }, 503);
}

export async function GET() {
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  try { return json(usesRonaldoBooks() ? await readRonaldoBooks('overview', session.identity) : await collection(getIssuancePool(), session.identity)); } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!isSameLocalOrigin(request)) return json({ error: 'ไม่สามารถขอเลขจากช่องทางนี้ได้' }, 403);
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  let input: unknown;
  try {
    const text = await request.text();
    if (text.length > 16384) return json({ error: 'ข้อมูลยาวเกินกำหนด' }, 400);
    input = JSON.parse(text);
  } catch { return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400); }
  try {
    const result = await issue(getIssuancePool(), session.identity, input);
    return json(result, result.replayed ? 200 : 201);
  } catch (error) { return failure(error); }
}
