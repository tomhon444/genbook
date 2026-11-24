import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { startDatabase } from '../issuance/database.mjs';
import { readDump } from './dump.mjs';
import { mappingPlan } from './mapping.mjs';
import { preserveSnapshot } from './preservation.mjs';
import { promoteSnapshot } from './promote.mjs';

if (process.argv.length !== 5) throw new Error('Usage: node tools/migration/rehearse-promotion.mjs <snapshot.sql.gz> <reviewed-mapping.json> <reviewed-targets.json>');
const dump = await readDump(process.argv[2]);
const mapping = JSON.parse(await readFile(process.argv[3], 'utf8'));
const plan = mappingPlan(dump, mapping);
if (!plan.summary.readyForLocalPromotion) throw new Error(`Reviewed mapping is not ready (${plan.summary.blockers} blockers); no database was started`);
const targets = JSON.parse(await readFile(process.argv[4], 'utf8'));
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === expected.length && Object.keys(value).every(key => expected.includes(key));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
if (!keys(targets, ['sourceSha256', 'mappingFingerprint', 'review', 'preservationApprovalReference', 'series', 'departments']) || targets.sourceSha256 !== dump.sourceSha256 || targets.mappingFingerprint !== plan.mappingFingerprint || !text(targets.preservationApprovalReference, 200) || !targets.review || !text(targets.review.by, 200) || !text(targets.review.evidence, 500) || !/^\d{4}-\d{2}-\d{2}$/.test(targets.review.at ?? '') || !Number.isFinite(Date.parse(targets.review.at)) || new Date(targets.review.at).toISOString().slice(0, 10) !== targets.review.at) throw new Error('Reviewed target references must bind the source and mapping');
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

// No supplied DB URL, no HTTP server, no real identity connection. Even the
// committed rehearsal is removed when this newly-created DB shuts down.
const db = await startDatabase({ port: 3332 });
try {
  await db.admin.query('UPDATE issuance_grants SET active=FALSE');
  for (const row of targets.departments) await db.admin.execute('INSERT INTO issuance_departments(id,name,enabled) VALUES (?,?,FALSE) ON DUPLICATE KEY UPDATE name=VALUES(name),enabled=FALSE', [row.id, row.name]);
  for (const row of targets.series) {
    const source = plan.mappedSeries.find(value => value.targetId === row.id);
    await db.admin.execute('INSERT INTO issuance_series(id,name,document_type,prefix,year_basis,enabled) VALUES (?,?,?,?,?,FALSE) ON DUPLICATE KEY UPDATE name=VALUES(name),document_type=VALUES(document_type),prefix=VALUES(prefix),year_basis=VALUES(year_basis),enabled=FALSE', [row.id, row.name, row.documentType, source.sourcePrefix, source.yearBasis]);
  }
  const options = { approvalReference: targets.preservationApprovalReference };
  await preserveSnapshot(db.admin, dump, options);
  const dryRun = await promoteSnapshot(db.admin, dump, mapping, options);
  const [[rolledBack]] = await db.admin.query('SELECT (SELECT COUNT(*) FROM legacy_documents)+(SELECT COUNT(*) FROM legacy_promotions)+(SELECT COUNT(*) FROM issuance_counters)+(SELECT COUNT(*) FROM legacy_reservation_links) writes');
  if (Number(rolledBack.writes)) throw new Error('Promotion dry-run did not roll back all derived writes');
  const committed = await promoteSnapshot(db.admin, dump, mapping, { ...options, dryRun: false });
  const replay = await promoteSnapshot(db.admin, dump, mapping, { ...options, dryRun: false });
  const [[gate]] = await db.admin.query('SELECT state FROM issuance_migration_gate WHERE id=1');
  const [[grants]] = await db.admin.query('SELECT COUNT(*) n FROM issuance_grants WHERE active=TRUE');
  if (gate.state !== 'blocked' || Number(grants.n)) throw new Error('Rehearsal must keep gate and issuance grants closed');
  const directory = `.local/t12/promotion-${dump.sourceSha256.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  await mkdir(directory, { recursive: true });
  const report = { ...committed, mappingFingerprint: plan.mappingFingerprint, planFingerprint: plan.planFingerprint, dryRunVerified: dryRun.dryRun, replayVerified: replay.replayed, rawAndHistoryEveryFieldVerified: true, grantsEnabled: 0, cleanup: 'Fresh isolated database removed after shutdown' };
  await writeFile(`${directory}/rehearsal.json`, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...report, directory }));
} finally { await db.close(); }
