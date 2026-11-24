import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readDump } from './dump.mjs';
import { mappingPlan } from './mapping.mjs';
import { buildMappingProposal } from './mapping-proposal.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = value => createHash('sha256').update(value).digest('hex');

export async function prepareMappingProposal(snapshot, evidenceDirectory) {
  const bytes = await readFile(path.join(evidenceDirectory, 'evidence.json'));
  const receipt = JSON.parse(await readFile(path.join(evidenceDirectory, 'summary.json'), 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(receipt.evidenceSha256 ?? '') || sha256(bytes) !== receipt.evidenceSha256) throw new Error('Evidence receipt hash mismatch');
  const packet = JSON.parse(bytes);
  const dump = await readDump(snapshot);
  if (receipt.sourceSha256 !== dump.sourceSha256 || packet.sourceSha256 !== dump.sourceSha256) throw new Error('Evidence and snapshot must match');
  const proposal = buildMappingProposal(dump, packet);
  const plan = mappingPlan(dump, proposal.mapping);
  if (plan.summary.readyForLocalPromotion || plan.summary.historyDocuments || plan.summary.counterScopes) throw new Error('Unreviewed proposal must not become executable');
  const relative = `.local/t12/proposal-${dump.sourceSha256.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(project, relative);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const provenance = { sourceSha256: dump.sourceSha256, evidenceSha256: receipt.evidenceSha256,
    evidenceCollectedAt: packet.completedAt, proposalCreatedAt: new Date().toISOString(),
    centralConsistentSnapshot: packet.central.consistentSnapshot, approvals: null };
  const artifacts = {
    'mapping.json': proposal.mapping,
    'decisions.json': { ...provenance, ...proposal.decisions },
    'summary.json': { ...provenance, ...proposal.summary },
    'validation.json': { ...plan.summary, mappingFingerprint: plan.mappingFingerprint,
      blockers: plan.blockers, counterWritesPerformed: false, grantsCreated: 0 },
  };
  for (const [file, value] of Object.entries(artifacts)) await writeFile(path.join(directory, file), JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  const summary = proposal.summary;
  const markdown = [
    '# T12 — ข้อเสนอ mapping สำหรับตรวจรับ', '',
    `ต้นฉบับ SHA-256: ${dump.sourceSha256}`, `หลักฐาน CENTRAL SHA-256: ${receipt.evidenceSha256}`, '',
    'ไฟล์นี้เป็นข้อเสนอ ยังไม่มีผู้รับรอง ทุก review เป็น null และยังไม่พร้อมนำเข้าจริง', '',
    '| กลุ่ม | เสนอจับคู่ | เสนอพัก |', '|---|---:|---:|',
    ...['owners', 'departments', 'series'].map(kind => `| ${kind} | ${summary[kind].map} | ${summary[kind].hold} |`), '',
    `- เรื่องว่างที่เสนอเก็บแยก: ${summary.blankSubjectHolds} รายการ ไม่แต่งข้อความแทน`,
    `- ภาพรวมตามข้อเสนอ: ผ่านเงื่อนไขเบื้องต้น ${summary.documents.readyCandidate}; เก็บแยก ${summary.documents.held}; รวม ${summary.documents.total}`, 
    `- ตัวนับสำหรับตรวจรับ: ${summary.counterPreviewScopes} ขอบเขตชุด/ปี คำนวณจาก reservation ทุก source ID`, '',
    '## ข้อเสนอที่ต้องตรวจรับ', '',
    '1. จับคู่รหัสเจ้าของที่ตรงกับ CENTRAL แบบ 1:1 รวมบัญชีไม่ active เพื่อรักษาประวัติ โดยไม่เปิด login หรือเพิ่มสิทธิ์',
    '2. จับคู่รหัสหน่วยงานเดิมที่พบตรงกัน และรักษาหน่วยงาน ณ วันออกตามต้นฉบับ ไม่แทนด้วยหน่วยงานปัจจุบัน',
    '3. จับคู่ชุดเลขที่มี prefix/กติกาปีครบแบบ 1:1; พักชุดที่ reference/prefix/ปีขาด ไม่รวมชุดเลขที่ prefix คล้ายกัน',
    '4. พักรหัสที่หาไม่พบและเรื่องว่างไว้ในข้อมูลเก็บแยก โดยคงต้นฉบับและกันเลขเดิมทุกเลข',
    '5. คงเลขซ้ำทุก source ID, เก็บวันที่เดิม และให้ PDF ที่ยังไม่ยืนยันคงสถานะรอ; นโยบายทั้งหมดอยู่ใน policySuggestions และยังไม่รับรอง',
    '6. สิทธิ์ bookdept_user/userbook/userlevel แยกจาก mapping นี้ ไม่เพิ่ม grant หรือเปิดการออกเลข', '',
    '## ไฟล์สำหรับตรวจ', '',
    '- mapping.json: รูปแบบที่ validator เดิมอ่านได้ แต่ทุก review ยังเป็น null และ policies ยัง pending',
    '- decisions.json: เหตุผลรายรหัส รายหนังสือ และพื้นตัวนับสำหรับตรวจรับเท่านั้น',
    '- validation.json: ผลตรวจจริงของ validator เดิม ยังมี blockers และไม่มี history/counter ที่พร้อมเขียน',
    '- summary.json: ยอดรวมและ hash อ้างอิง โดยไม่แสดงรหัสบุคคล', '',
    'จำนวนผ่านเงื่อนไขเบื้องต้นไม่ใช่ผลนำเข้า ไม่รวมการรับรองไฟล์/เวลา สิทธิ์จริง หรือ cutover',
    'ก่อนซ้อมนำเข้า ต้องบันทึกคำรับรองจริงและรัน migration:check อีกครั้ง ห้ามแต่งชื่อผู้รับรองหรือเปิด gate จากไฟล์ข้อเสนอ', '',
  ].join('\n');
  await writeFile(path.join(directory, 'REVIEW.md'), markdown, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ directory: relative, ...provenance, ...summary, validation: {
    readyForLocalPromotion: plan.summary.readyForLocalPromotion, historyDocuments: plan.summary.historyDocuments,
    counterScopes: plan.summary.counterScopes, blockers: plan.summary.blockers,
  } }));
  return { directory, summary, validation: plan.summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [, , snapshot, evidenceDirectory] = process.argv;
  if (!snapshot || !evidenceDirectory || process.argv.length !== 4) throw new Error('Usage: prepare-mapping-proposal.mjs <snapshot.sql.gz> <CENTRAL-evidence-directory>');
  try { await prepareMappingProposal(snapshot, evidenceDirectory); }
  catch { console.error('Mapping proposal refused; verify snapshot, evidence receipt and source-bound references. No database writes performed.'); process.exitCode = 1; }
}
