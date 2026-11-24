"use client";

export type AuditEntry = { actorId: string; event: string; createdAt: string; details: unknown };
const labels: Record<string, string> = { subject: 'เรื่อง', recipients: 'ผู้รับ', recipientDepartmentIds: 'รหัสหน่วยงานรับเรื่อง', externalOrganization: 'หน่วยงานภายนอก', signer: 'ผู้ลงนาม', confidential: 'ความลับ', published: 'เผยแพร่ภายในคณะ', sha256: 'SHA-256 ของ PDF', bytes: 'ขนาด PDF (bytes)', version: 'version' };
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function display(value: unknown, field: string) {
  if (field === 'confidential') return value ? 'ลับ' : 'ไม่ลับ';
  if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่ใช่';
  if (Array.isArray(value)) return value.join('\n') || '—';
  return value == null || value === '' ? '—' : String(value);
}
export function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  return <section className="audit-trail" aria-label="ประวัติของหนังสือ"><h4>ประวัติของหนังสือ</h4><ol>{entries.map((entry, index) => {
    const data = record(entry.details);
    const pdf = entry.event === 'pdf_attached' || entry.event === 'pdf_replaced';
    const before = pdf ? { sha256: data.previousSha256, bytes: data.previousBytes, version: data.previousVersion } : record(data.before);
    const after = pdf ? { sha256: data.sha256, bytes: data.bytes, version: data.version } : record(data.after);
    const changed = Object.keys(labels).filter(key => Object.hasOwn(after, key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    const title = ({ issued: 'บันทึกและออกเลขหนังสือ', issued_backdated: 'บันทึกและออกเลขย้อนหลัง', amended: 'แก้ไขข้อมูลหนังสือ', pdf_attached: 'แนบ PDF', pdf_replaced: 'เปลี่ยน PDF' } as Record<string, string>)[entry.event] ?? entry.event;
    return <li key={index}><p><strong>{title}</strong> · ผู้ดำเนินการ {entry.actorId} · <time dateTime={entry.createdAt}>{new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(entry.createdAt))}</time> (Asia/Bangkok)</p>
      {entry.event === 'amended' && <p>version {String(data.previousVersion)} → {String(data.version)}{changed.length === 0 ? ' · บันทึกโดยไม่มีการเปลี่ยนค่า' : ''}</p>}
      {changed.length > 0 && <details><summary>ดูค่าก่อนและหลัง ({changed.length} ฟิลด์)</summary>{changed.map(key => <div className="audit-change" key={key}><h5>{labels[key]}</h5><dl><div><dt>ก่อนแก้ไข</dt><dd className="preserve-lines">{display(before[key], key)}</dd></div><div><dt>หลังแก้ไข</dt><dd className="preserve-lines">{display(after[key], key)}</dd></div></dl></div>)}</details>}
    </li>;
  })}</ol></section>;
}
