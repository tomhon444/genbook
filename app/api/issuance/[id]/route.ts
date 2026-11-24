import { getSession, isSameLocalOrigin, json } from '@/lib/auth/server';
import { getIssuancePool } from '@/lib/issuance/database';
import { IssuanceError } from '@/lib/issuance/input';
import { detail } from '@/lib/issuance/service';
import { amendDocument } from '@/lib/issuance/amendment';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return json({ error: 'ไม่พบรายการ' }, 404);
  try { return json(await detail(getIssuancePool(), session.identity, id)); }
  catch (error) { return error instanceof IssuanceError ? json({ error: error.message }, error.status) : json({ error: 'ระบบออกเลขยังไม่พร้อมใช้งาน' }, 503); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameLocalOrigin(request)) return json({ error: 'ไม่สามารถแก้ไขจากช่องทางนี้ได้' }, 403);
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return json({ error: 'ไม่พบรายการ' }, 404);
  let input: unknown;
  try {
    const body = await request.text();
    if (body.length > 16384) return json({ error: 'ข้อมูลยาวเกินกำหนด' }, 400);
    input = JSON.parse(body);
  } catch { return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400); }
  try { return json(await amendDocument(getIssuancePool(), session.identity, id, input)); }
  catch (error) { return error instanceof IssuanceError ? json({ error: error.message }, error.status) : json({ error: 'ยังยืนยันผลการแก้ไขไม่ได้ กรุณาโหลดรายการใหม่เพื่อตรวจสอบ' }, 503); }
}
