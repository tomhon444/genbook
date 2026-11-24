import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSourceReferences, buildIdentityEvidence } from './identity-evidence.mjs';

const table = (name, columns, records) => ({ name, columns, records });
function fixture() {
  return { sourceSha256: 'synthetic-sha', tables: [
    table('genbook', ['gen_book_id', 'user_request', 'user_login', 'user_dept', 'bookdept'], [
      ['d1', '001', 'actor', 'old', '1'], ['d2', '001', null, 'older', '00001'],
      ['d3', '1', '', 'old', '2'], ['d4', ' 001 ', '001', null, '9'],
      ['d5', null, 'other', '', 'x'], ['d6', '', '001', 'old', null],
      ['d7', 'duplicate', '001', 'old', '1'], ['d8', 'gone', '001', 'old', '1'],
    ]),
    table('bookdept', ['bookdept_id', 'dept_id'], [['1', 'old'], ['00001', 'old'], ['2', 'new']]),
    table('book', ['dept_id'], [['book-only']]),
    table('bookdept_user', ['bookdept_user_id', 'staff_id', 'dept_id', 'bookdept_id'], [['g1', 'grant-only', 'grant-dept', '2']]),
    table('userbook', ['staff_id', 'bookdept_bookdeptid', 'userlevel_iduserlevel'], [['manager-only', '2', '2']]),
    table('userlevel', ['staff_id', 'userlevel'], [['role-only', '1']]),
    table('user_tb', ['staff_id'], [['directory-only']]),
  ] };
}
const byId = (rows, id) => rows.find(row => row.sourceId === id);

test('collects exact identities, historical departments and source grants without promoting roles', () => {
  const plan = fixture(), original = structuredClone(plan), source = collectSourceReferences(plan);
  assert.deepEqual(plan, original);
  assert.equal(source.sourceSha256, 'synthetic-sha');
  for (const id of ['001', '1', ' 001 ', 'actor', 'grant-only', 'manager-only', 'role-only', 'directory-only']) assert.ok(byId(source.staffIds, id));
  for (const id of ['old', 'older', 'new', 'book-only', 'grant-dept']) assert.ok(byId(source.departmentIds, id));
  assert.equal(byId(source.owners, '001').documentCount, 2);
  assert.equal(byId(source.owners, null).kind, 'null');
  assert.equal(byId(source.actors, null).documentCount, 1);
  assert.equal(byId(source.actors, '').kind, 'blank');
  assert.equal(source.grants.length, 1);
  assert.equal(source.grants[0].staffId, 'grant-only');
  assert.equal(source.grants[0].decision, 'pending');
  assert.equal(source.grants[0].seriesId, '00002');
  assert.equal(source.series.find(row => row.sourceId === '00001').status, 'duplicate');
  assert.deepEqual(source.series.find(row => row.sourceId === '00001').rawIds.map(row => row.value), ['1', '00001']);
  assert.equal(source.series.find(row => row.sourceId === '00009').status, 'missing');
  assert.equal(source.series.filter(row => row.status === 'invalid').length, 2);
  assert.equal(source.totals.documents, 8);
});

test('matches exact CENTRAL IDs and preserves ambiguous, inactive and absent evidence', () => {
  const source = collectSourceReferences(fixture());
  const staff = [
    { STAFF_ID: '001', DEPT_ID: 'new', ACTIVE: '1', PASSWORD: 'must-not-export', NAME: 'must-not-export' },
    { STAFF_ID: '1', DEPT_ID: 'old', ACTIVE: 0 },
    { STAFF_ID: 'duplicate', DEPT_ID: 'old', ACTIVE: '1' },
    { STAFF_ID: 'duplicate', DEPT_ID: 'new', ACTIVE: '0' },
    { STAFF_ID: 'ACTOR', DEPT_ID: 'new', ACTIVE: 1 },
    { STAFF_ID: 2, DEPT_ID: 'old', ACTIVE: 1 },
  ];
  const departments = [{ DEPT_ID: 'old', STATUS: '1' }, { DEPT_ID: 'new', STATUS: 0 }, { DEPT_ID: 'older', STATUS: 1 }, { DEPT_ID: 'older', STATUS: 1 }];
  const before = structuredClone({ source, staff, departments });
  const result = buildIdentityEvidence(source, staff, departments);
  assert.deepEqual({ source, staff, departments }, before);
  assert.equal(byId(result.owners, '001').match.status, 'active');
  assert.equal(byId(result.owners, '1').match.status, 'inactive');
  assert.equal(byId(result.owners, ' 001 ').match.status, 'missing');
  assert.equal(byId(result.owners, 'gone').match.status, 'missing');
  assert.equal(byId(result.owners, 'duplicate').match.status, 'ambiguous');
  assert.equal(byId(result.owners, null).match.status, 'unresolved');
  assert.equal(byId(result.owners, '').match.status, 'unresolved');
  assert.equal(byId(result.actors, 'actor').match.status, 'missing');
  const owner = byId(result.owners, '001');
  assert.equal(owner.currentDepartmentId, 'new');
  assert.equal(owner.currentDepartmentDiffersFromHistorical, true);
  assert.deepEqual(owner.historicalDepartments, [{ sourceId: 'old', kind: 'value' }, { sourceId: 'older', kind: 'value' }]);
  assert.equal(result.documents[0].historicalDepartmentId, 'old');
  assert.equal(byId(result.departmentIds, 'older').match.status, 'ambiguous');
  assert.equal(byId(result.departmentIds, 'new').match.status, 'inactive');
  assert.equal(result.summary.ownerDocuments.active, 2);
  assert.equal(Object.values(result.summary.ownerDocuments).reduce((sum, count) => sum + count, 0), 8);
  assert.equal(result.summary.grantsCreated, 0);
  assert.equal(result.summary.approvalsCreated, 0);
  assert.equal(result.summary.productionReady, false);
  assert.doesNotMatch(JSON.stringify(result), /must-not-export|PASSWORD|NAME/);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(result)));
});

test('absent columns differ from null and blank without fabricating references', () => {
  const source = collectSourceReferences({ tables: [table('genbook', ['gen_book_id', 'user_request'], [['d', null]])] });
  assert.equal(source.owners[0].kind, 'null');
  assert.equal(source.actors[0].kind, 'absent');
  assert.equal(source.departmentIds[0].kind, 'absent');
  assert.equal(source.grants.length, 0);
  const result = buildIdentityEvidence(source, [{ STAFF_ID: null, DEPT_ID: 'x', ACTIVE: 1 }], []);
  assert.equal(result.owners[0].match.status, 'unresolved');
  assert.equal(result.actors[0].match.status, 'unresolved');
});

test('driver numeric IDs match their exact string representation without dropping source zeroes', () => {
  const source = collectSourceReferences({ tables: [table('genbook', ['gen_book_id', 'user_request', 'user_dept'], [['a', '1', '2'], ['b', '001', '02']])] });
  const result = buildIdentityEvidence(source, [{ STAFF_ID: 1, DEPT_ID: 2, ACTIVE: 1 }], [{ DEPT_ID: 2, STATUS: 1 }]);
  assert.equal(byId(result.owners, '1').match.status, 'active');
  assert.equal(byId(result.owners, '001').match.status, 'missing');
  assert.equal(byId(result.departmentIds, '2').match.status, 'active');
  assert.equal(byId(result.departmentIds, '02').match.status, 'missing');
  assert.equal(byId(result.owners, '1').currentDepartmentDiffersFromHistorical, false);
});

test('reference samples are bounded while total document coverage remains complete', () => {
  const source = collectSourceReferences({ tables: [table('genbook', ['gen_book_id', 'user_request', 'user_login', 'bookdept'], Array.from({ length: 12 }, (_, index) => [String(index), 'owner', 'owner', '1']))] });
  assert.equal(source.owners[0].references.length, 5);
  assert.equal(source.owners[0].referenceCount, 12);
  assert.equal(source.owners[0].documentCount, 12);
  assert.equal(source.staffIds[0].referenceCount, 24);
  assert.equal(source.series[0].references.length, 5);
  assert.equal(source.series[0].documentCount, 12);
  assert.equal(source.documents.length, 12);
});

test('current-only departments retain missing, inactive and ambiguous evidence for each identity role', () => {
  const source = collectSourceReferences({ tables: [table('genbook', ['gen_book_id', 'user_request', 'user_login', 'user_dept'], [
    ['a', 'missing', 'missing', 'historical'], ['b', 'inactive', 'inactive', 'historical'],
    ['c', 'ambiguous', 'ambiguous', 'historical'], ['d', 'duplicate-staff', 'duplicate-staff', 'historical'],
    ['e', 'active', 'active', 'historical'],
  ])] });
  const staff = ['missing', 'inactive', 'ambiguous', 'duplicate-staff', 'active'].map(id => ({ STAFF_ID: id, DEPT_ID: `current-${id}`, ACTIVE: 1 }));
  staff.push({ STAFF_ID: 'duplicate-staff', DEPT_ID: 'other', ACTIVE: 1 });
  const result = buildIdentityEvidence(source, staff, [
    { DEPT_ID: 'current-inactive', STATUS: 0, PRIVATE: 'must-not-export' },
    { DEPT_ID: 'current-ambiguous', STATUS: 1 }, { DEPT_ID: 'current-ambiguous', STATUS: 0 },
    { DEPT_ID: 'current-active', STATUS: '1' },
  ]);
  for (const role of ['owners', 'actors', 'staffIds']) {
    for (const [id, expected] of [['missing', 'missing'], ['inactive', 'inactive'], ['ambiguous', 'ambiguous'], ['duplicate-staff', 'unresolved'], ['active', 'active']]) {
      const identity = byId(result[role], id);
      assert.equal(identity.currentDepartmentMatch.status, expected);
      assert.equal(identity.match.status, id === 'duplicate-staff' ? 'ambiguous' : 'active');
    }
    assert.deepEqual(byId(result[role], 'inactive').currentDepartmentMatch.matches, [{ DEPT_ID: 'current-inactive', STATUS: 0 }]);
  }
  assert.equal(result.departmentIds.length, 1);
  assert.equal(result.documents[0].historicalDepartmentId, 'historical');
  assert.deepEqual(result.summary.ownerCurrentDepartmentMatches, { active: 1, inactive: 1, missing: 1, ambiguous: 1, unresolved: 1 });
  assert.doesNotMatch(JSON.stringify(result), /must-not-export|PRIVATE/);
});
