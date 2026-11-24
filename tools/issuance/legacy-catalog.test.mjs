import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLegacyCatalog } from './legacy-catalog.mjs';

function source() {
  return { sourceSha256: 'a'.repeat(64), tables: {
    book: { records: [{ idbook: '1', book: 'Original parent prefix', dept_id: '202', alias_dept: 'Original parent alias', status: '1', typebook_idtypebook: '2' }] },
    typebook: { records: [{ idtypebook: '2', typebook: 'มอ', typesecret: 'y' }] },
    bookdept: { records: [
      { bookdept_id: '00001', book_number: 'มอ 202.1', book_year: 'y', dept_id: '202', book_idbook: '1', sub_dept: 'Original subdepartment' },
      { bookdept_id: '00006', book_number: 'คำสั่ง', book_year: 'y', dept_id: '*', book_idbook: '1', sub_dept: 'คำสั่ง' },
      { bookdept_id: '00047', book_number: 'Paused prefix', book_year: '', dept_id: '*', book_idbook: '1', sub_dept: '' },
    ] },
  } };
}

test('demo catalog preserves exact reference labels without importing grants, credentials, history or counters', () => {
  const dump = source(), before = structuredClone(dump);
  dump.tables.book.records[0].PASSWORD = 'must-not-be-projected';
  const catalog = buildLegacyCatalog(dump);
  assert.equal(catalog.sourceSha256, dump.sourceSha256);
  assert.equal(catalog.series[0].name, 'Original subdepartment');
  assert.equal(catalog.series[0].prefix, 'มอ 202.1');
  assert.equal(catalog.series[0].documentType, 'มอ');
  assert.equal(catalog.series[0].yearBasis, 'calendar');
  assert.equal(catalog.series[1].yearBasis, 'document_date');
  assert.equal(catalog.series[0].enabled, true);
  assert.equal(catalog.series[2].enabled, false);
  assert.deepEqual(catalog.series[2].disabledReasons, ['unsupported-year', 'confirmed-paused-series']);
  assert.equal(catalog.series[2].yearBasis, null);
  assert.equal(catalog.productionReady, false);
  assert.equal(catalog.demoOnly, true);
  assert.equal(JSON.stringify(catalog).includes('must-not-be-projected'), false);
  for (const field of ['grants', 'documents', 'counters', 'users', 'PASSWORD']) assert.equal(Object.hasOwn(catalog, field), false);
  delete dump.tables.book.records[0].PASSWORD;
  assert.deepEqual(dump, before);
});

test('department aliases remain references rather than verified CENTRAL names and wildcard does not become a department', () => {
  const dump = source();
  dump.tables.bookdept.records[1].dept_id = '*,202';
  dump.tables.book.records.push({ ...dump.tables.book.records[0], idbook: '2', alias_dept: 'Another historical alias' });
  const catalog = buildLegacyCatalog(dump);
  assert.equal(catalog.departments.length, 1);
  assert.equal(catalog.departments[0].id, '202');
  assert.equal(catalog.departments[0].name, 'รหัสหน่วยงาน 202');
  assert.equal(catalog.departments[0].nameVerified, false);
  assert.deepEqual(catalog.departments[0].aliases.map(row => row.value), ['Original parent alias', 'Another historical alias', 'Original subdepartment']);
  assert.equal(catalog.availability.departmentNames, 'central-required');
  assert.equal(catalog.availability.positions, 'central-required');
  assert.deepEqual(catalog.positions, []);
  assert.equal(catalog.departments.some(row => row.id.includes(',') || row.id.includes('*')), false);
  assert.equal(catalog.series[1].source.sourceDepartmentId, '*,202');
});

test('inactive parent, absent references, invalid prefixes and unsupported years never enable demo issuance', () => {
  for (const change of [
    value => { value.tables.book.records[0].status = '0'; },
    value => { value.tables.book.records[0].status = 'unknown'; },
    value => { value.tables.book.records = []; },
    value => { value.tables.typebook.records = []; },
    value => { value.tables.bookdept.records[0].book_number = ' '; },
    value => { value.tables.bookdept.records[0].book_number = 'x'.repeat(101); },
    value => { value.tables.bookdept.records[0].book_year = 'b'; },
  ]) {
    const dump = source(); change(dump);
    const catalog = buildLegacyCatalog(dump);
    assert.equal(catalog.series[0].enabled, false);
    assert.ok(catalog.series[0].disabledReasons.length);
  }
});

test('invalid and duplicate canonical identifiers refuse catalog instead of merging distinct source rows', () => {
  for (const change of [
    value => { value.sourceSha256 = 'invalid'; },
    value => { value.tables.bookdept.records[0].bookdept_id = '0'; },
    value => { value.tables.bookdept.records[0].bookdept_id = '100000'; },
    value => { value.tables.bookdept.records.push({ ...value.tables.bookdept.records[0], bookdept_id: '1' }); },
    value => { value.tables.book.records.push({ ...value.tables.book.records[0], idbook: '01' }); },
    value => { value.tables.typebook.records.push({ ...value.tables.typebook.records[0], idtypebook: '02' }); },
  ]) { const dump = source(); change(dump); assert.throws(() => buildLegacyCatalog(dump)); }
});
