// Row file-state pill shared by the home grid and lists (kit .x-pill).
export type FileState = { confidential?: boolean; cancelled?: boolean; pdfPending?: boolean };

export function fileStatus({ confidential, cancelled, pdfPending }: FileState) {
  if (cancelled) return { tone: 'x-pill-stop', label: 'ยกเลิกแล้ว' };
  if (confidential) return { tone: 'x-pill-brand', label: 'ลับ' };
  if (pdfPending) return { tone: 'x-pill-warn', label: 'รอแนบ PDF' };
  return { tone: 'x-pill-ok', label: 'ครบไฟล์' };
}

export function FileStatusPill(state: FileState) {
  const { tone, label } = fileStatus(state);
  return <span className={`x-pill ${tone}`}><span className="x-pill-dot" />{label}</span>;
}
