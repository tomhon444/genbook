import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openReadOnlySource } from './remote-source.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const reject = code => { throw new Error(`REFERENCE_NAMES_${code}`); };
const validName = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001F\u007F\uFFFD]/u.test(value);
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replace(/[\\`*_{}\[\]()#+.!|\-]/g, character => `\\${character}`).replace(/[\r\n]/g, ' ');
const packetFiles = ['summary.json', 'references.json', 'grants-review.json', 'attachments-inventory.json', 'time-review.json', 'acceptance.json', 'REVIEW.md', 'REFERENCES.md'];

export async function readReferencePacket(directory) {
  const manifestBytes = await readFile(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schemaVersion !== 1 || !['sourceSha256', 'mappingSha256', 'mappingFingerprint', 'targetsSha256', 'evidenceSha256', 'evidenceReceiptSha256'].every(field => hex(manifest[field]))
    || manifest.ac2Approved !== false || manifest.productionReady !== false || manifest.databaseWritesPerformed !== false || manifest.grantsCreated !== 0
    || !manifest.files || Object.keys(manifest.files).length !== packetFiles.length || Object.keys(manifest.files).some(name => !packetFiles.includes(name))) reject('PACKET_MANIFEST');
  const files = {};
  for (const name of packetFiles) {
    const bytes = await readFile(path.join(directory, name));
    if (!hex(manifest.files[name]) || hash(bytes) !== manifest.files[name]) reject('PACKET_DIGEST');
    files[name] = bytes;
  }
  const references = JSON.parse(files['references.json']);
  if (references.sourceSha256 !== manifest.sourceSha256 || references.executable !== false || references.review !== null) reject('REFERENCE_BINDING');
  for (const kind of ['series', 'departments', 'documentTypes']) {
    if (!Array.isArray(references[kind]) || !references[kind].length) reject('REFERENCE_SHAPE');
    const seen = new Set();
    for (const row of references[kind]) {
      if (typeof row.sourceId !== 'string' || !row.sourceId || seen.has(row.sourceId) || row.review !== null || row.decision !== 'pending'
        || row.displayName !== '' || kind === 'series' && (row.enabled !== false || row.documentType !== '') || kind === 'departments' && row.nameVerified !== false) reject('REFERENCE_SHAPE');
      seen.add(row.sourceId);
    }
  }
  for (const name of ['summary.json', 'grants-review.json', 'attachments-inventory.json', 'time-review.json', 'acceptance.json']) {
    if (JSON.parse(files[name]).sourceSha256 !== manifest.sourceSha256) reject('PACKET_SOURCE');
  }
  const grants = JSON.parse(files['grants-review.json']);
  if (grants.executable !== false || !Array.isArray(grants.rows) || grants.rows.some(row => row.enabled !== false || row.decision !== 'pending' || row.review !== null)) reject('GRANTS_CHANGED');
  return { manifest, manifestSha256: hash(manifestBytes), references };
}

export function fillReferenceNames(input, departmentRows, { departmentLookupPerformed = true } = {}) {
  if (!Array.isArray(departmentRows)) reject('DEPARTMENT_ROWS');
  const references = structuredClone(input), exceptions = [];
  const note = (kind, row, reason, field = null) => exceptions.push({ kind, sourceId: row.sourceId, targetId: row.targetId ?? null, reason, field });
  function fill(row, field, raw, max, kind) {
    if (!validName(raw, max)) { note(kind, row, 'blank-or-invalid-source-name', field); return false; }
    row[field] = raw;
    if (raw !== raw.trim()) note(kind, row, 'source-name-whitespace-preserved');
    return true;
  }
  for (const row of references.series) {
    // genbook.php builds the actual legacy issuance options from book_number.
    // Keep catalog aliases as context rather than inventing a replacement label.
    row.sourceNameMatched = fill(row, 'displayName', row.sourceCandidate?.provenance?.originalPrefix, 200, 'series');
    row.sourceTypeMatched = fill(row, 'documentType', row.sourceCandidate?.documentType, 100, 'series');
    row.nameProvenance = { table: 'bookdept', column: 'book_number', source: row.sourceCandidate?.provenance ?? null };
  }
  for (const row of references.documentTypes) row.sourceNameMatched = fill(row, 'displayName', row.sourceCandidateName, 100, 'document-type');
  for (const row of references.departments) {
    const matches = departmentRows.filter(value => (typeof value.DEPT_ID === 'number' ? String(value.DEPT_ID) : value.DEPT_ID) === row.sourceId);
    row.centralNameEvidence = { table: 'DEPT', idColumn: 'DEPT_ID', nameColumn: 'DEPT_NAME_TH', matches: matches.map(value => ({ DEPT_ID: value.DEPT_ID, DEPT_NAME_TH: value.DEPT_NAME_TH, STATUS: value.STATUS })) };
    row.sourceNameMatched = false;
    if (matches.length !== 1) { note('department', row, matches.length ? 'ambiguous-central-department' : departmentLookupPerformed ? 'missing-central-department' : 'central-lookup-not-performed'); continue; }
    const match = matches[0];
    row.sourceNameMatched = fill(row, 'displayName', match.DEPT_NAME_TH, 200, 'department');
    if (!['1', 1].includes(match.STATUS)) note('department', row, 'inactive-central-department');
    if (row.sourceNameMatched && row.sourceAliases?.some(alias => typeof alias.value === 'string' && alias.value.trim() && alias.value !== match.DEPT_NAME_TH)) note('department', row, 'source-alias-differs-from-central-name');
  }
  const names = new Map();
  for (const row of references.departments.filter(row => row.sourceNameMatched)) {
    const previous = names.get(row.displayName);
    if (previous) { note('department', row, 'same-name-for-different-department-ids'); note('department', previous, 'same-name-for-different-department-ids'); }
    else names.set(row.displayName, row);
  }
  references.departmentNameEvidence = departmentLookupPerformed ? 'CENTRAL.DEPT.DEPT_NAME_TH; exact DEPT_ID matches; source text preserved; owner review pending' : 'CENTRAL name lookup not performed; source aliases remain context only';
  const reasons = {};
  for (const row of exceptions) reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
  return { references, exceptions, summary: { sourceSha256: references.sourceSha256,
    series: references.series.length, seriesNamesFilled: references.series.filter(row => row.sourceNameMatched).length,
    seriesDocumentTypesFilled: references.series.filter(row => row.sourceTypeMatched).length,
    documentTypes: references.documentTypes.length, documentTypeNamesFilled: references.documentTypes.filter(row => row.sourceNameMatched).length,
    departments: references.departments.length, departmentNamesFilled: references.departments.filter(row => row.sourceNameMatched).length,
    exceptionCounts: reasons, ac2Approved: false, productionReady: false, grantsCreated: 0, databaseWritesPerformed: false } };
}

async function serviceDependencies(serviceRoot) {
  const root = path.resolve(serviceRoot);
  const connector = await import(pathToFileURL(path.join(root, 'dist/core/legacy/legacy-connection.js')).href);
  return { loadConfig: async () => {
    const service = connector.loadLegacyEnv(path.join(root, '.env'));
    const central = connector.loadLegacyEnv(path.resolve(root, service.LEGACY_ENV_FILE || '.env.legacy'));
    return { service, central };
  }, openSession: async (config) => {
    // Load the established configuration, but never call the older plaintext
    // connector. The restricted source adapter enforces TLS/certificate checks
    // and refuses host/database/user substitution or SQL writes.
    const source = await openReadOnlySource({ name: 'central', host: config.CENTRAL_DB_HOST, database: config.CENTRAL_DB_NAME,
      user: config.CENTRAL_DB_USER, password: config.CENTRAL_DB_PASSWORD, allowPrivatePlaintext: false });
    try {
      const [tls] = await source.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
      if (!tls.some(row => row.Variable_name === 'Ssl_cipher' && typeof row.Value === 'string' && row.Value.length > 0)) reject('TLS_REQUIRED');
      const [[charset]] = await source.query('SELECT @@SESSION.character_set_results AS cs');
      if (String(charset?.cs).toLowerCase() !== 'utf8mb4') reject('READ_ONLY_SESSION');
      // The trusted adapter has already completed START TRANSACTION READ ONLY.
      // A SESSION default flag can remain zero for that read-only transaction.
      return { readOnlyFlag: 'START TRANSACTION READ ONLY', characterSetResults: 'utf8mb4', consistentSnapshot: true, tlsVerified: true,
        query: async (sql, params = []) => { const [rows] = params.length ? await source.execute(sql, params) : await source.query(sql); return rows; },
        close: () => source.close() };
    } catch (error) { await source.close(); throw error; }
  } };
}

export async function collectReferenceNames(packetDirectory, serviceRoot, dependencies, { offline = false, departmentBlocker = null } = {}) {
  if (process.env.NODE_ENV === 'production') reject('PRODUCTION');
  const packet = await readReferencePacket(packetDirectory);
  if (departmentBlocker !== null && departmentBlocker !== 'TLS_NOT_AVAILABLE') reject('BLOCKER');
  const ids = packet.references.departments.map(row => row.sourceId);
  if (ids.length > 200 || ids.some(id => !/^\d{1,64}$/.test(id))) reject('DEPARTMENT_ID_SCOPE');
  let session, rows = [], table = null;
  const startedAt = new Date().toISOString();
  if (!offline) {
    const { loadConfig, openSession } = dependencies ?? await serviceDependencies(serviceRoot);
    const { service, central } = await loadConfig();
    if (service.IDENTITY_PROVIDER !== 'central' || service.GENBOOKNO_SOURCE_SHA256 !== packet.manifest.sourceSha256) reject('SERVICE_SOURCE');
    try {
    session = await openSession(central);
    if (!session.readOnlyFlag || session.characterSetResults !== 'utf8mb4' || !session.consistentSnapshot || session.tlsVerified !== true) reject('READ_ONLY_SESSION');
    const tables = await session.query('SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [central.CENTRAL_DB_NAME, 'DEPT']);
    if (tables.length !== 1 || tables[0].TABLE_NAME !== 'DEPT') reject('DEPARTMENT_TABLE');
    table = { TABLE_NAME: 'DEPT', ENGINE: String(tables[0].ENGINE) };
    const result = await session.query(`SELECT DEPT_ID, DEPT_NAME_TH, STATUS FROM DEPT WHERE DEPT_ID IN (${ids.map(() => '?').join(',')})`, ids);
    // Filter collation-equivalent values back to exact IDs and project only the
    // three approved columns; never expose other driver/source columns.
    rows = result.filter(row => ids.includes(typeof row.DEPT_ID === 'number' ? String(row.DEPT_ID) : row.DEPT_ID))
      .map(row => ({ DEPT_ID: row.DEPT_ID, DEPT_NAME_TH: row.DEPT_NAME_TH, STATUS: row.STATUS }));
    } finally { await session?.close(); }
  }
  const evidence = { schemaVersion: 1, sourceSha256: packet.manifest.sourceSha256, inputPacketManifestSha256: packet.manifestSha256,
    mappingFingerprint: packet.manifest.mappingFingerprint, startedAt, completedAt: new Date().toISOString(),
    selectedColumns: ['DEPT_ID', 'DEPT_NAME_TH', 'STATUS'], requestedDepartmentIds: ids, table,
    departmentCollection: { status: offline ? 'not-collected' : 'collected', reason: offline ? departmentBlocker ?? 'NOT_ATTEMPTED_OFFLINE' : null,
      reasonEvidence: offline && departmentBlocker ? 'operator-reported; no CENTRAL query performed in this offline invocation' : null },
    readOnlyVerified: !offline, tlsVerified: !offline, characterSetResults: offline ? null : 'utf8mb4', consistentSnapshot: table?.ENGINE.toUpperCase() === 'INNODB',
    rows, approvals: null, productionReady: false };
  const filled = fillReferenceNames(packet.references, rows, { departmentLookupPerformed: !offline });
  const evidenceBytes = JSON.stringify(evidence, null, 2);
  const summary = { ...filled.summary, centralEvidenceSha256: hash(evidenceBytes), centralConsistentSnapshot: evidence.consistentSnapshot,
    departmentCollection: evidence.departmentCollection, grantsUnchanged: true, inputPacketManifestSha256: packet.manifestSha256 };
  const markdown = ['# T12 — source-filled reference names (private)', '',
    'Names are copied from legacy sources for review. Decisions remain pending; no issuance permissions or production release are approved.', '',
    '| Source series | Target | Display name from old source | Document type | Review |', '|---|---|---|---|---|',
    ...filled.references.series.map(row => `| ${escape(row.sourceId)} | ${escape(row.targetId)} | ${escape(row.displayName)} | ${escape(row.documentType)} | pending |`), '',
    '| Source department | Target | CENTRAL name | Source matched | Review |', '|---|---|---|---|---|',
    ...filled.references.departments.map(row => `| ${escape(row.sourceId)} | ${escape(row.targetId)} | ${escape(row.displayName)} | ${row.sourceNameMatched} | pending |`), '',
    '| Exception kind | Source ID | Reason |', '|---|---|---|',
    ...filled.exceptions.map(row => `| ${escape(row.kind)} | ${escape(row.sourceId)} | ${escape(row.reason)} |`), '',
    'See central-names.json and manifest.json for exact source text, collection time, engine consistency and input/output hashes.', '',
  ].join('\n');
  const values = { 'central-names.json': evidenceBytes, 'references.json': JSON.stringify(filled.references, null, 2),
    'exceptions.json': JSON.stringify(filled.exceptions, null, 2), 'summary.json': JSON.stringify(summary, null, 2), 'REFERENCES.md': markdown };
  const relative = `.local/t12/reference-names-${packet.manifest.sourceSha256.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(project, relative);
  const manifest = { schemaVersion: 1, sourceSha256: packet.manifest.sourceSha256, mappingSha256: packet.manifest.mappingSha256,
    mappingFingerprint: packet.manifest.mappingFingerprint, targetsSha256: packet.manifest.targetsSha256,
    inputPacket: path.relative(project, path.resolve(packetDirectory)).replaceAll('\\', '/'), inputPacketManifestSha256: packet.manifestSha256,
    preservedGrantReviewSha256: packet.manifest.files['grants-review.json'], createdAt: new Date().toISOString(),
    files: Object.fromEntries(Object.entries(values).map(([name, bytes]) => [name, hash(bytes)])), ac2Approved: false, productionReady: false, grantsCreated: 0, databaseWritesPerformed: false };
  await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  await mkdir(directory, { recursive: false, mode: 0o700 });
  for (const [name, bytes] of Object.entries(values)) await writeFile(path.join(directory, name), bytes, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  return { directory: relative, ...summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 2 && args[1] !== '--offline') console.log(JSON.stringify(await collectReferenceNames(args[0], args[1])));
    else if (args[1] === '--offline' && (args.length === 2 || args.length === 4 && args[2] === '--department-blocker')) console.log(JSON.stringify(await collectReferenceNames(args[0], undefined, undefined, { offline: true, departmentBlocker: args[3] ?? null })));
    else reject('ARGUMENTS');
  } catch (error) {
    const code = ['HANDSHAKE_NO_SSL_SUPPORT', 'ECONNREFUSED', 'ETIMEDOUT', 'ER_ACCESS_DENIED_ERROR', 'CONNECTION_FAILED'].includes(error.code) ? error.code : /^REFERENCE_NAMES_[A-Z_]+$/.test(error.message) ? error.message : 'REFERENCE_NAMES_FAILED';
    console.error(JSON.stringify({ failed: true, code, plaintextAttempted: false, databaseWritesPerformed: false, grantsCreated: 0 }));
    process.exitCode = 1;
  }
}
