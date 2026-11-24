import { buildLegacyCatalog } from '../issuance/legacy-catalog.mjs';
import { readDump } from '../migration/dump.mjs';

export async function loadDemoReferences(file) {
  return buildLegacyCatalog(await readDump(file));
}

// Explicitly a demo catalog, not a migration of identities or issuing grants.
// Uses only INSERT/UPDATE in a loopback synthetic database; no source connection.
export async function applyDemoReferences(db, catalog) {
  if (process.env.NODE_ENV === 'production' || catalog?.demoOnly !== true || catalog?.productionReady !== false) throw new Error('Legacy reference preview is development-only');
  const config = db.connection?.config ?? db.config;
  if (config?.host !== '127.0.0.1' || Number(config.port) === 3306) throw new Error('Reference preview requires the isolated loopback database');
  const [[identity]] = await db.query('SELECT DATABASE() name,@@port port');
  if (identity.name !== 't05_synthetic' || Number(identity.port) === 3306) throw new Error('Reference preview refuses this database');
  await db.beginTransaction();
  try {
    // Share-lock the read-only maintenance gate; catalog table updates take
    // their own exclusive locks. Never grant the app permission to open it.
    const [[gate]] = await db.query('SELECT state FROM issuance_migration_gate WHERE id=1 LOCK IN SHARE MODE');
    const [[history]] = await db.query('SELECT (SELECT COUNT(*) FROM legacy_documents)+(SELECT COUNT(*) FROM legacy_number_reservations) total');
    if (gate?.state !== 'open' || Number(history.total) !== 0) throw new Error('Reference preview refuses preserved or migrated data');
    await db.query('UPDATE issuance_series SET enabled=FALSE');
    await db.query('UPDATE issuance_grants SET active=FALSE');
    await db.query('UPDATE issuance_departments SET enabled=FALSE');
    for (const department of catalog.departments) {
      await db.execute('INSERT INTO issuance_departments(id,name,enabled) VALUES (?,?,TRUE) ON DUPLICATE KEY UPDATE name=VALUES(name),enabled=TRUE', [department.id, department.name]);
    }
    for (const series of catalog.series) {
      // Unknown legacy year rules stay in the report only. Never assign an
      // invented enum value merely to satisfy the local schema.
      if (!['calendar', 'document_date'].includes(series.yearBasis)) continue;
      await db.execute('INSERT INTO issuance_series(id,name,document_type,prefix,year_basis,enabled) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),document_type=VALUES(document_type),prefix=VALUES(prefix),year_basis=VALUES(year_basis),enabled=VALUES(enabled)', [series.id, series.name, series.documentType, series.prefix, series.yearBasis, series.enabled]);
      if (series.enabled) await db.execute('INSERT INTO issuance_grants(owner_id,series_id,active) VALUES (?,?,TRUE) ON DUPLICATE KEY UPDATE active=TRUE', ['LOCAL-001', series.id]);
    }
    await db.commit();
    return { sourceSha256: catalog.sourceSha256, ...catalog.summary,
      storedSeries: catalog.series.filter(series => ['calendar', 'document_date'].includes(series.yearBasis)).length,
      catalogOnlySeries: catalog.series.filter(series => !['calendar', 'document_date'].includes(series.yearBasis)).length,
      demoOnly: true, productionReady: false };
  } catch (error) { await db.rollback(); throw error; }
}
