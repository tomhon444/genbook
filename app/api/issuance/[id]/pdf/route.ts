import { getSession, isSameLocalOrigin, json } from '@/lib/auth/server';
import { getIssuancePool } from '@/lib/issuance/database';
import { IssuanceError } from '@/lib/issuance/input';
import { attachPdf, downloadPdf, readPdfBody } from '@/lib/issuance/pdf';
import { detail } from '@/lib/issuance/service';

type Context = { params: Promise<{ id: string }> };
const failure = (error: unknown) => error instanceof IssuanceError ? json({ error: error.message }, error.status) : json({ error: 'บันทึกไฟล์ไม่สำเร็จหรือยังยืนยันผลไม่ได้ กรุณาเปิดรายการเพื่อตรวจสอบก่อนลองใหม่' }, 503);
export async function GET(_request: Request, context: Context) {
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  try {
    const { id } = await context.params;
    const bytes = await downloadPdf(getIssuancePool(), session.identity, id);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="document-${id}.pdf"`, 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" } });
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request, context: Context) {
  if (!isSameLocalOrigin(request)) return json({ error: 'ไม่สามารถแนบไฟล์จากช่องทางนี้ได้' }, 403);
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  try {
    const { id } = await context.params;
    const db = getIssuancePool();
    const current = await detail(db, session.identity, id);
    if (current.ownerId !== session.identity.staffId) throw new IssuanceError(404, 'ไม่พบรายการ');
    const raw = request.headers.get('if-match') ?? '';
    if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new IssuanceError(400, 'กรุณาระบุ version ของรายการ');
    return json(await attachPdf(db, session.identity, id, Number(raw), await readPdfBody(request)));
  } catch (error) { return failure(error); }
}
