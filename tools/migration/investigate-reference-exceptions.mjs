import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectNativeDump } from './native-dump.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(`REFERENCE_INVESTIGATION_${code}`); };
const json = value => JSON.stringify(value, null, 2);
// Numeric equivalence is used solely to inspect legacy relationships, never to rewrite IDs.
const key = value => typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value).toString() : null;
const esc = value => JSON.stringify(value ?? null).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replaceAll('`', '&#96;');

export function investigateReferenceRows(plan, reviews) {
  const rows = name => {
    const table = plan.tables.find(table => table.name === name);
    if (!table?.columns || !table.records) fail('TABLE');
    return table.records.map(record => Object.fromEntries(table.columns.map((column, index) => [column, record[index]])));
  };
  const series = rows('bookdept'), parents = rows('book'), types = rows('typebook'), history = rows('genbook');
  const result = [];
  const selected = reviews.rows.filter(row => row.kind === 'series' && row.exceptions.length);
  const seen = new Set();
  for (const review of selected) {
    if (seen.has(review.itemId) || !key(review.sourceId)) fail('REVIEW_SCOPE');
    seen.add(review.itemId);
    const matches = series.filter(row => key(row.bookdept_id) === key(review.sourceId));
    if (matches.length !== 1) fail('SERIES_MATCH');
    const source = matches[0];
    const parentMatches = key(source.book_idbook) === null ? [] : parents.filter(row => key(row.idbook) === key(source.book_idbook));
    const parent = parentMatches.length === 1 ? parentMatches[0] : null;
    const typeMatches = key(parent?.typebook_idtypebook) === null ? [] : types.filter(row => key(row.idtypebook) === key(parent.typebook_idtypebook));
    const linkedHistory = history.filter(row => key(row.bookdept) === key(review.sourceId));
    const years = {};
    for (const row of linkedHistory) years[String(row.gen_book_year)] = (years[String(row.gen_book_year)] ?? 0) + 1;
    const controls = typeof source.book_number === 'string' ? Array.from(source.book_number).flatMap((character, index) =>
      /[\u0000-\u001F\u007F]/u.test(character) ? [{ codePoint: `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`, codePointIndex: index }] : []) : [];
    const fields = review.exceptions.map(exception => {
      if (exception.field === 'displayName') return { field: 'displayName', finding: controls.length ? 'source-control-characters' : 'source-name-invalid',
        proposedValue: typeof source.book_number === 'string' && source.book_number.endsWith('\t') && controls.length === 1 ? source.book_number.slice(0, -1) : null,
        proposalScope: 'display-only; original prefix unchanged', decision: 'pending', review: null };
      if (exception.field === 'documentType') return { field: 'documentType', finding: parentMatches.length === 0 ? 'parent-row-absent' : parentMatches.length > 1 ? 'parent-row-ambiguous' : typeMatches.length !== 1 ? 'type-row-missing-or-ambiguous' : 'type-source-present-needs-review',
        proposedValue: null, requiredEvidence: { bookId: source.book_idbook, chain: 'book.idbook -> book.typebook_idtypebook -> typebook.idtypebook' },
        proposalScope: 'request verified parent/type evidence or hold; never infer type from prefix', decision: 'pending', review: null };
      fail('EXCEPTION_FIELD');
    });
    result.push({ itemId: review.itemId, sourceId: review.sourceId, source: {
      bookdeptId: source.bookdept_id, originalPrefix: source.book_number, bookId: source.book_idbook,
      subDepartmentContextOnly: source.sub_dept, parentMatches: parentMatches.length,
      parent: parent ? { idbook: parent.idbook, status: parent.status, typeId: parent.typebook_idtypebook } : null,
      typeMatches: typeMatches.length, type: typeMatches.length === 1 ? { id: typeMatches[0].idtypebook, name: typeMatches[0].typebook } : null },
      controls, history: { records: linkedHistory.length, years }, fields });
  }
  const missingParents = new Map();
  for (const row of result.filter(row => row.fields.some(field => field.finding === 'parent-row-absent'))) {
    const id = row.source.bookId;
    if (!missingParents.has(id)) missingParents.set(id, { bookId: id, seriesIds: [], historyRecords: 0 });
    const group = missingParents.get(id); group.seriesIds.push(row.sourceId); group.historyRecords += row.history.records;
  }
  return { rows: result, missingParentGroups: [...missingParents.values()] };
}

export async function investigateReferenceExceptions(sourceFile, reviewDirectory) {
  if (process.env.NODE_ENV === 'production') fail('PRODUCTION');
  const sourceBytes = await readFile(sourceFile);
  const manifestBytes = await readFile(path.join(reviewDirectory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const allowed = ['summary.json', 'reference-decisions.json', 'grant-decisions.json', 'REVIEW.md'];
  if (manifest.schemaVersion !== 1 || manifest.sourceSha256 !== hash(sourceBytes) || manifest.ac2Approved !== false
    || manifest.productionReady !== false || manifest.executable !== false || manifest.grantsCreated !== 0 || manifest.databaseWritesPerformed !== false
    || !manifest.files || Object.keys(manifest.files).length !== allowed.length || Object.keys(manifest.files).some(name => !allowed.includes(name))) fail('MANIFEST');
  let reviews;
  for (const name of allowed) {
    const bytes = await readFile(path.join(reviewDirectory, name));
    if (hash(bytes) !== manifest.files[name]) fail('DIGEST');
    if (name === 'reference-decisions.json') reviews = JSON.parse(bytes);
  }
  if (reviews.sourceSha256 !== manifest.sourceSha256 || reviews.executable !== false || !Array.isArray(reviews.rows)
    || reviews.rows.some(row => row.decision !== 'pending' || row.reviewer !== null || !Array.isArray(row.exceptions)
      || !Array.isArray(row.fieldReviews) || row.fieldReviews.some(field => field.decision !== 'pending' || field.reviewer !== null))) fail('PENDING_STATE');
  const findings = investigateReferenceRows(inspectNativeDump(sourceBytes), reviews);
  const common = { schemaVersion: 1, sourceSha256: manifest.sourceSha256, inputReviewManifestSha256: hash(manifestBytes),
    inputPacketManifestSha256: manifest.inputPacketManifestSha256, namesManifestSha256: manifest.namesManifestSha256,
    executable: false, ac2Approved: false, productionReady: false, databaseWritesPerformed: false, grantsCreated: 0 };
  const summary = { ...common, seriesInvestigated: findings.rows.length,
    missingParentSeries: findings.rows.filter(row => row.fields.some(field => field.finding === 'parent-row-absent')).length,
    missingParentIds: findings.missingParentGroups.length, controlCharacterSeries: findings.rows.filter(row => row.controls.length).length,
    affectedHistoryRecords: findings.rows.reduce((sum, row) => sum + row.history.records, 0), decisionsRecorded: 0 };
  const values = { 'findings.json': json({ ...common, ...findings }), 'summary.json': json(summary),
    'REVIEW.md': ['# T12 — ตรวจหลักฐานชื่อและประเภท 25 ชุด (ส่วนตัว)', '',
      'ข้อเสนอทั้งหมด pending ต้องมีคำรับรองจริงก่อนใช้ ไม่แก้ prefix/ข้อมูล/สิทธิ์ และไม่อนุมานประเภทจาก prefix', '',
      '## ชื่อผิดปกติ', '',
      ...findings.rows.filter(row => row.controls.length).flatMap(row => [
        `- ชุด ${row.sourceId}: ต้นฉบับ ${esc(row.source.originalPrefix)}; control ${esc(row.controls)}`,
        `- เสนอเฉพาะชื่อแสดงผล: ${esc(row.fields.find(field => field.field === 'displayName')?.proposedValue)}; prefix คงต้นฉบับ`,
        `- parent/type ตามแหล่งจริง: ${esc(row.source.parent)} / ${esc(row.source.type)}; ประวัติ ${row.history.records} รายการ`, '',
      ]),
      '## ประเภทที่ยังขาดหลักฐาน', '',
      '| ชุด | Prefix เดิม (JSON escaped) | parent ที่อ้าง | จำนวน parent ที่พบ | ประวัติทั้งหมด | ปี / จำนวน |', '|---|---|---|---:|---:|---|',
      ...findings.rows.filter(row => row.fields.some(field => field.field === 'documentType')).map(row =>
        `| ${row.sourceId} | ${esc(row.source.originalPrefix)} | ${esc(row.source.bookId)} | ${row.source.parentMatches} | ${row.history.records} | ${esc(row.history.years)} |`), '',
      'จำนวนประวัตินับจาก snapshot ต้นทางทั้งหมด ไม่ใช่ยอด normalized history ที่ promote หรือการรับรองสิทธิ์', '',
      '## ขอหลักฐานตาม parent', '',
      '| book.idbook ที่ต้องตรวจ | ชุดที่กระทบ | ประวัติ |', '|---|---|---:|',
      ...findings.missingParentGroups.map(group => `| ${esc(group.bookId)} | ${esc(group.seriesIds)} | ${group.historyRecords} |`), '',
      'ขอ export หรือหลักฐานจากเจ้าของที่แสดง book.idbook, book.typebook_idtypebook และ typebook.idtypebook/typebook พร้อมวัน/แหล่งที่มา ห้ามเลือก parent ทดแทนจากชื่อหรือรหัสที่ใกล้กัน', '',
      'หากยังไม่มีหลักฐาน ให้บันทึกพักรอการตรวจรับเฉพาะรายการ ไม่ใช่สั่งปิดชุดในฐานจริง', '',
      'ตอบแยกโดยอ้าง sourceSha256, inputReviewManifestSha256, itemId, field, proposedValue, เหตุผล ผู้รับรอง วันเวลา และหลักฐาน การรับรอง displayName ไม่รับรอง documentType หรือเปิดใช้ชุดเลข', '',
    ].join('\n') };
  const relative = `.local/t12/reference-investigation-${manifest.sourceSha256.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(project, relative);
  await mkdir(directory, { recursive: false });
  for (const [name, bytes] of Object.entries(values)) await writeFile(path.join(directory, name), bytes, { flag: 'wx' });
  await writeFile(path.join(directory, 'manifest.json'), json({ ...common, createdAt: new Date().toISOString(),
    files: Object.fromEntries(Object.entries(values).map(([name, bytes]) => [name, hash(bytes)])) }), { flag: 'wx' });
  return { directory: relative, ...summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) fail('USAGE');
    process.stdout.write(`${json(await investigateReferenceExceptions(process.argv[2], process.argv[3]))}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
