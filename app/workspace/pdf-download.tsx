import CIcon from '@coreui/icons-react';
import { cilCloudDownload } from '@coreui/icons';

export function PdfDownload({ id }: { id: string }) {
  return <a className="btn btn-outline-secondary pdf-download" href={`/api/issuance/${id}/pdf`}>
    <CIcon icon={cilCloudDownload} aria-hidden="true" />
    <span>ดาวน์โหลด PDF</span>
  </a>;
}
