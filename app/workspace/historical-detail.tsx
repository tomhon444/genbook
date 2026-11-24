import type { historyDetail } from '@/lib/issuance/history';

const originalText = (value: string | null) => value === null ? 'ไม่ทราบ' : value === '' ? 'ไม่ระบุ' : value;

export function HistoricalDetail({ document }: { document: Awaited<ReturnType<typeof historyDetail>> }) {
  return <div className="document-detail" role="region" aria-label="รายละเอียดประวัติหนังสือ"><p className="eyebrow">ประวัติจากระบบเดิม · อ่านอย่างเดียว</p><h3>{document.number}</h3><dl>
      <div><dt>รหัสรายการเดิม</dt><dd>{document.sourceId}</dd></div>
      <div><dt>เรื่อง</dt><dd className="preserve-lines">{document.subject}</dd></div>
      <div><dt>วันที่หนังสือ / ปีเลข</dt><dd>{document.documentDate} / {document.numberYear}</dd></div>
      <div><dt>ผู้ขอ / หน่วยงาน ณ วันออก</dt><dd>{document.ownerId} / {document.ownerDepartmentId}</dd></div>
      <div><dt>สถานะเดิม</dt><dd>{document.cancelled ? 'ยกเลิก' : 'ปกติ'} · {document.confidential ? 'ลับ' : 'ไม่ลับ'}</dd></div>
      <div><dt>การเผยแพร่</dt><dd>{document.published ? 'เผยแพร่ภายในคณะ' : 'ไม่เผยแพร่'}{document.confidential ? ' · ความลับจำกัดให้เฉพาะเจ้าของอ่าน' : ''}</dd></div>
      <div><dt>สถานะไฟล์แนบ</dt><dd>{document.confidential ? 'หนังสือลับ · ยกเว้น PDF' : document.pdfPending ? 'ยังไม่มี PDF ที่ตรวจรับแล้ว' : 'ยังไม่ได้ยืนยันไฟล์เดิม'} · ยังไม่ได้ตรวจย้ายไฟล์แนบเดิม</dd></div>
      {document.details && <>
        <div><dt>ผู้รับเดิม</dt><dd>{document.details.recipients.length ? <ol>{document.details.recipients.map(recipient => <li key={recipient.sourceId}><span className="preserve-lines">{originalText(recipient.text)}</span> <small>(รายการเดิม {recipient.sourceId})</small></li>)}</ol> : 'ไม่ระบุ'}</dd></div>
        <div><dt>ปลายทางเดิม</dt><dd>{document.details.destinations.length ? <ol>{document.details.destinations.map(destination => <li key={destination.sourceId}>{destination.kind === 'internal' ? 'รหัสหน่วยงานภายใน' : destination.kind === 'external' ? 'ภายนอกคณะ' : 'ไม่ทราบประเภท'}: <span className="preserve-lines">{originalText(destination.value)}</span> <small>(รายการเดิม {destination.sourceId})</small></li>)}</ol> : 'ไม่ระบุ'}</dd></div>
        <div><dt>ผู้ลงนามเดิม ({document.details.signer.kind === 'position' ? 'รหัสตำแหน่ง' : document.details.signer.kind === 'staff' ? 'รหัสบุคลากร' : 'รหัสอ้างอิงเดิม'})</dt><dd>{originalText(document.details.signer.reference)}</dd></div>
        <div><dt>ผู้บันทึกเดิม (รหัสบุคลากร)</dt><dd>{originalText(document.details.legacyActorId)}</dd></div>
        <div><dt>เวลาบันทึกตามต้นฉบับ</dt><dd>{originalText(document.details.recordedAtText)}</dd></div>
        <div><dt>เวลาแก้ไขตามต้นฉบับ</dt><dd>{originalText(document.details.updatedAtText)}</dd></div>
      </>}
    </dl>{document.details ? <p>เวลาแสดงตามที่บันทึกในระบบเดิม ยังไม่ยืนยันเขตเวลาและไม่ได้แปลงเวลา</p> : <p>ยังไม่มีรายละเอียดผู้รับ ปลายทาง และผู้ลงนามที่ตรวจรับแล้ว</p>}</div>;
}
