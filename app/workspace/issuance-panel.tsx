"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CButton, CForm, CFormCheck, CFormInput, CFormLabel, CFormSelect, CSpinner } from "@coreui/react";
import { PopupAlert } from "@/app/components/popup-alert";

import { PdfAttachment } from "./pdf-attachment";
import { AuditTrail, type AuditEntry } from "./audit-trail";
import { DocumentEditor } from "./document-editor";

type Series = { id: string; label: string; prefix: string };
type Document = Awaited<ReturnType<typeof import('@/lib/issuance/service').detail>> & { audit?: AuditEntry[] };
type Overview = { series: Series[]; documents: Document[]; sharedDocuments: Document[]; today: string; departments: { id: string; name: string }[]; readOnly?: boolean; legacyTotal?: number };
type SourceOption = { source: { kind: 'issuance'; id: string } | { kind: 'legacy'; snapshot: string; id: string }; seriesId: string; number: string; numberYear: number; subject: string; documentDate: string };

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
      formElement.reset(); setTarget("external"); setRecipients([{ id: nextRecipientId.current++, value: '' }]);
      try {
        const updated = await readResponse(await fetch("/api/issuance", { cache: "no-store" }));
        setOverview(updated);
      } catch {
        setNotice("ออกเลขสำเร็จแล้ว แต่โหลดรายการล่าสุดไม่สำเร็จ กรุณาโหลดรายการอีกครั้ง");
      }
    } catch (err) { setError(err instanceof Error ? err.message : "ยังยืนยันผลไม่ได้ กรุณาส่งข้อมูลเดิมซ้ำเพื่อตรวจสอบผล"); }
    finally { setPending(false); }
  }

  async function open(id: string) {
    setError(""); setSelected(null); setPending(true); setSuccess(false);
    try { const result = await readResponse(await fetch(`/api/issuance/${id}`, { cache: "no-store" })); setSelected(result.document ?? result); }
    catch (err) { setError(err instanceof Error ? err.message : "เปิดรายการไม่สำเร็จ"); }
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

  return <section className="issuance-section" aria-labelledby="issuance-heading">
    <div className="section-heading"><div><p className="eyebrow">งานหนังสือของคุณ</p><h2 id="issuance-heading">ขอเลขหนังสือ</h2></div><span className="text-secondary">{overview?.readOnly ? 'อ่านหนังสือเดิมตามสิทธิ์' : 'ออกเลขทันที · อ่านตามสิทธิ์หนังสือ'}</span></div>
    {error && <PopupAlert color="danger" role="alert" onClose={() => setError("")}>{error}</PopupAlert>}
    {pending && <p role="status" aria-live="polite">กำลังดำเนินการ…</p>}
    {notice && <PopupAlert color="warning" role="status" onClose={() => { setNotice(""); setSuccessPopup(false); }}>{notice} <CButton type="button" color="link" onClick={load}>โหลดรายการอีกครั้ง</CButton></PopupAlert>}
    {successPopup && selected && !pending && !notice && !error && <PopupAlert color="success" role="status" onClose={() => setSuccessPopup(false)}>ออกเลขสำเร็จ <strong>{selected.number}</strong><p>ตรวจสอบรายละเอียดและแนบ PDF ได้ที่รายการด้านล่าง</p></PopupAlert>}
    {loading ? <div role="status"><CSpinner as="span" size="sm" /> กำลังโหลดชุดเลขและรายการ…</div> : !overview ? <CButton color="primary" onClick={load}>ลองโหลดอีกครั้ง</CButton> : <>
      {overview.readOnly ? <div className="issuance-card"><p role="status">เชื่อมข้อมูลหนังสือเดิมแล้ว อ่านหนังสือที่คุณมีสิทธิ์ได้ {overview.legacyTotal?.toLocaleString('th-TH') ?? 'ตามรายการค้นหา'} รายการ</p><p>การขอเลขใหม่และแก้ไขข้อมูลยังไม่เปิดใช้งาน</p><a href="/workspace">ไปหน้าค้นหาหนังสือ</a></div> : <><div className="issuance-grid">
        <div className="issuance-card issuance-card--form">
          <h3>{mode === 'backdated' ? 'หนังสือย้อนหลัง' : 'หนังสือวันที่ปัจจุบัน'}</h3><p className="text-secondary">วันที่ {overview.today} (Asia/Bangkok) · ทุกวัน 07:00–22:30 น. การเงิน/พัสดุรหัส 204 ได้ตลอดเวลา</p>
          <CForm onSubmit={submit} aria-busy={pending}>
            <fieldset disabled={pending || overview.series.length === 0}>
          <div className="form-field"><CFormLabel htmlFor="seriesId">เลขหนังสือ</CFormLabel><CFormSelect id="seriesId" name="seriesId" required value={seriesId} onChange={event => { setChosenSeries(event.target.value); setSource(null); }}><option value="" disabled>เลือกชุดเลขที่ได้รับสิทธิ์</option>{overview.series.map(series => <option key={series.id} value={series.id}>{series.label} · {series.prefix}</option>)}</CFormSelect></div>
          <div className="form-field"><CFormLabel htmlFor="issuance-mode">วิธีขอเลข</CFormLabel><CFormSelect id="issuance-mode" value={mode} disabled={pending} onChange={event => { setMode(event.target.value); setSource(null); setSources([]); setHasMoreSources(false); setError(''); }}><option value="normal">วันที่ปัจจุบัน</option><option value="backdated">ย้อนหลัง</option></CFormSelect></div>
          {mode === 'backdated' && <div>
            <p>เลือกต้นทางที่อ่านได้ในชุดเลขที่คุณใช้ได้ ระบบคงชุด ปี วันที่ และเลขหลักเดิม แล้วเพิ่มเลขย่อย ไม่ต้องรออนุมัติ เลขหนังสือด้านบนจะตรงกับชุดของต้นทางที่เลือก</p>
            <div className="form-field"><CFormLabel htmlFor="source-date">วันที่หนังสือย้อนหลัง</CFormLabel><CFormInput id="source-date" type="date" max={overview.today} value={sourceDate} disabled={pending} onChange={event => { setSourceDate(event.target.value); setSource(null); setSources([]); setHasMoreSources(false); setSourcePage(1); }} /></div>
            <CButton type="button" color="secondary" disabled={pending || !sourceDate} onClick={() => findSources()}>ค้นหาต้นทาง</CButton>
            {sources.length > 0 && <div className="form-field"><CFormLabel htmlFor="source-document">หนังสือต้นทาง</CFormLabel><CFormSelect id="source-document" value={source ? JSON.stringify(source.source) : ''} disabled={pending} onChange={event => { const selectedSource = sources.find(item => JSON.stringify(item.source) === event.target.value) ?? null; setSource(selectedSource); if (selectedSource) setChosenSeries(selectedSource.seriesId); }}><option value="">เลือกหนังสือต้นทาง</option>{sources.map(item => <option key={JSON.stringify(item.source)} value={JSON.stringify(item.source)}>{item.number} · ปี {item.numberYear} · {item.subject}</option>)}</CFormSelect></div>}
            {(sourcePage > 1 || hasMoreSources) && <p><CButton type="button" color="link" disabled={pending || sourcePage <= 1} onClick={() => findSources(sourcePage - 1)}>ต้นทางหน้าก่อน</CButton><span>หน้า {sourcePage}</span><CButton type="button" color="link" disabled={pending || !hasMoreSources} onClick={() => findSources(sourcePage + 1)}>ต้นทางหน้าถัดไป</CButton></p>}
            {source && <p role="status">ต้นทาง {source.number} · วันที่ {source.documentDate} · ปีเลข {source.numberYear} เลขย่อยจะกำหนดเมื่อบันทึกสำเร็จ</p>}
          </div>}
              <fieldset className="form-field"><legend className="form-label">การเผยแพร่</legend><div className="legacy-radio-options"><CFormCheck type="radio" id="unpublished" name="published" value="off" label="ไม่เผยแพร่" defaultChecked /><CFormCheck type="radio" id="published" name="published" value="on" label="เผยแพร่" /></div></fieldset>
              <fieldset className="form-field"><legend className="form-label">ความลับ</legend><div className="legacy-radio-options"><CFormCheck type="radio" id="non-confidential" name="confidential" value="off" label="ไม่ลับ" defaultChecked /><CFormCheck type="radio" id="confidential" name="confidential" value="on" label="ลับ" /></div><small>ไม่ลับและไม่เผยแพร่: เจ้าของและบุคลากรหน่วยงานเดียวกันอ่านได้ · เผยแพร่: บุคลากรในคณะอ่านได้ · หนังสือลับ: เฉพาะเจ้าของ แม้เลือกเผยแพร่</small></fieldset>
              <div className="form-field"><CFormLabel htmlFor="document-date">วันที่</CFormLabel><CFormInput id="document-date" readOnly value={mode === 'backdated' ? source?.documentDate ?? '' : overview.today} placeholder="เลือกหนังสือต้นทางเพื่อแสดงวันที่" /><small>Asia/Bangkok{mode === 'backdated' ? ' · ใช้วันที่ของหนังสือต้นทาง' : ' · วันที่ปัจจุบัน'}</small></div>
              <div className="form-field"><CFormLabel htmlFor="subject">เรื่อง</CFormLabel><CFormInput id="subject" name="subject" required maxLength={500} /></div>
              <fieldset className="form-field"><legend className="form-label">เรียน</legend>{recipients.map((row, index) => <div key={row.id} className="legacy-recipient-row"><CFormLabel className="visually-hidden" htmlFor={`recipient-${row.id}`}>ผู้รับ {index + 1}</CFormLabel><CFormInput id={`recipient-${row.id}`} name="recipient" required maxLength={200} value={row.value} onChange={event => setRecipients(current => current.map(item => item.id === row.id ? { ...item, value: event.target.value } : item))} /><CButton type="button" color="secondary" variant="outline" disabled={recipients.length === 1} aria-label={`ลบผู้รับ ${index + 1}`} onClick={() => setRecipients(current => current.filter(item => item.id !== row.id))}>ลบแถว</CButton></div>)}<div className="legacy-recipient-actions"><CButton type="button" color="secondary" disabled={recipients.length >= 20} onClick={() => setRecipients(current => [...current, { id: nextRecipientId.current++, value: '' }])}>เพิ่มผู้รับ</CButton><small>ไม่เกิน 20 คน คนละ 200 ตัวอักษร รวมไม่เกิน 3,000 ตัวอักษร</small></div></fieldset>
              <fieldset className="form-field"><legend className="form-label">หน่วยงานรับเรื่อง</legend><div className="legacy-radio-options"><CFormCheck type="radio" id="target-internal" name="target" value="internal" label="ภายในคณะ" checked={target === 'internal'} onChange={() => setTarget('internal')} /><CFormCheck type="radio" id="target-external" name="target" value="external" label="ภายนอกคณะ" checked={target === 'external'} onChange={() => setTarget('external')} /></div></fieldset>
              {target === "external" ? <div className="form-field"><CFormLabel htmlFor="externalOrganization">หน่วยงานรับเรื่องภายนอกคณะ</CFormLabel><CFormInput id="externalOrganization" name="externalOrganization" required maxLength={500} /></div> : <div className="form-field"><CFormLabel htmlFor="recipientDepartmentIds">หน่วยงานรับเรื่องภายในคณะ (เลือกได้หลายหน่วยงาน)</CFormLabel><CFormSelect id="recipientDepartmentIds" name="recipientDepartmentIds" multiple required htmlSize={4}>{overview.departments?.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</CFormSelect><small>ใช้ Ctrl หรือ Command เพื่อเลือกหลายรายการบนคอมพิวเตอร์</small></div>}
              <div className="form-field"><CFormLabel htmlFor="signer">ผู้ลงนาม</CFormLabel><CFormInput id="signer" name="signer" required maxLength={200} /></div>
              <div className="form-field"><CFormLabel htmlFor="requester">ผู้ขอเลข</CFormLabel><CFormInput id="requester" readOnly value={displayName || ownerId} /></div>
              <p className="issuance-help">หนังสือไม่ลับออกเลขก่อนได้ และต้องแนบ PDF ให้ครบก่อนขอเลขครั้งถัดไป หนังสือลับยกเว้น PDF เลือกเปิดรายการเดิมเพื่อแนบ PDF</p>
              <CButton type="submit" color="primary" disabled={pending}>{pending ? <><CSpinner as="span" size="sm" /> กำลังดำเนินการ…</> : "ยืนยันขอเลข"}</CButton>
            </fieldset>
          </CForm>
          {overview.series.length === 0 && <p className="alert alert-warning" role="status">ยังไม่มีชุดเลขที่ได้รับสิทธิ์ กรุณาติดต่อผู้ดูแลระบบ</p>}
        </div>
        <div className="issuance-card issuance-card--recent"><h3>รายการล่าสุดของคุณ</h3><p className="text-secondary">หนังสือที่บันทึกสำเร็จแล้ว</p>{overview.documents.length === 0 ? <p>ยังไม่มีรายการ</p> : <ul className="document-list">{overview.documents.map(document => <li key={document.id}><button type="button" disabled={pending} onClick={() => open(document.id)}><strong>{document.number}</strong><span>{document.subject}</span><small>{document.documentDate} · {document.confidential ? "ลับ" : document.pdfPending ? "รอแนบ PDF" : "ครบไฟล์"}</small></button></li>)}</ul>}</div>
      </div>
      <div className="issuance-card shared-documents"><h3>หนังสือจากผู้อื่นที่คุณอ่านได้</h3><p className="text-secondary">รายการล่าสุดตามสิทธิ์หน่วยงานและการเผยแพร่</p>{overview.sharedDocuments.length === 0 ? <p>ยังไม่มีรายการที่อ่านร่วมได้</p> : <ul className="document-list">{overview.sharedDocuments.map(document => <li key={document.id}><button type="button" disabled={pending} onClick={() => open(document.id)}><strong>{document.number}</strong><span>{document.subject}</span><small>{document.documentDate} · {document.published ? "เผยแพร่ภายในคณะ" : "ภายในหน่วยงาน"}</small></button></li>)}</ul>}</div>
      </>}
    </>}
    {selected && <section className="issuance-card document-detail" ref={detailRef} tabIndex={-1} aria-labelledby="document-result-heading">
      <p className="eyebrow" role={success ? undefined : "status"}>{success ? "ออกเลขสำเร็จ" : "รายละเอียดหนังสือ"}</p><h3 id="document-result-heading">{selected.number}</h3>
      <dl><div><dt>ผู้ขอเลข</dt><dd>{selected.ownerId}</dd></div><div><dt>หน่วยงานผู้ขอเลข ณ วันออก</dt><dd>{selected.ownerDepartmentName || overview?.departments.find(department => department.id === selected.ownerDepartmentId)?.name || selected.ownerDepartmentId}</dd></div><div><dt>วิธีออกเลข</dt><dd>{selected.issuanceKind === "backdated" ? "ย้อนหลัง · เลขย่อย" : "วันที่ปัจจุบัน"}</dd></div><div><dt>การจัดสรรเลข</dt><dd>จัดสรรแล้ว</dd></div><div><dt>ความลับ</dt><dd>{selected.confidential ? "ลับ" : "ไม่ลับ"}</dd></div><div><dt>การเผยแพร่</dt><dd>{selected.published ? "เผยแพร่ภายในคณะ" : "ไม่เผยแพร่"}{selected.confidential && selected.published ? " · ความลับจำกัดให้เฉพาะเจ้าของอ่าน" : ""}</dd></div><div><dt>เวลาออกเลข</dt><dd>{new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(selected.issuedAt))} (Asia/Bangkok)</dd></div><div><dt>เรื่อง</dt><dd>{selected.subject}</dd></div><div><dt>ผู้รับ</dt><dd className="preserve-lines">{selected.recipient}</dd></div><div><dt>หน่วยงานรับเรื่อง</dt><dd>{selected.externalOrganization || selected.recipientDepartments?.map(department => department.name).join(", ") || selected.recipientDepartmentIds?.map(id => overview?.departments.find(department => department.id === id)?.name || id).join(", ")}</dd></div><div><dt>ผู้ลงนาม</dt><dd>{selected.signer}</dd></div><div><dt>วันที่หนังสือ / ปีเลข</dt><dd>{selected.documentDate} / {selected.numberYear}</dd></div><div><dt>สถานะไฟล์</dt><dd>{selected.confidential ? (selected.hasPdf ? "หนังสือลับ · แนบ PDF แล้ว" : "หนังสือลับ · ยกเว้น PDF") : selected.pdfPending ? (selected.ownerId === ownerId ? "รอแนบ PDF · ยังขอเลขใหม่ไม่ได้" : "รอผู้ขอเลขแนบ PDF") : "ครบไฟล์"}</dd></div></dl>
      {selected.audit && <AuditTrail entries={selected.audit} />}
      {selected.ownerId === ownerId && <DocumentEditor key={`edit-${selected.id}`} document={selected} onReload={async () => { setSelected(await readResponse(await fetch(`/api/issuance/${selected.id}`, { cache: 'no-store' }))); }} onSaved={async document => { setSelected(document); setSuccess(false); setOverview(await readResponse(await fetch('/api/issuance', { cache: 'no-store' }))); }} />}
      <PdfAttachment key={selected.id} id={selected.id} version={selected.version} owner={selected.ownerId === ownerId} hasPdf={selected.hasPdf} onSaved={async () => { const updated = await readResponse(await fetch(`/api/issuance/${selected.id}`, { cache: "no-store" })); setSelected(updated); setOverview(await readResponse(await fetch("/api/issuance", { cache: "no-store" }))); }} />
    </section>}
  </section>;
}


