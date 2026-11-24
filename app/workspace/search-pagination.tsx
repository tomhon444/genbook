"use client";

import { CButton, CFormSelect } from '@coreui/react';

export function SearchPagination({ total, page, pageSize, count, pending, onPage, onSize }: {
  total: number; page: number; pageSize: number; count: number; pending: boolean;
  onPage: (page: number) => void; onSize: (size: number) => void;
}) {
  const pages = Math.min(10000, Math.max(1, Math.ceil(total / pageSize)));
  const numbers = [...new Set([1, page - 1, page, page + 1, pages])].filter(value => value >= 1 && value <= pages).sort((a, b) => a - b);
  return <footer className="search-pagination">
    <p role="status">พบ {total.toLocaleString('th-TH')} รายการ · หน้า {page} จาก {pages} · แสดง {count} รายการ</p>
    <div className="search-pagination-controls">
      <label className="search-page-size">แสดงหน้าละ<CFormSelect aria-label="จำนวนรายการต่อหน้า" value={pageSize} disabled={pending} onChange={event => onSize(Number(event.target.value))}>{[20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</CFormSelect></label>
      <nav aria-label="หน้าผลค้นหาหนังสือ">
        <CButton type="button" aria-label="ผลค้นหาหน้าก่อน" disabled={pending || page <= 1} onClick={() => onPage(page - 1)}>ก่อนหน้า</CButton>
        {numbers.map((value, index) => <span className="search-page-item" key={value}>{index > 0 && value - numbers[index - 1] > 1 && <span className="search-page-gap" aria-hidden="true">…</span>}<CButton type="button" aria-label={`หน้าที่ ${value}`} aria-current={page === value ? 'page' : undefined} disabled={pending} onClick={() => onPage(value)}>{value}</CButton></span>)}
        <CButton type="button" aria-label="ผลค้นหาหน้าถัดไป" disabled={pending || page >= pages} onClick={() => onPage(page + 1)}>ถัดไป</CButton>
      </nav>
    </div>
  </footer>;
}
