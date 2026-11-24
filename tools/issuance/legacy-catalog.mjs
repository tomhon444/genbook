// Reference-data preview only. This module does not import history, credentials,
// issuing grants or counters, and never connects to CENTRAL or a legacy server.
const identifier = (value, maximum = 16) => typeof value === 'string' && new RegExp(`^\\d{1,${maximum}}$`).test(value) && BigInt(value) > 0n ? BigInt(value).toString() : null;
const text = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const original = value => value === undefined ? null : value;
const records = (dump, name) => {
  const value = dump?.tables?.[name]?.records;
  if (!Array.isArray(value)) throw new Error('Legacy catalog requires reference source tables');
  return value;
};
function index(rows, field) {
  const result = new Map();
  for (const row of rows) {
    const id = identifier(row[field]);
    if (!id || result.has(id)) throw new Error('Invalid or duplicate legacy reference ID');
    result.set(id, row);
  }
  return result;
}

export function buildLegacyCatalog(dump) {
  if (!/^[a-f0-9]{64}$/.test(dump?.sourceSha256 ?? '')) throw new Error('Catalog must bind the source snapshot');
  const parents = index(records(dump, 'book'), 'idbook');
  const types = index(records(dump, 'typebook'), 'idtypebook');
  const sourceSeries = records(dump, 'bookdept'), seen = new Set(), departments = new Map();
  function department(id, sourceTable, sourceId, alias) {
    // Wildcards and compound visibility scopes are not department identities.
    // Keep them in series provenance rather than inventing a destination ID.
    if (typeof id !== 'string' || !/^\d{1,64}$/.test(id)) return;
    if (!departments.has(id)) departments.set(id, { id, name: `รหัสหน่วยงาน ${id}`, nameVerified: false, aliases: [] });
    if (text(alias, 500)) departments.get(id).aliases.push({ sourceTable, sourceId, value: alias });
  }
  for (const row of parents.values()) department(row.dept_id, 'book', row.idbook, row.alias_dept);
  const series = sourceSeries.map(row => {
    const canonical = identifier(row.bookdept_id, 5);
    if (!canonical || seen.has(canonical)) throw new Error('Invalid or duplicate canonical legacy series ID');
    seen.add(canonical);
    const id = canonical.padStart(5, '0'), parent = parents.get(identifier(row.book_idbook));
    const type = types.get(identifier(parent?.typebook_idtypebook));
    const prefixValid = text(row.book_number, 100), typeValid = text(type?.typebook, 100);
    const reasons = [];
    if (!parent) reasons.push('missing-parent');
    else if (parent.status !== '1') reasons.push('inactive-parent');
    if (!typeValid) reasons.push('missing-document-type');
    if (!prefixValid) reasons.push('invalid-prefix');
    if (row.book_year !== 'y') reasons.push('unsupported-year');
    if (id === '00047') reasons.push('confirmed-paused-series');
    department(row.dept_id, 'bookdept', row.bookdept_id, row.sub_dept);
    return {
      id, name: [row.sub_dept, parent?.alias_dept, row.book_number].find(value => text(value, 200)) ?? id,
      documentType: typeValid ? type.typebook : '', prefix: prefixValid ? row.book_number : '',
      yearBasis: row.book_year === 'y' ? (id === '00006' ? 'document_date' : 'calendar') : null,
      enabled: reasons.length === 0, disabledReasons: reasons,
      source: { table: 'bookdept', bookdeptId: row.bookdept_id, bookId: original(row.book_idbook),
        sourceDepartmentId: original(row.dept_id), parentAlias: original(parent?.alias_dept), subDepartment: original(row.sub_dept),
        typeId: original(parent?.typebook_idtypebook), parentStatus: original(parent?.status), yearCode: original(row.book_year), originalPrefix: original(row.book_number) },
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const departmentList = [...departments.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    version: 1, sourceSha256: dump.sourceSha256, sourceTable: 'bookdept', demoOnly: true, productionReady: false,
    series, departments: departmentList,
    documentTypes: [...types.values()].map(row => ({ id: row.idtypebook, name: row.typebook, sourceSecretCode: original(row.typesecret) })),
    positions: [], availability: { departmentNames: 'central-required', positions: 'central-required' },
    summary: { sourceSeries: series.length, enabledDemoSeries: series.filter(row => row.enabled).length,
      disabledSeries: series.filter(row => !row.enabled).length, departmentReferences: departmentList.length,
      verifiedDepartmentNames: 0, positions: 0, productionReady: false },
  };
}
