"use client";

import { Breadcrumbs } from '@/app/components/breadcrumbs';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { CButton } from '@coreui/react';
import type { BookDocument, HistoricalDocument } from '@/lib/genbookno/types';
import { AuditTrail, type AuditEntry } from '../audit-trail';
import { DocumentEditor } from '../document-editor';
import { PdfAttachment } from '../pdf-attachment';
import './document-page.css';

type Modern = BookDocument & { audit?: AuditEntry[] };
type Historical = HistoricalDocument;
type Document = Modern | Historical;
const original = (text: string | null) => text === null ? 'ไม่ทราบ' : text === '' ? 'ไม่ระบุ' : text;

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={wide ? 'document-record-wide' : undefined}><dt>{label}</dt><dd>{children}</dd></div>;
}

export function DocumentPage({ kind, id, snapshot, ownerId, returnTo }: {
  kind: 'legacy' | 'issuance'; id: string; snapshot: string; ownerId: string; returnTo: string;
}) {
  const router = useRouter();
  const [document, setDocument] = useState<Document | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setPending(true); setError(''); setDocument(null);
      try {
        const url = kind === 'legacy' ? `/api/history?${new URLSearchParams({ snapshot, sourceId: id })}` : `/api/issuance/${encodeURIComponent(id)}`;
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (response.status === 401) { router.replace('/login?reason=session'); return; }
        if (response.status === 404 || response.status === 403) throw new Error('ไม่พบรายการ หรือคุณไม่มีสิทธิ์อ่านหนังสือนี้');
        if (!response.ok) throw new Error('รายละเอียดหนังสือยังไม่พร้อมใช้งาน กรุณาลองใหม่');
        const data: Document = await response.json();
        if (!controller.signal.aborted) setDocument(data);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'โหลดรายละเอียดไม่สำเร็จ กรุณาลองใหม่');
      } finally { if (!controller.signal.aborted) setPending(false); }
    }
    void load();
    return () => controller.abort();
  }, [kind, id, snapshot, retry, router]);

  const legacy = document && 'sourceId' in document ? document : null;
  const modern = document && !('sourceId' in document) ? document : null;
  return <section className={'document-record-page'} aria-labelledby="document-page-heading" aria-busy={pending}>
    <Breadcrumbs backHref={returnTo} items={[{ label: 'ค้นหาหนังสือ', href: returnTo }, { label: document?.number ?? 'รายละเอียดหนังสือ' }]} />
    {!document && <h1 id="document-page-heading" className={'document-record-loadingHeading'}>รายละเอียดหนังสือ</h1>}
    {pending && <div className={'document-record-feedback'} role="status">กำลังโหลดรายละเอียดหนังสือ…</div>}
    {error && <div className={'document-record-feedback'} role="alert"><h2>ไม่สามารถเปิดรายละเอียดได้</h2><p>{error}</p><CButton type="button" color="primary" onClick={() => setRetry(value => value + 1)}>ลองใหม่</CButton></div>}
    {document && <article className={'document-record-paper'} role="region" aria-label={legacy ? 'รายละเอียดประวัติหนังสือ' : 'รายละเอียดจากผลค้นหา'}>
      <header className={'document-record-header'}>
        <div className={'document-record-badges'}><span className="x-pill x-pill-neutral">{legacy ? 'ประวัติจากระบบเดิม · อ่านอย่างเดียว' : 'หนังสือจากระบบใหม่'}</span><span className={`x-pill ${document.confidential ? 'x-pill-brand' : 'x-pill-ok'}`}><span className="x-pill-dot" />{document.confidential ? 'ลับ' : 'ไม่ลับ'}</span>{legacy?.cancelled && <span className="x-pill x-pill-stop"><span className="x-pill-dot" />ยกเลิก</span>}</div>
        <h1 id="document-page-heading">{document.number}</h1>
        <p className={'document-record-subject'}>{document.subject}</p>
      </header>
      <div className={'document-record-content'}>
        <section className={'document-record-section'} aria-labelledby="document-information"><h2 id="document-information">ข้อมูลหนังสือ</h2><dl className={'document-record-fields'}>
          <Field label="วันที่หนังสือ / ปีเลข">{document.documentDate} / {document.numberYear}</Field>
          <Field label="การเผยแพร่">{document.published ? 'เผยแพร่ภายในคณะ' : 'ไม่เผยแพร่'}{document.confidential ? ' · ความลับจำกัดให้เฉพาะเจ้าของอ่าน' : ''}</Field>
          <Field label="ผู้ขอเลข (รหัสบุคลากร)">{document.ownerId}</Field>
          <Field label="หน่วยงาน ณ วันออก">{modern ? modern.ownerDepartmentName || modern.ownerDepartmentId : legacy?.ownerDepartmentId}</Field>
          {legacy && <><Field label="รหัสรายการเดิม">{legacy.sourceId}</Field><Field label="สถานะเดิม">{legacy.cancelled ? 'ยกเลิก' : 'ปกติ'} · {legacy.confidential ? 'ลับ' : 'ไม่ลับ'}</Field></>}
          {modern && <Field label="เวลาออกเลข (Asia/Bangkok)">{new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(modern.issuedAt))}</Field>}
        </dl></section>
        {modern && <section className={'document-record-section'} aria-labelledby="document-delivery"><h2 id="document-delivery">ผู้รับและปลายทาง</h2><dl className={'document-record-fields'}><Field label="ผู้รับ" wide>{modern.recipient || 'ไม่ระบุ'}</Field><Field label="หน่วยงานรับเรื่อง">{modern.externalOrganization || modern.recipientDepartments.map(department => department.name).join(', ') || 'ไม่ระบุ'}</Field><Field label="ผู้ลงนาม">{modern.signer || 'ไม่ระบุ'}</Field></dl></section>}
        {legacy && <HistoricalInformation document={legacy} />}
        <section className={'document-record-section'} aria-labelledby="document-attachments"><h2 id="document-attachments">ไฟล์แนบ</h2>
          {modern ? <>{!modern.hasPdf && <p>{modern.confidential ? 'หนังสือลับ · ยกเว้น PDF' : 'รอแนบ PDF'}</p>}<PdfAttachment key={`${modern.id}:${modern.version}`} id={modern.id} version={modern.version} owner={modern.ownerId === ownerId && !modern.cancelled} hasPdf={modern.hasPdf} onSaved={async () => { setRetry(value => value + 1); }} /></> : <p>{legacy?.confidential ? 'หนังสือลับ · ยกเว้น PDF' : legacy?.pdfPending ? 'ยังไม่มี PDF ที่ตรวจรับแล้ว' : 'ยังไม่ได้ยืนยันไฟล์เดิม'} · ยังไม่ได้ตรวจย้ายไฟล์แนบเดิม</p>}
        </section>
        {modern && <>
          {'audit' in modern && modern.audit && <AuditTrail entries={modern.audit} />}
          {modern.ownerId === ownerId && <DocumentEditor key={modern.id} document={modern} onReload={async () => { setRetry(value => value + 1); }} onSaved={async saved => { setDocument(saved); }} />}
        </>}
      </div>
    </article>}
  </section>;
}

function HistoricalInformation({ document }: { document: Historical }) {
  const details = document.details;
  return <>
    <section className={'document-record-section'} aria-labelledby="document-delivery"><h2 id="document-delivery">ผู้รับและปลายทาง</h2>
      {!details ? <p className={'document-record-note'}>ยังไม่มีรายละเอียดผู้รับ ปลายทาง และผู้ลงนามที่ตรวจรับแล้ว</p> : <dl className={'document-record-fields'}>
        <Field label="ผู้รับเดิม" wide>{details.recipients.length ? <ol>{details.recipients.map(recipient => <li key={recipient.sourceId}>{original(recipient.text)} <small>(รายการเดิม {recipient.sourceId})</small></li>)}</ol> : 'ไม่ระบุ'}</Field>
        <Field label="ปลายทางเดิม" wide>{details.destinations.length ? <ol>{details.destinations.map(destination => <li key={destination.sourceId}>{destination.kind === 'internal' ? 'รหัสหน่วยงานภายใน' : destination.kind === 'external' ? 'ภายนอกคณะ' : 'ไม่ทราบประเภท'}: {original(destination.value)} <small>(รายการเดิม {destination.sourceId})</small></li>)}</ol> : 'ไม่ระบุ'}</Field>
        <Field label={`ผู้ลงนามเดิม (${details.signer.kind === 'position' ? 'รหัสตำแหน่ง' : details.signer.kind === 'staff' ? 'รหัสบุคลากร' : 'รหัสอ้างอิงเดิม'})`}>{original(details.signer.reference)}</Field>
      </dl>}
    </section>
    {details && <section className={'document-record-section'} aria-labelledby="document-original-record"><h2 id="document-original-record">บันทึกจากระบบเดิม</h2><dl className={'document-record-fields'}><Field label="ผู้บันทึกเดิม (รหัสบุคลากร)">{original(details.legacyActorId)}</Field><Field label="เวลาบันทึกตามต้นฉบับ">{original(details.recordedAtText)}</Field><Field label="เวลาแก้ไขตามต้นฉบับ">{original(details.updatedAtText)}</Field></dl><p className={'document-record-note'}>เวลาแสดงตามที่บันทึกในระบบเดิม ยังไม่ยืนยันเขตเวลาและไม่ได้แปลงเวลา</p></section>}
  </>;
}
