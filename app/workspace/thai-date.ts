// Date-only values (YYYY-MM-DD) are calendar dates already in Asia/Bangkok;
// format them as UTC so the browser's zone cannot shift the day.
const short = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const month = new Intl.DateTimeFormat('th-TH', { month: 'short', timeZone: 'UTC' });

function parse(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
}

/** "17 พ.ย. 2569" */
export function thaiDate(value: string) {
  const date = parse(value);
  return date ? short.format(date) : value;
}

/** { day: "17", month: "พ.ย." } for compact date badges. */
export function thaiDayMonth(value: string) {
  const date = parse(value);
  return date ? { day: String(date.getUTCDate()), month: month.format(date) } : { day: '', month: '' };
}
