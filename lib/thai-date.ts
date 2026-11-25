// Business dates are plain `YYYY-MM-DD` values (Asia/Bangkok calendar day); no timezone math needed.
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export function thaiDateParts(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return null;
  return { day: String(Number(match[3])), month, year: String(Number(match[1]) + 543) };
}

/** `2026-11-17` → `17 พ.ย. 2569`; unparseable values are returned unchanged. */
export function formatThaiDate(value: string | null | undefined) {
  const parts = thaiDateParts(value);
  return parts ? `${parts.day} ${parts.month} ${parts.year}` : value ?? '';
}
