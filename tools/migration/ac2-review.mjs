import { fingerprint, mappingPlan } from './mapping.mjs';
import { buildMappingProposal } from './mapping-proposal.mjs';
import { collectSourceReferences } from './identity-evidence.mjs';
import { validateTargets } from './http-rehearsal-input.mjs';
import { buildAttachmentInventory } from './attachments.mjs';
import { buildLegacyCatalog } from '../issuance/legacy-catalog.mjs';

const same = (left, right) => fingerprint(left) === fingerprint(right);
const refuse = message => { throw new Error(`AC2 review refused: ${message}`); };
const key = row => JSON.stringify([row.kind, row.sourceId]);
const status = row => row?.match?.status ?? 'unresolved';
const nativeRows = (native, name) => {
  const table = native.tables.find(row => row.name === name);
  return (table?.records ?? []).map(row => Object.fromEntries((table.columns ?? []).map((column, index) => [column, row[index]])));
};
const unknown = value => value === null || value === undefined || value === '';
const timeKind = value => {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (value === '') return 'blank';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return 'invalid';
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19).replace('T', ' ') === value ? 'valid_text' : 'invalid';
};
const timeCounts = values => Object.fromEntries(['absent', 'null', 'blank', 'invalid', 'valid_text'].map(kind => [kind, values.filter(value => timeKind(value) === kind).length]));
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...keys].sort());
const reviewed = value => exactKeys(value, ['by', 'at', 'evidence']) && ['by', 'evidence'].every(key => typeof value[key] === 'string' && value[key].trim().length > 0 && value[key].length <= 500)
  && typeof value.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.at) && Number.isFinite(Date.parse(value.at)) && new Date(value.at).toISOString().slice(0, 10) === value.at;
function validateTimeDisplayApproval(approval, sourceSha256, mappingFingerprint) {
  if (approval === null) return;
  if (!exactKeys(approval, ['schemaVersion', 'sourceSha256', 'mappingFingerprint', 'scope', 'policy', 'review', 'userResponse']) || approval.schemaVersion !== 1
    || approval.sourceSha256 !== sourceSha256 || approval.mappingFingerprint !== mappingFingerprint || approval.scope !== 'historical-time-display-only'
    || approval.policy !== 'preserve-source-text-with-unverified-timezone-and-unknown-missing' || !reviewed(approval.review)
    || approval.userResponse !== 'แสดงข้อความเวลาเดิมพร้อมระบุว่ายังไม่ยืนยันเขตเวลา และคงค่าที่หายเป็นไม่ทราบ (แนะนำ)') refuse('time display approval scope or binding mismatch');
}

function corroborateEvidence(dump, native, packet) {
  if (native?.sourceSha256 !== dump.sourceSha256 || !Array.isArray(native.tables)) refuse('native snapshot binding mismatch');
  for (const [name, table] of Object.entries(dump.tables)) if (!same(nativeRows(native, name), table.records)) refuse('native and migration source rows differ');
  // Reuse the existing strict evidence validator for source references, exact
  // CENTRAL matches, selected columns, provenance and no-approval metadata.
  buildMappingProposal(dump, packet);
  const source = collectSourceReferences(native), evidence = packet.evidence;
  for (const name of ['documents', 'series', 'grants']) if (!same(evidence[name], source[name])) refuse(`${name} native source coverage mismatch`);
  for (const name of ['owners', 'actors', 'staffIds', 'departmentIds']) {
    const actual = new Map((evidence[name] ?? []).map(row => [key(row), row]));
    if (actual.size !== source[name].length || actual.size !== evidence[name].length) refuse(`${name} native group coverage mismatch`);
    for (const row of source[name]) {
      const group = actual.get(key(row));
      if (!group || !same(Object.fromEntries(Object.keys(row).map(field => [field, group[field]])), row)) refuse(`${name} native group changed`);
      if (name !== 'departmentIds') {
        const department = group.currentDepartmentMatch;
        const currentId = group.match.matches.length === 1 ? group.match.matches[0].DEPT_ID : null;
        const exactId = typeof currentId === 'number' ? String(currentId) : currentId;
        if (!department || !Array.isArray(department.matches)) refuse('current department evidence missing');
        for (const match of department.matches) if (!same(Object.keys(match).sort(), ['DEPT_ID', 'STATUS']) || String(match.DEPT_ID) !== exactId) refuse('current department identity mismatch');
        const expected = unknown(exactId) ? 'unresolved' : department.matches.length === 0 ? 'missing' : department.matches.length > 1 ? 'ambiguous' : ['1', 1].includes(department.matches[0].STATUS) ? 'active' : 'inactive';
        if (department.status !== expected || unknown(exactId) && department.matches.length) refuse('current department status mismatch');
      }
    }
  }
  return source;
}

// Data-only review preparation. None of these outputs is an executable grants,
// mapping, target configuration or approval file. Do not serialize native tables.
export function buildAc2Review({ dump, native, mapping, targets, packet, timeDisplayApproval = null }) {
  const plan = mappingPlan(dump, mapping);
  if (!plan.summary.readyForLocalPromotion) refuse('approved mapping is not ready');
  validateTargets(targets, dump.sourceSha256, plan);
  validateTimeDisplayApproval(timeDisplayApproval, dump.sourceSha256, plan.mappingFingerprint);
  const source = corroborateEvidence(dump, native, packet);
  const catalog = buildLegacyCatalog(dump);
  const usedDepartments = new Set(plan.documents.map(row => row.departmentId));
  const references = {
    sourceSha256: dump.sourceSha256, review: null, executable: false,
    series: plan.mappedSeries.map(row => {
      const candidate = catalog.series.find(item => item.id === row.sourceId);
      if (!candidate) refuse('mapped series has no source catalog entry');
      const rehearsal = targets.series.find(item => item.id === row.targetId);
      return { sourceId: row.sourceId, targetId: row.targetId, prefix: row.sourcePrefix, yearBasis: row.yearBasis,
        sourceCandidate: { name: candidate.name, documentType: candidate.documentType, provenance: candidate.source },
        rehearsalOnly: { name: rehearsal.name, documentType: rehearsal.documentType },
        displayName: '', documentType: '', decision: 'pending', review: null, enabled: false };
    }),
    departments: mapping.departments.filter(row => row.decision === 'map').map(row => ({ sourceId: row.sourceId, targetId: row.targetId,
      usedByPromotedHistory: usedDepartments.has(row.targetId),
      sourceAliases: catalog.departments.find(item => item.id === row.sourceId)?.aliases ?? [],
      rehearsalOnlyName: targets.departments.find(item => item.id === row.targetId)?.name ?? null,
      displayName: '', nameVerified: false, decision: 'pending', review: null })),
    documentTypes: catalog.documentTypes.map(row => ({ sourceId: row.id, sourceCandidateName: row.name, displayName: '', decision: 'pending', review: null })),
    departmentNameEvidence: 'not-collected; source aliases are not verified department names',
  };
  const staffGroups = new Map(packet.evidence.staffIds.map(row => [key(row), row]));
  const departments = new Map(packet.evidence.departmentIds.map(row => [key(row), row]));
  const ownerMaps = new Map(mapping.owners.map(row => [row.sourceId, row]));
  const seriesMaps = new Map(mapping.series.map(row => [row.sourceId, row]));
  const sourceSeries = new Map(source.series.map(row => [row.sourceId, row]));
  const pairs = new Map();
  for (const row of source.grants) { const pair = JSON.stringify([row.staffId, row.seriesId]); pairs.set(pair, (pairs.get(pair) ?? 0) + 1); }
  const reasonCounts = {};
  const grantRows = source.grants.map(row => {
    const staff = staffGroups.get(JSON.stringify([row.staffKind, row.staffId]));
    const owner = ownerMaps.get(row.staffId), series = seriesMaps.get(row.seriesId);
    const reference = sourceSeries.get(row.seriesId);
    const department = departments.get(JSON.stringify([typeof row.departmentId === 'string' && row.departmentId ? 'value' : row.departmentId === '' ? 'blank' : 'null', row.departmentId]));
    const reasons = [];
    if (!reference || reference.status !== 'unique') reasons.push('source-series-missing');
    if (!series || series.decision !== 'map') reasons.push('series-mapping-held-or-missing');
    if (!owner || owner.decision !== 'map') reasons.push('owner-mapping-required');
    if (status(staff) !== 'active') reasons.push(`staff-${status(staff)}`);
    if (staff?.currentDepartmentMatch?.status !== 'active') reasons.push(`current-department-${staff?.currentDepartmentMatch?.status ?? 'unresolved'}`);
    if (status(department) !== 'active') reasons.push(`source-department-${status(department)}`);
    if (pairs.get(JSON.stringify([row.staffId, row.seriesId])) > 1) reasons.push('duplicate-staff-series');
    for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    return { sourceTable: 'bookdept_user', sourceRowIndex: row.rowIndex, sourceId: row.sourceId,
      staffId: row.staffId, staffKind: row.staffKind, rawSeriesId: row.rawSeriesId, sourceSeriesId: row.seriesId,
      sourceDepartmentId: row.departmentId, targetOwnerId: owner?.decision === 'map' ? owner.targetId : null,
      targetSeriesId: series?.decision === 'map' ? series.targetId : null,
      centralStaffStatus: status(staff), currentDepartmentStatus: staff?.currentDepartmentMatch?.status ?? 'unresolved',
      sourceDepartmentStatus: status(department), reasons, decision: 'pending', enabled: false, review: null };
  });
  const inventory = buildAttachmentInventory(dump);
  const attachmentCounts = Object.fromEntries(['pending', 'missing_reference', 'invalid_reference'].map(value => [value, inventory.entries.filter(row => row.status === value).length]));
  const promotedIds = new Set(plan.documents.map(row => row.sourceId));
  const documents = dump.tables.genbook.records;
  const times = { sourceSha256: dump.sourceSha256, timestampTimeZone: 'unverified', actualTimezoneVerified: false, timezoneDecision: 'pending', review: null,
    displayPolicyApproved: timeDisplayApproval !== null, displayPolicyReview: timeDisplayApproval === null ? null : { scope: timeDisplayApproval.scope, policy: timeDisplayApproval.policy, review: timeDisplayApproval.review, userResponse: timeDisplayApproval.userResponse },
    raw: { documents: documents.length, recordedAtUnknown: documents.filter(row => unknown(row.user_datetime)).length, updatedAtUnknown: documents.filter(row => unknown(row.lastupdate)).length,
      recordedAtTextKinds: timeCounts(documents.map(row => row.user_datetime)), updatedAtTextKinds: timeCounts(documents.map(row => row.lastupdate)) },
    promoted: { documents: plan.documents.length, recordedAtUnknown: plan.documents.filter(row => unknown(row.details.recordedAtText)).length, updatedAtUnknown: plan.documents.filter(row => unknown(row.details.updatedAtText)).length,
      recordedAtTextKinds: timeCounts(plan.documents.map(row => row.details.recordedAtText)), updatedAtTextKinds: timeCounts(plan.documents.map(row => row.details.updatedAtText)) },
    unknownRecordedAtRows: documents.filter(row => unknown(row.user_datetime)).map(row => ({ sourceId: row.gen_book_id, recordedAtText: row.user_datetime ?? null,
      sourceValueKind: row.user_datetime === undefined ? 'absent' : row.user_datetime === null ? 'null' : 'blank', promoted: promotedIds.has(row.gen_book_id), decision: 'preserve-unknown', review: null })),
    exportTimezoneIsNotApplicationTimezone: true, utcConversionPerformed: false };
  const acceptance = { sourceSha256: dump.sourceSha256, ac2Approved: false, reviewer: null, reviewedAt: null, evidence: null,
    checks: ['final-source-snapshot', 'display-references', 'issuance-permissions', 'attachments-and-pending-policy', 'time-display-policy', 'historical-timezone', 'real-identity-acceptance'].map(id => ({ id,
      decision: id === 'time-display-policy' && timeDisplayApproval !== null ? 'accepted' : 'pending', review: id === 'time-display-policy' && timeDisplayApproval !== null ? timeDisplayApproval.review : null })),
    productionMigrationApproved: false, cutoverApproved: false };
  const summary = { sourceSha256: dump.sourceSha256, sourceDocuments: documents.length, promotedHistoryDocuments: plan.documents.length, heldDocuments: plan.held.length,
    mappedSeries: references.series.length, mappedDepartments: references.departments.length, promotedDepartments: usedDepartments.size,
    legacyGrantRows: grantRows.length, grantReasonCounts: reasonCounts,
    attachmentDocuments: inventory.entries.length, attachmentPendingDocuments: attachmentCounts.pending, attachmentMissingReferences: attachmentCounts.missing_reference,
    attachmentInvalidReferences: attachmentCounts.invalid_reference, uniqueReferencedFiles: new Set(inventory.entries.filter(row => row.sourcePath).map(row => row.sourcePath)).size,
    attachmentInventorySha256: inventory.inventorySha256, attachmentBytesVerified: 0, downloadsAttempted: 0,
    promotedPdfPending: plan.documents.filter(row => row.pdfPending).length,
    attachmentReferenceStatusByDisposition: Object.fromEntries(['promoted', 'held'].map(disposition => [disposition,
      Object.fromEntries(['pending', 'missing_reference', 'invalid_reference'].map(value => [value, inventory.entries.filter(row => row.status === value && promotedIds.has(row.sourceId) === (disposition === 'promoted')).length]))])),
    unknownRecordedAtRaw: times.raw.recordedAtUnknown, unknownRecordedAtPromoted: times.promoted.recordedAtUnknown,
    pendingAcceptanceChecks: acceptance.checks.filter(row => row.decision === 'pending').length, timeDisplayPolicyApproved: timeDisplayApproval !== null,
    ac2Approved: false, productionReady: false, grantsCreated: 0, approvalsCreated: 0, databaseWritesPerformed: false };
  return { summary, references, grants: { sourceSha256: dump.sourceSha256, executable: false, rolesCreateGrants: false, review: null, rows: grantRows },
    attachments: inventory, times, acceptance };
}
