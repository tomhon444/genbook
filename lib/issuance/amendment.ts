import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Identity } from '../auth/server';
import { IssuanceError, parseContent } from './input';
import { detail } from './service';

function parseAmendment(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new IssuanceError(400, 'ข้อมูลไม่ถูกต้อง');
  const body = input as Record<string, unknown>;
  const allowed = ['version', 'subject', 'recipient', 'recipientDepartmentIds', 'externalOrganization', 'signer', 'confidential', 'published'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new IssuanceError(400, 'มีข้อมูลที่ไม่อนุญาตให้แก้ไข');
  if (typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version < 1 || body.version > 4294967295 || typeof body.published !== 'boolean') throw new IssuanceError(400, 'version หรือการเผยแพร่ไม่ถูกต้อง');
  return { version: body.version, ...parseContent(body) };
}
function content(row: RowDataPacket) {
  const decode = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;
  return { subject: String(row.subject), recipients: decode(row.recipients) as string[], recipientDepartmentIds: decode(row.recipient_department_ids) as string[], externalOrganization: String(row.external_organization), signer: String(row.signer), confidential: Boolean(row.confidential), published: Boolean(row.published) };
}

export async function amendDocument(db: Pool, actor: Identity, id: string, input: unknown) {
  const data = parseAmendment(input);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    // Same owner mutex as issuance and PDF writes. Secret -> nonsecret without
    // a PDF must serialize with the next issuance's pending-file check.
    await connection.execute('INSERT INTO issuance_owner_locks(owner_id) VALUES (?) ON DUPLICATE KEY UPDATE owner_id=owner_id', [actor.staffId]);
    const [rows] = await connection.execute<RowDataPacket[]>('SELECT * FROM issuance_documents WHERE id=? AND owner_id=? FOR UPDATE', [id, actor.staffId]);
    const current = rows[0];
    if (!current) throw new IssuanceError(404, 'ไม่พบรายการ');
    if (Number(current.version) !== data.version) throw new IssuanceError(409, 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดรายการใหม่ก่อนแก้ไข');
    if (data.version === 4294967295) throw new IssuanceError(409, 'version เต็ม กรุณาติดต่อผู้ดูแล');
    const before = content(current);
    for (const id of data.recipientDepartmentIds) {
      const [departments] = await connection.execute<RowDataPacket[]>('SELECT enabled FROM issuance_departments WHERE id=? LOCK IN SHARE MODE', [id]);
      if (!departments[0] || (!departments[0].enabled && !before.recipientDepartmentIds.includes(id))) throw new IssuanceError(400, 'หน่วยงานรับเรื่องไม่ถูกต้องหรือปิดใช้งานแล้ว');
    }
    const after = { subject: data.subject, recipients: data.recipients, recipientDepartmentIds: data.recipientDepartmentIds, externalOrganization: data.externalOrganization, signer: data.signer, confidential: data.confidential, published: data.published };
    await connection.execute('UPDATE issuance_documents SET subject=?,recipients=?,recipient_department_ids=?,external_organization=?,signer=?,confidential=?,published=?,version=version+1 WHERE id=?', [after.subject, JSON.stringify(after.recipients), JSON.stringify(after.recipientDepartmentIds), after.externalOrganization, after.signer, after.confidential, after.published, id]);
    await connection.execute("INSERT INTO issuance_audit(document_id,actor_id,event,details,created_at) VALUES (?,?,'amended',?,UTC_TIMESTAMP(3))", [id, actor.staffId, JSON.stringify({ before, after, previousVersion: data.version, version: data.version + 1 })]);
    const document = await detail(connection, actor, id);
    await connection.commit();
    return document;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
