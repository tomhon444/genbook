import { getSession, isSameLocalOrigin, json } from '@/lib/auth/server';
import { getIssuancePool } from '@/lib/issuance/database';
import { IssuanceError } from '@/lib/issuance/input';
import { backdatedSources, issueBackdated } from '@/lib/issuance/service';

const failure = (error: unknown) => error instanceof IssuanceError ? json({ error: error.message }, error.status) : json({ error: 'ระบบขอเลขย้อนหลังไม่พร้อมใช้งาน กรุณาลองใหม่ด้วยคำขอเดิม' }, 503);
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  const query = new URL(request.url).searchParams;
  try { return json(await backdatedSources(getIssuancePool(), session.identity, query.get('date') ?? '', Number(query.get('page') ?? '1'))); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!isSameLocalOrigin(request)) return json({ error: 'ไม่สามารถขอเลขจากช่องทางนี้ได้' }, 403);
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  try {
    const text = await request.text();
    if (text.length > 16384) throw new IssuanceError(400, 'ข้อมูลยาวเกินกำหนด');
    let input: unknown;
    try { input = JSON.parse(text); } catch { throw new IssuanceError(400, 'ข้อมูลไม่ถูกต้อง'); }
    const result = await issueBackdated(getIssuancePool(), session.identity, input);
    return json(result, result.replayed ? 200 : 201);
  } catch (error) { return failure(error); }
}
