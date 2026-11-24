import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { inspectNativeDump, digest } from './native-dump.mjs';
import { collectSourceReferences, buildIdentityEvidence } from './identity-evidence.mjs';

// Evidence only: no mapping approvals, grants, SQL writes or issuance switches.
// Use the service's existing CENTRAL connection and SQL guard without changing Core.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function writeCentralReview(packet, directory) {
  const evidence = packet.evidence;
  const candidates = rows => rows.map(row => ({
    sourceId: row.sourceId, sourceKind: row.kind, referenceCount: row.referenceCount,
    documentCount: row.documentCount, centralStatus: row.match.status,
    candidateTargetId: row.match.matches.length === 1 ? row.sourceId : null,
    decision: 'pending', review: null,
  }));
  const proposals = { schemaVersion: 1, sourceSha256: packet.sourceSha256,
    evidenceFile: 'evidence.json', evidenceSha256: digest(Buffer.from(JSON.stringify(packet, null, 2))),
    owners: candidates(evidence.owners), departments: candidates(evidence.departmentIds),
    series: evidence.series.map(row => ({ sourceId: row.sourceId, referenceStatus: row.status, documentCount: row.documentCount, decision: 'pending', targetId: null, yearBasis: null, review: null })),
    legacyGrantRows: evidence.grants, approvals: null, readyForLocalPromotion: false, productionReady: false };
  await writeFile(path.join(directory, 'review-proposals.json'), JSON.stringify(proposals, null, 2), { flag: 'wx', mode: 0o600 });
  const escape = value => (value === null ? '(NULL)' : value === '' ? '(blank)' : String(value))
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|\-]/g, character => `\\${character}`).replace(/[\r\n]/g, ' ');
  const ownerExceptions = evidence.owners.filter(row => !['active', 'inactive'].includes(row.match.status));
  const departments = evidence.departmentIds.filter(row => row.references.some(reference => reference.table === 'genbook'));
  const mismatches = evidence.owners.filter(row => row.currentDepartmentDiffersFromHistorical);
  const missingGrantSeries = evidence.grants.filter(grant => !evidence.series.some(series => series.sourceId === grant.seriesId && series.status === 'unique'));
  const markdown = [
    '# T12 CENTRAL mapping evidence — private review', '',
    `Source SHA-256: ${packet.sourceSha256}`, `Collected: ${packet.completedAt}`, '',
    'Exact identifiers only. No names, passwords, email or personal profile fields were queried.',
    'All proposals remain pending. An exact match does not approve a migration, series permission or account login.',
    'CENTRAL tables are reported with their engines in summary.json; MyISAM reads are not a point-in-time snapshot.', '',
    '## Owner exceptions', '', '| Source owner | CENTRAL result | Documents |', '|---|---|---:|',
    ...ownerExceptions.map(row => `| ${escape(row.sourceId)} | ${row.match.status} | ${row.documentCount} |`), '',
    '## Historical departments', '', '| Source department | CENTRAL status | Source references |', '|---|---|---:|',
    ...departments.map(row => `| ${escape(row.sourceId)} | ${row.match.status} | ${row.referenceCount} |`), '',
    '## Current department differs from historical evidence', '',
    'This is a review cue, not proof of a staff transfer. Keep the department recorded on each historical document.', '',
    '| Source owner | Current department | Historical departments | Documents |', '|---|---|---|---:|',
    ...mismatches.map(row => `| ${escape(row.sourceId)} | ${escape(row.currentDepartmentId)} | ${row.historicalDepartments.map(item => escape(item.sourceId)).join(', ')} | ${row.documentCount} |`), '',
    '## Series and legacy permissions', '',
    `Source grant rows: ${evidence.grants.length}; rows without one unique source series reference: ${missingGrantSeries.length}.`,
    'bookdept_user rows are unapproved source evidence. userbook/userlevel/user_tb do not become issuance grants.',
    'Series prefix, year basis, enabled/held state and permission decisions require separate review in the source-bound workbench.', '',
    '## Files and next decisions', '',
    '- evidence.json: exact-ID matches and source references; keep private.',
    '- review-proposals.json: candidate identity targets, series and original grant rows; all pending.',
    '- Review missing owners/departments, inactive references, differing historical departments, series references and empty subjects.',
    '- Record actual reviewer/evidence in the separate workbench mapping.json, then run migration:check.',
    '- This packet does not import history, seed counters, assign grants or open issuance.', '',
  ].join('\n');
  await writeFile(path.join(directory, 'REVIEW.md'), markdown, { flag: 'wx', mode: 0o600 });
  return { ownerExceptions: ownerExceptions.length, historicalDepartmentGroups: departments.length, currentDepartmentMismatchGroups: mismatches.length, sourceGrantRows: evidence.grants.length, missingGrantSeriesRows: missingGrantSeries.length };
}

async function lookup(session, table, column, columns, ids) {
  const rows = [];
  for (let start = 0; start < ids.length; start += 200) {
    const chunk = ids.slice(start, start + 200);
    const matches = await session.query(`SELECT ${columns} FROM ${table} WHERE ${column} IN (${chunk.map(() => '?').join(',')})`, chunk);
    // SQL collation may equate different IDs. Retain only exact requested IDs;
    // this also prevents the same row being counted twice across chunks.
    rows.push(...matches.filter(row => chunk.includes(String(row[column]))));
  }
  return rows;
}

export async function auditCentralMapping(sourceFile, serviceRoot) {
  const root = path.resolve(serviceRoot);
  const { loadLegacyEnv, openLegacySession } = await import(pathToFileURL(path.join(root, 'dist/core/legacy/legacy-connection.js')).href);
  const config = loadLegacyEnv(path.join(root, '.env'));
  if (config.IDENTITY_PROVIDER !== 'central') throw new Error('CENTRAL provider required');
  const compressed = await readFile(sourceFile);
  if (digest(compressed) !== config.GENBOOKNO_SOURCE_SHA256) throw new Error('Snapshot does not match the service source SHA');
  const source = collectSourceReferences(inspectNativeDump(compressed));
  const envFile = path.resolve(root, config.LEGACY_ENV_FILE || '.env.legacy');
  const centralConfig = loadLegacyEnv(envFile);
  let session;
  let packet;
  const startedAt = new Date().toISOString();
  try {
    session = await openLegacySession('central', centralConfig, { textResults: true });
    if (!session.readOnlyFlag || !session.consistentSnapshot || session.characterSetResults !== 'utf8mb4') throw new Error('Verified read-only CENTRAL session required');
    const tables = await session.query('SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?)', [centralConfig.CENTRAL_DB_NAME, 'STAFF_INFO', 'DEPT']);
    if (!['STAFF_INFO', 'DEPT'].every(name => tables.some(row => row.TABLE_NAME === name))) throw new Error('Required CENTRAL tables missing');
    const staffIds = source.staffIds.filter(row => row.kind === 'value').map(row => row.sourceId);
    const staff = await lookup(session, 'STAFF_INFO', 'STAFF_ID', 'STAFF_ID, DEPT_ID, ACTIVE', staffIds);
    const departmentIds = [...new Set([
      ...source.departmentIds.filter(row => row.kind === 'value').map(row => row.sourceId),
      ...staff.map(row => row.DEPT_ID).filter(value => value !== null && value !== undefined && String(value).trim() !== '').map(String),
    ])];
    const departments = await lookup(session, 'DEPT', 'DEPT_ID', 'DEPT_ID, STATUS', departmentIds);
    packet = {
      schemaVersion: 1, startedAt, completedAt: new Date().toISOString(),
      sourceSha256: digest(compressed),
      central: { provider: 'central', readOnlyFlag: session.readOnlyFlag, characterSetResults: session.characterSetResults,
        tables, consistentSnapshot: tables.every(row => String(row.ENGINE).toUpperCase() === 'INNODB'),
        consistencyNote: 'Read-only transaction; nontransactional source tables do not provide a consistent snapshot.',
        selectedColumns: { staff: ['STAFF_ID', 'DEPT_ID', 'ACTIVE'], departments: ['DEPT_ID', 'STATUS'] } },
      evidence: buildIdentityEvidence(source, staff, departments),
      approvals: null, readyForLocalPromotion: false, productionReady: false,
    };
  } finally { await session?.close(); }

  // Exclusive private artifacts: never overwrite a review or publish person IDs.
  const directory = path.join(project, '.local/t12', `central-evidence-${packet.sourceSha256.slice(0, 8)}-${randomUUID().slice(0, 8)}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const json = JSON.stringify(packet, null, 2);
  await writeFile(path.join(directory, 'evidence.json'), json, { flag: 'wx', mode: 0o600 });
  const summary = { sourceSha256: packet.sourceSha256, evidenceSha256: digest(Buffer.from(json)),
    startedAt, completedAt: packet.completedAt, central: packet.central,
    summary: packet.evidence.summary, approvals: null, readyForLocalPromotion: false, productionReady: false };
  await writeFile(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 });
  await writeCentralReview(packet, directory);
  console.log(JSON.stringify({ directory: path.relative(project, directory), ...summary }));
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [, , source, service] = process.argv;
  if (!source || !service || process.argv.length !== 4) throw new Error('Usage: audit-central-mapping.mjs <native-snapshot.sql.gz> <ronaldo-service-root>');
  try { await auditCentralMapping(source, service); }
  catch (error) {
    // Driver errors may contain source identifiers, addresses or SQL parameters.
    const safe = /^(CENTRAL provider required|Snapshot does not match the service source SHA|Verified read-only CENTRAL session required|Required CENTRAL tables missing)$/.test(error.message);
    console.error(safe ? error.message : 'CENTRAL mapping audit failed; no approvals or database writes performed.');
    process.exitCode = 1;
  }
}
