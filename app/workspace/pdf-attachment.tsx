"use client";

import { useState, type FormEvent } from 'react';
import { CButton, CForm, CFormInput, CFormLabel } from '@coreui/react';
import { PopupAlert } from '@/app/components/popup-alert';
import { PdfDownload } from './pdf-download';

export function PdfAttachment({ id, version, owner, hasPdf, onSaved }: { id: string; version: number; owner: boolean; hasPdf: boolean; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const file = new FormData(form).get('pdf');
    setError(''); setNotice('');
    if (!(file instanceof File) || !file.size) { setError('กรุณาเลือก PDF'); return; }
    if (file.size > 2097152) { setError('PDF ต้องไม่เกิน 2 MiB (2,097,152 bytes)'); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/issuance/${id}/pdf`, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'If-Match': String(version) }, body: file });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'แนบ PDF ไม่สำเร็จ');
      form.reset();
      setNotice('บันทึก PDF สำเร็จ');
      try { await onSaved(); }
      catch { setNotice('บันทึก PDF สำเร็จ แต่โหลดรายการไม่สำเร็จ กรุณาเปิดรายการอีกครั้งก่อนแนบไฟล์ใหม่'); }
    } catch (err) { setError(err instanceof Error ? err.message : 'ยังยืนยันผลไม่ได้ กรุณาเปิดรายการเพื่อตรวจสอบก่อนลองใหม่'); }
    finally { setBusy(false); }
  }
  return <div>
    {hasPdf && <p><PdfDownload id={id} /></p>}
    {owner && <CForm onSubmit={submit} aria-busy={busy}>
      <CFormLabel htmlFor="attachment-pdf">แนบ PDF</CFormLabel>
      <CFormInput id="attachment-pdf" name="pdf" type="file" accept="application/pdf,.pdf" required disabled={busy} aria-describedby="pdf-help" />
      <p id="pdf-help">ไม่เกิน 2 MiB · ไม่รับไฟล์เสียหรือเข้ารหัส {hasPdf ? 'ไฟล์ใหม่จะใช้แทนไฟล์ปัจจุบันเมื่อบันทึกสำเร็จ' : ''}</p>
      <CButton type="submit" color="primary" disabled={busy}>{busy ? 'กำลังแนบ PDF…' : 'บันทึก PDF'}</CButton>
    </CForm>}
    {error && <PopupAlert color="danger" role="alert" onClose={() => setError('')}>{error} <CButton type="button" color="link" onClick={async () => { setError(''); try { await onSaved(); } catch { setError('โหลดรายการไม่สำเร็จ กรุณาลองอีกครั้ง'); } }}>เปิดรายการอีกครั้ง</CButton></PopupAlert>}
    {notice && <PopupAlert color="success" role="status" onClose={() => setNotice('')}>{notice}</PopupAlert>}
  </div>;
}
