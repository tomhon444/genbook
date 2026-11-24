import { hash, profileDump } from './dump.mjs';
import { preservationPlan } from './preservation.mjs';
import { historyMetadataBuilder } from './history-metadata.mjs';

export const mappingVersion = 1;
export const canonicalSeries = value => /^\d{1,5}$/.test(value ?? '') && Number(value) > 0 ? String(Number(value)).padStart(5, '0') : null;
const policies = { subnumbers: 'null-is-zero-with-raw-preserved', duplicates: 'preserve-every-source-id', prefix: 'reviewed-current-series-reference', dates: 'stored-document-date-no-issued-time-conversion', pdf: 'unverified-files-remain-pending' };
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const fingerprint = value => hash(JSON.stringify(stable(value)));
const text = (value, max) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max;
const sourceText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const approval = value => value && typeof value === 'object' && text(value.by, 200) && text(value.evidence, 500) && typeof value.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.at) && Number.isFinite(Date.parse(value.at)) && new Date(value.at).toISOString().slice(0, 10) === value.at;
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}

// Drafts contain source IDs only, never invented target identities or approvals.
export function mappingTemplate(dump) {
  const documents = dump.tables.genbook.records;
  const references = new Map();
  for (const row of dump.tables.bookdept.records) {
    const id = canonicalSeries(row.bookdept_id);
    if (!id || references.has(id)) throw new Error('Ambiguous source series reference');
    references.set(id, row);
  }
  const sourceSeries = [...new Set([...references.keys(), ...documents.map(row => canonicalSeries(row.bookdept))])].sort();
  if (sourceSeries.includes(null)) throw new Error('Invalid source series');
  const identities = field => [...new Set(documents.map(row => row[field]).filter(value => typeof value === 'string' && value.length > 0))].sort().map(sourceId => ({ sourceId, decision: 'pending', targetId: '', review: null }));
  return { schemaVersion: mappingVersion, sourceSha256: dump.sourceSha256, sourceFingerprint: fingerprint(dump.tables), review: null,
    policies: Object.fromEntries(Object.keys(policies).map(key => [key, 'pending'])),
    series: sourceSeries.map(sourceId => ({ sourceId, sourcePrefix: references.get(sourceId)?.book_number ?? null, decision: 'pending', targetId: '', yearBasis: '', review: null })),
    owners: identities('user_request'), departments: identities('user_dept'), holds: [] };
}

// A plan is derived from the snapshot; no client-supplied document copies or
// changed subject/number/flags can enter the executable history plan.
export function mappingPlan(dump, mapping) {
  const template = mappingTemplate(dump), preserved = preservationPlan(dump), profile = profileDump(dump);
  const details = historyMetadataBuilder(dump);
  if (!exactKeys(mapping, Object.keys(template)) || mapping.schemaVersion !== mappingVersion || mapping.sourceSha256 !== dump.sourceSha256 || mapping.sourceFingerprint !== template.sourceFingerprint) throw new Error('Mapping must bind the exact source snapshot and schema');
  const blockers = [];
  const block = (code, kind, sourceId = null) => blockers.push({ code, kind, sourceId });
  if (!approval(mapping.review)) block('APPROVAL_REQUIRED', 'manifest');
  if (!exactKeys(mapping.policies, Object.keys(policies))) throw new Error('Unknown mapping policies');
  for (const [key, value] of Object.entries(policies)) if (mapping.policies[key] !== value) block('POLICY_REVIEW_REQUIRED', key);
  const references = new Map(dump.tables.bookdept.records.map(row => [canonicalSeries(row.bookdept_id), row]));
  const maps = {};
  for (const kind of ['series', 'owners', 'departments']) {
    if (!Array.isArray(mapping[kind])) throw new Error('Mapping arrays required');
    const expected = new Map(template[kind].map(row => [row.sourceId, row])), entries = new Map(), targets = new Set();
    for (const row of mapping[kind]) {
      const keys = kind === 'series' ? ['sourceId', 'sourcePrefix', 'decision', 'targetId', 'yearBasis', 'review'] : ['sourceId', 'decision', 'targetId', 'review'];
      if (!exactKeys(row, keys) || !expected.has(row.sourceId) || entries.has(row.sourceId) || !['pending', 'map', 'hold'].includes(row.decision)) throw new Error('Unknown, duplicate or malformed mapping decision');
      if (kind === 'series' && row.sourcePrefix !== expected.get(row.sourceId).sourcePrefix) throw new Error('Source prefix was changed');
      if (row.decision === 'pending' || !approval(row.review)) block('MAPPING_REVIEW_REQUIRED', kind, row.sourceId);
      if (row.decision === 'map') {
        if (!text(row.targetId, kind === 'series' ? 32 : 64) || targets.has(row.targetId)) throw new Error('Mappings must have distinct explicit target IDs');
        targets.add(row.targetId);
        if (kind === 'series') {
          const source = references.get(row.sourceId);
          const basis = row.sourceId === '00006' ? 'document_date' : 'calendar';
          if (!source || !sourceText(source.book_number, 100) || source.book_year !== 'y' || row.yearBasis !== basis) throw new Error('Unresolved prefix/year rule cannot be promoted');
        }
      } else if (row.targetId !== '' || (kind === 'series' && row.yearBasis !== '')) throw new Error('Pending/held mappings must not assign a target');
      entries.set(row.sourceId, row);
    }
    for (const sourceId of expected.keys()) if (!entries.has(sourceId)) block('MAPPING_MISSING', kind, sourceId);
    maps[kind] = entries;
  }
  if (!Array.isArray(mapping.holds)) throw new Error('Source holds must be an array');
  const sourceIds = new Set(dump.tables.genbook.records.map(row => row.gen_book_id)), holds = new Set();
  for (const row of mapping.holds) {
    if (!exactKeys(row, ['sourceId', 'review']) || !sourceIds.has(row.sourceId) || holds.has(row.sourceId)) throw new Error('Invalid explicit source hold');
    if (!approval(row.review)) block('HOLD_REVIEW_REQUIRED', 'genbook', row.sourceId);
    holds.add(row.sourceId);
  }
  const restrictions = new Set(preserved.dispositions.filter(row => row.table === 'genbook' && row.handling === 'restricted').map(row => row.sourceId));
  const unknownTime = new Set(preserved.dispositions.filter(row => row.table === 'genbook' && row.handling === 'unknown_time').map(row => row.sourceId));
  const documents = [], held = [], unresolved = [], invalid = [];
  for (const row of dump.tables.genbook.records) {
    const id = row.gen_book_id;
    if (restrictions.has(id)) { held.push({ sourceId: id, reason: 'restricted-source' }); continue; }
    if (holds.has(id)) { held.push({ sourceId: id, reason: 'explicit-hold' }); continue; }
    const series = maps.series.get(canonicalSeries(row.bookdept)), owner = maps.owners.get(row.user_request), department = maps.departments.get(row.user_dept);
    const decisions = [series, owner, department];
    const pending = decisions.some(value => !value || value.decision === 'pending' || !approval(value.review));
    if (!pending && decisions.some(value => value.decision === 'hold')) { held.push({ sourceId: id, reason: 'held-mapping' }); continue; }
    const date = row.date_request;
    const issues = [];
    if (typeof row.title !== 'string') issues.push('MISSING_SOURCE_SUBJECT');
    else if (!row.title.trim()) issues.push('EMPTY_SOURCE_SUBJECT');
    else if (row.title.length > 500) issues.push('SOURCE_SUBJECT_TOO_LONG');
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1000-01-01' || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) issues.push('INVALID_SOURCE_DOCUMENT_DATE');
    if (issues.length) { invalid.push(id); for (const code of issues) block(code, 'genbook', id); continue; }
    if (pending) { unresolved.push(id); continue; }
    const confidential = row.secret === '1', cancelled = row.status_genbook === 'c';
    documents.push({ sourceId: id, ownerId: owner.targetId, departmentId: department.targetId, seriesId: series.targetId, year: Number(row.gen_book_year), main: Number(row.book_number), sub: Number(row.book_number_insert ?? 0), prefix: series.sourcePrefix, subject: row.title, documentDate: date, confidential, published: row.publish === '1', cancelled, pdfPending: !confidential && !cancelled, details: details(row) });
  }
  documents.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const floors = new Map();
  for (const reservation of preserved.reservations) {
    const series = maps.series.get(reservation.series);
    if (!series || series.decision !== 'map' || !approval(series.review)) continue;
    const key = JSON.stringify([series.targetId, reservation.year]);
    const old = floors.get(key);
    floors.set(key, { seriesId: series.targetId, legacySeriesId: reservation.series, year: reservation.year, floor: Math.max(old?.floor ?? 0, reservation.main) });
  }
  const counters = [...floors.values()].sort((a, b) => a.seriesId.localeCompare(b.seriesId) || a.year - b.year);
  const mappedSeries = [...maps.series.values()].filter(row => row.decision === 'map' && approval(row.review)).sort((a, b) => a.targetId.localeCompare(b.targetId));
  const metadataIssueCounts = {};
  for (const row of blockers) if (row.kind === 'genbook' && row.code !== 'HOLD_REVIEW_REQUIRED') metadataIssueCounts[row.code] = (metadataIssueCounts[row.code] ?? 0) + 1;
  const summary = { sourceSha256: dump.sourceSha256, sourceDocuments: sourceIds.size, sourceReservations: preserved.reservations.length, sourceRows: Object.values(profile.counts).reduce((a, b) => a + b, 0), historyDocuments: documents.length, heldDocuments: held.length, unresolvedDocuments: unresolved.length, invalidDocuments: invalid.length, metadataIssueCounts, unknownTimeDocuments: documents.filter(row => unknownTime.has(row.sourceId)).length, duplicateGroups: profile.duplicateGroups, counterScopes: counters.length, unmappedReservationScopes: preserved.summary.sourceScopes - counters.length, blockers: blockers.length, readyForLocalPromotion: blockers.length === 0 && unresolved.length === 0 && documents.length > 0, gate: 'blocked', productionReady: false };
  if (summary.historyDocuments + summary.heldDocuments + summary.unresolvedDocuments + summary.invalidDocuments !== summary.sourceDocuments) throw new Error('Source reconciliation mismatch');
  return { summary, blockers, documents, held, unresolved, invalid, counters, mappedSeries, mappingFingerprint: fingerprint(mapping), planFingerprint: fingerprint({ documents, held, counters, mappedSeries }) };
}

