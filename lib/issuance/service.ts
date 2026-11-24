import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { Identity } from '../auth/server';
import { bangkokNow, IssuanceError, parseInput, type BackdatedSource } from './input';

type Database = Pool | PoolConnection;
async function rows(db: Database, sql: string, values: (string | number)[] = []) {
  const [result] = await db.execute<RowDataPacket[]>(sql, values);
  return result;
}
function decoded(value: unknown) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}
function view(row: RowDataPacket) {
  const recipients = decoded(row.recipients) as string[];
  return {
    id: String(row.id), number: `${row.prefix}/${String(row.main_number).padStart(4, '0')}${row.sub_number ? `.${row.sub_number}` : ''}`,
    numberYear: Number(row.number_year), subject: String(row.subject), recipient: recipients.join('\n'),
    issuanceKind: row.sub_number ? 'backdated' as const : 'normal' as const,
    seriesId: String(row.series_id), mainNumber: Number(row.main_number), subNumber: Number(row.sub_number),
    recipientDepartmentIds: decoded(row.recipient_department_ids) as string[], externalOrganization: String(row.external_organization), signer: String(row.signer),
    documentDate: String(row.document_date), issuedAt: `${String(row.issued_at).replace(' ', 'T')}Z`, confidential: Boolean(row.confidential),
    published: Boolean(row.published), allocationStatus: 'allocated' as const,
    hasPdf: Boolean(row.pdf_path), pdfPending: !row.confidential && !row.pdf_path, ownerId: String(row.owner_id), ownerDepartmentId: String(row.owner_department_id), version: Number(row.version),
  };
}

// Apply T02 before returning rows or applying LIMIT. Documents keep the original
// department; readers use their current verified identity. Grants only allow issuance.
const readable = '(owner_id=? OR (confidential=0 AND (published=1 OR owner_department_id=?)))';
const readerValues = (actor: Identity) => [actor.staffId, actor.departmentId];

// Sources come only from readable issued/normalized documents, never raw or
// restricted reservations. The latter are a numbering floor, not permission.
export async function backdatedSources(db: Pool, actor: Identity, date: string, page = 1) {
  const today = bangkokNow().today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > today || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new IssuanceError(400, 'วันที่ย้อนหลังหรือหน้าไม่ถูกต้อง');
  const [result] = await db.query<RowDataPacket[]>(`SELECT d.* FROM (
    SELECT 'issuance' kind,'' snapshot,id,series_id,number_year,main_number,sub_number,prefix,document_date,subject,owner_id,owner_department_id,confidential,published FROM issuance_documents
    UNION ALL
    SELECT 'legacy' kind,source_sha256 snapshot,source_id id,series_id,number_year,main_number,sub_number,prefix,document_date,subject,owner_id,owner_department_id,confidential,published FROM legacy_documents WHERE cancelled=0
  ) d JOIN issuance_series s ON s.id=d.series_id JOIN issuance_grants g ON g.series_id=s.id
  WHERE g.owner_id=? AND g.active=1 AND s.enabled=1 AND s.prefix<>'' AND s.year_basis IN ('calendar','document_date')
    AND d.document_date=? AND (d.owner_id=? OR (d.confidential=0 AND (d.published=1 OR d.owner_department_id=?)))
  ORDER BY d.number_year,d.series_id,d.main_number,d.sub_number,d.kind,d.snapshot,d.id LIMIT 21 OFFSET ?`, [actor.staffId, date, ...readerValues(actor), (page - 1) * 20]);
  return { sources: result.slice(0, 20).map(row => ({ source: row.kind === 'legacy' ? { kind: 'legacy', snapshot: String(row.snapshot), id: String(row.id) } : { kind: 'issuance', id: String(row.id) }, seriesId: String(row.series_id), numberYear: Number(row.number_year), number: `${row.prefix}/${String(row.main_number).padStart(4, '0')}${row.sub_number ? `.${row.sub_number}` : ''}`, documentDate: String(row.document_date), subject: String(row.subject) })), hasMore: result.length > 20, page, today };
}

async function sourceDocument(db: Database, actor: Identity, source: BackdatedSource) {
  const [document] = source.kind === 'issuance'
    ? await rows(db, `SELECT * FROM issuance_documents WHERE id=? AND ${readable} LOCK IN SHARE MODE`, [source.id, ...readerValues(actor)])
    : await rows(db, `SELECT * FROM legacy_documents WHERE source_sha256=? AND source_id=? AND cancelled=0 AND ${readable} LOCK IN SHARE MODE`, [source.snapshot, source.id, ...readerValues(actor)]);
  if (!document) throw new IssuanceError(404, 'ไม่พบต้นทางที่ใช้ได้');
  return document;
}

export async function collection(db: Pool, actor: Identity) {
  const series = await rows(db, `SELECT s.id,s.name,s.prefix FROM issuance_series s JOIN issuance_grants g ON g.series_id=s.id WHERE g.owner_id=? AND g.active=1 AND s.enabled=1 AND s.prefix<>'' AND s.year_basis IN ('calendar','document_date') ORDER BY s.id`, [actor.staffId]);
  const documents = await rows(db, 'SELECT * FROM issuance_documents WHERE owner_id=? ORDER BY issued_at DESC,id DESC LIMIT 10', [actor.staffId]);
  const shared = await rows(db, `SELECT * FROM issuance_documents WHERE ${readable} AND owner_id<>? ORDER BY issued_at DESC,id DESC LIMIT 10`, [...readerValues(actor), actor.staffId]);
  const departments = await rows(db, 'SELECT id,name FROM issuance_departments WHERE enabled=1 ORDER BY id');
  return { series: series.map((row) => ({ id: String(row.id), label: String(row.name), prefix: String(row.prefix) })), departments: departments.map((row) => ({ id: String(row.id), name: String(row.name) })), documents: documents.map(view), sharedDocuments: shared.map(view), today: bangkokNow().today };
}

export async function detail(db: Database, actor: Identity, id: string) {
  const [document] = await rows(db, `SELECT * FROM issuance_documents WHERE id=? AND ${readable}`, [id, ...readerValues(actor)]);
  if (!document) throw new IssuanceError(404, 'ไม่พบรายการ');
  const departmentIds = [...new Set([String(document.owner_department_id), ...(decoded(document.recipient_department_ids) as string[])])];
  const names = await rows(db, `SELECT id,name FROM issuance_departments WHERE id IN (${departmentIds.map(() => '?').join(',')})`, departmentIds);
  const departmentName = (id: string) => String(names.find(row => String(row.id) === id)?.name ?? id);
  const metadata = { ...view(document), ownerDepartmentName: departmentName(String(document.owner_department_id)), recipientDepartments: (decoded(document.recipient_department_ids) as string[]).map(id => ({ id, name: departmentName(id) })) };
  // Reading a document never implies access to its audit.
  if (String(document.owner_id) !== actor.staffId) return metadata;
  const audit = await rows(db, 'SELECT actor_id,event,details,created_at FROM issuance_audit WHERE document_id=? ORDER BY id', [id]);
  return { ...metadata, audit: audit.map((row) => ({ actorId: String(row.actor_id), event: String(row.event), details: decoded(row.details), createdAt: `${String(row.created_at).replace(' ', 'T')}Z` })) };
}

// Migration gate -> owner -> series -> counters is the shared lock order.
// The owner mutex protects the cross-series pending-file rule. Counter rows protect
// shared series/year numbering. Every issuer takes these locks in that order.
export async function issue(db: Pool, actor: Identity, input: unknown, clock: () => Date = () => new Date(), backdated = false) {
  const data = parseInput(input, backdated);
  const connection = await db.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await connection.beginTransaction();
    const [gate] = await rows(connection, 'SELECT state FROM issuance_migration_gate WHERE id=1 LOCK IN SHARE MODE');
    if (!gate || gate.state !== 'open') throw new IssuanceError(503, 'ระบบกำลังตรวจรับข้อมูลเดิม ยังไม่เปิดออกเลข');
    // Duplicate-key no-op UPDATE takes an exclusive row lock immediately.
    // INSERT IGNORE would take shared duplicate locks and deadlock on upgrade
    // when several first-time requests then try SELECT ... FOR UPDATE.
    await connection.execute('INSERT INTO issuance_owner_locks(owner_id) VALUES (?) ON DUPLICATE KEY UPDATE owner_id=owner_id', [actor.staffId]);
    await rows(connection, 'SELECT owner_id FROM issuance_owner_locks WHERE owner_id=? FOR UPDATE', [actor.staffId]);
    const [series] = await rows(connection, `SELECT s.* FROM issuance_series s JOIN issuance_grants g ON g.series_id=s.id WHERE g.owner_id=? AND g.series_id=? AND g.active=1 AND s.enabled=1 AND s.prefix<>'' AND s.year_basis IN ('calendar','document_date') LOCK IN SHARE MODE`, [actor.staffId, data.seriesId]);
    if (!series) throw new IssuanceError(403, 'ไม่มีสิทธิ์ใช้ชุดเลขนี้');
    const source = data.source ? await sourceDocument(connection, actor, data.source) : null;
    if (source && (String(source.series_id) !== data.seriesId || String(source.document_date) !== data.documentDate)) throw new IssuanceError(404, 'ไม่พบต้นทางที่ใช้ได้');
    const [previous] = await rows(connection, 'SELECT * FROM issuance_documents WHERE owner_id=? AND request_key=?', [actor.staffId, data.requestId]);
    if (previous) {
      if (previous.payload_hash !== data.payloadHash && previous.payload_hash !== data.legacyPayloadHash) throw new IssuanceError(409, 'รหัสคำขอเดิมมีข้อมูลต่างกัน กรุณาเริ่มรายการใหม่');
      const document = await detail(connection, actor, String(previous.id));
      await connection.commit();
      return { document, replayed: true };
    }
    const [pending] = await rows(connection, "SELECT id FROM issuance_documents WHERE owner_id=? AND confidential=0 AND (pdf_path IS NULL OR pdf_path='') LIMIT 1", [actor.staffId]);
    if (pending) throw new IssuanceError(409, 'ยังมีหนังสือไม่ลับค้างแนบ PDF กรุณาแนบไฟล์ให้ครบก่อนขอเลขใหม่');
    const [legacyPending] = await rows(connection, 'SELECT source_id FROM legacy_documents WHERE owner_id=? AND confidential=0 AND cancelled=0 AND pdf_pending=1 LIMIT 1', [actor.staffId]);
    if (legacyPending) throw new IssuanceError(409, 'มีหนังสือเดิมค้างแนบ PDF กรุณาติดต่อผู้ดูแลก่อนขอเลขใหม่');
    for (const departmentId of data.recipientDepartmentIds) {
      const [department] = await rows(connection, 'SELECT id FROM issuance_departments WHERE id=? AND enabled=1 LOCK IN SHARE MODE', [departmentId]);
      if (!department) throw new IssuanceError(400, 'หน่วยงานรับเรื่องไม่ถูกต้องหรือปิดใช้งานแล้ว');
    }
    // Obtain the allocation time after waiting for both owner and counter locks.
    // Re-evaluate the year after a counter wait that crosses midnight.
    let allocatedAt: Date;
    let business: ReturnType<typeof bangkokNow>;
    let year: number;
    let next: number;
    let sub = 0;
    if (source) {
      year = Number(source.number_year);
      next = Number(source.main_number);
      await connection.execute('INSERT INTO issuance_subcounters(series_id,number_year,main_number,last_sub_number) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE last_sub_number=last_sub_number', [data.seriesId, year, next]);
      const [counter] = await rows(connection, 'SELECT last_sub_number FROM issuance_subcounters WHERE series_id=? AND number_year=? AND main_number=? FOR UPDATE', [data.seriesId, year, next]);
      allocatedAt = clock(); business = bangkokNow(allocatedAt);
      if (data.documentDate > business.today) throw new IssuanceError(400, 'ใช้ต้นทางวันที่อนาคตไม่ได้');
      // MAX is only a seed/floor under the subcounter's exclusive scope lock.
      // Include hidden and cancelled historical reservations; never reuse them.
      const [issued] = await rows(connection, 'SELECT MAX(sub_number) floor FROM issuance_documents WHERE series_id=? AND number_year=? AND main_number=?', [data.seriesId, year, next]);
      const [legacy] = await rows(connection, 'SELECT MAX(sub_number) floor FROM legacy_documents WHERE series_id=? AND number_year=? AND main_number=?', [data.seriesId, year, next]);
      const [reserved] = await rows(connection, `SELECT MAX(r.sub_number) floor FROM legacy_number_reservations r JOIN legacy_reservation_links l ON l.source_sha256=r.source_sha256 AND l.legacy_series_id=r.legacy_series_id WHERE l.series_id=? AND r.number_year=? AND r.main_number=?`, [data.seriesId, year, next]);
      sub = Math.max(Number(counter.last_sub_number), Number(issued?.floor ?? 0), Number(legacy?.floor ?? 0), Number(reserved?.floor ?? 0)) + 1;
      if (!Number.isSafeInteger(sub) || sub > 4294967295) throw new IssuanceError(409, 'เลขย่อยเต็ม กรุณาติดต่อผู้ดูแล');
      await connection.execute('UPDATE issuance_subcounters SET last_sub_number=? WHERE series_id=? AND number_year=? AND main_number=?', [sub, data.seriesId, year, next]);
    } else {
      while (true) {
        business = bangkokNow(clock());
        year = series.year_basis === 'document_date' ? Number(data.documentDate.slice(0, 4)) + 543 : business.year;
        await connection.execute('INSERT INTO issuance_counters(series_id,number_year,last_number) VALUES (?,?,0) ON DUPLICATE KEY UPDATE last_number=last_number', [data.seriesId, year]);
        await rows(connection, 'SELECT last_number FROM issuance_counters WHERE series_id=? AND number_year=? FOR UPDATE', [data.seriesId, year]);
        allocatedAt = clock();
        business = bangkokNow(allocatedAt);
        if (series.year_basis === 'document_date' || year === business.year) break;
      }
      if (data.documentDate !== business.today) throw new IssuanceError(400, 'การขอเลขปกติต้องใช้วันที่ปัจจุบันตามเวลาไทย');
      const [counter] = await rows(connection, 'SELECT last_number FROM issuance_counters WHERE series_id=? AND number_year=?', [data.seriesId, year]);
      // Immutable imported reservations are an input floor, never an allocator.
      // Check under the existing series/counter locks; a reset counter must not
      // reuse a historical gap below the largest reserved main/sub number.
      const [reserved] = await rows(connection, `SELECT MAX(r.main_number) floor FROM legacy_number_reservations r JOIN legacy_reservation_links l ON l.source_sha256=r.source_sha256 AND l.legacy_series_id=r.legacy_series_id WHERE l.series_id=? AND r.number_year=?`, [data.seriesId, year]);
      if (reserved?.floor != null && Number(counter.last_number) < Number(reserved.floor)) throw new IssuanceError(409, 'ตัวนับต่ำกว่าเลขเดิมที่กันไว้ กรุณาติดต่อผู้ดูแล');
      next = Number(counter.last_number) + 1;
      if (!Number.isSafeInteger(next) || next > 4294967295) throw new IssuanceError(409, 'ชุดเลขเต็ม กรุณาติดต่อผู้ดูแล');
      await connection.execute('UPDATE issuance_counters SET last_number=? WHERE series_id=? AND number_year=?', [next, data.seriesId, year]);
    }
    // Evaluate after all allocator waits, including the independent subcounter.
    if (actor.departmentId !== '204' && (business.seconds < 7 * 3600 || business.seconds >= 22 * 3600 + 31 * 60)) throw new IssuanceError(403, 'ขอเลขได้ทุกวันเวลา 07:00:00–22:30:59');
    const id = randomUUID();
    const timestamp = allocatedAt.toISOString().slice(0, 23).replace('T', ' ');
    await connection.execute(`INSERT INTO issuance_documents (id,owner_id,owner_department_id,request_key,payload_hash,series_id,number_year,main_number,sub_number,prefix,document_date,issued_at,subject,recipients,recipient_department_ids,external_organization,signer,confidential,published) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, actor.staffId, actor.departmentId, data.requestId, data.payloadHash, data.seriesId, year, next, sub, String(source?.prefix ?? series.prefix), data.documentDate, timestamp, data.subject, JSON.stringify(data.recipients), JSON.stringify(data.recipientDepartmentIds), data.externalOrganization, data.signer, data.confidential, data.published]);
    await connection.execute('INSERT INTO issuance_audit(document_id,actor_id,event,details,created_at) VALUES (?,?,?,?,?)', [id, actor.staffId, source ? 'issued_backdated' : 'issued', JSON.stringify({ ...(source ? { source: data.source, subNumber: sub } : {}), seriesId: data.seriesId, year, mainNumber: next, subject: data.subject, recipients: data.recipients, recipientDepartmentIds: data.recipientDepartmentIds, externalOrganization: data.externalOrganization, signer: data.signer, confidential: data.confidential, published: data.published, documentDate: data.documentDate }), timestamp]);
    const document = await detail(connection, actor, id);
    await connection.commit();
    return { document, replayed: false };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export const issueBackdated = (db: Pool, actor: Identity, input: unknown, clock: () => Date = () => new Date()) => issue(db, actor, input, clock, true);
