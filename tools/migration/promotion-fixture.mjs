import { preservationFixture } from './preservation-fixture.mjs';
import { mappingTemplate } from './mapping.mjs';

// Synthetic-only approvals. This function accepts no source dump or real IDs.
export function promotionFixture() {
  const dump = preservationFixture();
  for (const row of dump.tables.genbook.records) Object.assign(row, { endorser_type: null, endorser: null, document_file: null });
  dump.tables.genbook.records[0].publish = '1';
  dump.tables.genbook.records[5].secret = '1';
  dump.tables.genbook.records[5].publish = '1';
  Object.assign(dump.tables.genbook.records[0], { endorser_type: '1', endorser: 'POSITION-TEST', user_login: 'LEGACY-ACTOR', lastupdate: '2026-11-13 11:00:00' });
  Object.assign(dump.tables.genbook.records[5], { endorser_type: '2', endorser: 'STAFF-TEST', document_file: 'never-expose-secret-path.pdf' });
  dump.tables.genbook_inform.records.push(
    { gen_book_inform_id: '20', gen_book_id: '1', inform: 'Second synthetic recipient' },
    { gen_book_inform_id: '10', gen_book_id: '1', inform: 'First synthetic recipient' },
    { gen_book_inform_id: '30', gen_book_id: '6', inform: 'Confidential synthetic recipient' },
  );
  dump.tables.genbook_dept.records.push(
    { gen_book_dept_id: '10', gen_book_id: '1', dept_status: '1', dept: '204' },
    { gen_book_dept_id: '20', gen_book_id: '1', dept_status: '2', dept: 'Synthetic external organization' },
  );
  const mapping = mappingTemplate(dump);
  const review = { by: 'synthetic-reviewer', at: '2026-11-13', evidence: 'Synthetic fixture approval; never an actual mapping' };
  mapping.review = review;
  mapping.policies = { subnumbers: 'null-is-zero-with-raw-preserved', duplicates: 'preserve-every-source-id', prefix: 'reviewed-current-series-reference', dates: 'stored-document-date-no-issued-time-conversion', pdf: 'unverified-files-remain-pending' };
  for (const kind of ['series', 'owners', 'departments']) for (const row of mapping[kind]) {
    row.review = review;
    if (kind === 'series') {
      row.decision = row.sourceId === '00001' ? 'map' : 'hold';
      row.targetId = row.decision === 'map' ? 'TEST-S1' : '';
      row.yearBasis = row.decision === 'map' ? 'calendar' : '';
    } else { row.decision = 'map'; row.targetId = row.sourceId; }
  }
  return { dump, mapping, approvalReference: 'Synthetic preservation approval for source-bound promotion' };
}
