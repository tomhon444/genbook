import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { chromium, expect, request as playwrightRequest } from '@playwright/test';
import mysql from 'mysql2/promise';
import { startDatabase } from '../issuance/database.mjs';
import { startIdentity } from '../local-auth/provider.mjs';
import { readDump } from './dump.mjs';
import { mappingPlan, fingerprint } from './mapping.mjs';
import { preserveSnapshot } from './preservation.mjs';
import { promoteSnapshot } from './promote.mjs';
import { validateTargets, permissionSamples, allocationScope } from './http-rehearsal-input.mjs';
import { stopApp } from './http-rehearsal-process.mjs';

// Test-only orchestrator: accepts files, never a database URL. All writes,
// fixture grants and the temporary open gate belong to startDatabase()'s fresh
// disposable instance. No CENTRAL connection or production release is involved.
const databasePort = 3333, appPort = 3115, origin = `http://127.0.0.1:${appPort}`;
const verify = (condition, code) => { if (!condition) throw new Error(code); };
const bangkokDate = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const number = row => `${row.prefix}/${String(row.main).padStart(4, '0')}${row.sub ? `.${row.sub}` : ''}`;
const readable = (row, actor) => row.ownerId === actor.staffId || (!row.confidential && (row.published || row.departmentId === actor.departmentId));

async function portIsFree(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

let database, provider, child, logs, browser, report, directory, stage = 'preflight', cleaning;
const contexts = [];
const cleanupResult = {};
async function closeIssuance() {
  if (!database) return;
  await database.admin.query("UPDATE issuance_migration_gate SET state='blocked' WHERE id=1; UPDATE issuance_grants SET active=FALSE; UPDATE issuance_series SET enabled=FALSE");
  const [[state]] = await database.admin.query("SELECT (SELECT state FROM issuance_migration_gate WHERE id=1) gate,(SELECT COUNT(*) FROM issuance_grants WHERE active=TRUE) grants,(SELECT COUNT(*) FROM issuance_series WHERE enabled=TRUE) series");
  verify(state.gate === 'blocked' && Number(state.grants) === 0 && Number(state.series) === 0, 'RESTORED_GATE_OR_GRANTS_INVALID');
  cleanupResult.gateRestoredBlocked = true;
  cleanupResult.activeGrantsAtEnd = 0;
  cleanupResult.enabledSeriesAtEnd = 0;
}

async function cleanup() {
  return cleaning ??= (async () => {
    const failures = [];
    const attempt = async (name, work) => { try { await work(); } catch { failures.push(name); } };
    await attempt('gate', closeIssuance);
    await attempt('browser', async () => { await browser?.close(); });
    for (const context of contexts) await attempt('request-context', () => context.dispose());
    await attempt('app', () => stopApp(child));
    if (child) await attempt('app-port', async () => { await portIsFree(appPort); cleanupResult.appPortClosed = true; });
    await attempt('identity', async () => { await provider?.close(); });
    await attempt('database', async () => { await database?.close(); });
    if (database) {
      await attempt('database-directory', async () => {
        try { await access(path.join(database.runtime, 'data')); throw new Error('Data still exists'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        cleanupResult.dataDirectoryRemoved = true;
      });
      await attempt('database-port', async () => { await portIsFree(databasePort); cleanupResult.databasePortClosed = true; });
    }
    if (logs) await attempt('diagnostic-log', () => new Promise(resolve => logs.end(resolve)));
    cleanupResult.failures = failures;
    verify(failures.length === 0, 'CLEANUP_INCOMPLETE');
  })();
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  try { await cleanup(); } finally { process.exit(signal === 'SIGINT' ? 130 : 143); }
});

async function newContext(username, password) {
  const context = await playwrightRequest.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin }, timeout: 60000 });
  contexts.push(context);
  if (username) {
    const response = await context.post('/api/auth/login', { data: { username, password } });
    verify(response.status() === 200, 'FIXTURE_LOGIN_FAILED');
  }
  return context;
}

try {
  verify(process.env.NODE_ENV !== 'production', 'REHEARSAL_REFUSES_PRODUCTION');
  verify(process.argv.length === 5, 'Usage: node tools/migration/rehearse-http.mjs <snapshot.sql.gz> <reviewed-mapping.json> <reviewed-targets.json>');
  const dump = await readDump(process.argv[2]);
  const mapping = JSON.parse(await readFile(process.argv[3], 'utf8'));
  const plan = mappingPlan(dump, mapping);
  verify(plan.summary.readyForLocalPromotion, 'APPROVED_MAPPING_NOT_READY');
  const targets = JSON.parse(await readFile(process.argv[4], 'utf8'));
  validateTargets(targets, dump.sourceSha256, plan);
  const samples = permissionSamples(plan);
  const today = bangkokDate(), currentYear = Number(today.slice(0, 4)) + 543;
  const scope = allocationScope(plan, currentYear);
  verify(plan.held.length > 0, 'ACTUAL_HELD_SAMPLE_REQUIRED');
  await portIsFree(appPort);
  directory = `.local/t12/http-${dump.sourceSha256.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  await mkdir(directory, { recursive: true });
  const progress = message => console.log(JSON.stringify({ stage: message, directory }));
  stage = 'isolated-database'; progress(stage);
  database = await startDatabase({ port: databasePort });
  await database.admin.query('UPDATE issuance_grants SET active=FALSE; UPDATE issuance_series SET enabled=FALSE');
  for (const row of targets.departments) await database.admin.execute('INSERT INTO issuance_departments(id,name,enabled) VALUES (?,?,FALSE) ON DUPLICATE KEY UPDATE name=VALUES(name),enabled=FALSE', [row.id, row.name]);
  for (const row of targets.series) {
    const source = plan.mappedSeries.find(value => value.targetId === row.id);
    await database.admin.execute('INSERT INTO issuance_series(id,name,document_type,prefix,year_basis,enabled) VALUES (?,?,?,?,?,FALSE) ON DUPLICATE KEY UPDATE name=VALUES(name),document_type=VALUES(document_type),prefix=VALUES(prefix),year_basis=VALUES(year_basis),enabled=FALSE', [row.id, row.name, row.documentType, source.sourcePrefix, source.yearBasis]);
  }
  stage = 'preservation'; progress(stage);
  const options = { approvalReference: targets.preservationApprovalReference };
  await preserveSnapshot(database.admin, dump, options);
  stage = 'promotion-dry-run'; progress(stage);
  const dryRun = await promoteSnapshot(database.admin, dump, mapping, options);
  const [[rolledBack]] = await database.admin.query('SELECT (SELECT COUNT(*) FROM legacy_documents)+(SELECT COUNT(*) FROM legacy_document_details)+(SELECT COUNT(*) FROM legacy_promotions)+(SELECT COUNT(*) FROM issuance_counters)+(SELECT COUNT(*) FROM legacy_reservation_links) writes');
  verify(dryRun.dryRun && Number(rolledBack.writes) === 0, 'DRY_RUN_WRITES_REMAIN');
  stage = 'promotion-commit-and-replay'; progress(stage);
  await promoteSnapshot(database.admin, dump, mapping, { ...options, dryRun: false });
  const replay = await promoteSnapshot(database.admin, dump, mapping, { ...options, dryRun: false });
  verify(replay.replayed, 'PROMOTION_REPLAY_FAILED');
  const [[seed]] = await database.admin.execute('SELECT last_number FROM issuance_counters WHERE series_id=? AND number_year=?', [scope.seriesId, currentYear]);
  verify(Number(seed.last_number) === scope.floor, 'IMPORTED_FLOOR_MISMATCH');
  const [[closed]] = await database.admin.query("SELECT (SELECT state FROM issuance_migration_gate WHERE id=1) gate,(SELECT COUNT(*) FROM issuance_grants WHERE active=TRUE) grants,(SELECT COUNT(*) FROM issuance_series WHERE enabled=TRUE) series");
  verify(closed.gate === 'blocked' && Number(closed.grants) === 0 && Number(closed.series) === 0, 'PRE_TEST_GATE_MUST_BE_CLOSED');

  // Real owner/department references below are simulated identities only. They
  // prove app authorization on imported rows, not real CENTRAL login or grants.
  const suffix = randomUUID().slice(0, 8);
  const usedOwners = new Set(plan.documents.map(row => row.ownerId));
  const usedDepartments = new Set(plan.documents.map(row => row.departmentId));
  const fixtureId = `AC4-FIXTURE-${suffix}`;
  verify(!usedOwners.has(fixtureId) && !usedOwners.has(`${fixtureId}-2`) && !usedDepartments.has(fixtureId), 'FIXTURE_ID_COLLISION');
  const actors = samples.flatMap(({ kind, document }, index) => [
    { username: `owner-${index}`, staffId: document.ownerId, departmentId: document.departmentId, role: 'owner', kind, document },
    { username: `peer-${index}`, staffId: fixtureId, departmentId: document.departmentId, role: 'peer', kind, document },
    { username: `outside-${index}`, staffId: fixtureId, departmentId: fixtureId, role: 'outside', kind, document },
  ]);
  const issuers = [0, 1].map(index => ({ username: `issuer-${index}`, staffId: index ? `${fixtureId}-2` : fixtureId, departmentId: '204' }));
  const secret = randomBytes(32).toString('hex'), password = randomBytes(24).toString('base64url');
  provider = await startIdentity({ secret, ttlMs: 60 * 60 * 1000, users: [...actors, ...issuers].map(({ username, staffId, departmentId }) => ({ username, staffId, departmentId, password, displayName: 'AC4 simulated identity', departmentName: 'AC4 simulated department', active: true, faculty: true })) });
  logs = createWriteStream(`${directory}/server-private.log`, { flags: 'wx', mode: 0o600 });
  stage = 'http-server'; progress(stage);
  child = spawn(process.execPath, ['tools/migration/http-rehearsal-app.mjs', String(appPort)], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, NODE_ENV: 'development', AC4_HTTP_REHEARSAL: '1', NEXT_TEST_DIST: 't12-details', AUTH_PROVIDER: 'local', BOOK_DATA_PROVIDER: 'local', LOCAL_IDENTITY_URL: provider.url, LOCAL_IDENTITY_SECRET: secret, ISSUANCE_DATABASE_URL: database.url, RONALDO_SERVICE_URL: '', RONALDO_GENBOOKNO_SECRET: '', NEXT_TELEMETRY_DISABLED: '1' },
  });
  await writeFile(`${directory}/runtime-private.json`, JSON.stringify({ appRootPid: child.pid, appPort, databasePort, databaseRuntime: database.runtime }), { flag: 'wx', mode: 0o600 });
  let spawnError;
  child.once('error', error => { spawnError = error; });
  child.stdout.pipe(logs); child.stderr.pipe(logs);
  const startupDeadline = Date.now() + 120000;
  let ready = false;
  while (Date.now() < startupDeadline) {
    verify(!spawnError && child.exitCode === null && child.signalCode === null, 'OWN_APP_PROCESS_EXITED');
    try { ready = (await fetch(`${origin}/login`, { signal: AbortSignal.timeout(4000) })).status === 200; } catch { /* Startup polling only. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  verify(ready, 'HTTP_STARTUP_TIMEOUT');
  const anonymous = await newContext();
  verify((await anonymous.get('/api/history')).status() === 401 && (await anonymous.get('/api/search')).status() === 401, 'ANONYMOUS_HISTORY_EXPOSED');

  stage = 'actual-history-permissions'; progress(stage);
  const byId = new Map(plan.documents.map(row => [row.sourceId, row]));
  const matrix = [];
  const heldSamples = [...new Map(plan.held.map(row => [row.reason, row])).values()];
  for (const actor of actors) {
    const context = await newContext(actor.username, password);
    actor.context = context;
    const detail = await context.get(`/api/history?${new URLSearchParams({ snapshot: dump.sourceSha256, sourceId: actor.document.sourceId })}`);
    const allowed = actor.role === 'owner' || (actor.kind !== 'confidential' && (actor.role === 'peer' || actor.kind === 'faculty-published'));
    verify(detail.status() === (allowed ? 200 : 404), 'DETAIL_PERMISSION_MATRIX_FAILED');
    if (allowed) {
      const body = await detail.json();
      verify(body.sourceId === actor.document.sourceId && body.sourceSha256 === dump.sourceSha256 && body.number === number(actor.document) && body.subject === actor.document.subject, 'DETAIL_HISTORY_CHANGED');
      verify(fingerprint(body.details) === fingerprint(actor.document.details), 'DETAIL_METADATA_CHANGED');
      verify(detail.headers()['cache-control'] === 'no-store', 'DETAIL_CACHE_INVALID');
    }
    const listing = await context.get('/api/history');
    verify(listing.status() === 200 && listing.headers()['cache-control'] === 'no-store', 'HISTORY_LIST_FAILED');
    const listed = await listing.json();
    verify(listed.documents.length > 0 && listed.documents.every(row => row.sourceSha256 === dump.sourceSha256 && byId.has(row.sourceId) && readable(byId.get(row.sourceId), actor) && !Object.hasOwn(row, 'details')), 'HISTORY_LIST_PERMISSION_FAILED');
    const search = await context.get('/api/search');
    verify(search.status() === 200, 'HISTORY_SEARCH_FAILED');
    const searched = await search.json();
    const expectedTotal = plan.documents.filter(row => readable(row, actor)).length;
    verify(searched.total === expectedTotal && searched.documents.every(row => row.kind === 'legacy' && row.snapshot === dump.sourceSha256 && byId.has(row.id) && readable(byId.get(row.id), actor)), 'SEARCH_PERMISSION_TOTAL_FAILED');
    for (const held of heldSamples) verify((await context.get(`/api/history?${new URLSearchParams({ snapshot: dump.sourceSha256, sourceId: held.sourceId })}`)).status() === 404, 'HELD_HISTORY_EXPOSED');
    matrix.push({ category: actor.kind, role: actor.role, detailStatus: detail.status(), authorizedSearchTotal: searched.total });
  }
  const [[heldCount]] = await database.admin.execute('SELECT COUNT(*) n FROM legacy_number_reservations r LEFT JOIN legacy_documents d ON d.source_sha256=r.source_sha256 AND d.source_id=r.source_id WHERE r.source_sha256=? AND d.source_id IS NULL', [dump.sourceSha256]);
  verify(Number(heldCount.n) === plan.held.length, 'HELD_SOURCE_RECONCILIATION_FAILED');
  const appConnection = await mysql.createConnection(database.url);
  try {
    for (const sql of ['SELECT * FROM legacy_staging LIMIT 1', "UPDATE issuance_migration_gate SET state='open' WHERE id=1"]) {
      let denied = false;
      try { await appConnection.query(sql); } catch (error) { denied = error.code === 'ER_TABLEACCESS_DENIED_ERROR'; }
      verify(denied, 'APP_DATABASE_PRIVILEGES_TOO_BROAD');
    }
  } finally { await appConnection.end(); }

  stage = 'browser-history'; progress(stage);
  browser = await chromium.launch({ headless: true });
  const browserContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Never fetch external resources or capture real contents in screenshots,
  // video, trace or a shared Playwright report.
  await browserContext.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await browserContext.newPage();
  page.setDefaultTimeout(30000);
  const browserActor = actors[0];
  await page.goto(`${origin}/login`);
  await page.getByLabel('ชื่อบัญชี').fill(browserActor.username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/workspace`);
  const document = browserActor.document;
  const detailUrl = `${origin}/workspace/documents/legacy/${encodeURIComponent(document.sourceId)}?${new URLSearchParams({ snapshot: dump.sourceSha256 })}`;
  await page.goto(detailUrl);
  const detailRegion = page.getByRole('region', { name: 'รายละเอียดประวัติหนังสือ', exact: true });
  await expect(detailRegion).toContainText(document.subject);
  await expect(detailRegion).toContainText(number(document));
  await expect(detailRegion).toContainText('อ่านอย่างเดียว');
  await expect(detailRegion.getByRole('button')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(detailRegion).toContainText(document.subject);
  // A different simulated session must not retain confidential details.
  await page.request.post(`${origin}/api/auth/logout`, { headers: { Origin: origin } });
  const outside = actors.find(actor => actor.kind === 'confidential' && actor.role === 'outside');
  const loginOutside = await page.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: { username: outside.username, password } });
  verify(loginOutside.status() === 200, 'BROWSER_OUTSIDE_LOGIN_FAILED');
  await page.goto(detailUrl);
  await expect(page.getByRole('alert').filter({ hasText: 'ไม่มีสิทธิ์' })).toContainText('ไม่มีสิทธิ์');
  await expect(page.getByRole('region', { name: 'รายละเอียดประวัติหนังสือ', exact: true })).toHaveCount(0);
  await browserContext.close();

  stage = 'isolated-concurrent-allocation'; progress(stage);
  const issuerContexts = await Promise.all(issuers.map(actor => newContext(actor.username, password)));
  const input = () => ({ requestId: randomUUID(), seriesId: scope.seriesId, subject: 'AC4 disposable HTTP allocation', recipient: 'AC4 fixture', recipientDepartmentIds: [], externalOrganization: 'AC4 fixture', signer: 'AC4 fixture', confidential: true, published: false, documentDate: today });
  verify((await issuerContexts[0].post('/api/issuance', { data: input() })).status() === 503, 'CLOSED_GATE_ALLOWED_ALLOCATION');
  // Explicit fixture release solely in this disposable instance. Imported rows,
  // owners, PDF state and reservation floors are never altered for the test.
  await database.admin.query("UPDATE issuance_migration_gate SET state='open' WHERE id=1");
  await database.admin.execute('UPDATE issuance_series SET enabled=TRUE WHERE id=?', [scope.seriesId]);
  verify((await issuerContexts[0].post('/api/issuance', { data: input() })).status() === 403, 'MISSING_GRANT_ALLOWED_ALLOCATION');
  for (const issuer of issuers) await database.admin.execute('INSERT INTO issuance_grants(owner_id,series_id,active) VALUES (?,?,TRUE) ON DUPLICATE KEY UPDATE active=TRUE', [issuer.staffId, scope.seriesId]);
  verify(bangkokDate() === today, 'BANGKOK_DATE_CHANGED_RERUN_REQUIRED');
  const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => issuerContexts[index % 2].post('/api/issuance', { data: input() })));
  verify(responses.every(response => response.status() === 201), 'CONCURRENT_ALLOCATION_STATUS_FAILED');
  const allocated = await Promise.all(responses.map(response => response.json()));
  const mainNumbers = allocated.map(value => value.document.mainNumber).sort((a, b) => a - b);
  verify(mainNumbers.every((value, index) => value === scope.floor + index + 1), 'CONCURRENT_CONTINUITY_FAILED');
  verify(new Set(allocated.map(value => value.document.id)).size === 6 && allocated.every(value => value.document.numberYear === currentYear && value.document.seriesId === scope.seriesId && value.document.subNumber === 0), 'CONCURRENT_UNIQUENESS_FAILED');
  const repeatedInput = input();
  const repeated = await Promise.all(Array.from({ length: 4 }, () => issuerContexts[0].post('/api/issuance', { data: repeatedInput })));
  verify(repeated.filter(response => response.status() === 201).length === 1 && repeated.filter(response => response.status() === 200).length === 3, 'CONCURRENT_RETRY_STATUS_FAILED');
  const repeatedBodies = await Promise.all(repeated.map(response => response.json()));
  verify(new Set(repeatedBodies.map(body => body.document.id)).size === 1 && repeatedBodies.every(body => body.document.mainNumber === scope.floor + 7), 'RETRY_CREATED_MULTIPLE_DOCUMENTS');
  const changed = await issuerContexts[0].post('/api/issuance', { data: { ...repeatedInput, subject: 'Changed retry must conflict' } });
  verify(changed.status() === 409, 'CHANGED_RETRY_NOT_REJECTED');
  const [[counts]] = await database.admin.execute('SELECT (SELECT COUNT(*) FROM issuance_documents) documents,(SELECT COUNT(*) FROM issuance_audit) audit,(SELECT last_number FROM issuance_counters WHERE series_id=? AND number_year=?) counter', [scope.seriesId, currentYear]);
  verify(Number(counts.documents) === 7 && Number(counts.audit) === 7 && Number(counts.counter) === scope.floor + 7, 'RETRY_AUDIT_COUNTER_RECONCILIATION_FAILED');
  const [[collisions]] = await database.admin.query('SELECT COUNT(*) n FROM issuance_documents d JOIN legacy_number_reservations r JOIN legacy_reservation_links l ON l.source_sha256=r.source_sha256 AND l.legacy_series_id=r.legacy_series_id WHERE d.series_id=l.series_id AND d.number_year=r.number_year AND d.main_number=r.main_number AND d.sub_number=r.sub_number');
  verify(Number(collisions.n) === 0, 'NEW_NUMBER_COLLIDES_WITH_IMPORTED_RESERVATION');
  await closeIssuance();
  verify((await issuerContexts[0].post('/api/issuance', { data: input() })).status() === 503, 'RESTORED_GATE_ALLOWED_ALLOCATION');

  report = {
    sourceSha256: dump.sourceSha256, mappingFingerprint: plan.mappingFingerprint, planFingerprint: plan.planFingerprint,
    sourceRows: plan.summary.sourceRows, sourceReservations: plan.summary.sourceReservations,
    historyDocuments: plan.documents.length, heldDocuments: plan.held.length,
    dryRunVerified: true, replayVerified: true, rawAndHistoryEveryFieldVerified: true,
    simulatedIdentityOnly: true, centralLoginVerified: false, realIssuancePermissionsApproved: false,
    permissionMatrix: matrix, heldHttpSamplesPerIdentity: heldSamples.length,
    heldSourceReconciliationVerified: true, appDatabasePrivilegeIsolationVerified: true,
    browser: { actualHistoryDesktopAndMobileRead: true, confidentialOutsideDenied: true, screenshotsOrTracesSaved: false },
    allocation: { temporaryDisposableReleaseOnly: true, syntheticIssuers: 2, issuerDepartment204TimeExemptionFixture: true, importedPdfStateUnchanged: true, numberYear: currentYear, importedReservationFloor: scope.floor, concurrentDistinctRequests: 6, concurrentIdenticalRequests: 4, documentsCreated: 7, auditRowsCreated: 7, counterAdvanced: 7, newReservationCollisions: 0, changedRetryRejected: true, initialAndRestoredGateReject: true, missingGrantRejected: true },
    productionReady: false, databasePort, appPort, verifiedAt: new Date().toISOString(),
  };
  stage = 'cleanup'; progress(stage);
  await cleanup();
  await writeFile(`${directory}/rehearsal.json`, JSON.stringify({ ...report, cleanup: cleanupResult }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ passed: true, directory, historyDocuments: report.historyDocuments, permissionMatrixChecks: matrix.length, allocationDocuments: 7, cleanup: cleanupResult, productionReady: false }));
} catch (error) {
  let cleanupFailed = false;
  try { await cleanup(); } catch { cleanupFailed = true; }
  if (directory) {
    // Diagnostic details may contain source-derived assertions. Keep them local;
    // console output and the aggregate failure report never print their values.
    await writeFile(`${directory}/failure-private.log`, String(error?.stack ?? error), { flag: 'wx', mode: 0o600 }).catch(() => {});
    await writeFile(`${directory}/failure.json`, JSON.stringify({ passed: false, stage, cleanup: cleanupResult, cleanupFailed }, null, 2), { flag: 'wx', mode: 0o600 }).catch(() => {});
  }
  console.error(JSON.stringify({ passed: false, stage, directory: directory ?? null, cleanupFailed, message: directory ? 'See private local diagnostics' : 'Invalid invocation, unapproved inputs, missing permission/year coverage or occupied test port' }));
  process.exitCode = 1;
}
