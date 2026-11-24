import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { inspectNativeDump } from './native-dump.mjs';
import { readDump } from './dump.mjs';
import { fingerprint } from './mapping.mjs';
import { buildAc2Review } from './ac2-review.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2);
const escape = value => (value === null || value === undefined ? '(none)' : String(value))
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replace(/[\\`*_{}\[\]()#+.!|\-]/g, character => `\\${character}`).replace(/[\r\n]/g, ' ');

// Accept file inputs only. Never import database modules, execute source SQL,
// query a directory, download files, or turn review rows into active grants.
export async function prepareAc2Review(snapshotFile, mappingFile, targetsFile, evidenceDirectory, { timeDisplayApprovalFile } = {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('AC2 review refuses production');
  const [compressed, mappingBytes, targetsBytes, evidenceBytes, receiptBytes, approvalBytes] = await Promise.all([
    readFile(snapshotFile), readFile(mappingFile), readFile(targetsFile),
    readFile(path.join(evidenceDirectory, 'evidence.json')), readFile(path.join(evidenceDirectory, 'summary.json')),
    timeDisplayApprovalFile ? readFile(timeDisplayApprovalFile) : null,
  ]);
  const native = inspectNativeDump(compressed), dump = await readDump(snapshotFile);
  if (native.sourceSha256 !== dump.sourceSha256) throw new Error('Snapshot changed while preparing review');
  const receipt = JSON.parse(receiptBytes), packet = JSON.parse(evidenceBytes);
  if (!/^[a-f0-9]{64}$/.test(receipt.evidenceSha256 ?? '') || receipt.evidenceSha256 !== digest(evidenceBytes)
    || receipt.sourceSha256 !== dump.sourceSha256 || packet.sourceSha256 !== dump.sourceSha256) throw new Error('Evidence receipt or source binding mismatch');
  const mapping = JSON.parse(mappingBytes), targets = JSON.parse(targetsBytes), timeDisplayApproval = approvalBytes ? JSON.parse(approvalBytes) : null;
  const result = buildAc2Review({ dump, native, mapping, targets, packet, timeDisplayApproval });
  const relative = `.local/t12/ac2-${dump.sourceSha256.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(project, relative);
  if (approvalBytes) result.times.displayPolicyReview.approvalReference = path.relative(project, path.resolve(timeDisplayApprovalFile)).replaceAll('\\', '/');
  const artifacts = {
    'summary.json': result.summary, 'references.json': result.references, 'grants-review.json': result.grants,
    'attachments-inventory.json': result.attachments, 'time-review.json': result.times, 'acceptance.json': result.acceptance,
  };
  const s = result.summary;
  const review = [
    '# T12 — AC2 private review packet', '', `Source SHA-256: ${dump.sourceSha256}`, '',
    'Offline preparation only. This packet is not an approval, production plan, executable grant configuration, or final-source declaration.',
    'No source/target database writes, directory queries, attachment downloads or permission changes were performed.', '',
    '| Review area | Current evidence | Owner decision still required |', '|---|---|---|',
    `| Final source | ${s.sourceDocuments} source documents; ${s.promotedHistoryDocuments} mapped / ${s.heldDocuments} held | Confirm final export and cutover separately |`,
    `| Display references | ${s.mappedSeries} mapped series, ${s.mappedDepartments} mapped departments (${s.promotedDepartments} used in history) | Accept actual names/types; rehearsal labels and aliases are not official names |`,
    `| Legacy permissions | ${s.legacyGrantRows} original rows, all pending/disabled | Review every row and exact staff/series identity; roles do not create grants |`,
    `| File references | ${s.attachmentPendingDocuments} pending documents / ${s.uniqueReferencedFiles} unique paths; ${s.attachmentMissingReferences} missing / ${s.attachmentInvalidReferences} invalid | Verify bytes, visibility, gaps and handling before real release |`,
    `| Pending PDF impact | ${s.promotedPdfPending} promoted documents remain PDF-pending | Do not clear pending state just to allow issuance |`,
    `| Historical times | ${s.unknownRecordedAtRaw} raw / ${s.unknownRecordedAtPromoted} promoted creation times unknown | ${s.timeDisplayPolicyApproved ? 'Display-only policy approved; actual timezone still unverified' : 'Confirm original-text display and unknown-time policy'} |`,
    '| Real accounts | Directory ID/status evidence only; refresh needed before cutover | Confirm actual login and issuance authority |', '',
    '## Files', '',
    '- references.json / REFERENCES.md: source display candidates and original aliases; final displayName and reviews stay empty.',
    '- grants-review.json: every bookdept_user row with exact IDs, directory status and review reasons. Every row is disabled/pending.',
    '- attachments-inventory.json: current snapshot references only, with digest. Zero bytes verified or downloads attempted; older archive results are not copied.',
    '- time-review.json: raw/promoted text quality and unknown source IDs; timezone remains unverified, no UTC conversion.',
    '- acceptance.json: separate pending decisions; any display-only receipt cannot approve actual timezone, real accounts, grants or production.',
    '- manifest.json: input hashes and output digests. Keep this directory private and retain earlier packets unchanged.', '',
    'Record genuine reviewer/date/evidence for decisions. Never fill approvals by interpreting a request to prepare the next step as acceptance.', '',
  ].join('\n');
  const referenceMarkdown = [
    '# T12 — Private display reference review', '', 'Source-derived suggestions only; all final display fields and reviews remain empty.', '',
    '| Source series | Target | Source name candidate | Source type candidate | Final name | Review |', '|---|---|---|---|---|---|',
    ...result.references.series.map(row => `| ${escape(row.sourceId)} | ${escape(row.targetId)} | ${escape(row.sourceCandidate.name)} | ${escape(row.sourceCandidate.documentType)} | pending | pending |`), '',
    '| Source department | Target | Used in promoted history | Source aliases (not official names) | Final name | Review |', '|---|---|---|---|---|---|',
    ...result.references.departments.map(row => `| ${escape(row.sourceId)} | ${escape(row.targetId)} | ${row.usedByPromotedHistory} | ${row.sourceAliases.map(alias => escape(alias.value)).join('; ')} | pending | pending |`), '',
  ].join('\n');
  const outputs = Object.fromEntries(Object.entries(artifacts).map(([name, value]) => [name, json(value)]));
  outputs['REVIEW.md'] = review; outputs['REFERENCES.md'] = referenceMarkdown;
  const manifest = { schemaVersion: 1, sourceSha256: dump.sourceSha256, mappingSha256: digest(mappingBytes), mappingFingerprint: fingerprint(mapping),
    targetsSha256: digest(targetsBytes), evidenceSha256: digest(evidenceBytes), evidenceReceiptSha256: digest(receiptBytes), evidenceCollectedAt: packet.completedAt ?? null,
    centralConsistentSnapshot: packet.central.consistentSnapshot, createdAt: new Date().toISOString(),
    timeDisplayApproval: approvalBytes ? { sha256: digest(approvalBytes), reference: result.times.displayPolicyReview.approvalReference, scope: timeDisplayApproval.scope } : null,
    files: Object.fromEntries(Object.entries(outputs).map(([name, bytes]) => [name, digest(bytes)])),
    ac2Approved: false, productionReady: false, databaseWritesPerformed: false, grantsCreated: 0 };
  // Validation is complete before creating the first output. Each invocation
  // uses a fresh private directory and exclusive writes; no previous review is edited.
  await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  await mkdir(directory, { recursive: false, mode: 0o700 });
  for (const [name, bytes] of Object.entries(outputs)) await writeFile(path.join(directory, name), bytes, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(directory, 'manifest.json'), json(manifest), { flag: 'wx', mode: 0o600 });
  return { directory: relative, ...s };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (!(args.length === 4 || args.length === 6 && args[4] === '--time-display-approval')) throw new Error('Invalid AC2 review arguments');
    const result = await prepareAc2Review(...args.slice(0, 4), { timeDisplayApprovalFile: args[5] });
    console.log(JSON.stringify(result));
  } catch {
    // Errors can include source identifiers or raw values; never print them.
    console.error('AC2 review preparation refused; check approved source/mapping/targets and evidence receipt. No database writes or approvals performed.');
    process.exitCode = 1;
  }
}
