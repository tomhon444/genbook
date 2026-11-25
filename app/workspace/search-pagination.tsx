"use client";

import CIcon from '@coreui/icons-react';
import { cilChevronLeft, cilChevronRight } from '@coreui/icons';
import { PAGE_SIZES } from '@/lib/grid';

// Red Wyvern UI Kit list footer (.x-listfoot + .x-pager); the server pages the results.
export function SearchPagination({ total, page, pageSize, count, pending, onPage, onSize }: {
  total: number; page: number; pageSize: number; count: number; pending: boolean;
  onPage: (page: number) => void; onSize: (size: number) => void;
}) {
  const pages = Math.min(10000, Math.max(1, Math.ceil(total / pageSize)));
  const numbers = [...new Set([1, page - 1, page, page + 1, pages])].filter(value => value >= 1 && value <= pages).sort((a, b) => a - b);
  const from = (page - 1) * pageSize + 1;
  const button = (disabled: boolean, active = false) => `x-pager-btn${active ? ' is-active' : ''}${disabled && !active ? ' is-disabled' : ''}`;
  return <footer className="x-listfoot search-pagination">
    <p className="x-listfoot-info mb-0" role="status">{count ? <>แสดง {from.toLocaleString('th-TH')}–{(from + count - 1).toLocaleString('th-TH')} จาก {total.toLocaleString('th-TH')} รายการ</> : 'ไม่มีรายการ'}</p>
    <label className="x-listfoot-size">แสดงหน้าละ<select className="form-select" aria-label="จำนวนรายการต่อหน้า" value={pageSize} disabled={pending} onChange={event => onSize(Number(event.target.value))}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
    <nav className="x-pager" aria-label="หน้าผลค้นหาหนังสือ">
      <button type="button" className={button(pending || page <= 1)} aria-label="ผลค้นหาหน้าก่อน" disabled={pending || page <= 1} onClick={() => onPage(page - 1)}><CIcon icon={cilChevronLeft} size="sm" aria-hidden="true" /></button>
      {numbers.map((value, index) => <span className="d-inline-flex align-items-center gap-1" key={value}>{index > 0 && value - numbers[index - 1] > 1 && <span className="x-pager-gap" aria-hidden="true">…</span>}<button type="button" className={button(pending, page === value)} aria-label={`หน้าที่ ${value}`} aria-current={page === value ? 'page' : undefined} disabled={pending} onClick={() => onPage(value)}>{value}</button></span>)}
      <button type="button" className={button(pending || page >= pages)} aria-label="ผลค้นหาหน้าถัดไป" disabled={pending || page >= pages} onClick={() => onPage(page + 1)}><CIcon icon={cilChevronRight} size="sm" aria-hidden="true" /></button>
    </nav>
  </footer>;
}
