const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === expected.length && Object.keys(value).every(key => expected.includes(key));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

// Same source/mapping binding and complete reference requirements as the
// closed-gate promotion rehearsal. Validate before creating any database.
export function validateTargets(targets, sourceSha256, plan) {
  if (!keys(targets, ['sourceSha256', 'mappingFingerprint', 'review', 'preservationApprovalReference', 'series', 'departments']) || targets.sourceSha256 !== sourceSha256 || targets.mappingFingerprint !== plan.mappingFingerprint || !text(targets.preservationApprovalReference, 200) || !targets.review || !text(targets.review.by, 200) || !text(targets.review.evidence, 500) || !/^\d{4}-\d{2}-\d{2}$/.test(targets.review.at ?? '') || !Number.isFinite(Date.parse(targets.review.at)) || new Date(targets.review.at).toISOString().slice(0, 10) !== targets.review.at) throw new Error('Reviewed target references must bind the source and mapping');
  const seriesIds = new Set(plan.mappedSeries.map(row => row.targetId));
  const departmentIds = new Set(plan.documents.map(row => row.departmentId));
  for (const [kind, expected, fields] of [['series', seriesIds, ['id', 'name', 'documentType']], ['departments', departmentIds, ['id', 'name']]]) {
    if (!Array.isArray(targets[kind]) || targets[kind].length !== expected.size) throw new Error('Complete reviewed target references required');
    const seen = new Set();
    for (const row of targets[kind]) {
      if (!keys(row, fields) || !expected.has(row.id) || seen.has(row.id) || !text(row.name, 200) || (kind === 'series' && !text(row.documentType, 100))) throw new Error('Invalid reviewed target reference');
      seen.add(row.id);
    }
  }
}

export function permissionSamples(plan) {
  return [
    ['confidential', row => row.confidential],
    ['department-private', row => !row.confidential && !row.published],
    ['faculty-published', row => !row.confidential && row.published],
  ].map(([kind, predicate]) => {
    const document = plan.documents.find(predicate);
    if (!document) throw new Error(`Actual snapshot lacks required permission coverage: ${kind}`);
    return { kind, document };
  });
}

export function allocationScope(plan, year) {
  const scope = plan.counters.find(row => row.year === year && row.floor > 0 && plan.mappedSeries.some(series => series.targetId === row.seriesId));
  if (!scope) throw new Error('Actual snapshot has no imported reservation floor in the current Bangkok year; continuity cannot be claimed');
  return scope;
}
