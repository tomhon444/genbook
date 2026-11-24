import { getSession, json } from '@/lib/auth/server';
import { getIssuancePool } from '@/lib/issuance/database';
import { IssuanceError } from '@/lib/issuance/input';
import { searchDocuments, parseSearch } from '@/lib/issuance/search';
import { usesRonaldoBooks, readRonaldoBooks } from '@/lib/books/server';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง' }, 401);
  try {
    const params = new URL(request.url).searchParams;
    return json(usesRonaldoBooks() ? await readRonaldoBooks('search', session.identity, { filters: parseSearch(params) }) : await searchDocuments(getIssuancePool(), session.identity, params));
  }
  catch (error) { return error instanceof IssuanceError ? json({ error: error.message }, error.status) : json({ error: 'ค้นหาไม่สำเร็จ กรุณาลองใหม่' }, 503); }
}
