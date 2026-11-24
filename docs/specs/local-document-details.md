# T06 — รายละเอียดหนังสือและสิทธิ์อ่าน รุ่น local

พัฒนาเมื่อ 12 พฤศจิกายน 2026 (Asia/Bangkok) ต่อจาก T05 ใช้บัญชีสังเคราะห์และ MySQL แยกเดิม ไม่เปลี่ยน schema หรือเปิด production

- รองรับผู้รับหนึ่งคนต่อบรรทัดสูงสุด 20 คน คนละ 200 ตัวอักษร และปลายทางภายในหลายหน่วยงานหรือหน่วยงานภายนอกแบบข้อความอย่างใดอย่างหนึ่ง
- `POST /api/issuance` เพิ่ม `published` boolean ไม่ส่งมีค่า false ปฏิเสธ null/string; รวมค่าที่ normalize แล้วใน idempotency hash และ audit ภายใน transaction เดียวกับเลขและหนังสือ
- รองรับ hash ของคำขอ T05 เดิมเฉพาะ published=false และคง fingerprint ใน browser โดยละค่าตั้งต้น false เพื่อให้ retry หลังอัปเกรดใช้ requestId เดิม
- ผู้ขอเลขและหน่วยงาน ณ วันออกมาจาก identity ฝั่ง server ผู้ลงนามเป็นข้อมูลแยก ไม่รับการกำหนดเจ้าของหรือเลขจาก client
- แยก `allocationStatus: allocated`, `confidential`, `published` และสถานะค้าง PDF ใน response และหน้ารายละเอียด
- `GET /api/issuance` คง `documents` ล่าสุดของเจ้าของ เพิ่ม `sharedDocuments` ล่าสุดของผู้อื่นที่อ่านได้ จำกัดส่วนละ 10 รายการ กรองสิทธิ์ใน SQL ก่อน LIMIT ไม่มีการส่งรายการหรือยอดที่ถูกซ่อน
- `GET /api/issuance/:id` เจ้าของอ่านได้เสมอ ผู้อื่นอ่านเมื่อไม่ลับและ (เผยแพร่หรือหน่วยงานปัจจุบันตรงกับหน่วยงานเดิมของหนังสือ) ใช้กฎ T02 ไม่อิงสิทธิ์ชุดเลขหรือหน่วยงานผู้รับ ไม่พบและไม่มีสิทธิ์คืน 404 ข้อความเดียวกัน ทุก response ใช้ no-store
- รายละเอียดแสดงผู้ขอเลขด้วย stable ID หน่วยงานเดิม ชื่อหน่วยงานรับเรื่องรวมหน่วยงานที่ปิดใช้แล้ว ผู้ลงนาม วันที่/ปีเลข เวลาไทย ความลับ การเผยแพร่ และสถานะจัดสรร/ไฟล์
- Audit เฉพาะเจ้าของ ผู้อ่านร่วมไม่ได้รับ field audit; เจ้าของอ่านเหตุการณ์ทั้งหมดของหนังสือตนได้
- UI มีสถานะ loading/error ที่ประกาศต่อ screen reader และล้างรายละเอียดเก่าเมื่อเปิดรายการใหม่แล้วถูกปฏิเสธ

การแก้ไขหลังออกเลข/version conflict อยู่ T09 และแนบไฟล์อยู่ T07 เทสต์ใช้ fixture แนบ PDF/เปลี่ยนความลับเฉพาะฐานสังเคราะห์เพื่อทดสอบสิทธิ์ การเชื่อม identity จริงและเปิดใช้ยังต้องผ่าน T13/T12

## การตรวจสอบ

ตรวจรับ local และ QA อิสระผ่านเมื่อ 12 พฤศจิกายน 2026 ไม่พบประเด็นค้าง:

- `npm.cmd run test:e2e`: 20/20 (T04 6 และ T05/T06 14) ครอบคลุมตารางอ่านทั้งสี่สถานะ ข้ามเจ้าของ/หน่วยงาน ลับเหนือเผยแพร่ audit เฉพาะเจ้าของ การเดา ID ข้อมูลผิด รายละเอียดครบ และรายการที่ซ่อนมากกว่า LIMIT
- หลังเพิ่ม compatibility T05 รัน `npm.cmd run test:e2e -- tests/issuance.spec.mjs --grep 'T06 invalid|lost committed'`: 2/2 ทั้ง legacy hash และ browser fingerprint ไม่สร้างเลข/audit ซ้ำ
- `npm.cmd run test:issuance`: 7/7 รวมเวลา/ปี การรอ lock การจัดสรร และ replay
- `npm.cmd run test:auth`: 9/9; `npm.cmd run test:production-auth`: 3/3
- `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run build`: ผ่าน
- ตรวจภาพ `.local/t06-document-details.png` และ regression มือถือจาก T05 แล้ว

ไม่รัน migration หรือใช้ข้อมูลจริง GitHub #7 ยัง OPEN เพราะรอบนี้บันทึกผลใน workspace เท่านั้น
