"use client";

import { useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CButton, CForm, CFormCheck, CFormInput, CFormLabel, CFormSelect, CFormTextarea } from '@coreui/react';
import { PopupAlert } from '@/app/components/popup-alert';
import type { BookDocument } from '@/lib/genbookno/types';

type Document = BookDocument;
export function DocumentEditor({ document, onSaved, onReload }: { document: Document; onSaved: (document: Document) => Promise<void>; onReload: () => Promise<void> }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reloadRequired, setReloadRequired] = useState(false);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [target, setTarget] = useState('external');
  const [baseVersion, setBaseVersion] = useState(document.version);
  const [cancelling, setCancelling] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const prefix = `edit-${useId()}`;
  async function begin() {
    setBusy(true); setError(''); setNotice(''); setReloadRequired(false);
    try {
      const response = await fetch('/api/issuance', { cache: 'no-store' });
      if (response.status === 401) { router.replace('/login?reason=session'); throw new Error('กรุณาเข้าสู่ระบบใหม่'); }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'โหลดหน่วยงานไม่สำเร็จ กรุณาลองใหม่');
      const choices = new Map<string, { id: string; name: string }>();
      for (const department of [...document.recipientDepartments, ...data.departments]) choices.set(department.id, department);
      setDepartments([...choices.values()]); setTarget(document.externalOrganization ? 'external' : 'internal'); setBaseVersion(document.version); setEditing(true);
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('input')?.focus());
    } catch (error) { setError(error instanceof Error ? error.message : 'เชื่อมต่อไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true); setError(''); setNotice('');
    try { await onReload(); setEditing(false); setReloadRequired(false); setNotice('โหลดข้อมูลล่าสุดแล้ว กรุณาเริ่มแก้ไขอีกครั้ง'); }
    catch { setError('โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาลองใหม่'); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || reloadRequired) return;
    const form = new FormData(event.currentTarget);
    const data = { version: baseVersion, subject: String(form.get('subject')), recipient: String(form.get('recipient')), signer: String(form.get('signer')), recipientDepartmentIds: target === 'internal' ? form.getAll('recipientDepartmentIds').map(String) : [], externalOrganization: target === 'external' ? String(form.get('externalOrganization')) : '', confidential: form.get('confidential') === 'on', published: form.get('published') === 'on' };
    setBusy(true); setError(''); setNotice('');
    let reloadNeeded = true;
    try {
      const response = await fetch(`/api/issuance/${document.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (response.status === 401) { router.replace('/login?reason=session'); throw new Error('กรุณาเข้าสู่ระบบใหม่'); }
      if (response.status === 409 || response.status >= 500) setReloadRequired(true);
      const result = await response.json();
      reloadNeeded = response.status === 409 || response.status >= 500;
      if (!response.ok) throw new Error(result.error || 'แก้ไขไม่สำเร็จ กรุณาโหลดข้อมูลล่าสุด');
      setEditing(false); setNotice('บันทึกการแก้ไขสำเร็จ');
      try { await onSaved(result); }
      catch { setReloadRequired(true); setNotice('บันทึกการแก้ไขสำเร็จ แต่โหลดรายการไม่สำเร็จ กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไขอีกครั้ง'); }
    } catch (error) { setReloadRequired(reloadNeeded); setError(error instanceof Error ? error.message : 'ยังยืนยันผลไม่ได้ กรุณาโหลดข้อมูลล่าสุด'); }
    finally { setBusy(false); }
  }
  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || reloadRequired) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (!window.confirm(`ยืนยันยกเลิกเลข ${document.number}? เลขที่ยกเลิกจะไม่ถูกนำกลับมาใช้`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/issuance/${document.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: document.version, reason }) });
      if (response.status === 401) { router.replace('/login?reason=session'); throw new Error('กรุณาเข้าสู่ระบบใหม่'); }
      if (response.status === 409 || response.status >= 500) setReloadRequired(true);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'ยกเลิกไม่สำเร็จ กรุณาโหลดข้อมูลล่าสุด');
      setCancelling(false); setNotice('ยกเลิกเลขหนังสือแล้ว');
      try { await onSaved(result); } catch { setReloadRequired(true); }
    } catch (error) { setError(error instanceof Error ? error.message : 'ยังยืนยันผลไม่ได้ กรุณาโหลดข้อมูลล่าสุด'); }
    finally { setBusy(false); }
  }
  if (document.cancelled) return <section className="document-editor" aria-label="สถานะการยกเลิก">
    <h4>หนังสือนี้ถูกยกเลิกแล้ว</h4><p>เหตุผล: {document.cancelReason || '-'} · เลขนี้จะไม่ถูกนำกลับมาใช้ และแก้ไขหรือแนบ PDF ไม่ได้</p>
    {notice && <PopupAlert color="success" role="status" onClose={() => setNotice('')}>{notice}</PopupAlert>}
  </section>;
  return <section className="document-editor" aria-label="แก้ไขข้อมูลหนังสือ">
    <h4>แก้ไขข้อมูลหนังสือ</h4><p>คงเลข เจ้าของ ชุดเลข ปี และวันเวลาเดิม · version {editing ? baseVersion : document.version}</p>
    {!editing ? <CButton color="secondary" variant="outline" type="button" disabled={busy || reloadRequired} onClick={begin}>แก้ไขข้อมูล</CButton> : <CForm ref={formRef} onSubmit={submit} aria-busy={busy}><fieldset disabled={busy || reloadRequired}>
      <div className="form-field"><CFormLabel htmlFor={`${prefix}-subject`}>แก้ไขเรื่อง</CFormLabel><CFormInput id={`${prefix}-subject`} name="subject" defaultValue={document.subject} required maxLength={500} /></div>
      <div className="form-field"><CFormLabel htmlFor={`${prefix}-recipient`}>แก้ไขผู้รับ (หนึ่งคนต่อบรรทัด)</CFormLabel><CFormTextarea id={`${prefix}-recipient`} name="recipient" defaultValue={document.recipient} required maxLength={3000} rows={3} /></div>
      <div className="form-field"><CFormLabel htmlFor={`${prefix}-target`}>แก้ไขปลายทางหนังสือ</CFormLabel><CFormSelect id={`${prefix}-target`} value={target} onChange={event => setTarget(event.target.value)}><option value="external">ภายนอกคณะ</option><option value="internal">ภายในคณะ</option></CFormSelect></div>
      {target === 'external' ? <div className="form-field"><CFormLabel htmlFor={`${prefix}-external`}>แก้ไขหน่วยงานภายนอก</CFormLabel><CFormInput id={`${prefix}-external`} name="externalOrganization" defaultValue={document.externalOrganization} required maxLength={500} /></div> : <div className="form-field"><CFormLabel htmlFor={`${prefix}-departments`}>แก้ไขหน่วยงานรับเรื่องภายใน</CFormLabel><CFormSelect id={`${prefix}-departments`} name="recipientDepartmentIds" multiple htmlSize={4} defaultValue={document.recipientDepartmentIds} required>{departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</CFormSelect><small>คงหน่วยงานเดิมที่ปิดใช้แล้วได้ ใช้ Ctrl หรือ Command เพื่อเลือกหลายรายการบนคอมพิวเตอร์</small></div>}
      <div className="form-field"><CFormLabel htmlFor={`${prefix}-signer`}>แก้ไขผู้ลงนาม</CFormLabel><CFormInput id={`${prefix}-signer`} name="signer" defaultValue={document.signer} maxLength={40} pattern="(position:[0-9]{1,11}|[A-Za-z0-9_\-]{1,20})" title="รหัสบุคลากร หรือ position:รหัสตำแหน่ง" /></div>
      <div className="form-field"><CFormCheck id={`${prefix}-confidential`} name="confidential" label="แก้ไขเป็นหนังสือลับ" defaultChecked={document.confidential} /><CFormCheck id={`${prefix}-published`} name="published" label="แก้ไขการเผยแพร่ภายในคณะ" defaultChecked={document.published} /><small>ลับอ่านได้เฉพาะเจ้าของแม้เลือกเผยแพร่ เปลี่ยนเป็นไม่ลับโดยไม่มี PDF จะค้างไฟล์และขอเลขครั้งถัดไปไม่ได้จนแนบครบ</small></div>
      <CButton type="submit" color="primary">บันทึกการแก้ไข</CButton>{' '}<CButton type="button" color="secondary" variant="outline" onClick={() => { setEditing(false); setError(''); }}>ยกเลิกการแก้ไข</CButton>
    </fieldset></CForm>}
    {!editing && (!cancelling ? <>{' '}<CButton color="danger" variant="outline" type="button" disabled={busy || reloadRequired} onClick={() => setCancelling(true)}>ยกเลิกเลขหนังสือ</CButton></> : <CForm onSubmit={cancel} aria-busy={busy} className="mt-3"><fieldset disabled={busy || reloadRequired}>
      <div className="form-field"><CFormLabel htmlFor={`${prefix}-reason`}>เหตุผลการขอยกเลิก</CFormLabel><CFormTextarea id={`${prefix}-reason`} name="reason" required maxLength={500} rows={2} /></div>
      <CButton type="submit" color="danger">ยืนยันยกเลิกเลข</CButton>{' '}<CButton type="button" color="secondary" variant="outline" onClick={() => setCancelling(false)}>ไม่ยกเลิก</CButton>
    </fieldset></CForm>)}
    {busy && <p role="status">กำลังดำเนินการแก้ไข…</p>}
    {error && <PopupAlert color="danger" role="alert" onClose={() => setError('')}>{error}</PopupAlert>}
    {notice && <PopupAlert color="success" role="status" onClose={() => setNotice('')}>{notice}</PopupAlert>}
    {reloadRequired && <CButton type="button" color="primary" variant="outline" disabled={busy} onClick={reload}>โหลดข้อมูลล่าสุดเพื่อแก้ไข</CButton>}
  </section>;
}
