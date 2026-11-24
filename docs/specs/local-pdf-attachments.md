# T07 — แนบและดาวน์โหลด PDF รุ่น local

พัฒนา 13 พฤศจิกายน 2026 (Asia/Bangkok) บนบัญชีจำลองและ MySQL แยกของ T05/T06 ใช้ `pdf_path` และ `version` เดิม ไม่มี schema migration

- เจ้าของแนบหรือเปลี่ยนไฟล์จากหน้ารายละเอียดด้วย `PUT /api/issuance/:id/pdf` ส่ง bytes ตรง ชนิด `application/pdf` และ `If-Match` เป็น version ปัจจุบัน ไม่รับชื่อไฟล์/path จาก client
- อ่าน stream แบบจำกัดขนาดจริงไม่เกิน 2,097,152 bytes รวมขอบ ตรวจ signature และโครงสร้างด้วย `pdf-lib@1.17.1` ปฏิเสธไฟล์เข้ารหัส โครงสร้างเสีย reference ขาด หรือ content stream อ่านไม่ได้ แยก parser เป็น subprocess จำกัด heap 128 MiB และเวลา 5 วินาที
- เก็บไฟล์ immutable ชื่อสุ่มใน `.local/private-pdf` นอก public เขียน/flush/ปิดก่อนอัปเดตฐานข้อมูล ไม่ใช้ path จากประวัติเดิม
- ล็อก owner ร่วมกับการออกเลข แล้วล็อกหนังสือ ตรวจเจ้าของและ version ซ้ำ อัปเดต pointer/version และ audit `pdf_attached`/`pdf_replaced` ใน transaction เดียว ข้อผิดพลาดไม่เปลี่ยนไฟล์เดิม เลข หรือสถานะค้างไฟล์
- เมื่อแนบไม่ลับสำเร็จ `pdfPending=false` และขอเลขใหม่ได้ตามสิทธิ์/เวลาเดิม หนังสือลับยกเว้นไฟล์แต่ถ้าแนบต้องผ่านการตรวจเช่นเดียวกัน ไม่ผูกการแนบกับวันที่/ประเภทการจัดสรรเลข
- ดาวน์โหลดผ่าน `GET /api/issuance/:id/pdf` เท่านั้น ตรวจสิทธิ์ทุกครั้งด้วยกฎ T02: เจ้าของ หรือไม่ลับและ (เผยแพร่หรืออยู่หน่วยงานเดิมของหนังสือ) ผู้อ่านคนอื่นแนบแทนไม่ได้ ลับเหนือเผยแพร่ ไม่อิง grant หรือหน่วยงานผู้รับ
- response ดาวน์โหลดใช้ attachment, nosniff, sandbox, no-store และ Vary: Cookie; ไม่ส่ง storage key ในรายละเอียดหรือ audit ของผู้ใช้ ไฟล์หายคืน 503 ไม่ส่งไฟล์ว่างสำเร็จ
- UI มี input/คำอธิบาย/validation/loading/error และลิงก์เปิดรายการใหม่เมื่อ version เก่า รองรับดาวน์โหลดของลับที่มีไฟล์แล้วด้วย

## การกู้คืนและการดูแลไฟล์

เก็บไฟล์เดิมหลังแทนที่ และเก็บไฟล์ใหม่ที่เขียนแล้วแม้ DB rollback หรือผล commit ไม่ชัดเจน เพื่อไม่ลบไฟล์ที่ transaction อาจอ้างอิงสำเร็จแล้ว ไฟล์ orphan ไม่ถูกเสิร์ฟเพราะ endpoint อ่าน pointer ที่ commit แล้วจาก DB เท่านั้น ยังไม่มีงานลบไฟล์อัตโนมัติหรือกำหนดอายุเก็บ

เมื่อ response หาย ให้เปิดรายการเดิมเพื่อตรวจ version/สถานะและดาวน์โหลดก่อนลองอีกครั้ง คำขอ version เก่าจะได้ 409 ไม่เขียนทับ หาก storage หายให้กู้ `.local/private-pdf` จากสำเนาของ environment นั้น หรือให้เจ้าของแนบใหม่บนรายการเดิม ห้ามแก้ pointer หรือปลด gate ด้วยค่าปลอม ก่อนเปิดจริงต้องจัด storage/backup/สิทธิ์ filesystem ตาม environment ที่ตรวจรับ

T07 นี้ใช้กับหนังสือใหม่ `issuance_documents` เท่านั้น PDF ของประวัติที่ย้ายยังรอ inventory และ mapping M21 ของ T12 ไม่เปิด legacy filename/path เป็น URL และไม่แก้ `legacy_documents.pdf_pending` จากการคาดเดา identity จริงและเปิดใช้งานยังเป็น T13/T12; งานย้อนหลังเป็น T10 และเปลี่ยนความลับเป็น T09

## ผลตรวจ

ตรวจรับ 13 พฤศจิกายน 2026:

- T07 browser/HTTP `npm.cmd run test:e2e -- tests/pdf.spec.mjs`: 8/8 ผ่าน ครอบคลุมสิทธิ์ทั้งสี่สถานะ/เจ้าของ/anonymous/Origin, bytes และ headers, gate, ขอบ 2 MiB, ปลอม MIME, เข้ารหัส, content stream เสีย, Contents/Resources reference ขาด, version ชนกัน, audit ก่อน–หลัง, audit rollback, storage เขียนไม่ได้/ไฟล์หาย และมือถืออัปโหลด/ดาวน์โหลด
- Regression `npm.cmd run test:e2e -- tests/issuance.spec.mjs tests/auth.spec.mjs`: 20/20 ผ่าน
- `npm.cmd run test:issuance`: 7/7; `npm.cmd run test:auth`: 9/9
- `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run build`: ผ่าน
- `npm.cmd run test:production-auth`: 3/3 ผ่าน
- QA แยกตรวจหลังแก้ validator และ before/after audit แล้ว ไม่พบ Critical/High/Medium ค้าง ตรวจภาพ `.local/t07-mobile-pdf.png` แล้ว ไม่มี horizontal overflow บนมือถือ

เกณฑ์ T07 ผ่าน 6/6 สำหรับ local; T10 พร้อมเริ่ม GitHub #8 ยัง OPEN เพราะบันทึกเฉพาะ workspace ไม่ได้อัปเดตภายนอก ไม่รัน production migration/deploy
