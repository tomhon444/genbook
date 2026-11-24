import { assertIsolated, stageDump } from './import.mjs';
import { preservationPlan, verifyPreservation } from './preservation.mjs';
import { mappingPlan, fingerprint } from './mapping.mjs';
import { historyMetadataVersion } from './history-metadata.mjs';

const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
const fields = { source_id: 'sourceId', owner_id: 'ownerId', owner_department_id: 'departmentId', series_id: 'seriesId', number_year: 'year', main_number: 'main', sub_number: 'sub', prefix: 'prefix', subject: 'subject', date_text: 'documentDate' };

async function verifyHistory(db, dump, plan) {
  const [stored] = await db.execute("SELECT *,DATE_FORMAT(document_date,'%Y-%m-%d') date_text FROM legacy_documents WHERE source_sha256=?", [dump.sourceSha256]);
  if (stored.length !== plan.documents.length) throw new Error('Promoted history count mismatch');
  const expected = new Map(plan.documents.map(row => [row.sourceId, row]));
  for (const row of stored) {
    const source = expected.get(row.source_id);
    if (!source || Object.entries(fields).some(([column, key]) => String(row[column]) !== String(source[key])) || ['confidential', 'published', 'cancelled'].some(key => Boolean(row[key]) !== source[key]) || Boolean(row.pdf_pending) !== source.pdfPending) throw new Error('Promoted history payload mismatch');
  }
  const [metadata] = await db.execute('SELECT source_id,schema_version,payload FROM legacy_document_details WHERE source_sha256=?', [dump.sourceSha256]);
  if (metadata.length !== plan.documents.length) throw new Error('Promoted details count mismatch');
  for (const row of metadata) {
    const source = expected.get(row.source_id);
    if (!source || Number(row.schema_version) !== historyMetadataVersion || fingerprint(decode(row.payload)) !== fingerprint(source.details)) throw new Error('Promoted details payload mismatch');
  }
  for (const row of plan.mappedSeries) {
    const [[target]] = await db.execute('SELECT enabled,prefix,year_basis FROM issuance_series WHERE id=? FOR UPDATE', [row.targetId]);
    if (!target || target.enabled || target.prefix !== row.sourcePrefix || target.year_basis !== row.yearBasis) throw new Error('Promotion target must match the reviewed disabled series');
    if (!plan.counters.some(counter => counter.seriesId === row.targetId)) continue;
    const [[link]] = await db.execute('SELECT series_id,reviewed_by FROM legacy_reservation_links WHERE source_sha256=? AND legacy_series_id=?', [dump.sourceSha256, row.sourceId]);
    if (!link || link.series_id !== row.targetId || link.reviewed_by !== row.review.by) throw new Error('Promoted reservation mapping mismatch');
  }
  for (const row of plan.counters) {
    const [[counter]] = await db.execute('SELECT last_number FROM issuance_counters WHERE series_id=? AND number_year=?', [row.seriesId, row.year]);
    if (!counter || Number(counter.last_number) < row.floor) throw new Error('Promoted reservation counter mismatch');
  }
}

// Only the fresh local DB is accepted. The caller must first preserve the source
// and prepare reviewed target references. No grants or gate-opening code exists.
export async function promoteSnapshot(db, dump, mapping, { approvalReference, dryRun = true } = {}) {
  await assertIsolated(db);
  const plan = mappingPlan(dump, mapping);
  if (!plan.summary.readyForLocalPromotion) throw new Error(`Reviewed source mapping is not ready (${plan.summary.blockers} blockers)`);
  const preserved = preservationPlan(dump);
  await db.beginTransaction();
  try {
    const [[gate]] = await db.query('SELECT state FROM issuance_migration_gate WHERE id=1 FOR UPDATE');
    if (!gate || gate.state !== 'blocked') throw new Error('Promotion requires the closed migration gate');
    await verifyPreservation(db, dump, preserved, approvalReference);
    // Verify raw every field too; this does not replace the raw-batch digest.
    await stageDump(db, dump, { manageTransaction: false });
    const [[old]] = await db.execute('SELECT mapping_sha256,plan_sha256,report FROM legacy_promotions WHERE source_sha256=? FOR UPDATE', [dump.sourceSha256]);
    if (old) {
      if (old.mapping_sha256 !== plan.mappingFingerprint || old.plan_sha256 !== plan.planFingerprint || fingerprint(decode(old.report)) !== fingerprint(plan.summary)) throw new Error('Changed promotion mapping or plan; use a fresh rehearsal');
      await verifyHistory(db, dump, plan);
      await db.rollback();
      return { ...plan.summary, dryRun, replayed: true };
    }
    for (const series of plan.mappedSeries) {
      const [[target]] = await db.execute('SELECT enabled,prefix,year_basis FROM issuance_series WHERE id=? FOR UPDATE', [series.targetId]);
      if (!target || target.enabled || target.prefix !== series.sourcePrefix || target.year_basis !== series.yearBasis) throw new Error('Promotion target must match the reviewed disabled series');
      const [[existing]] = await db.execute('SELECT (SELECT COUNT(*) FROM issuance_documents WHERE series_id=?)+(SELECT COUNT(*) FROM legacy_documents WHERE series_id=?) total', [series.targetId, series.targetId]);
      if (Number(existing.total)) throw new Error('Promotion requires an empty target series');
      if (!plan.counters.some(row => row.seriesId === series.targetId)) continue;
      const [[link]] = await db.execute('SELECT series_id,reviewed_by FROM legacy_reservation_links WHERE source_sha256=? AND legacy_series_id=?', [dump.sourceSha256, series.sourceId]);
      if (link && (link.series_id !== series.targetId || link.reviewed_by !== series.review.by)) throw new Error('Changed reservation mapping');
      if (!link) await db.execute('INSERT INTO legacy_reservation_links(source_sha256,legacy_series_id,series_id,reviewed_by) VALUES (?,?,?,?)', [dump.sourceSha256, series.sourceId, series.targetId, series.review.by]);
    }
    for (const row of plan.counters) {
      const [[current]] = await db.execute('SELECT last_number FROM issuance_counters WHERE series_id=? AND number_year=? FOR UPDATE', [row.seriesId, row.year]);
      if (current && Number(current.last_number) < row.floor) throw new Error('Existing reservation counter is below the source floor');
      if (!current) await db.execute('INSERT INTO issuance_counters(series_id,number_year,last_number) VALUES (?,?,?)', [row.seriesId, row.year, row.floor]);
    }
    for (let offset = 0; offset < plan.documents.length; offset += 250) {
      const rows = plan.documents.slice(offset, offset + 250).map(row => [dump.sourceSha256, row.sourceId, row.ownerId, row.departmentId, row.seriesId, row.year, row.main, row.sub, row.prefix, row.subject, row.documentDate, row.confidential, row.published, row.cancelled, row.pdfPending]);
      await db.query('INSERT INTO legacy_documents(source_sha256,source_id,owner_id,owner_department_id,series_id,number_year,main_number,sub_number,prefix,subject,document_date,confidential,published,cancelled,pdf_pending) VALUES ?', [rows]);
      const metadata = plan.documents.slice(offset, offset + 250).map(row => [dump.sourceSha256, row.sourceId, historyMetadataVersion, JSON.stringify(row.details)]);
      await db.query('INSERT INTO legacy_document_details(source_sha256,source_id,schema_version,payload) VALUES ?', [metadata]);
    }
    await db.execute('INSERT INTO legacy_promotions(source_sha256,mapping_sha256,plan_sha256,report) VALUES (?,?,?,?)', [dump.sourceSha256, plan.mappingFingerprint, plan.planFingerprint, JSON.stringify(plan.summary)]);
    await verifyHistory(db, dump, plan);
    if (dryRun) await db.rollback(); else await db.commit();
    return { ...plan.summary, dryRun, replayed: false };
  } catch (error) { await db.rollback(); throw error; }
}
