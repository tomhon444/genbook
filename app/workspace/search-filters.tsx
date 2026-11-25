"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CButton, CForm, CFormInput, CFormLabel, CFormSelect } from '@coreui/react';
import CIcon from '@coreui/icons-react';
import { cilFilter, cilX } from '@coreui/icons';

export type AdvancedFilters = { year: string; type: string; from: string; to: string; requester: string };

export function SearchFilters({ applied, years, types, onApply, onClear }: {
  applied: AdvancedFilters; years: number[]; types: string[];
  onApply: (filters: AdvancedFilters) => void; onClear: () => void;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const openingScroll = useRef({ x: 0, y: 0 });
  const [draft, setDraft] = useState(applied);
  const [open, setOpen] = useState(false);
  const count = [applied.year, applied.type, applied.from, applied.to, applied.requester].filter(Boolean).length;
  useEffect(() => {
    const dismiss = () => panel.current?.hidePopover();
    const dismissOnOutsideScroll = (event: Event) => {
      const current = panel.current;
      if (!current?.matches(':popover-open')) return;
      if (event.target instanceof Node && current.contains(event.target)) return;
      // A button click may first scroll its trigger into view. Its queued scroll
      // event must not dismiss a popover opened at that same page position.
      if (event.target === document && window.scrollX === openingScroll.current.x && window.scrollY === openingScroll.current.y) return;
      current.hidePopover();
    };
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismissOnOutsideScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismissOnOutsideScroll, true);
    };
  }, []);

  function prepare() {
    setDraft(applied);
    openingScroll.current = { x: window.scrollX, y: window.scrollY };
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect || !panel.current) return;
    const width = Math.min(440, window.innerWidth - 32);
    const top = Math.min(rect.bottom + 8, Math.max(16, window.innerHeight - 360));
    Object.assign(panel.current.style, {
      width: `${width}px`, left: `${Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16))}px`,
      top: `${top}px`, maxHeight: `${window.innerHeight - top - 16}px`,
    });
  }
  function close() { panel.current?.hidePopover(); trigger.current?.focus(); }
  function apply(event: FormEvent) { event.preventDefault(); onApply(draft); close(); }

  return <>
    <CButton ref={trigger} type="button" className="search-filter-trigger" variant="outline" color="secondary" popoverTarget={id} aria-controls={id} aria-expanded={open} onClick={prepare}>
      <CIcon icon={cilFilter} size="sm" aria-hidden="true" />
      ตัวกรอง{count > 0 && <span className="search-filter-count">{count}</span>}
    </CButton>
    <div ref={panel} id={id} popover="auto" className="search-filter-popover" role="dialog" aria-labelledby={`${id}-heading`} onToggle={event => setOpen(event.currentTarget.matches(':popover-open'))}>
      <div className="search-filter-heading"><h2 id={`${id}-heading`}>ตัวกรองหนังสือ</h2><CButton type="button" className="filter-close" aria-label="ปิดตัวกรอง" onClick={close}><CIcon icon={cilX} aria-hidden="true" /></CButton></div>
      <CForm onSubmit={apply}>
        <div className="form-field"><CFormLabel htmlFor={`${id}-year`}>ปีเลข (พ.ศ.)</CFormLabel><CFormSelect id={`${id}-year`} autoFocus value={draft.year} onChange={event => setDraft(current => ({ ...current, year: event.target.value }))}><option value="">ทุกปี</option>{draft.year && !years.includes(Number(draft.year)) && <option value={draft.year} disabled>{draft.year} (ไม่พบรายการที่อ่านได้)</option>}{years.map(year => <option key={year} value={String(year)}>{year}</option>)}</CFormSelect></div>
        <div className="form-field"><CFormLabel htmlFor={`${id}-type`}>ประเภทหนังสือ</CFormLabel><CFormSelect id={`${id}-type`} value={draft.type} onChange={event => setDraft(current => ({ ...current, type: event.target.value }))}><option value="">ทุกประเภท</option>{draft.type && !types.includes(draft.type) && <option value={draft.type} disabled>{draft.type} (ไม่พบรายการที่อ่านได้)</option>}{types.map(type => <option key={type} value={type}>{type}</option>)}</CFormSelect></div>
        <div className="filter-date-range">{([['from', 'วันที่หนังสือตั้งแต่'], ['to', 'วันที่หนังสือถึง']] as const).map(([key, label]) => <div className="form-field" key={key}><CFormLabel htmlFor={`${id}-${key}`}>{label}</CFormLabel><CFormInput id={`${id}-${key}`} type="date" value={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} /></div>)}</div>
        <div className="form-field"><CFormLabel htmlFor={`${id}-requester`}>ผู้ขอเลข (รหัสบุคลากรตรงตัว)</CFormLabel><CFormInput id={`${id}-requester`} maxLength={64} value={draft.requester} onChange={event => setDraft(current => ({ ...current, requester: event.target.value }))} /></div>
        <div className="search-filter-actions"><CButton type="button" color="link" onClick={() => { setDraft({ year: '', type: '', from: '', to: '', requester: '' }); onClear(); close(); }}>ล้างตัวกรอง</CButton><CButton type="submit" color="primary">ใช้ตัวกรอง</CButton></div>
      </CForm>
    </div>
  </>;
}
