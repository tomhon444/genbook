import { hash } from './dump.mjs';

// Synthetic data only; duplicate and canceled numbers are deliberate.
export function fixture() {
  const document = { sourceId: '1', ownerId: 'TEST-001', departmentId: '204', seriesId: 'TEST-S1', year: 2569, main: 42, sub: 0, prefix: 'ทดสอบ 001', subject: 'ประวัติจำลองภายใน', documentDate: '2026-11-01', confidential: false, published: false, cancelled: false, pdfPending: false };
  return { sourceSha256: hash('synthetic-t12-fixture-v1'), reviewedBy: 'synthetic-test-reviewer', documents: [
    document,
    { ...document, sourceId: '2', subject: 'ประวัติจำลองเลขซ้ำ' },
    { ...document, sourceId: '3', main: 70, sub: 1, cancelled: true, subject: 'ประวัติจำลองยกเลิก' },
    { ...document, sourceId: '4', main: 41, confidential: true, published: true, subject: 'ประวัติจำลองลับ' },
    { ...document, sourceId: '5', main: 40, published: true, subject: 'ประวัติจำลองเผยแพร่' },
  ] };
}
