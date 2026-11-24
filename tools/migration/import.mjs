import { hash, profileDump } from './dump.mjs';
import { isApprovedLocalGenbookTarget } from './local-target.mjs';

export async function assertIsolated(db) {
  if (process.env.NODE_ENV === 'production') throw new Error('Rehearsal refuses production');
  const [[row]] = await db.query('SELECT DATABASE() name, @@port port');
  if ((row.name !== 't05_synthetic' || Number(row.port) === 3306) && !await isApprovedLocalGenbookTarget(db)) throw new Error('Only an isolated or explicitly managed local migration database is allowed');
}

// Called only with startDatabase()'s fresh local connection, never a supplied URL.
export async function stageDump(db, dump, { manageTransaction = true } = {}) {
  await assertIsolated(db);
  const report = profileDump(dump);
  const fingerprint = hash(JSON.stringify(dump.tables));
  if (manageTransaction) await db.beginTransaction();
  try {
    const [[old]] = await db.execute('SELECT manifest_sha256 FROM legacy_batches WHERE source_sha256=? FOR UPDATE', [dump.sourceSha256]);
    if (old) {
      if (old.manifest_sha256 !== fingerprint) throw new Error('Changed source content for the same snapshot');
      await verifyStage(db, dump);
      if (manageTransaction) await db.commit(); return { ...report, replayed: true };
    }
    await db.execute('INSERT INTO legacy_batches(source_sha256,manifest_sha256,report) VALUES (?,?,?)', [dump.sourceSha256, fingerprint, JSON.stringify(report)]);
    for (const [table, { primaryKey, records }] of Object.entries(dump.tables)) {
      for (let offset = 0; offset < records.length; offset += 250) {
        const batch = records.slice(offset, offset + 250);
        await db.query('INSERT INTO legacy_staging(source_sha256,source_table,source_id,payload) VALUES ?', [batch.map(row => [dump.sourceSha256,table,row[primaryKey],JSON.stringify(row)])]);
      }
    }
    await verifyStage(db, dump);
    if (manageTransaction) await db.commit(); return { ...report, replayed: false };
  } catch (error) { if (manageTransaction) await db.rollback(); throw error; }
}

async function verifyStage(db, dump) {
  for (const [table, { primaryKey, records }] of Object.entries(dump.tables)) {
    const [stored] = await db.execute('SELECT source_id,payload FROM legacy_staging WHERE source_sha256=? AND source_table=? ORDER BY source_id', [dump.sourceSha256,table]);
    if (stored.length !== records.length) throw new Error('Staged count mismatch');
    const expected = new Map(records.map(row => [row[primaryKey],row]));
    // Compare every field, not just counts; JSON key ordering is DB-dependent.
    for (const row of stored) {
      const original = expected.get(row.source_id);
      const value = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      if (!original || Object.keys(value).length !== Object.keys(original).length || Object.entries(original).some(([key,field]) => value[key] !== field)) throw new Error('Staged payload mismatch');
    }
  }
}

function validatedManifest(manifest) {
  if (!manifest || !/^[a-f0-9]{64}$/.test(manifest.sourceSha256) || !manifest.reviewedBy?.trim() || !Array.isArray(manifest.documents) || !manifest.documents.length) throw new Error('Reviewed mapping manifest required');
  const ids = new Set();
  for (const row of manifest.documents) {
    for (const [key,max] of [['sourceId',64],['ownerId',64],['departmentId',64],['seriesId',32],['prefix',100],['subject',500]]) {
      if (typeof row[key] !== 'string' || !row[key].trim() || row[key].length > max) throw new Error(`Invalid mapping field: ${key}`);
    }
    if (!/^\d+$/.test(row.sourceId) || ids.has(row.sourceId)) throw new Error('Duplicate/invalid source ID'); ids.add(row.sourceId);
    for (const [key,min,max] of [['year',2400,3000],['main',1,4294967295],['sub',0,4294967295]]) if (!Number.isInteger(row[key]) || row[key] < min || row[key] > max) throw new Error('Invalid number mapping');
    for (const key of ['confidential','published','cancelled','pdfPending']) if (typeof row[key] !== 'boolean') throw new Error('Unknown visibility/status mapping');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.documentDate) || !Number.isFinite(Date.parse(row.documentDate)) || new Date(row.documentDate).toISOString().slice(0,10) !== row.documentDate) throw new Error('Invalid legacy date');
  }
  const scopes = new Map();
  for (const row of manifest.documents) {
    const key = JSON.stringify([row.seriesId,row.year]);
    scopes.set(key, Math.max(scopes.get(key) ?? 0,row.main));
  }
  return scopes;
}

// Only reviewed normalized records, into DISABLED series. Enabling is a separate
// cutover action, intentionally absent from this module and the application API.
export async function importHistory(db, manifest, { dryRun = true } = {}) {
  await assertIsolated(db);
  const scopes = validatedManifest(manifest);
  const digest = hash(JSON.stringify(manifest));
  await db.beginTransaction();
  try {
    const [[batch]] = await db.execute('SELECT manifest_sha256 FROM legacy_batches WHERE source_sha256=? FOR UPDATE', [manifest.sourceSha256]);
    if (batch) {
      if (batch.manifest_sha256 !== digest) throw new Error('Changed mapping/source snapshot; use a fresh rehearsal');
      await verifyHistory(db,manifest,scopes);
      await db.rollback(); return { replayed: true, count: manifest.documents.length };
    }
    for (const seriesId of [...new Set(manifest.documents.map(row => row.seriesId))].sort()) {
      const [[series]] = await db.execute('SELECT enabled,prefix FROM issuance_series WHERE id=? FOR UPDATE', [seriesId]);
      if (!series || series.enabled) throw new Error('Import requires mapped disabled series');
      if (manifest.documents.some(row => row.seriesId === seriesId && row.prefix !== series.prefix)) throw new Error('Prefix mapping mismatch');
      const [[existing]] = await db.execute('SELECT COUNT(*) total FROM issuance_documents WHERE series_id=?', [seriesId]);
      const [[archived]] = await db.execute('SELECT COUNT(*) total FROM legacy_documents WHERE series_id=?', [seriesId]);
      if (Number(existing.total) || Number(archived.total)) throw new Error('Import requires an empty series');
    }
    await db.execute('INSERT INTO legacy_batches(source_sha256,manifest_sha256,report) VALUES (?,?,?)', [manifest.sourceSha256,digest,JSON.stringify({ reviewedBy: manifest.reviewedBy, count: manifest.documents.length, productionReady: false })]);
    for (const row of manifest.documents) {
      await db.execute('INSERT INTO legacy_documents(source_sha256,source_id,owner_id,owner_department_id,series_id,number_year,main_number,sub_number,prefix,subject,document_date,confidential,published,cancelled,pdf_pending) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [manifest.sourceSha256,row.sourceId,row.ownerId,row.departmentId,row.seriesId,row.year,row.main,row.sub,row.prefix,row.subject,row.documentDate,row.confidential,row.published,row.cancelled,row.pdfPending]);
    }
    for (const [scope, maximum] of [...scopes.entries()].sort()) {
      const [seriesId, year] = JSON.parse(scope);
      // No overwrite or rewind of existing counters. This is a fresh rehearsal.
      await db.execute('INSERT INTO issuance_counters(series_id,number_year,last_number) VALUES (?,?,?)', [seriesId,year,maximum]);
    }
    await verifyHistory(db,manifest,scopes);
    if (dryRun) await db.rollback(); else await db.commit();
    return { dryRun, replayed: false, count: manifest.documents.length, counters: [...scopes].map(([scope,lastNumber]) => ({ scope: JSON.parse(scope), lastNumber })) };
  } catch (error) { await db.rollback(); throw error; }
}

async function verifyHistory(db,manifest,scopes) {
  const [stored] = await db.execute("SELECT *,DATE_FORMAT(document_date,'%Y-%m-%d') date_text FROM legacy_documents WHERE source_sha256=?",[manifest.sourceSha256]);
  if (stored.length !== manifest.documents.length) throw new Error('History count mismatch');
  const expected = new Map(manifest.documents.map(row=>[row.sourceId,row]));
  const fields = { source_id:'sourceId',owner_id:'ownerId',owner_department_id:'departmentId',series_id:'seriesId',number_year:'year',main_number:'main',sub_number:'sub',prefix:'prefix',subject:'subject',date_text:'documentDate' };
  for (const row of stored) {
    const original=expected.get(row.source_id);
    if (!original || Object.entries(fields).some(([column,field])=>String(row[column])!==String(original[field])) || ['confidential','published','cancelled'].some(field=>Boolean(row[field])!==original[field]) || Boolean(row.pdf_pending)!==original.pdfPending) throw new Error('History payload mismatch');
  }
  for (const [scope,maximum] of scopes) {
    const [[counter]]=await db.execute('SELECT last_number FROM issuance_counters WHERE series_id=? AND number_year=?',JSON.parse(scope));
    // Counters can advance after the simulated release, but must never rewind.
    if (!counter || Number(counter.last_number)<maximum) throw new Error('History counter mismatch');
  }
}
