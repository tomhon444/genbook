"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CButton, CForm, CFormInput, CFormLabel, CFormSelect, CFormTextarea, CSpinner } from "@coreui/react";
import CIcon from "@coreui/icons-react";
import { cilBolt, cilCheckAlt, cilDescription, cilLockLocked, cilLowVision, cilPlus, cilTrash } from "@coreui/icons";
import { PopupAlert } from "@/app/components/popup-alert";

import { PdfAttachment } from "./pdf-attachment";
import { AuditTrail, type AuditEntry } from "./audit-trail";
import { DocumentEditor } from "./document-editor";

type Series = { id: string; label: string; prefix: string };
type Document = import('@/lib/genbookno/types').BookDocument & { audit?: AuditEntry[] };
type Overview = { series: Series[]; documents: Document[]; sharedDocuments: Document[]; today: string; departments: { id: string; name: string }[]; positions?: { id: string; name: string }[]; readOnly?: boolean; legacyTotal?: number };
type SourceOption = { source: { kind: 'issuance'; id: string } | { kind: 'legacy'; snapshot: string; id: string }; seriesId: string; number: string; numberYear: number; subject: string; documentDate: string };

const MAX_RECIPIENTS = 20;

/** Formats a YYYY-MM-DD business date in Thai (Asia/Bangkok); falls back to the raw value. */
function thaiDate(value: string | undefined, style: "full" | "long") {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: style, timeZone: "Asia/Bangkok" }).format(date);
}

function readerText(published: boolean, confidential: boolean) {
  if (confidential) return "เฉพาะเจ้าของ";
  return published ? "บุคลากรในคณะ" : "เจ้าของและบุคลากรหน่วยงานเดียวกัน";
}

/** Segmented choice rendered as native radios so keyboard and form semantics stay intact. */
function Choice({ name, options, value, onChange, label }: { name: string; label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <div className="issuance-choice" role="radiogroup" aria-label={label}>
    {options.map(option => <label key={option.value} className="issuance-choice-item">
      <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
      <span>{option.label}</span>
    </label>)}
  </div>;
}

function Step({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  const id = `issuance-step-${index}`;
  return <section className="issuance-card issuance-step" aria-labelledby={id}>
    <h3 id={id} className="issuance-step-title"><span className="issuance-step-no" aria-hidden="true">{index}</span>{title}</h3>
    {children}
  </section>;
}

export function IssuancePanel({ ownerId, displayName }: { ownerId: string; displayName?: string }) {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selected, setSelected] = useState<Document | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [successPopup, setSuccessPopup] = useState(false);
  const [target, setTarget] = useState("external");
  const [mode, setMode] = useState('normal');
  const [published, setPublished] = useState(false);
  const [confidential, setConfidential] = useState(false);
  const [chosenSeries, setChosenSeries] = useState('');
  const [recipients, setRecipients] = useState([{ id: 0, value: '' }]);
  const nextRecipientId = useRef(1);
  const seriesId = overview?.series.length === 1 ? overview.series[0].id : chosenSeries;
  const [sourceDate, setSourceDate] = useState('');
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [source, setSource] = useState<SourceOption | null>(null);
  const [sourcePage, setSourcePage] = useState(1);
  const [hasMoreSources, setHasMoreSources] = useState(false);
  const requestRef = useRef<{ id: string; payload: string } | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const storageKey = `genbook-issuance-${ownerId}`;

  useEffect(() => { if (selected && !successPopup) detailRef.current?.focus(); }, [selected, successPopup]);

  async function readResponse(response: Response) {
    if (response.status === 401) { router.replace("/login?reason=session"); throw new Error("กรุณาเข้าสู่ระบบใหม่"); }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "ไม่สามารถดำเนินการได้ กรุณาลองใหม่");
    return body;
  }

  async function load() {
    setLoading(true); setError(""); setNotice(""); setSuccessPopup(false);
    try { setOverview(await readResponse(await fetch("/api/issuance", { cache: "no-store" }))); }
    catch (err) { setError(err instanceof Error ? err.message : "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่"); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    void fetch("/api/issuance", { cache: "no-store" }).then(readResponse)
      .then(data => { if (active) setOverview(data); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function changeMode(next: string) {
    setMode(next); setSource(null); setSources([]); setHasMoreSources(false); setError('');
  }

  /** Runs on the form's reset event (the clear button and after a successful issue). */
  function resetState() {
    setTarget("external"); setPublished(false); setConfidential(false);
    setRecipients([{ id: nextRecipientId.current++, value: '' }]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !overview) return;
    if (mode === 'backdated' && !source) { setError('กรุณาค้นหาและเลือกหนังสือต้นทาง'); return; }
    const recipient = recipients.map(row => row.value.trim()).filter(Boolean).join('\n');
    if (!recipient || recipient.length > 3000) { setError('กรุณาระบุผู้รับ โดยรวมไม่เกิน 3,000 ตัวอักษร'); return; }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      seriesId: mode === 'backdated' ? source!.seriesId : String(form.get("seriesId")), subject: String(form.get("subject")).trim(),
      recipient, signer: String(form.get("signer")).trim(),
      recipientDepartmentIds: target === "internal" ? form.getAll("recipientDepartmentIds").map(String) : [], externalOrganization: target === "external" ? String(form.get("externalOrganization")).trim() : "",
      // Omit the default publication value to preserve saved T05 retry fingerprints.
      confidential: form.get("confidential") === "on", ...(form.get("published") === "on" ? { published: true } : {}), documentDate: mode === 'backdated' ? source!.documentDate : overview.today,
      ...(mode === 'backdated' ? { source: source!.source } : {}),
    };
    setPending(true); setError(""); setNotice(""); setSuccess(false); setSuccessPopup(false);
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
      const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      // Persist only a fingerprint/key, so a reload after a lost response can
      // retry the same data without storing the document's contents.
      if (!requestRef.current) {
        try { requestRef.current = JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch { /* Storage may be unavailable. */ }
      }
      if (requestRef.current?.payload !== fingerprint) requestRef.current = { id: crypto.randomUUID(), payload: fingerprint };
      try { sessionStorage.setItem(storageKey, JSON.stringify(requestRef.current)); } catch { /* In-memory retry remains available. */ }
      const result = await readResponse(await fetch(mode === 'backdated' ? '/api/backdated' : '/api/issuance', { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId: requestRef.current!.id }) }));
      const document: Document = result.document ?? result;
      setSelected(document); setSuccess(true); setSuccessPopup(true); requestRef.current = null;
      try { sessionStorage.removeItem(storageKey); } catch { /* No document contents were stored. */ }
      formElement.reset(); resetState();
      try {
        const updated = await readResponse(await fetch("/api/issuance", { cache: "no-store" }));
        setOverview(updated);
      } catch {
        setNotice("ออกเลขสำเร็จแล้ว แต่โหลดรายการล่าสุดไม่สำเร็จ กรุณาโหลดรายการอีกครั้ง");
      }
    } catch (err) { setError(err instanceof Error ? err.message : "ยังยืนยันผลไม่ได้ กรุณาส่งข้อมูลเดิมซ้ำเพื่อตรวจสอบผล"); }
    finally { setPending(false); }
  }

  async function findSources(page = 1) {
    if (!sourceDate) { setError('กรุณาเลือกวันที่หนังสือย้อนหลัง'); return; }
    setPending(true); setError(''); setSource(null); setSources([]); setHasMoreSources(false);
    try {
      const result = await readResponse(await fetch(`/api/backdated?date=${encodeURIComponent(sourceDate)}&page=${page}`, { cache: 'no-store' }));
      setSources(result.sources); setSourcePage(result.page); setHasMoreSources(result.hasMore);
      if (!result.sources.length) setError('ไม่พบต้นทางที่ใช้ได้ในวันที่เลือก ไม่สามารถเติมเลขว่างได้');
    } catch (err) { setError(err instanceof Error ? err.message : 'ค้นหาต้นทางไม่สำเร็จ'); }
    finally { setPending(false); }
  }

  const series = overview?.series.find(item => item.id === (mode === 'backdated' && source ? source.seriesId : seriesId));
  const documentDate = mode === 'backdated' ? source?.documentDate : overview?.today;
  const recipientCount = recipients.filter(row => row.value.trim()).length;
  const previewNumber = mode === 'backdated' ? (source ? `${source.number}/…` : "—") : series ? `${series.prefix}/····` : "—";
  const disabled = pending || !overview || overview.series.length === 0;

  return <section className="issuance-section" aria-labelledby="issuance-heading">
    <header className="issuance-head">
      <div><p className="issuance-eyebrow">งานหนังสือของคุณ</p><h2 id="issuance-heading">ขอเลขหนังสือ</h2><p className="issuance-lead">{overview?.readOnly ? 'อ่านหนังสือเดิมตามสิทธิ์' : 'กรอกข้อมูลให้ครบ ระบบจะออกเลขให้ทันทีเมื่อยืนยัน'}</p></div>
      {!overview?.readOnly && <div className="issuance-head-tags"><span className="issuance-tag"><CIcon icon={cilBolt} size="sm" aria-hidden="true" />ออกเลขทันที</span><span className="issuance-tag"><CIcon icon={cilLockLocked} size="sm" aria-hidden="true" />อ่านตามสิทธิ์หนังสือ</span></div>}
    </header>
    {error && <PopupAlert color="danger" role="alert" onClose={() => setError("")}>{error}</PopupAlert>}
    {pending && <p className="issuance-pending" role="status" aria-live="polite"><CSpinner as="span" size="sm" /> กำลังดำเนินการ…</p>}
    {notice && <PopupAlert color="warning" role="status" onClose={() => { setNotice(""); setSuccessPopup(false); }}>{notice} <CButton type="button" color="link" onClick={load}>โหลดรายการอีกครั้ง</CButton></PopupAlert>}
    {successPopup && selected && !pending && !notice && !error && <PopupAlert color="success" role="status" onClose={() => setSuccessPopup(false)}>ออกเลขสำเร็จ <strong>{selected.number}</strong><p>ตรวจสอบรายละเอียดและแนบ PDF ได้ด้านล่าง</p></PopupAlert>}
    {loading ? <div role="status"><CSpinner as="span" size="sm" /> กำลังโหลดชุดเลขและรายการ…</div> : !overview ? <CButton color="primary" onClick={load}>ลองโหลดอีกครั้ง</CButton> : overview.readOnly
      ? <div className="issuance-card"><p role="status">เชื่อมข้อมูลหนังสือเดิมแล้ว อ่านหนังสือที่คุณมีสิทธิ์ได้ {overview.legacyTotal?.toLocaleString('th-TH') ?? 'ตามรายการค้นหา'} รายการ</p><p>การขอเลขใหม่และแก้ไขข้อมูลยังไม่เปิดใช้งาน</p><a href="/workspace">ไปหน้าค้นหาหนังสือ</a></div>
      : <>
        {overview.series.length === 0 && <p className="alert alert-warning" role="status">ยังไม่มีชุดเลขที่ได้รับสิทธิ์ กรุณาติดต่อผู้ดูแลระบบ</p>}
        <CForm onSubmit={submit} onReset={resetState} aria-busy={pending}>
          <fieldset className="issuance-grid issuance-layout" disabled={disabled}>
            <div className="issuance-steps">
              <Step index={1} title="ชุดเลขและวันที่">
                <div className="issuance-row">
                  <div className="form-field"><CFormLabel htmlFor="seriesId">เลขหนังสือ</CFormLabel><CFormSelect id="seriesId" name="seriesId" required value={seriesId} onChange={event => { setChosenSeries(event.target.value); setSource(null); }}><option value="" disabled>เลือกชุดเลขที่ได้รับสิทธิ์</option>{overview.series.map(item => <option key={item.id} value={item.id}>{item.label} · {item.prefix}</option>)}</CFormSelect><small>แสดงเฉพาะชุดเลขที่คุณได้รับสิทธิ์</small></div>
                  <div className="form-field"><span className="form-label">วิธีขอเลข</span><Choice name="mode" label="วิธีขอเลข" value={mode} onChange={changeMode} options={[{ value: 'normal', label: 'วันที่ปัจจุบัน' }, { value: 'backdated', label: 'ย้อนหลัง' }]} /></div>
                </div>
                {mode === 'backdated' && <div className="issuance-backdated">
                  <p>เลือกต้นทางที่อ่านได้ในชุดเลขที่คุณใช้ได้ ระบบคงชุด ปี วันที่ และเลขหลักเดิม แล้วเพิ่มเลขย่อย ไม่ต้องรออนุมัติ เลขหนังสือด้านบนจะตรงกับชุดของต้นทางที่เลือก</p>
                  <div className="issuance-row issuance-row--end">
                    <div className="form-field"><CFormLabel htmlFor="source-date">วันที่หนังสือย้อนหลัง</CFormLabel><CFormInput id="source-date" type="date" max={overview.today} value={sourceDate} onChange={event => { setSourceDate(event.target.value); setSource(null); setSources([]); setHasMoreSources(false); setSourcePage(1); }} /></div>
                    <div className="form-field"><CButton type="button" color="secondary" variant="outline" disabled={pending || !sourceDate} onClick={() => findSources()}>ค้นหาต้นทาง</CButton></div>
                  </div>
                  {sources.length > 0 && <div className="form-field"><CFormLabel htmlFor="source-document">หนังสือต้นทาง</CFormLabel><CFormSelect id="source-document" value={source ? JSON.stringify(source.source) : ''} onChange={event => { const selectedSource = sources.find(item => JSON.stringify(item.source) === event.target.value) ?? null; setSource(selectedSource); if (selectedSource) setChosenSeries(selectedSource.seriesId); }}><option value="">เลือกหนังสือต้นทาง</option>{sources.map(item => <option key={JSON.stringify(item.source)} value={JSON.stringify(item.source)}>{item.number} · ปี {item.numberYear} · {item.subject}</option>)}</CFormSelect></div>}
                  {(sourcePage > 1 || hasMoreSources) && <p className="issuance-pager"><CButton type="button" color="link" disabled={pending || sourcePage <= 1} onClick={() => findSources(sourcePage - 1)}>ต้นทางหน้าก่อน</CButton><span>หน้า {sourcePage}</span><CButton type="button" color="link" disabled={pending || !hasMoreSources} onClick={() => findSources(sourcePage + 1)}>ต้นทางหน้าถัดไป</CButton></p>}
                  {source && <p role="status">ต้นทาง {source.number} · วันที่ {thaiDate(source.documentDate, "long")} · ปีเลข {source.numberYear} เลขย่อยจะกำหนดเมื่อบันทึกสำเร็จ</p>}
                </div>}
                <div className="form-field issuance-half"><CFormLabel htmlFor="document-date">วันที่หนังสือ</CFormLabel><CFormInput id="document-date" readOnly value={thaiDate(documentDate, "full")} placeholder="เลือกหนังสือต้นทางเพื่อแสดงวันที่" /><small>Asia/Bangkok · {mode === 'backdated' ? 'ใช้วันที่ของหนังสือต้นทาง' : 'ใช้วันที่ปัจจุบันอัตโนมัติ'} · ขอเลขได้ทุกวัน 07:00–22:30 น. การเงิน/พัสดุรหัส 204 ได้ตลอดเวลา</small></div>
              </Step>

              <Step index={2} title="ปลายทางและผู้ลงนาม">
                <div className="form-field"><span className="form-label">หน่วยงานรับเรื่อง</span><div className="issuance-half"><Choice name="target" label="หน่วยงานรับเรื่อง" value={target} onChange={setTarget} options={[{ value: 'internal', label: 'ภายในคณะ' }, { value: 'external', label: 'ภายนอกคณะ' }]} /></div></div>
                {target === "external"
                  ? <div className="form-field"><CFormLabel htmlFor="externalOrganization">หน่วยงานรับเรื่องภายนอกคณะ</CFormLabel><CFormInput id="externalOrganization" name="externalOrganization" required maxLength={500} placeholder="เช่น กองคลัง มหาวิทยาลัยสงขลานครินทร์" /></div>
                  : <div className="form-field"><CFormLabel htmlFor="recipientDepartmentIds">หน่วยงานรับเรื่องภายในคณะ (เลือกได้หลายหน่วยงาน)</CFormLabel><CFormSelect id="recipientDepartmentIds" name="recipientDepartmentIds" multiple required htmlSize={4}>{overview.departments?.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</CFormSelect><small>ใช้ Ctrl หรือ Command เพื่อเลือกหลายรายการบนคอมพิวเตอร์</small></div>}
                <div className="issuance-row">
                  <div className="form-field"><CFormLabel htmlFor="signer">ผู้ลงนาม</CFormLabel><CFormInput id="signer" name="signer" list="signer-positions" maxLength={40} pattern="(position:[0-9]{1,11}|[A-Za-z0-9_\-]{1,20})" title="รหัสบุคลากร หรือเลือกตำแหน่งจากรายการ" placeholder="รหัสบุคลากร หรือเลือกตำแหน่ง" /><datalist id="signer-positions">{overview.positions?.map(position => <option key={position.id} value={position.id}>{position.name}</option>)}</datalist><small>พิมพ์รหัสบุคลากร หรือเลือกตำแหน่งจากรายการ</small></div>
                  <div className="form-field"><CFormLabel htmlFor="requester">ผู้ขอเลข</CFormLabel><CFormInput id="requester" readOnly value={displayName || ownerId} /></div>
                </div>
              </Step>

              <Step index={3} title="รายละเอียดหนังสือ">
                <div className="form-field"><CFormLabel htmlFor="subject">เรื่อง</CFormLabel><CFormTextarea id="subject" name="subject" required maxLength={500} rows={2} placeholder="ระบุชื่อเรื่องของหนังสือ" /><small>ไม่เกิน 500 ตัวอักษร</small></div>
                <fieldset className="form-field"><legend className="form-label">เรียน</legend>
                  {recipients.map((row, index) => <div key={row.id} className="issuance-recipient">
                    <CFormLabel className="issuance-recipient-label" htmlFor={`recipient-${row.id}`}>ผู้รับ {index + 1}</CFormLabel>
                    <CFormInput id={`recipient-${row.id}`} name="recipient" required maxLength={200} placeholder="ชื่อหรือตำแหน่งผู้รับ" value={row.value} onChange={event => setRecipients(current => current.map(item => item.id === row.id ? { ...item, value: event.target.value } : item))} />
                    <CButton type="button" color="secondary" variant="outline" className="issuance-icon-btn" disabled={recipients.length === 1} aria-label={`ลบผู้รับ ${index + 1}`} onClick={() => setRecipients(current => current.filter(item => item.id !== row.id))}><CIcon icon={cilTrash} aria-hidden="true" /></CButton>
                  </div>)}
                  <div className="issuance-recipient-actions">
                    <CButton type="button" className="issuance-add-btn" disabled={recipients.length >= MAX_RECIPIENTS} onClick={() => setRecipients(current => [...current, { id: nextRecipientId.current++, value: '' }])}><CIcon icon={cilPlus} size="sm" aria-hidden="true" />เพิ่มผู้รับ</CButton>
                    <small>{recipients.length} / {MAX_RECIPIENTS} คน · คนละไม่เกิน 200 ตัวอักษร รวมไม่เกิน 3,000</small>
                  </div>
                </fieldset>
              </Step>

              <Step index={4} title="สิทธิ์การอ่าน">
                <div className="issuance-row">
                  <div className="form-field"><span className="form-label">การเผยแพร่</span><Choice name="published" label="การเผยแพร่" value={published ? 'on' : 'off'} onChange={value => setPublished(value === 'on')} options={[{ value: 'off', label: 'ไม่เผยแพร่' }, { value: 'on', label: 'เผยแพร่' }]} /></div>
                  <div className="form-field"><span className="form-label">ความลับ</span><Choice name="confidential" label="ความลับ" value={confidential ? 'on' : 'off'} onChange={value => setConfidential(value === 'on')} options={[{ value: 'off', label: 'ไม่ลับ' }, { value: 'on', label: 'ลับ' }]} /></div>
                </div>
                <div className="issuance-readers" role="status"><CIcon icon={cilLowVision} aria-hidden="true" /><div><strong>ผู้ที่อ่านหนังสือนี้ได้: {readerText(published, confidential)}</strong><small>ไม่ลับและไม่เผยแพร่: เจ้าของและบุคลากรหน่วยงานเดียวกัน · เผยแพร่: บุคลากรในคณะ · หนังสือลับ: เฉพาะเจ้าของ แม้เลือกเผยแพร่</small></div></div>
              </Step>
            </div>

            <aside className="issuance-summary-wrap" aria-label="สรุปการขอเลข">
              <div className="issuance-card issuance-summary">
                <div className="issuance-summary-head"><p>เลขหนังสือที่จะได้รับ</p><strong>{previewNumber}</strong><small>{mode === 'backdated' ? 'ระบบเพิ่มเลขย่อยต่อจากต้นทางเมื่อกดยืนยัน' : 'ระบบออกเลขลำดับถัดไปเมื่อกดยืนยัน'}</small></div>
                <dl>
                  <div><dt>ชุดเลข</dt><dd>{series?.prefix ?? '—'}</dd></div>
                  <div><dt>วันที่</dt><dd>{thaiDate(documentDate, "long") || '—'}</dd></div>
                  <div><dt>การเผยแพร่</dt><dd>{published ? 'เผยแพร่' : 'ไม่เผยแพร่'}</dd></div>
                  <div><dt>ความลับ</dt><dd>{confidential ? 'ลับ' : 'ไม่ลับ'}</dd></div>
                  <div><dt>ผู้อ่านได้</dt><dd>{readerText(published, confidential)}</dd></div>
                  <div><dt>หน่วยงานรับเรื่อง</dt><dd>{target === 'external' ? 'ภายนอกคณะ' : 'ภายในคณะ'}</dd></div>
                  <div><dt>ผู้รับ</dt><dd>{recipientCount} คน</dd></div>
                </dl>
                <p className="issuance-help"><CIcon icon={cilDescription} aria-hidden="true" /><span>{confidential ? 'หนังสือลับออกเลขได้ทันที และยกเว้นการแนบ PDF' : 'ออกเลขได้ทันที แต่ต้องแนบ PDF ให้ครบก่อนขอเลขครั้งถัดไป'}</span></p>
                <CButton type="submit" color="primary" size="lg" className="issuance-submit" disabled={disabled}>{pending ? <><CSpinner as="span" size="sm" /> กำลังดำเนินการ…</> : <><CIcon icon={cilCheckAlt} aria-hidden="true" />ยืนยันขอเลข</>}</CButton>
                <CButton type="reset" color="secondary" variant="outline" className="issuance-clear" disabled={disabled}>ล้างฟอร์ม</CButton>
              </div>
              <p className="issuance-summary-note">ต้องการแนบ PDF ให้หนังสือเดิม? เปิดจาก <Link href="/workspace" prefetch={false}>ล่าสุดของคุณ</Link> ที่หน้าหลัก</p>
            </aside>
          </fieldset>
        </CForm>
      </>}
    {selected && <section className="issuance-card document-detail" ref={detailRef} tabIndex={-1} aria-labelledby="document-result-heading">
      <p className="eyebrow" role={success ? undefined : "status"}>{success ? "ออกเลขสำเร็จ" : "รายละเอียดหนังสือ"}</p><h3 id="document-result-heading">{selected.number}</h3>
      <dl><div><dt>ผู้ขอเลข</dt><dd>{selected.ownerId}</dd></div><div><dt>หน่วยงานผู้ขอเลข ณ วันออก</dt><dd>{selected.ownerDepartmentName || overview?.departments.find(department => department.id === selected.ownerDepartmentId)?.name || selected.ownerDepartmentId}</dd></div><div><dt>วิธีออกเลข</dt><dd>{selected.issuanceKind === "backdated" ? "ย้อนหลัง · เลขย่อย" : "วันที่ปัจจุบัน"}</dd></div><div><dt>การจัดสรรเลข</dt><dd>จัดสรรแล้ว</dd></div><div><dt>ความลับ</dt><dd>{selected.confidential ? "ลับ" : "ไม่ลับ"}</dd></div><div><dt>การเผยแพร่</dt><dd>{selected.published ? "เผยแพร่ภายในคณะ" : "ไม่เผยแพร่"}{selected.confidential && selected.published ? " · ความลับจำกัดให้เฉพาะเจ้าของอ่าน" : ""}</dd></div><div><dt>เวลาออกเลข</dt><dd>{new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(selected.issuedAt))} (Asia/Bangkok)</dd></div><div><dt>เรื่อง</dt><dd>{selected.subject}</dd></div><div><dt>ผู้รับ</dt><dd className="preserve-lines">{selected.recipient}</dd></div><div><dt>หน่วยงานรับเรื่อง</dt><dd>{selected.externalOrganization || selected.recipientDepartments?.map(department => department.name).join(", ") || selected.recipientDepartmentIds?.map(id => overview?.departments.find(department => department.id === id)?.name || id).join(", ")}</dd></div><div><dt>ผู้ลงนาม</dt><dd>{selected.signer}</dd></div><div><dt>วันที่หนังสือ / ปีเลข</dt><dd>{selected.documentDate} / {selected.numberYear}</dd></div><div><dt>สถานะไฟล์</dt><dd>{selected.confidential ? (selected.hasPdf ? "หนังสือลับ · แนบ PDF แล้ว" : "หนังสือลับ · ยกเว้น PDF") : selected.pdfPending ? (selected.ownerId === ownerId ? "รอแนบ PDF · ยังขอเลขใหม่ไม่ได้" : "รอผู้ขอเลขแนบ PDF") : "ครบไฟล์"}</dd></div></dl>
      {selected.audit && <AuditTrail entries={selected.audit} />}
      {selected.ownerId === ownerId && <DocumentEditor key={`edit-${selected.id}`} document={selected} onReload={async () => { setSelected(await readResponse(await fetch(`/api/issuance/${selected.id}`, { cache: 'no-store' }))); }} onSaved={async document => { setSelected(document); setSuccess(false); setOverview(await readResponse(await fetch('/api/issuance', { cache: 'no-store' }))); }} />}
      <PdfAttachment key={selected.id} id={selected.id} version={selected.version} owner={selected.ownerId === ownerId && !selected.cancelled} hasPdf={selected.hasPdf} onSaved={async () => { const updated = await readResponse(await fetch(`/api/issuance/${selected.id}`, { cache: "no-store" })); setSelected(updated); setOverview(await readResponse(await fetch("/api/issuance", { cache: "no-store" }))); }} />
    </section>}
  </section>;
}
