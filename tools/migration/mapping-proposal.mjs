import { canonicalSeries, fingerprint, mappingTemplate, mappingPlan } from './mapping.mjs';
import { preservationPlan } from './preservation.mjs';
import { collectSourceReferences } from './identity-evidence.mjs';

const policySuggestions = { subnumbers: 'null-is-zero-with-raw-preserved', duplicates: 'preserve-every-source-id', prefix: 'reviewed-current-series-reference', dates: 'stored-document-date-no-issued-time-conversion', pdf: 'unverified-files-remain-pending' };
const refuse = message => { throw new Error(`Mapping proposal refused: ${message}`); };
const equal = (a, b) => fingerprint(a) === fingerprint(b);
const key = row => JSON.stringify([row.kind, row.sourceId]);
const centralId = value => typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
const active = value => value === '1' || value === 1;
const countDecisions = rows => ({ map: rows.filter(row => row.decision === 'map').length, hold: rows.filter(row => row.decision === 'hold').length });

function uniqueGroups(rows, label) {
  if (!Array.isArray(rows)) refuse(`${label} groups missing`);
  const groups = new Map();
  for (const row of rows) {
    if (!row || !['value', 'null', 'blank', 'absent', 'invalid'].includes(row.kind) || groups.has(key(row))) refuse(`${label} duplicate or malformed group`);
    if (row.kind === 'value' && (typeof row.sourceId !== 'string' || row.sourceId.length === 0) || ['null', 'absent'].includes(row.kind) && row.sourceId !== null || row.kind === 'blank' && row.sourceId !== '') refuse(`${label} source identity changed`);
    if (Object.hasOwn(row, 'targetId') || Object.hasOwn(row, 'candidateTargetId')) refuse(`${label} unexpected target identity`);
    groups.set(key(row), row);
  }
  return groups;
}

function validateMatch(group, idField, statusField) {
  const evidence = group.match;
  if (!evidence || !equal(Object.keys(evidence).sort(), ['matches', 'status']) || !Array.isArray(evidence.matches)) refuse('malformed CENTRAL match');
  const fields = idField === 'STAFF_ID' ? ['ACTIVE', 'DEPT_ID', 'STAFF_ID'] : ['DEPT_ID', 'STATUS'];
  for (const row of evidence.matches) {
    if (!row || !equal(Object.keys(row).sort(), fields) || centralId(row[idField]) !== group.sourceId) refuse('CENTRAL exact identity or selected columns changed');
  }
  const expected = group.kind !== 'value' ? 'unresolved' : evidence.matches.length === 0 ? 'missing' : evidence.matches.length > 1 ? 'ambiguous' : active(evidence.matches[0][statusField]) ? 'active' : 'inactive';
  if (evidence.status !== expected || group.kind !== 'value' && evidence.matches.length) refuse('CENTRAL match status contradicts its rows');
}

function validatePacket(dump, packet) {
  if (!packet || packet.schemaVersion !== 1 || packet.sourceSha256 !== dump.sourceSha256 || packet.evidence?.sourceSha256 !== dump.sourceSha256) refuse('source SHA binding mismatch');
  const central = packet.central;
  if (central?.provider !== 'central' || !['transaction_read_only', 'tx_read_only'].includes(central.readOnlyFlag) || central.characterSetResults !== 'utf8mb4' || typeof central.consistencyNote !== 'string' || !central.consistencyNote.trim()) refuse('verified read-only CENTRAL metadata required');
  if (!Array.isArray(central.tables) || central.tables.length !== 2 || !['STAFF_INFO', 'DEPT'].every(name => central.tables.filter(row => row.TABLE_NAME === name && typeof row.ENGINE === 'string').length === 1) || central.consistentSnapshot !== central.tables.every(row => row.ENGINE.toUpperCase() === 'INNODB')) refuse('CENTRAL engine consistency metadata mismatch');
  if (!equal(central.selectedColumns, { staff: ['STAFF_ID', 'DEPT_ID', 'ACTIVE'], departments: ['DEPT_ID', 'STATUS'] })) refuse('CENTRAL selected columns mismatch');
  if (packet.approvals !== null || packet.readyForLocalPromotion !== false || packet.productionReady !== false) refuse('evidence must remain unapproved');
  // The parser's six tables corroborate historical ownership. Native-only role
  // and grant tables may add directory references, never mapping authority.
  const native = { sourceSha256: dump.sourceSha256, tables: Object.entries(dump.tables).map(([name, table]) => {
    const columns = [...new Set(table.records.flatMap(row => Object.keys(row)))];
    return { name, columns, records: table.records.map(row => columns.map(column => row[column])) };
  }) };
  const expected = collectSourceReferences(native), evidence = packet.evidence;
  if (!Array.isArray(evidence.documents) || evidence.documents.length !== expected.documents.length) refuse('document coverage mismatch');
  const documents = new Map(expected.documents.map(row => [row.sourceId, row]));
  if (documents.size !== expected.documents.length) refuse('duplicate source documents');
  const seen = new Set();
  for (const row of evidence.documents) {
    if (seen.has(row.sourceId) || !documents.has(row.sourceId) || !equal(row, documents.get(row.sourceId))) refuse('document identity links changed');
    seen.add(row.sourceId);
  }
  if (!equal(evidence.series, expected.series)) refuse('series references changed');
  const indexes = {};
  for (const name of ['owners', 'actors', 'staffIds', 'departmentIds']) {
    const actual = uniqueGroups(evidence[name], name), required = new Map(expected[name].map(row => [key(row), row]));
    indexes[name] = actual;
    if (['owners', 'actors'].includes(name) && actual.size !== required.size) refuse(`${name} extra or missing groups`);
    for (const [id, row] of required) {
      const candidate = actual.get(id);
      if (!candidate || candidate.documentCount !== row.documentCount || !Number.isSafeInteger(candidate.referenceCount) || candidate.referenceCount < row.referenceCount || !Array.isArray(candidate.references) || candidate.references.length > 5) refuse(`${name} source counts changed`);
      if (['owners', 'actors'].includes(name) && candidate.referenceCount !== row.referenceCount) refuse(`${name} source reference counts changed`);
      for (let index = 0; index < row.references.length; index++) if (!equal(candidate.references[index], row.references[index])) refuse(`${name} source references changed`);
    }
    for (const [id, row] of actual) {
      if (!required.has(id) && (!['staffIds', 'departmentIds'].includes(name) || !Array.isArray(row.references) || !row.references.length || row.references.some(reference => !['bookdept_user', 'userbook', 'userlevel', 'user_tb'].includes(reference.table)) || row.documentCount !== 0)) refuse(`${name} unexplained extra group`);
      validateMatch(row, name === 'departmentIds' ? 'DEPT_ID' : 'STAFF_ID', name === 'departmentIds' ? 'STATUS' : 'ACTIVE');
    }
  }
  for (const name of ['owners', 'actors']) for (const [id, row] of indexes[name]) if (!equal(row.match, indexes.staffIds.get(id)?.match)) refuse('inconsistent owner/actor directory evidence');
  return indexes;
}

export function buildMappingProposal(dump, packet) {
  const indexes = validatePacket(dump, packet), mapping = mappingTemplate(dump), preserved = preservationPlan(dump);
  const decisions = { owners: [], departments: [], series: [], holds: [], policySuggestions: { ...policySuggestions }, counterPreview: [], documents: [] };
  for (const [name, evidenceName] of [['owners', 'owners'], ['departments', 'departmentIds']]) for (const row of mapping[name]) {
    const evidence = indexes[evidenceName].get(JSON.stringify(['value', row.sourceId]));
    if (!evidence) refuse(`${name} evidence missing`);
    const status = evidence.match.status;
    const safeId = row.sourceId.trim() === row.sourceId && row.sourceId.length <= 64;
    row.decision = ['active', 'inactive'].includes(status) && safeId ? 'map' : 'hold';
    row.targetId = row.decision === 'map' ? row.sourceId : '';
    decisions[name].push({ sourceId: row.sourceId, decision: row.decision, targetId: row.targetId, reason: safeId ? `central-${status}` : 'source-id-not-valid-target', review: null });
  }
  const references = new Map(dump.tables.bookdept.records.map(row => [canonicalSeries(row.bookdept_id), row]));
  for (const row of mapping.series) {
    const reference = references.get(row.sourceId);
    const valid = reference && typeof reference.book_number === 'string' && reference.book_number.trim().length > 0 && reference.book_number.length <= 100 && reference.book_year === 'y';
    row.decision = valid ? 'map' : 'hold';
    row.targetId = valid ? row.sourceId : '';
    row.yearBasis = valid ? row.sourceId === '00006' ? 'document_date' : 'calendar' : '';
    decisions.series.push({ ...row, reason: !reference ? 'missing-source-series-reference' : valid ? 'source-prefix-year-rule-candidate' : 'invalid-source-prefix-year-rule' });
  }
  const restrictions = new Set(preserved.dispositions.filter(row => row.table === 'genbook' && row.handling === 'restricted').map(row => row.sourceId));
  for (const row of dump.tables.genbook.records) if (!restrictions.has(row.gen_book_id) && (row.title == null || typeof row.title === 'string' && !row.title.trim())) {
    mapping.holds.push({ sourceId: row.gen_book_id, review: null });
    decisions.holds.push({ sourceId: row.gen_book_id, reason: 'blank-source-subject-preserved', review: null });
  }
  const explicit = new Set(mapping.holds.map(row => row.sourceId));
  const maps = Object.fromEntries(['owners', 'departments', 'series'].map(name => [name, new Map(mapping[name].map(row => [row.sourceId, row]))]));
  const metadata = new Map();
  for (const blocker of mappingPlan(dump, mapping).blockers.filter(row => row.kind === 'genbook' && row.code !== 'HOLD_REVIEW_REQUIRED')) {
    if (!metadata.has(blocker.sourceId)) metadata.set(blocker.sourceId, []);
    metadata.get(blocker.sourceId).push(blocker.code);
  }
  const reasonCounts = {};
  for (const row of dump.tables.genbook.records) {
    const reasons = [];
    if (restrictions.has(row.gen_book_id)) reasons.push('restricted-source');
    if (explicit.has(row.gen_book_id)) reasons.push('blank-source-subject-preserved');
    for (const [name, id] of [['owners', row.user_request], ['departments', row.user_dept], ['series', canonicalSeries(row.bookdept)]]) if (maps[name].get(id)?.decision !== 'map') reasons.push(`held-${name}`);
    reasons.push(...(metadata.get(row.gen_book_id) ?? []));
    for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    decisions.documents.push({ sourceId: row.gen_book_id, state: reasons.length ? 'held' : 'readyCandidate', reasons });
  }
  const floors = new Map();
  for (const reservation of preserved.reservations) if (maps.series.get(reservation.series)?.decision === 'map') {
    const id = JSON.stringify([reservation.series, reservation.year]);
    const floor = Math.max(floors.get(id)?.floor ?? 0, reservation.main);
    floors.set(id, { seriesId: reservation.series, legacySeriesId: reservation.series, year: reservation.year, floor, previewOnly: true, approved: false });
  }
  decisions.counterPreview = [...floors.values()].sort((a, b) => a.seriesId.localeCompare(b.seriesId) || a.year - b.year);
  const readyCandidate = decisions.documents.filter(row => row.state === 'readyCandidate').length;
  const summary = { sourceSha256: dump.sourceSha256, owners: countDecisions(mapping.owners), departments: countDecisions(mapping.departments), series: countDecisions(mapping.series), blankSubjectHolds: mapping.holds.length, documents: { total: decisions.documents.length, readyCandidate, held: decisions.documents.length - readyCandidate }, reasonCounts, counterPreviewScopes: decisions.counterPreview.length, approvalsCreated: 0, grantsCreated: 0, readyForLocalPromotion: false, productionReady: false };
  return { mapping, decisions, summary };
}
