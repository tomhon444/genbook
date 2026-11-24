import { createHash } from 'node:crypto';

export class IssuanceError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function bangkokNow(now = new Date()) {
  const local = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return { today: local.toISOString().slice(0, 10), seconds: local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds(), year: local.getUTCFullYear() + 543 };
}

export type BackdatedSource = { kind: 'issuance'; id: string } | { kind: 'legacy'; snapshot: string; id: string };
export function parseSource(value: unknown): BackdatedSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IssuanceError(400, 'กรุณาเลือกหนังสือต้นทาง');
  const source = value as Record<string, unknown>;
  if (source.kind === 'issuance' && Object.keys(source).length === 2 && typeof source.id === 'string' && /^[a-f0-9-]{36}$/.test(source.id)) return { kind: 'issuance', id: source.id };
  if (source.kind === 'legacy' && Object.keys(source).length === 3 && typeof source.snapshot === 'string' && /^[a-f0-9]{64}$/.test(source.snapshot) && typeof source.id === 'string' && /^[\w-]{1,64}$/.test(source.id)) return { kind: 'legacy', snapshot: source.snapshot, id: source.id };
  throw new IssuanceError(400, 'หนังสือต้นทางไม่ถูกต้อง');
}

export function parseContent(body: Record<string, unknown>) {
  const field = (key: string, max: number, optional = false) => {
    const value = body[key];
    if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) throw new IssuanceError(400, 'กรุณากรอกข้อมูลหนังสือให้ครบถ้วน');
    return value.trim();
  };
  const subject = field('subject', 500);
  const recipients = field('recipient', 3000).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (!recipients.length || recipients.length > 20 || recipients.some((item) => item.length > 200)) throw new IssuanceError(400, 'ข้อมูลผู้รับไม่ถูกต้อง');
  const signer = field('signer', 200);
  const externalOrganization = field('externalOrganization', 500, true);
  if (!Array.isArray(body.recipientDepartmentIds) || body.recipientDepartmentIds.length > 20 || body.recipientDepartmentIds.some((id) => typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id))) throw new IssuanceError(400, 'ข้อมูลหน่วยงานรับเรื่องไม่ถูกต้อง');
  const recipientDepartmentIds = [...new Set(body.recipientDepartmentIds as string[])].sort();
  if (Boolean(externalOrganization) === Boolean(recipientDepartmentIds.length)) throw new IssuanceError(400, 'กรุณาระบุหน่วยงานรับเรื่องภายในหรือภายนอกอย่างใดอย่างหนึ่ง');
  if (typeof body.confidential !== 'boolean') throw new IssuanceError(400, 'ความลับไม่ถูกต้อง');
  if (body.published !== undefined && typeof body.published !== 'boolean') throw new IssuanceError(400, 'ข้อมูลการเผยแพร่ไม่ถูกต้อง');
  return { subject, recipients, signer, externalOrganization, recipientDepartmentIds, confidential: body.confidential, published: body.published ?? false };
}

export function parseInput(value: unknown, backdated = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IssuanceError(400, 'ข้อมูลไม่ถูกต้อง');
  const body = value as Record<string, unknown>;
  const allowed = ['requestId', 'seriesId', 'subject', 'recipient', 'recipientDepartmentIds', 'externalOrganization', 'signer', 'confidential', 'published', 'documentDate'];
  if (backdated) allowed.push('source');
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new IssuanceError(400, 'มีข้อมูลที่ไม่อนุญาตให้กำหนด');
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId) || String(body.requestId).length > 36) throw new IssuanceError(400, 'รหัสคำขอไม่ถูกต้อง');
  if (typeof body.seriesId !== 'string' || !body.seriesId.trim() || body.seriesId.length > 32) throw new IssuanceError(400, 'ชุดเลขไม่ถูกต้อง');
  const seriesId = body.seriesId.trim();
  const content = parseContent(body);
  if (typeof body.documentDate !== 'string' || body.documentDate.length > 10) throw new IssuanceError(400, 'วันที่ไม่ถูกต้อง');
  const documentDate = body.documentDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(documentDate) || Number.isNaN(Date.parse(documentDate)) || new Date(documentDate).toISOString().slice(0, 10) !== documentDate) throw new IssuanceError(400, 'วันที่ไม่ถูกต้อง');
  const source = backdated ? parseSource(body.source) : null;
  // Preserve T05/T06 payload key order, including both historical retry hashes.
  const { subject, recipients, signer, externalOrganization, recipientDepartmentIds, confidential, published } = content;
  const data = { seriesId, subject, recipients, signer, externalOrganization, recipientDepartmentIds, documentDate, confidential, published, ...(source ? { source } : {}) };
  // T05 stored the same normalized payload without a publication field. Keep
  // committed retries compatible, only for the original unpublished state.
  const { published: publication, ...legacyData } = data;
  const legacyPayloadHash = publication || backdated ? null : createHash('sha256').update(JSON.stringify(legacyData)).digest('hex');
  return { ...data, requestId, payloadHash: createHash('sha256').update(JSON.stringify(data)).digest('hex'), legacyPayloadHash };
}
