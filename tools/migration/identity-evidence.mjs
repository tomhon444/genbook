import { canonicalSeries } from './mapping.mjs';

// Identity values are exact source values. In particular, whitespace and leading
// zeroes are evidence, not formatting to repair. Missing columns differ from SQL NULL.
const kind = value => value === undefined ? 'absent' : value === null ? 'null' : value === '' ? 'blank' : typeof value === 'string' ? 'value' : 'invalid';
const valueKey = value => JSON.stringify([kind(value), value ?? null]);
const raw = value => value === undefined ? null : value;
function add(groups, value, reference) {
  const key = valueKey(value);
  if (!groups.has(key)) groups.set(key, { sourceId: raw(value), kind: kind(value), references: [], referenceCount: 0, documentCount: 0 });
  const group = groups.get(key);
  if (group.references.length < 5) group.references.push(reference);
  group.referenceCount++;
  if (reference.table === 'genbook') group.documentCount++;
}

export function collectSourceReferences(plan) {
  const tables = new Map(plan.tables.map(table => [table.name, table]));
  const rows = name => {
    const table = tables.get(name);
    return (table?.records ?? []).map(record => Object.fromEntries((table.columns ?? []).map((column, index) => [column, record[index]])));
  };
  const groups = Object.fromEntries(['owners', 'actors', 'staffIds', 'departmentIds'].map(name => [name, new Map()]));
  const collect = (name, table, column) => rows(table).forEach((row, rowIndex) => add(groups[name], row[column], { table, column, rowIndex, ...(table === 'genbook' ? { documentId: raw(row.gen_book_id) } : {}) }));
  collect('owners', 'genbook', 'user_request');
  collect('actors', 'genbook', 'user_login');
  for (const column of ['user_request', 'user_login']) collect('staffIds', 'genbook', column);
  for (const table of ['bookdept_user', 'userbook', 'userlevel', 'user_tb']) collect('staffIds', table, 'staff_id');
  for (const [table, column] of [['genbook', 'user_dept'], ['bookdept', 'dept_id'], ['book', 'dept_id'], ['bookdept_user', 'dept_id']]) collect('departmentIds', table, column);
  const documents = rows('genbook').map(row => ({ sourceId: raw(row.gen_book_id), ownerId: raw(row.user_request), ownerKind: kind(row.user_request), actorId: raw(row.user_login), actorKind: kind(row.user_login), historicalDepartmentId: raw(row.user_dept), historicalDepartmentKind: kind(row.user_dept), rawSeriesId: raw(row.bookdept), seriesId: canonicalSeries(row.bookdept) }));
  const seriesGroups = new Map();
  for (const [table, column] of [['bookdept', 'bookdept_id'], ['genbook', 'bookdept']]) rows(table).forEach((row, rowIndex) => {
    const value = row[column], sourceId = canonicalSeries(value);
    const key = sourceId === null ? `invalid:${valueKey(value)}` : sourceId;
    if (!seriesGroups.has(key)) seriesGroups.set(key, { sourceId, rawIds: [], references: [], referenceCount: 0, documentCount: 0 });
    const group = seriesGroups.get(key);
    if (!group.rawIds.some(item => item.kind === kind(value) && item.value === raw(value))) group.rawIds.push({ value: raw(value), kind: kind(value) });
    if (group.references.length < 5) group.references.push({ table, column, rowIndex, rawId: raw(value), kind: kind(value) });
    if (table === 'bookdept') group.referenceCount++; else group.documentCount++;
  });
  const series = [...seriesGroups.values()].map(group => ({ ...group, status: group.sourceId === null ? 'invalid' : group.referenceCount === 0 ? 'missing' : group.referenceCount > 1 ? 'duplicate' : 'unique' }));
  // These are source grant rows only. Roles/managers never create grants here.
  const grants = rows('bookdept_user').map((row, rowIndex) => ({ rowIndex, sourceId: raw(row.bookdept_user_id), staffId: raw(row.staff_id), staffKind: kind(row.staff_id), departmentId: raw(row.dept_id), rawSeriesId: raw(row.bookdept_id), seriesId: canonicalSeries(row.bookdept_id), decision: 'pending' }));
  const result = Object.fromEntries(Object.entries(groups).map(([name, values]) => [name, [...values.values()]]));
  return { sourceSha256: plan.sourceSha256, ...result, series, grants, documents, totals: { documents: documents.length, owners: result.owners.length, actors: result.actors.length, staffIds: result.staffIds.length, departmentIds: result.departmentIds.length, series: series.length, grants: grants.length } };
}

const active = value => value === '1' || value === 1;
// Drivers may return numeric IDs for numeric CENTRAL columns. Convert only that
// representation; do not trim strings or coerce the source ID to a number.
const centralId = value => typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
function match(group, rows, idField, statusField, fields) {
  const matches = group.kind === 'value' ? rows.filter(row => centralId(row[idField]) === group.sourceId).map(row => Object.fromEntries(fields.map(field => [field, raw(row[field])]))) : [];
  const status = group.kind !== 'value' ? 'unresolved' : matches.length === 0 ? 'missing' : matches.length > 1 ? 'ambiguous' : active(matches[0][statusField]) ? 'active' : 'inactive';
  return { ...group, match: { status, matches } };
}

export function buildIdentityEvidence(source, staffRows, departmentRows) {
  const staff = group => {
    const evidence = match(group, staffRows, 'STAFF_ID', 'ACTIVE', ['STAFF_ID', 'DEPT_ID', 'ACTIVE']);
    const currentDepartmentId = evidence.match.matches.length === 1 ? centralId(evidence.match.matches[0].DEPT_ID) : undefined;
    const department = match({ sourceId: raw(currentDepartmentId), kind: kind(currentDepartmentId) }, departmentRows, 'DEPT_ID', 'STATUS', ['DEPT_ID', 'STATUS']);
    return { ...evidence, currentDepartmentMatch: department.match };
  };
  const departments = source.departmentIds.map(group => match(group, departmentRows, 'DEPT_ID', 'STATUS', ['DEPT_ID', 'STATUS']));
  const owners = source.owners.map(group => {
    const evidence = staff(group);
    const documents = source.documents.filter(document => document.ownerKind === group.kind && document.ownerId === group.sourceId);
    const historical = new Map(documents.map(document => [JSON.stringify([document.historicalDepartmentKind, document.historicalDepartmentId]), { sourceId: document.historicalDepartmentId, kind: document.historicalDepartmentKind }]));
    const historicalDepartments = [...historical.values()];
    const currentDepartmentId = evidence.match.matches.length === 1 ? centralId(evidence.match.matches[0].DEPT_ID) : null;
    return { ...evidence, historicalDepartments, currentDepartmentId, currentDepartmentDiffersFromHistorical: evidence.match.matches.length === 1 ? historicalDepartments.some(department => department.kind === 'value' && department.sourceId !== currentDepartmentId) : null };
  });
  const summary = { sourceDocuments: source.documents.length, ownerGroups: owners.length, ownerDocuments: Object.fromEntries(['active', 'inactive', 'missing', 'ambiguous', 'unresolved'].map(status => [status, owners.filter(owner => owner.match.status === status).reduce((sum, owner) => sum + owner.documentCount, 0)])), ownerMatches: Object.fromEntries(['active', 'inactive', 'missing', 'ambiguous', 'unresolved'].map(status => [status, owners.filter(owner => owner.match.status === status).length])), productionReady: false, approvalsCreated: 0, grantsCreated: 0 };
  const actors = source.actors.map(staff), staffIds = source.staffIds.map(staff);
  summary.matches = Object.fromEntries(Object.entries({ owners, actors, staffIds, departmentIds: departments }).map(([name, groups]) => [name, Object.fromEntries(['active', 'inactive', 'missing', 'ambiguous', 'unresolved'].map(status => [status, groups.filter(group => group.match.status === status).length]))]));
  summary.currentDepartmentDiffersFromHistorical = owners.filter(owner => owner.currentDepartmentDiffersFromHistorical === true).length;
  summary.ownerCurrentDepartmentMatches = Object.fromEntries(['active', 'inactive', 'missing', 'ambiguous', 'unresolved'].map(status => [status, owners.filter(owner => owner.currentDepartmentMatch.status === status).length]));
  return { ...source, owners, actors, staffIds, departmentIds: departments, summary };
}
