import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readDump } from './dump.mjs';
import { mappingTemplate, mappingPlan } from './mapping.mjs';

const [, , file, reviewedFile] = process.argv;
if (!file || process.argv.length > 4) throw new Error('Usage: node tools/migration/check-mapping.mjs <snapshot.sql.gz> [reviewed-mapping.json]');
const dump = await readDump(file);
const template = mappingTemplate(dump);
const mapping = reviewedFile ? JSON.parse(await readFile(reviewedFile, 'utf8')) : template;
const plan = mappingPlan(dump, mapping);
const directory = `.local/t12/mapping-${dump.sourceSha256.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/mapping.json`, JSON.stringify(mapping, null, 2), { flag: 'wx', mode: 0o600 });
await writeFile(`${directory}/readiness.json`, JSON.stringify({ ...plan.summary, mappingFingerprint: plan.mappingFingerprint, planFingerprint: plan.planFingerprint, blockers: plan.blockers, held: plan.held }, null, 2), { flag: 'wx', mode: 0o600 });
await writeFile(`${directory}/README.md`, `# T12 — ผลตรวจ mapping\n\nข้อมูลเฉพาะเครื่อง ไม่เผยแพร่รหัสบุคคลหรือเนื้อหาต้นฉบับ\n\n- ต้นฉบับ ${dump.sourceSha256}\n- หนังสือทั้งหมด ${plan.summary.sourceDocuments}\n- ผ่าน mapping ${plan.summary.historyDocuments}; เก็บแยก ${plan.summary.heldDocuments}; รอ mapping ${plan.summary.unresolvedDocuments}; ข้อมูลไม่ผ่าน ${plan.summary.invalidDocuments}\n- รายการค้าง ${plan.summary.blockers}; พร้อมซ้อม local: ${plan.summary.readyForLocalPromotion}\n- เก็บเลขเดิมทุก source ID ${plan.summary.sourceReservations}; ไม่เปิด gate หรือเพิ่มสิทธิ์\n\nกรอก decision เป็น map หรือ hold ใน mapping.json พร้อม review.by/review.at (YYYY-MM-DD)/review.evidence ทุกแถว และ review ระดับไฟล์ การถือรหัสเหมือนกันไม่ใช่หลักฐานจับคู่ ห้ามกรอกผู้รับรองแทนเจ้าของ\n\nนโยบายที่ต้องรับรองใน policies:\n\n- subnumbers: null-is-zero-with-raw-preserved\n- duplicates: preserve-every-source-id\n- prefix: reviewed-current-series-reference\n- dates: stored-document-date-no-issued-time-conversion\n- pdf: unverified-files-remain-pending\n\nseries map ต้องระบุ targetId และ yearBasis ตาม T01 (00006=document_date, y อื่น=calendar) ชุดที่ไม่มี reference/prefix/ปีให้ hold และเว้น targetId/yearBasis ว่าง Owner/department ต้องระบุ targetId ที่รับรองแล้วแบบ 1:1 หรือ hold เก็บรหัสที่ขาดไว้ตาม ADR 0001 ไม่สร้างรหัสแทน สามารถ hold ราย source ID เพิ่มผ่าน holds พร้อม review ได้\n\nไฟล์นี้สร้างใหม่เสมอ ไม่เขียนทับตารางตรวจรับเดิม ไม่มีการเชื่อม DB หรือ promote ข้อมูลจริง ผล readyForLocalPromotion ไม่ใช่การอนุมัติ production หรือ cutover\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ...plan.summary, directory }));
