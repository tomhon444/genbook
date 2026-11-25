"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CButton, CForm, CFormInput, CFormLabel } from '@coreui/react';
import { PopupAlert } from '@/app/components/popup-alert';
import { HistoricalDetail } from './historical-detail';

type HistoricalDocument = import('@/lib/genbookno/types').HistoricalDocument;
export function HistoryPanel() {
  const router = useRouter();
  const [query,setQuery] = useState('');
  const [result,setResult] = useState<{ documents: HistoricalDocument[]; hasMore: boolean; page: number } | null>(null);
  const [selected,setSelected] = useState<HistoricalDocument | null>(null);
  const [error,setError] = useState('');
  const [pending,setPending] = useState(false);
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; active.current?.abort(); }, []);
  function cancel() { generation.current++; active.current?.abort(); active.current = null; }
  async function read(params: URLSearchParams, signal: AbortSignal, requestId: number) {
    const response = await fetch(`/api/history?${params}`, { cache: 'no-store', signal });
    if (requestId !== generation.current) throw new DOMException('Superseded request', 'AbortError');
    if (response.status === 401) {
      setResult(null); setSelected(null);
      router.replace('/login?reason=session');
      throw new Error('กรุณาเข้าสู่ระบบใหม่');
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data;
  }
  async function search(page = 1) {
    cancel();
    const controller = new AbortController(), requestId = generation.current;
    active.current = controller;
    setPending(true); setError(''); setSelected(null); setResult(null);
    try {
      const data = await read(new URLSearchParams({ q: query, page: String(page) }), controller.signal, requestId);
      if (requestId === generation.current) setResult(data);
    }
    catch (error) { if (requestId === generation.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : 'โหลดไม่สำเร็จ'); }
    finally { if (requestId === generation.current) { active.current = null; setPending(false); } }
  }
  async function open(document: HistoricalDocument) {
    cancel();
    const controller = new AbortController(), requestId = generation.current;
    active.current = controller;
    setPending(true); setError(''); setSelected(null);
    try {
      const data = await read(new URLSearchParams({ snapshot: document.sourceSha256, sourceId: document.sourceId }), controller.signal, requestId);
      if (requestId === generation.current) setSelected(data);
    }
    catch (error) { if (requestId === generation.current && !controller.signal.aborted) { setResult(null); setError(error instanceof Error ? error.message : 'เปิดไม่สำเร็จ'); } }
    finally { if (requestId === generation.current) { active.current = null; setPending(false); } }
  }
  function submit(event: FormEvent) { event.preventDefault(); void search(); }
  return <section className="issuance-card history-section" aria-labelledby="history-heading">
    <p className="eyebrow">คลังข้อมูลเดิม</p><h2 id="history-heading">ประวัติหนังสือเดิม</h2><p>ค้นรายการที่ผ่านการตรวจรับข้อมูลแล้ว ตามสิทธิ์ของคุณ</p>
    <CForm onSubmit={submit}><CFormLabel htmlFor="history-query">เรื่อง เลขหนังสือ หรือรหัสรายการเดิม</CFormLabel><CFormInput id="history-query" maxLength={200} value={query} onChange={event => { cancel(); setQuery(event.target.value); setResult(null); setSelected(null); setError(''); setPending(false); }} /><CButton type="submit" color="primary" disabled={pending}>ค้นประวัติ</CButton></CForm>
    {pending && <p role="status">กำลังค้นข้อมูล…</p>}{error && <PopupAlert color="danger" role="alert" onClose={() => setError('')}>{error}</PopupAlert>}
    {result && <div aria-live="polite">{result.documents.length ? <ul className="document-list">{result.documents.map(document => <li key={`${document.sourceSha256}:${document.sourceId}`}><button type="button" disabled={pending} onClick={() => open(document)}><strong>{document.number} · ปี {document.numberYear}</strong><span>{document.subject}</span><small>รหัสเดิม {document.sourceId} <span className={`x-pill ${document.cancelled ? 'x-pill-stop' : 'x-pill-ok'}`}><span className="x-pill-dot" />{document.cancelled ? 'ยกเลิก' : 'ปกติ'}</span></small></button></li>)}</ul> : <p>ไม่พบประวัติที่คุณอ่านได้</p>}<CButton color="secondary" variant="outline" disabled={pending || result.page === 1} onClick={() => search(result.page-1)}>หน้าก่อน</CButton><span> หน้า {result.page} </span><CButton color="secondary" variant="outline" disabled={pending || !result.hasMore} onClick={() => search(result.page+1)}>หน้าถัดไป</CButton></div>}
    {selected && <HistoricalDetail document={selected} />}
  </section>;
}
