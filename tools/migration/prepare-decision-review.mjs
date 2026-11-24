import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readReferencePacket, fillReferenceNames } from './reference-names.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(`DECISION_REVIEW_${code}`); };
const json = value => JSON.stringify(value, null, 2);
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replace(/[\\`*_{}\[\]()#+.!|\-]/g, character => `\\${character}`).replace(/[\u0000-\u001F\u007F]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
const pending = () => ({ decision: 'pending', reviewer: null, reviewedAt: null, evidence: null, rationale: null });
const choices = {
  reference: ['confirm-source-text-with-evidence', 'provide-verified-value-with-evidence', 'hold-for-evidence'],
  grant: ['retain-after-current-identity-and-series-verification', 'exclude-with-owner-confirmed-reason', 'hold-for-evidence'],
};
const nameFiles = ['central-names.json', 'references.json', 'exceptions.json', 'summary.json', 'REFERENCES.md'];

export function groupGrantRows(rows) {
  const groups = new Map(), reasons = {}, seen = new Set();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.sourceRowIndex) || row.sourceRowIndex < 0 || seen.has(row.sourceRowIndex)
      || row.sourceTable !== 'bookdept_user' || !Array.isArray(row.reasons) || row.reasons.some(reason => typeof reason !== 'string' || !reason)) fail('GRANT_SHAPE');
    seen.add(row.sourceRowIndex);
    const unique = [...new Set(row.reasons)].sort();
    for (const reason of unique) reasons[reason] = (reasons[reason] ?? 0) + 1;
    const key = json({ reasons: unique, centralStaffStatus: row.centralStaffStatus,
      currentDepartmentStatus: row.currentDepartmentStatus, sourceDepartmentStatus: row.sourceDepartmentStatus });
    if (!groups.has(key)) groups.set(key, { groupId: `grant-group-${hash(key)}`, reasons: unique,
      centralStaffStatus: row.centralStaffStatus, currentDepartmentStatus: row.currentDepartmentStatus,
      sourceDepartmentStatus: row.sourceDepartmentStatus, rowIndexes: [] });
    groups.get(key).rowIndexes.push(row.sourceRowIndex);
  }
  return { groups: [...groups.values()].sort((a, b) => a.groupId.localeCompare(b.groupId)), reasonCounts: reasons };
}

export async function prepareDecisionReview(packetDirectory, namesDirectory) {
  if (process.env.NODE_ENV === 'production') fail('PRODUCTION');
  const packet = await readReferencePacket(packetDirectory);
  const manifestBytes = await readFile(path.join(namesDirectory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schemaVersion !== 1 || manifest.ac2Approved !== false || manifest.productionReady !== false
    || manifest.grantsCreated !== 0 || manifest.databaseWritesPerformed !== false
    || !manifest.files || Object.keys(manifest.files).length !== nameFiles.length
    || Object.keys(manifest.files).some(name => !nameFiles.includes(name))
    || manifest.inputPacketManifestSha256 !== packet.manifestSha256
    || manifest.preservedGrantReviewSha256 !== packet.manifest.files['grants-review.json']
    || ['sourceSha256', 'mappingSha256', 'mappingFingerprint', 'targetsSha256'].some(field => manifest[field] !== packet.manifest[field])) fail('NAMES_BINDING');
  const files = {};
  for (const name of nameFiles) {
    const bytes = await readFile(path.join(namesDirectory, name));
    if (hash(bytes) !== manifest.files[name]) fail('NAMES_DIGEST');
    files[name] = JSON.parse(name.endsWith('.json') ? bytes : 'null');
  }
  const references = files['references.json'];
  const central = files['central-names.json'];
  if (central.sourceSha256 !== packet.manifest.sourceSha256 || central.inputPacketManifestSha256 !== packet.manifestSha256
    || !['collected', 'not-collected'].includes(central.departmentCollection?.status)) fail('EVIDENCE_BINDING');
  const expected = fillReferenceNames(packet.references, central.rows, { departmentLookupPerformed: central.departmentCollection.status === 'collected' });
  if (json(expected.references) !== json(references) || json(expected.exceptions) !== json(files['exceptions.json'])) fail('REFERENCE_CONTENT');
  if (references.sourceSha256 !== packet.manifest.sourceSha256 || references.executable !== false || references.review !== null) fail('REFERENCE_STATE');
  const referenceRows = [];
  for (const kind of ['series', 'departments', 'documentTypes']) {
    const original = packet.references[kind];
    if (!Array.isArray(references[kind]) || references[kind].length !== original.length) fail('REFERENCE_SCOPE');
    const seen = new Set();
    for (const row of references[kind]) {
      const prior = original.find(value => value.sourceId === row.sourceId);
      if (!prior || seen.has(row.sourceId) || row.targetId !== prior.targetId) fail('REFERENCE_SCOPE');
      seen.add(row.sourceId);
      if (row.decision !== 'pending' || row.review !== null || kind === 'series' && row.enabled !== false
        || kind === 'departments' && row.nameVerified !== false) fail('REFERENCE_STATE');
      referenceRows.push({ itemId: `${kind}:${row.sourceId}`, kind, sourceId: row.sourceId, targetId: row.targetId ?? null,
        displayName: row.displayName, documentType: row.documentType ?? null,
        exceptions: files['exceptions.json'].filter(value => value.sourceId === row.sourceId
          && value.kind === ({ series: 'series', departments: 'department', documentTypes: 'document-type' })[kind]),
        fieldReviews: (kind === 'series' ? ['displayName', 'documentType'] : ['displayName']).map(field => ({
          field, sourceValue: row[field], proposedValue: null, allowedChoices: choices.reference, ...pending() })), ...pending() });
    }
  }
  // readReferencePacket has verified these bytes against the input manifest.
  const grantBytes = await readFile(path.join(packetDirectory, 'grants-review.json'));
  if (hash(grantBytes) !== packet.manifest.files['grants-review.json']) fail('GRANTS_DIGEST');
  const grants = JSON.parse(grantBytes);
  const grouped = groupGrantRows(grants.rows);
  const common = { schemaVersion: 1, sourceSha256: packet.manifest.sourceSha256,
    inputPacketManifestSha256: packet.manifestSha256, namesManifestSha256: hash(manifestBytes), executable: false,
    ac2Approved: false, productionReady: false, databaseWritesPerformed: false, grantsCreated: 0 };
  const summary = { ...common, referenceItems: referenceRows.length,
    referenceItemsWithExceptions: referenceRows.filter(row => row.exceptions.length).length,
    referenceExceptionReasons: files['summary.json'].exceptionCounts,
    grantRows: grants.rows.length, grantGroups: grouped.groups.length, grantReasonCounts: grouped.reasonCounts,
    decisionsRecorded: 0, allPending: true };
  const values = {
    'summary.json': json(summary),
    'reference-decisions.json': json({ ...common, rows: referenceRows }),
    'grant-decisions.json': json({ ...common, rolesCreateGrants: false, groups: grouped.groups,
      rows: grants.rows.map(row => ({ ...row, itemId: `bookdept_user:${row.sourceRowIndex}`, allowedChoices: choices.grant,
        currentReview: pending() })) }),
    'REVIEW.md': ['# T12 AC2 — รายการตรวจรับทีละกลุ่ม (ส่วนตัว)', '',
      'ทุกคำตัดสินยัง pending ไฟล์นี้เป็นข้อเสนอสำหรับตรวจรับ ไม่เปิดสิทธิ์หรือรับรอง AC2', '',
      '## 1. ชื่อและประเภทที่มีข้อยกเว้น', '',
      '| รายการ | ชื่อจากต้นทาง | ประเภท | เหตุผล |', '|---|---|---|---|',
      ...referenceRows.filter(row => row.exceptions.length).map(row => `| ${escape(row.itemId)} | ${escape(row.displayName)} | ${escape(row.documentType)} | ${escape(row.exceptions.map(value => `${value.field ?? ''}: ${value.reason}`).join('; '))} |`), '',
      'ตัวเลือก: ยืนยันข้อความเดิมพร้อมหลักฐาน / ระบุค่าที่ตรวจสอบแล้วพร้อมหลักฐาน / พักรอหลักฐาน', '',
      'ห้ามแก้ prefix รหัส หรือประเภทตามการเดา การพักในชุดตรวจรับนี้ยังไม่เปลี่ยนสถานะชุดเลขในระบบ', '',
      'ชื่อที่เติมได้ก็ยังต้องตรวจรับ ดูทุกรายการใน reference-decisions.json', '',
      '## 2. สิทธิ์เดิม แบ่งกลุ่มแบบไม่ซ้ำแถว', '',
      '| กลุ่ม | จำนวนแถว | เหตุผล | สถานะบุคลากร / หน่วยงานปัจจุบัน |', '|---|---:|---|---|',
      ...grouped.groups.map(group => `| ${escape(group.groupId)} | ${group.rowIndexes.length} | ${escape(group.reasons.join('; '))} | ${escape(group.centralStaffStatus)} / ${escape(group.currentDepartmentStatus)} |`), '',
      `รวม ${grants.rows.length} แถว แต่ละแถวอยู่กลุ่มเดียว ยอดรายเหตุผลใน summary.json ซ้อนกันได้`, '',
      'ตัวเลือกแต่ละแถว: คงสิทธิ์หลังตรวจตัวตน/ชุดเลขปัจจุบัน / ไม่ย้ายสิทธิ์พร้อมเหตุผลที่เจ้าของรับรอง / พักรอหลักฐาน', '',
      'กลุ่มใช้จัดลำดับตรวจเท่านั้น ต้องตรวจรายแถว ไม่รับรองรวมตามกลุ่ม การไม่มี mapping เจ้าของประวัติไม่พิสูจน์ว่า login ไม่ได้ และ dept_id ว่างไม่ใช่เหตุถอนสิทธิ์', '',
      '## 3. วิธีส่งคำตัดสิน', '',
      'อ้าง itemId และ field (displayName หรือ documentType) พร้อมตัวเลือก เหตุผล ผู้รับรอง วันเวลา และหลักฐานจริง หากเปลี่ยนชื่อ/ประเภทระบุ proposedValue ด้วย ต้องรับรองแต่ละ fieldReviews แยกกัน การยืนยันชื่อไม่ยืนยันประเภท', '',
      'เก็บชุดนี้เป็นหลักฐานตั้งต้น ส่งคำตอบเป็นไฟล์แยกที่ผูก sourceSha256 และ manifest hash ทั้งสอง ห้ามแก้ต้นฉบับเพื่อให้ hash ผ่าน การบันทึกคำตอบยังไม่ใช่การ apply สิทธิ์หรือ cutover', '',
      'ชื่อหน่วยงานต้องได้หลักฐาน CENTRAL ผ่านช่องทางเข้ารหัสหรือ export ที่ตรวจที่มาได้ สถานะ/สิทธิ์ต้องตรวจซ้ำร่วมกับ T13 ก่อนเปิดจริง', '',
    ].join('\n'),
  };
  const relative = `.local/t12/decision-review-${common.sourceSha256.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(project, relative);
  await mkdir(directory, { recursive: false });
  for (const [name, bytes] of Object.entries(values)) await writeFile(path.join(directory, name), bytes, { flag: 'wx' });
  await writeFile(path.join(directory, 'manifest.json'), json({ ...common, createdAt: new Date().toISOString(),
    preservedGrantReviewSha256: hash(grantBytes), files: Object.fromEntries(Object.entries(values).map(([name, bytes]) => [name, hash(bytes)])) }), { flag: 'wx' });
  return { directory: relative, ...summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) fail('USAGE: node tools/migration/prepare-decision-review.mjs <ac2-packet> <reference-names-packet>');
    process.stdout.write(`${json(await prepareDecisionReview(process.argv[2], process.argv[3]))}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
