import { getSession, isSameLocalOrigin, json } from '@/lib/auth/server';
import { downloadPdf, failure, isBookId, uploadPdf } from '@/lib/genbookno/client';
import { readPdfBody } from '@/lib/genbookno/pdf';

type Context = { params: Promise<{ id: string }> };
const saveFailed = 'บันทึกไฟล์ไม่สำเร็จหรือยังยืนยันผลไม่ได้ กรุณาเปิดรายการเพื่อตรวจสอบก่อนลองใหม่';

export async function GET(_request: Request, context: Context) {
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  const { id } = await context.params;
  if (!isBookId(id)) return json({ error: 'ไม่พบ PDF' }, 404);
  try {
    const bytes = await downloadPdf(session.identity.staffId, id);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="document-${id}.pdf"`, 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" } });
  } catch (error) { return failure(error, 'ไฟล์ไม่พร้อมใช้งาน กรุณาลองใหม่'); }
}

export async function PUT(request: Request, context: Context) {
  if (!isSameLocalOrigin(request)) return json({ error: 'ไม่สามารถแนบไฟล์จากช่องทางนี้ได้' }, 403);
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  const { id } = await context.params;
  if (!isBookId(id)) return json({ error: 'ไม่พบรายการ' }, 404);
  const raw = request.headers.get('if-match') ?? '';
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return json({ error: 'กรุณาระบุ version ของรายการ' }, 400);
  try { return json(await uploadPdf(session.identity.staffId, id, Number(raw), await readPdfBody(request))); }
  catch (error) { return failure(error, saveFailed); }
}
