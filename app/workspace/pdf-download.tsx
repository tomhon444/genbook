export function PdfDownload({ id }: { id: string }) {
  return <a className="btn btn-primary pdf-download" href={`/api/issuance/${id}/pdf`}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4" />
    </svg>
    <span>ดาวน์โหลด PDF</span>
  </a>;
}
