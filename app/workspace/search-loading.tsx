/** Skeleton rows shown while a section loads; mirrors the grid layout. */
export function SearchLoading({ label = 'กำลังโหลดข้อมูล…', rows = 5 }: { label?: string; rows?: number }) {
  return <div className="x-loading" role="status" aria-live="polite">
    <div className="x-loading-bar" aria-hidden="true" />
    <div className="x-loading-label"><span className="x-loading-dots" aria-hidden="true"><i /><i /><i /></span>{label}</div>
    <div className="x-loading-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => <div key={index} className="x-loading-row" style={{ animationDelay: `${index * 90}ms` }}>
        <span style={{ width: '14%' }} /><span style={{ width: '12%' }} /><span style={{ width: '40%' }} /><span style={{ width: '14%' }} /><span style={{ width: '10%' }} />
      </div>)}
    </div>
  </div>;
}
