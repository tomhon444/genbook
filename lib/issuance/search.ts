import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Identity } from '../auth/server';
import { IssuanceError } from './input';

const fields = { q: 200, year: 4, type: 100, number: 100, from: 10, to: 10, subject: 200, requester: 64, page: 5, pageSize: 3, sort: 12, direction: 4 };
const sortColumns = {
  number: ['d.number_year', 'd.prefix', 'd.main_number', 'd.sub_number'],
  documentDate: ['d.document_date'], subject: ['d.subject'], ownerId: ['d.owner_id'], type: ['s.document_type'],
} as const;
const defaultOrder = 'd.document_date DESC,d.number_year DESC,d.series_id,d.main_number DESC,d.sub_number DESC,d.kind,d.snapshot,d.id';
export function parseSearch(params: URLSearchParams) {
  const input: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!Object.hasOwn(fields, key) || params.getAll(key).length !== 1 || value.length > fields[key as keyof typeof fields]) throw new IssuanceError(400, 'ตัวกรองไม่ถูกต้องหรือยาวเกินกำหนด');
    input[key] = value.trim();
  }
  const { q = '', year = '', type = '', number = '', from = '', to = '', subject = '', requester = '', page = '1', pageSize = '20', sort = '', direction = '' } = input;
  if (!['20', '50', '100'].includes(pageSize)) throw new IssuanceError(400, 'จำนวนรายการต่อหน้าไม่ถูกต้อง');
  if ((sort || direction) && (!Object.hasOwn(sortColumns, sort) || !['asc', 'desc'].includes(direction))) throw new IssuanceError(400, 'การเรียงข้อมูลไม่ถูกต้อง');
  if ((year && !/^[1-9]\d{3}$/.test(year)) || !/^[1-9]\d{0,4}$/.test(page) || Number(page) > 10000) throw new IssuanceError(400, 'ปีเลขหรือหน้าไม่ถูกต้อง');
  for (const date of [from, to]) {
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date < '1000-01-01')) throw new IssuanceError(400, 'วันที่ไม่ถูกต้อง');
  }
  if (from && to && from > to) throw new IssuanceError(400, 'วันเริ่มต้องไม่เกินวันสิ้นสุด');
  return { q, year, type, number, from, to, subject, requester, page: Number(page), pageSize: Number(pageSize), sort, direction };
}

// Only normalized, readable history participates. Do not join grants: permission
// to issue in a series is independent of permission to read its documents.
const source = `(
  SELECT 'issuance' kind,'' snapshot,id,series_id,number_year,main_number,sub_number,prefix,document_date,subject,owner_id,owner_department_id,confidential,published FROM issuance_documents
  UNION ALL
  SELECT 'legacy' kind,source_sha256 snapshot,source_id id,series_id,number_year,main_number,sub_number,prefix,document_date,subject,owner_id,owner_department_id,confidential,published FROM legacy_documents
) d JOIN issuance_series s ON s.id=d.series_id`;
const readable = '(d.owner_id=? OR (d.confidential=0 AND (d.published=1 OR d.owner_department_id=?)))';
const numberSql = "CONCAT(d.prefix,'/',LPAD(d.main_number,GREATEST(4,LENGTH(d.main_number)),'0'),IF(d.sub_number=0,'',CONCAT('.',d.sub_number)))";

export async function searchDocuments(db: Pool, actor: Identity, params: URLSearchParams) {
  const filter = parseSearch(params);
  // SQL identifiers and direction come only from these validated allowlists.
  const order = filter.sort ? `${sortColumns[filter.sort as keyof typeof sortColumns].map(column => `${column} ${filter.direction === 'asc' ? 'ASC' : 'DESC'}`).join(',')},${defaultOrder}` : defaultOrder;
  const conditions = [readable];
  const values: (string | number)[] = [actor.staffId, actor.departmentId];
  for (const [value, condition] of [
    [filter.year, 'd.number_year=?'], [filter.type, 's.document_type=?'],
    [filter.number, `LOCATE(?,${numberSql})>0`], [filter.from, 'd.document_date>=?'],
    [filter.to, 'd.document_date<=?'], [filter.subject, 'LOCATE(?,d.subject)>0'],
    [filter.requester, 'd.owner_id=?'],
  ]) {
    if (value) { conditions.push(condition); values.push(value); }
  }
  if (filter.q) {
    conditions.push(`(LOCATE(?,${numberSql})>0 OR LOCATE(?,d.subject)>0)`);
    values.push(filter.q, filter.q);
  }
  const where = conditions.join(' AND ');
  const connection = await db.getConnection();
  try {
    // Count, page, type and year choices describe the same database snapshot.
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.beginTransaction();
    const [counts] = await connection.execute<RowDataPacket[]>(`SELECT COUNT(*) total FROM ${source} WHERE ${where}`, values);
    const [documents] = await connection.query<RowDataPacket[]>(`SELECT d.*,s.document_type,${numberSql} number FROM ${source} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, [...values, filter.pageSize, (filter.page - 1) * filter.pageSize]);
    const [types] = await connection.execute<RowDataPacket[]>(`SELECT DISTINCT s.document_type FROM ${source} WHERE ${readable} ORDER BY s.document_type`, [actor.staffId, actor.departmentId]);
    const [years] = await connection.execute<RowDataPacket[]>(`SELECT DISTINCT d.number_year FROM ${source} WHERE ${readable} ORDER BY d.number_year DESC`, [actor.staffId, actor.departmentId]);
    await connection.commit();
    const total = Number(counts[0].total);
    return { documents: documents.map(row => ({ kind: String(row.kind), snapshot: String(row.snapshot), id: String(row.id), number: String(row.number), numberYear: Number(row.number_year), type: String(row.document_type), subject: String(row.subject), documentDate: String(row.document_date), ownerId: String(row.owner_id) })), total, page: filter.page, pageSize: filter.pageSize, hasMore: filter.page * filter.pageSize < total, types: types.map(row => String(row.document_type)), years: years.map(row => Number(row.number_year)) };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
