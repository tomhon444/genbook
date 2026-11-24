// Source-derived display metadata only. No directory lookups, inferred names,
// attachment paths or timezone conversion belong in this representation.
export const historyMetadataVersion = 1;
const sourceText = value => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('Unsupported historical metadata field');
  return value;
};
const compareIds = (a, b) => {
  const left = BigInt(a), right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : a.localeCompare(b);
};

export function historyMetadataBuilder(dump) {
  const children = (name, primaryKey) => {
    const index = new Map();
    for (const row of dump.tables[name].records) {
      if (typeof row[primaryKey] !== 'string' || !/^\d+$/.test(row[primaryKey])) throw new Error('Invalid historical child source ID');
      const group = index.get(row.gen_book_id) ?? [];
      group.push(row); index.set(row.gen_book_id, group);
    }
    for (const group of index.values()) group.sort((a, b) => compareIds(a[primaryKey], b[primaryKey]));
    return index;
  };
  const recipients = children('genbook_inform', 'gen_book_inform_id');
  const destinations = children('genbook_dept', 'gen_book_dept_id');
  return row => {
    const typeCode = sourceText(row.endorser_type);
    return {
      recipients: (recipients.get(row.gen_book_id) ?? []).map(child => ({ sourceId: child.gen_book_inform_id, text: sourceText(child.inform) })),
      destinations: (destinations.get(row.gen_book_id) ?? []).map(child => ({ sourceId: child.gen_book_dept_id, kind: child.dept_status === '1' ? 'internal' : child.dept_status === '2' ? 'external' : 'unknown', value: sourceText(child.dept) })),
      signer: { kind: typeCode === '1' ? 'position' : typeCode === '2' ? 'staff' : 'unknown', typeCode, reference: sourceText(row.endorser) },
      legacyActorId: sourceText(row.user_login), recordedAtText: sourceText(row.user_datetime), updatedAtText: sourceText(row.lastupdate),
      timestampTimeZone: 'unverified', attachmentVerification: 'unverified',
    };
  };
}
