"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { SearchDocument, SearchSort } from './search-grid';
import { CButton, CForm, CFormInput } from '@coreui/react';
import { PopupAlert } from '@/app/components/popup-alert';
import { SearchFilters, type AdvancedFilters } from './search-filters';
import { SearchPagination } from './search-pagination';
import CIcon from '@coreui/icons-react';
import { cilInbox, cilSearch } from '@coreui/icons';
import { emptySearch, readSearchState, scopePrefix, searchStateUrl, type SearchScope, type SearchState } from './search-state';
import { SearchLoading } from './search-loading';

const SearchGrid = dynamic(() => import('./search-grid'), { ssr: false, loading: () => <SearchLoading label="กำลังเตรียมตาราง…" /> });

type ResultDocument = SearchDocument;
type Results = { documents: ResultDocument[]; total: number; page: number; pageSize?: number; hasMore: boolean; types: string[]; years: number[] };
const initial = emptySearch;

type Props = { scope: SearchScope; title: string; description: string; initialState: SearchState };

export function SearchPanel({ scope, title, description, initialState }: Props) {
  const prefix = scopePrefix[scope], headingId = `search-heading-${scope}`;
  const router = useRouter();
  const [filters, setFilters] = useState(initialState.filters);
  const [queryDraft, setQueryDraft] = useState(initialState.filters.q);
  const [pageSize, setPageSize] = useState(initialState.pageSize);
  const [ordering, setOrdering] = useState<SearchSort>(initialState.ordering);
  const [result, setResult] = useState<Results | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  function cancel() { generation.current++; active.current?.abort(); active.current = null; }
  useEffect(() => {
    const state = readSearchState(new URLSearchParams(window.location.search), prefix);
    void search(state.page, state.filters, state.ordering, state.pageSize);
    return cancel;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function read(url: string, signal?: AbortSignal) {
    const response = await fetch(url, { cache: 'no-store', signal });
    if (signal?.aborted) throw new DOMException('Superseded request', 'AbortError');
    if (response.status === 401) { setResult(null); router.replace('/login?reason=session'); throw new Error('กรุณาเข้าสู่ระบบใหม่'); }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'ค้นหาไม่สำเร็จ กรุณาลองใหม่');
    return data;
  }
  function failure(error: unknown) {
    setError(error instanceof Error ? error.message : 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่');
  }
  async function search(page = 1, criteria = filters, sort = ordering, size = pageSize) {
    cancel();
    const controller = new AbortController(), requestId = generation.current;
    active.current = controller;
    setPending(true); setError(''); setResult(null);
    window.history.replaceState(null, '', searchStateUrl({ filters: criteria, page, pageSize: size, ordering: sort }, prefix, new URLSearchParams(window.location.search)));
    const params = new URLSearchParams({ scope, page: String(page), pageSize: String(size), ...sort });
    for (const [key, value] of Object.entries(criteria)) if (value.trim()) params.set(key, value.trim());
    try { const data: Results = await read(`/api/search?${params}`, controller.signal); if (requestId === generation.current) { setResult(data); setTypes(data.types); setYears(data.years ?? []); } }
    catch (error) { if (requestId === generation.current && !controller.signal.aborted) failure(error); }
    finally { if (requestId === generation.current) { active.current = null; setPending(false); } }
  }
  function open(document: ResultDocument) {
    cancel();
    const params = new URLSearchParams({ returnTo: window.location.pathname + window.location.search });
    if (document.kind === 'legacy') params.set('snapshot', document.snapshot);
    router.push(`/workspace/documents/${document.kind}/${encodeURIComponent(document.id)}?${params}`);
  }
  function submit(event: FormEvent) { event.preventDefault(); const criteria = { ...filters, q: queryDraft }; setFilters(criteria); void search(1, criteria); }
  function apply(advanced: AdvancedFilters) { const criteria = { ...advanced, q: queryDraft }; setFilters(criteria); void search(1, criteria); }
  function clear() { setFilters(initial); setQueryDraft(''); void search(1, initial); }
  const filtered = Object.values(filters).some(Boolean);
  // Rendered inside a home tab panel: the tab carries the title, the head shows the scope note.
  return <section className="search-section search-workspace" aria-label={title} aria-busy={pending}>
    <div className="x-grid">
      <div className="x-grid-head">
        <p className="search-scope-note" id={headingId}>{description}</p>
        <div className="x-toolbar search-command-bar">
          <CForm onSubmit={submit} className="x-search search-query-form"><CButton type="submit" className="search-query-submit" aria-label="ค้นหาหนังสือ" disabled={pending}><CIcon icon={cilSearch} size="sm" aria-hidden="true" /></CButton><CFormInput id={`search-q-${scope}`} aria-label="เลขหนังสือหรือชื่อเรื่อง" type="search" maxLength={200} placeholder="ค้นหาเลขหนังสือหรือชื่อเรื่อง…" value={queryDraft} onChange={event => setQueryDraft(event.target.value)} /></CForm>
          <SearchFilters applied={filters} years={years} types={types} onApply={apply} onClear={clear} />
        </div>
      </div>
      {pending && <SearchLoading label="กำลังโหลดรายการหนังสือ…" rows={Math.min(pageSize, 6)} />}
      {error && <PopupAlert color="danger" role="alert" onClose={() => setError('')}>{error}</PopupAlert>}
      {result && !result.documents.length && <div className="x-grid-empty search-result-status" aria-live="polite">
        <CIcon icon={cilInbox} size="xxl" className="mb-2" aria-hidden="true" />
        <p className="x-grid-empty-t">ไม่พบหนังสือที่คุณอ่านได้ในหน้านี้</p>
        <p className="x-grid-empty-h">{filtered ? 'ลองเปลี่ยนคำค้นหรือล้างตัวกรอง' : (scope === 'mine' ? 'คุณยังไม่เคยออกเลขหนังสือ' : 'ฝ่ายของคุณยังไม่มีเลขหนังสือที่คุณอ่านได้')}</p>
        {filtered && <CButton type="button" color="secondary" variant="outline" size="sm" onClick={clear}>ล้างตัวกรอง</CButton>}
      </div>}
      <div className="search-results-surface" hidden={!result?.documents.length}>
        <SearchGrid documents={result?.documents ?? []} pending={pending} ordering={ordering} onOpen={open} onSort={next => { setOrdering(next); void search(1, filters, next); }} />
      </div>
      {result && <SearchPagination total={result.total} page={result.page} pageSize={result.pageSize ?? pageSize} count={result.documents.length} pending={pending} onPage={page => void search(page)} onSize={size => { setPageSize(size); void search(1, filters, ordering, size); }} />}
    </div>
  </section>;
}
