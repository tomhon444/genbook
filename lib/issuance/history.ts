import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Identity } from '../auth/server';
import { IssuanceError } from './input';

const readable = '(owner_id=? OR (confidential=0 AND (published=1 OR owner_department_id=?)))';
const columns = 'source_sha256,source_id,prefix,main_number,sub_number,number_year,subject,document_date,confidential,published,cancelled,owner_id,owner_department_id,pdf_pending';

export type HistoricalDetails = {
  recipients: { sourceId: string; text: string | null }[];
  destinations: { sourceId: string; kind: 'internal' | 'external' | 'unknown'; value: string | null }[];
  signer: { kind: 'position' | 'staff' | 'unknown'; typeCode: string | null; reference: string | null };
  legacyActorId: string | null; recordedAtText: string | null; updatedAtText: string | null;
  timestampTimeZone: 'unverified'; attachmentVerification: 'unverified';
};

// Project each field explicitly; sidecar JSON must never become an unfiltered
// channel for raw source columns, credentials or old attachment paths.
function metadata(row: RowDataPacket | undefined): HistoricalDetails | null {
  if (!row) return null;
  const invalid = () => { throw new IssuanceError(503, 'รายละเอียดประวัติยังไม่พร้อมใช้งาน'); };
  const text = (value: unknown): string | null => typeof value === 'string' || value === null ? value : invalid();
  const id = (value: unknown): string => typeof value === 'string' && /^\d+$/.test(value) ? value : invalid();
  const data = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  if (Number(row.schema_version) !== 1 || !data || !Array.isArray(data.recipients) || !Array.isArray(data.destinations)
    || !data.signer || !['position', 'staff', 'unknown'].includes(data.signer.kind)
    || data.timestampTimeZone !== 'unverified' || data.attachmentVerification !== 'unverified') return invalid();
  return {
    recipients: data.recipients.map((value: { sourceId: unknown; text: unknown }) => ({ sourceId: id(value?.sourceId), text: text(value?.text) })),
    destinations: data.destinations.map((value: { sourceId: unknown; kind: HistoricalDetails['destinations'][number]['kind']; value: unknown }) => {
      if (!value || !['internal', 'external', 'unknown'].includes(value.kind)) return invalid();
      return { sourceId: id(value.sourceId), kind: value.kind, value: text(value.value) };
    }),
    signer: { kind: data.signer.kind, typeCode: text(data.signer.typeCode), reference: text(data.signer.reference) },
    legacyActorId: text(data.legacyActorId), recordedAtText: text(data.recordedAtText), updatedAtText: text(data.updatedAtText),
    timestampTimeZone: 'unverified', attachmentVerification: 'unverified',
  };
}
function view(row: RowDataPacket) {
  return { sourceSha256: String(row.source_sha256), sourceId: String(row.source_id),
    number: `${row.prefix}/${String(row.main_number).padStart(4,'0')}${row.sub_number ? `.${row.sub_number}` : ''}`,
    numberYear: Number(row.number_year), subject: String(row.subject), documentDate: String(row.document_date),
    confidential: Boolean(row.confidential), published: Boolean(row.published), cancelled: Boolean(row.cancelled),
    ownerId: String(row.owner_id), ownerDepartmentId: String(row.owner_department_id), pdfPending: Boolean(row.pdf_pending) };
}
export async function history(db: Pool, actor: Identity, query: string, page: number) {
  if (query.length > 200 || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new IssuanceError(400,'คำค้นหรือหน้าไม่ถูกต้อง');
  // LOCATE treats %, _ and SQL syntax as literal text. Authorize before LIMIT.
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${columns} FROM legacy_documents WHERE ${readable} AND (?='' OR LOCATE(?,subject)>0 OR LOCATE(?,source_id)>0 OR LOCATE(?,CONCAT(prefix,'/',LPAD(main_number,GREATEST(4,LENGTH(main_number)),'0'),IF(sub_number=0,'',CONCAT('.',sub_number))))>0) ORDER BY document_date DESC,source_sha256,source_id LIMIT 21 OFFSET ?`, [actor.staffId,actor.departmentId,query,query,query,query,(page-1)*20]);
  return { documents: rows.slice(0,20).map(view), hasMore: rows.length > 20, page };
}
export async function historyDetail(db: Pool, actor: Identity, snapshot: string, id: string) {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${columns} FROM legacy_documents WHERE source_sha256=? AND source_id=? AND ${readable}`, [snapshot,id,actor.staffId,actor.departmentId]);
  if (!rows[0]) throw new IssuanceError(404,'ไม่พบรายการ');
  const [details] = await db.execute<RowDataPacket[]>('SELECT schema_version,payload FROM legacy_document_details WHERE source_sha256=? AND source_id=?', [snapshot,id]);
  return { ...view(rows[0]), details: metadata(details[0]) };
}
