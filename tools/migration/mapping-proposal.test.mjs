import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMappingProposal } from './mapping-proposal.mjs';
import { collectSourceReferences, buildIdentityEvidence } from './identity-evidence.mjs';
import { preservationFixture } from './preservation-fixture.mjs';
import { mappingPlan } from './mapping.mjs';

function packetFor(dump, staff = [{ STAFF_ID: 'TEST-001', DEPT_ID: 'current-only', ACTIVE: '0' }], departments = [{ DEPT_ID: '204', STATUS: '1' }]) {
  const native = { sourceSha256: dump.sourceSha256, tables: Object.entries(dump.tables).map(([name, table]) => {
    const columns = [...new Set(table.records.flatMap(row => Object.keys(row)))];
    return { name, columns, records: table.records.map(row => columns.map(column => row[column])) };
  }) };
  return { schemaVersion: 1, sourceSha256: dump.sourceSha256,
    central: { provider: 'central', readOnlyFlag: 'transaction_read_only', characterSetResults: 'utf8mb4', consistentSnapshot: false,
      consistencyNote: 'Read-only transaction; nontransactional source tables do not provide a consistent snapshot.',
      tables: [{ TABLE_NAME: 'STAFF_INFO', ENGINE: 'MyISAM' }, { TABLE_NAME: 'DEPT', ENGINE: 'InnoDB' }],
      selectedColumns: { staff: ['STAFF_ID', 'DEPT_ID', 'ACTIVE'], departments: ['DEPT_ID', 'STATUS'] } },
    evidence: buildIdentityEvidence(collectSourceReferences(native), staff, departments), approvals: null, readyForLocalPromotion: false, productionReady: false };
}

test('proposes inactive exact owners and historical departments without approvals or grants', () => {
  const dump = preservationFixture(), packet = packetFor(dump), before = structuredClone({ dump, packet });
  const result = buildMappingProposal(dump, packet);
  assert.deepEqual({ dump, packet }, before);
  assert.equal(result.mapping.review, null);
  assert.equal(result.mapping.owners[0].decision, 'map');
  assert.equal(result.mapping.owners[0].targetId, 'TEST-001');
  assert.equal(result.decisions.owners[0].reason, 'central-inactive');
  assert.equal(result.mapping.departments[0].targetId, '204');
  assert.equal(result.mapping.series.find(row => row.sourceId === '00001').targetId, '00001');
  assert.equal(result.mapping.series.find(row => row.sourceId === '00096').decision, 'hold');
  for (const name of ['owners', 'departments', 'series', 'holds']) assert.ok(result.mapping[name].every(row => row.review === null));
  assert.ok(Object.values(result.mapping.policies).every(value => value === 'pending'));
  assert.equal(result.decisions.policySuggestions.subnumbers, 'null-is-zero-with-raw-preserved');
  assert.equal(result.summary.documents.total, 6);
  assert.equal(result.summary.documents.readyCandidate + result.summary.documents.held, 6);
  assert.equal(new Set(result.decisions.documents.map(row => row.sourceId)).size, 6);
  assert.equal(result.summary.readyForLocalPromotion, false);
  assert.equal(result.summary.approvalsCreated, 0);
  assert.equal(result.summary.grantsCreated, 0);
  assert.equal(result.mapping.grants, undefined);
  assert.equal(mappingPlan(dump, result.mapping).summary.readyForLocalPromotion, false);
});

test('preserves blank subjects as proposed holds and previews all reservations including held/cancelled rows', () => {
  const dump = preservationFixture();
  dump.tables.genbook.records[1].title = '  ';
  dump.tables.genbook.records[1].book_number = '150';
  const result = buildMappingProposal(dump, packetFor(dump));
  assert.deepEqual(result.mapping.holds, [{ sourceId: '2', review: null }]);
  assert.equal(result.summary.blankSubjectHolds, 1);
  assert.equal(result.decisions.counterPreview[0].floor, 150);
  assert.equal(result.decisions.counterPreview[0].approved, false);
  assert.equal(result.decisions.counterPreview[0].previewOnly, true);
  assert.ok(result.decisions.documents.find(row => row.sourceId === '2').reasons.includes('blank-source-subject-preserved'));
  assert.ok(result.decisions.documents.find(row => row.sourceId === '3').reasons.includes('restricted-source'));
  assert.equal(result.mapping.holds.some(row => row.sourceId === '3'), false);
});

test('leading-zero identity and historical department need their own exact CENTRAL matches', () => {
  const dump = preservationFixture();
  dump.tables.genbook.records[0].user_request = '001';
  dump.tables.genbook.records[0].user_dept = '0204';
  const packet = packetFor(dump, [{ STAFF_ID: 'TEST-001', DEPT_ID: 'current', ACTIVE: 1 }, { STAFF_ID: 1, DEPT_ID: '204', ACTIVE: 1 }]);
  const result = buildMappingProposal(dump, packet);
  assert.equal(result.mapping.owners.find(row => row.sourceId === '001').decision, 'hold');
  assert.equal(result.mapping.owners.find(row => row.sourceId === '001').targetId, '');
  assert.equal(result.mapping.departments.find(row => row.sourceId === '0204').decision, 'hold');
  assert.deepEqual(result.decisions.documents.find(row => row.sourceId === '1').reasons.sort(), ['held-departments', 'held-owners']);
  assert.equal(result.summary.reasonCounts['held-owners'], 2);
});

test('ambiguous CENTRAL evidence and bad prefix/year references remain held', () => {
  const dump = preservationFixture();
  dump.tables.bookdept.records[0].book_number = '';
  const packet = packetFor(dump, [{ STAFF_ID: 'TEST-001', DEPT_ID: 'a', ACTIVE: 1 }, { STAFF_ID: 'TEST-001', DEPT_ID: 'b', ACTIVE: 0 }]);
  const result = buildMappingProposal(dump, packet);
  assert.equal(result.mapping.owners[0].decision, 'hold');
  assert.equal(result.mapping.series.find(row => row.sourceId === '00001').decision, 'hold');
  assert.equal(result.decisions.counterPreview.length, 0);
  assert.equal(result.summary.documents.readyCandidate, 0);
});

test('series six keeps confirmed document-date year basis and overlong prefix is held', () => {
  const dump = preservationFixture();
  dump.tables.bookdept.records.push({ bookdept_id: '00006', book_number: 'TEST-6', book_year: 'y' }, { bookdept_id: '00007', book_number: 'x'.repeat(101), book_year: 'y' });
  const result = buildMappingProposal(dump, packetFor(dump));
  assert.equal(result.mapping.series.find(row => row.sourceId === '00006').yearBasis, 'document_date');
  assert.equal(result.mapping.series.find(row => row.sourceId === '00007').decision, 'hold');
});

test('rejects source, metadata, document, group and CENTRAL match tampering', () => {
  const changes = [
    packet => { packet.sourceSha256 = 'other'; },
    packet => { packet.evidence.sourceSha256 = 'other'; },
    packet => { packet.central.provider = 'local'; },
    packet => { packet.central.readOnlyFlag = 'yes'; },
    packet => { packet.central.consistentSnapshot = true; },
    packet => { packet.central.consistencyNote = ''; },
    packet => { packet.central.selectedColumns.staff.push('PASSWORD'); },
    packet => { packet.evidence.documents[0].ownerId = 'other'; },
    packet => { packet.evidence.documents[1] = structuredClone(packet.evidence.documents[0]); },
    packet => { packet.evidence.documents[0].historicalDepartmentId = 'current-only'; },
    packet => { packet.evidence.owners[0].documentCount++; },
    packet => { packet.evidence.owners[0].referenceCount++; },
    packet => { packet.evidence.owners.push(structuredClone(packet.evidence.owners[0])); },
    packet => { packet.evidence.owners.push({ ...structuredClone(packet.evidence.owners[0]), sourceId: 'extra' }); },
    packet => { packet.evidence.owners[0].match.status = 'active'; },
    packet => { packet.evidence.owners[0].match.matches[0].STAFF_ID = 'other'; },
    packet => { packet.evidence.owners[0].targetId = 'other'; },
    packet => { packet.evidence.series[0].referenceCount++; },
  ];
  for (const change of changes) {
    const dump = preservationFixture(), packet = packetFor(dump);
    change(packet);
    assert.throws(() => buildMappingProposal(dump, packet), /Mapping proposal refused/);
  }
});

test('invalid document metadata remains a held candidate without fabricated fixes', () => {
  const dump = preservationFixture();
  dump.tables.genbook.records[0].date_request = '2026-02-31';
  const result = buildMappingProposal(dump, packetFor(dump));
  assert.ok(result.decisions.documents.find(row => row.sourceId === '1').reasons.includes('INVALID_SOURCE_DOCUMENT_DATE'));
  assert.equal(result.mapping.holds.some(row => row.sourceId === '1'), false);
});
