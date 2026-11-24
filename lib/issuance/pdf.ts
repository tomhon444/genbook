import 'server-only';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Identity } from '../auth/server';
import { IssuanceError } from './input';
import { detail } from './service';

export const MAX_PDF = 2097152;
// This runtime is intentionally limited to the existing synthetic local system.
const directory = () => path.join(process.cwd(), '.local', 'private-pdf');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export async function readPdfBody(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/pdf') throw new IssuanceError(415, 'รับเฉพาะ PDF');
  const reader = request.body?.getReader();
  if (!reader) throw new IssuanceError(400, 'กรุณาเลือก PDF');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PDF) { await reader.cancel(); throw new IssuanceError(413, 'PDF ต้องไม่เกิน 2 MiB (2,097,152 bytes)'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  // Isolate untrusted parsing with memory and time limits.
  const valid = await new Promise<boolean>(resolve => {
    const child = spawn(process.execPath, ['--max-old-space-size=128', path.join(process.cwd(), 'tools/pdf/validate.mjs')], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 5000);
    child.once('error', () => { clearTimeout(timer); resolve(false); });
    child.once('exit', code => { clearTimeout(timer); resolve(code === 0); });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
  if (!valid) throw new IssuanceError(400, 'PDF เสียหาย เข้ารหัส หรืออ่านโครงสร้างไม่ได้');
  return bytes;
}

export async function attachPdf(db: Pool, actor: Identity, id: string, version: number, bytes: Buffer) {
  // Check ownership before writing anything, then recheck under the row lock.
  const document = await detail(db, actor, id);
  if (document.ownerId !== actor.staffId) throw new IssuanceError(404, 'ไม่พบรายการ');
  const key = `${randomUUID()}.pdf`;
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const file = await open(path.join(directory(), key), 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  // Immutable blobs are retained on rollback/ambiguous commit and replacement.
  // Never remove a blob that a successfully committed row may reference.
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('INSERT INTO issuance_owner_locks(owner_id) VALUES (?) ON DUPLICATE KEY UPDATE owner_id=owner_id', [actor.staffId]);
    const [rows] = await connection.execute<RowDataPacket[]>('SELECT owner_id,version,pdf_path FROM issuance_documents WHERE id=? FOR UPDATE', [id]);
    const current = rows[0];
    if (!current || current.owner_id !== actor.staffId) throw new IssuanceError(404, 'ไม่พบรายการ');
    if (Number(current.version) !== version) throw new IssuanceError(409, 'ข้อมูลเปลี่ยนแล้ว กรุณาเปิดรายการอีกครั้งก่อนแนบ PDF');
    const [prior] = await connection.execute<RowDataPacket[]>("SELECT details FROM issuance_audit WHERE document_id=? AND event IN ('pdf_attached','pdf_replaced') ORDER BY id DESC LIMIT 1", [id]);
    const previous = prior[0] ? (typeof prior[0].details === 'string' ? JSON.parse(prior[0].details) : prior[0].details) : null;
    await connection.execute('UPDATE issuance_documents SET pdf_path=?,version=version+1 WHERE id=?', [key, id]);
    await connection.execute('INSERT INTO issuance_audit(document_id,actor_id,event,details,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))', [id, actor.staffId, current.pdf_path ? 'pdf_replaced' : 'pdf_attached', JSON.stringify({ previousSha256: current.pdf_path ? previous?.sha256 ?? null : null, previousBytes: current.pdf_path ? previous?.bytes ?? null : null, previousVersion: version, sha256: hash(bytes), bytes: bytes.length, version: version + 1 })]);
    const result = await detail(connection, actor, id);
    await connection.commit();
    return result;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function downloadPdf(db: Pool, actor: Identity, id: string) {
  // Read authorization and pointer in one query, including direct URL requests.
  const [rows] = await db.execute<RowDataPacket[]>('SELECT pdf_path FROM issuance_documents WHERE id=? AND (owner_id=? OR (confidential=0 AND (published=1 OR owner_department_id=?)))', [id, actor.staffId, actor.departmentId]);
  const key = rows[0]?.pdf_path;
  if (typeof key !== 'string' || !/^[a-f0-9-]{36}\.pdf$/.test(key)) throw new IssuanceError(404, 'ไม่พบ PDF');
  try { return await readFile(path.join(directory(), key)); }
  catch { throw new IssuanceError(503, 'ไฟล์ไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล'); }
}
