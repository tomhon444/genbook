import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTargets, permissionSamples, allocationScope } from './http-rehearsal-input.mjs';

const plan = () => ({
  mappingFingerprint: 'mapping-digest',
  mappedSeries: [{ targetId: 'S1' }],
  documents: [
    { sourceId: '1', departmentId: 'D1', confidential: true, published: true },
    { sourceId: '2', departmentId: 'D1', confidential: false, published: false },
    { sourceId: '3', departmentId: 'D1', confidential: false, published: true },
  ],
  counters: [{ seriesId: 'S1', year: 2569, floor: 98 }],
});
const targets = () => ({ sourceSha256: 'source-digest', mappingFingerprint: 'mapping-digest',
  review: { by: 'Fixture reviewer', evidence: 'Fixture approval', at: '2026-11-23' },
  preservationApprovalReference: 'Fixture preservation approval',
  series: [{ id: 'S1', name: 'Fixture series', documentType: 'Fixture type' }],
  departments: [{ id: 'D1', name: 'Fixture department' }],
});

test('reviewed target references must bind source, mapping and the complete distinct target set', () => {
  assert.doesNotThrow(() => validateTargets(targets(), 'source-digest', plan()));
  for (const change of [
    value => { value.sourceSha256 = 'changed'; },
    value => { value.mappingFingerprint = 'changed'; },
    value => { value.review.at = '2026-02-30'; },
    value => { value.series.push({ ...value.series[0] }); },
    value => { value.departments = []; },
    value => { value.series[0].unexpected = true; },
  ]) {
    const value = targets(); change(value);
    assert.throws(() => validateTargets(value, 'source-digest', plan()));
  }
});

test('permission coverage requires actual confidential, unpublished and published history samples', () => {
  assert.deepEqual(permissionSamples(plan()).map(row => row.kind), ['confidential', 'department-private', 'faculty-published']);
  const incomplete = plan(); incomplete.documents = incomplete.documents.filter(row => !row.confidential);
  assert.throws(() => permissionSamples(incomplete), /permission coverage/);
});

test('allocation refuses a year without a positive imported reservation floor', () => {
  assert.equal(allocationScope(plan(), 2569).floor, 98);
  assert.throws(() => allocationScope(plan(), 2570), /current Bangkok year/);
  const empty = plan(); empty.counters[0].floor = 0;
  assert.throws(() => allocationScope(empty, 2569), /current Bangkok year/);
});
