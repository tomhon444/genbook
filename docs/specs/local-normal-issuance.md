# T05 — ออกเลขปกติในเครื่อง

รุ่นนี้ใช้บัญชีและข้อมูลสังเคราะห์เท่านั้น ไม่เปิดใช้กับบุคลากรหรือหนังสือจริงก่อนผ่าน T12/T13

## ทดลองใช้งาน

ใช้ Node.js 24.16 ขึ้นไป และ MySQL 8.0 executable ที่ `C:/laragon/bin/mysql/mysql-8.0.30-winx64/bin/mysqld.exe` หรือกำหนด `T05_MYSQLD` ให้ชี้ executable จากนั้นรัน `npm.cmd run dev:local`

Runner สร้าง MySQL แยกใหม่บน `127.0.0.1:3315` และบัญชีจำลองใน `.local/t04-account.json` เปิด `http://127.0.0.1:3000/login` แล้วขอเลขจากพื้นที่ส่วนตัวได้ หากพอร์ตถูกใช้จะหยุด ไม่เชื่อมฐานที่พอร์ตนั้นแทน ไม่มีการ import ฐานเดิมหรือใช้พอร์ต 3306

ทุกครั้งที่เริ่ม runner เป็นข้อมูลทดสอบชุดใหม่ มีชุดเลขร่วม ชุดแยก และคำสั่งจำลอง พร้อม grants ของบัญชีตัวอย่าง ชุด `00047` พักไว้ ข้อมูลเหล่านี้ไม่ใช่ configuration เปิดระบบจริง รหัสผ่านสร้างใหม่และเก็บเฉพาะ `.local/` ที่ Git ไม่ติดตาม หยุด runner เมื่อเลิกใช้ ฐานสังเคราะห์เป็นข้อมูลชั่วคราว; log คงไว้สำหรับตรวจสอบ

## พฤติกรรมที่รองรับ

- เรื่อง ผู้รับหลายคน ผู้ลงนาม และปลายทางภายในหลายหน่วยงานจากรายการจำลอง หรือภายนอกแบบข้อความ วันที่ปกติใช้วันที่ปัจจุบันของไทย เผยแพร่เป็น false เสมอ
- server ตรวจ session, Origin, input, grants และเวลาไทย ณ จุดจัดสรร ทั่วไปทุกวัน 07:00:00–22:30:59 รหัสหน่วยงาน 204 ได้ตลอดเวลา ไม่ห้ามวันหยุด
- ล็อกเจ้าของก่อนตรวจ PDF ค้างทั้งประวัติ แล้วล็อก counter ตามชุดเลข+ปี พ.ศ. หนังสือไม่ลับค้าง PDF บล็อกคำขอใหม่ทุกชุด หนังสือลับยกเว้น PDF
- เลข หนังสือ และ audit บันทึกใน transaction เดียว พร้อม unique constraints รายชุด/ปี/เลขหลัก/เลขย่อย และเจ้าของ/รหัสคำขอ
- คำขอเดิมที่สำเร็จแล้วคืนรายการเดิมหลังตรวจสิทธิ์ปัจจุบัน แม้มีไฟล์ค้างหรือเวลาปิด หากเปลี่ยนข้อมูลภายใต้รหัสเดิมปฏิเสธ ก่อน commit ล้มเหลวจะ rollback ทั้งชุด
- browser เก็บเพียง fingerprint และรหัสคำขอใน sessionStorage แยกตามเจ้าของ เพื่อ retry หลังการตอบกลับหาย ไม่เก็บเนื้อหาหนังสือ การใช้ HTTP ต้องเก็บ requestId เดิมไว้เอง
- แสดงเลขที่ได้ รายละเอียด และ 10 รายการล่าสุดเฉพาะเจ้าของ พร้อมสถานะรอ PDF การแนบ PDF จริงอยู่ใน T07 รุ่นนี้ทดสอบปลด gate ด้วย fixture เท่านั้น

## API

`GET /api/issuance` คืนชุดเลขที่มีสิทธิ์ หน่วยงานรับเรื่อง วันที่ไทย และรายการส่วนตัวล่าสุด `GET /api/issuance/{id}` คืนรายละเอียดและ audit เฉพาะเจ้าของ

`POST /api/issuance` รับ `requestId` UUID v4, `seriesId`, `subject`, `recipient` (หนึ่งคนต่อบรรทัด), `recipientDepartmentIds`, `externalOrganization`, `signer`, `confidential`, `documentDate` ต้องเลือกปลายทางภายในหรือภายนอกอย่างเดียว ไม่รับ owner/year/number/published จาก client คืน `{document,replayed}` สถานะ 201 เมื่อสร้าง และ 200 เมื่อ replay ทุก response ใช้ no-store

## ตรวจสอบและ schema

รัน `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run test:auth`, `npm.cmd run test:issuance`, `npm.cmd run test:e2e`, `npm.cmd run build`, `npm.cmd run test:production-auth`

Rule tests ใช้ MySQL แยกพอร์ต 3317 ส่วน HTTP/browser ใช้ MySQL 3315 และเว็บ 3106; T04 ใช้เว็บ 3104 แต่ละชุดใช้ Next output แยกจาก dev ที่เปิดอยู่ ห้ามรัน T05 หลายชุดพร้อมกัน ภาพ/log อยู่ใน `.local/` และ trace เมื่อผิดพลาดใน `test-results/`

Schema เพิ่มใหม่ที่ `tools/issuance/schema.sql` ใช้ InnoDB/utf8mb4 เก็บ timestamp UTC และวันธุรกิจไทย Runner ใช้เฉพาะฐานสังเคราะห์ใหม่ ไม่ใช่ migration สำหรับ production ก่อนเปิดจริงต้องตรวจ mapping/grants/หน่วยงานและยอด counter รายชุด+ปีกับ T12 และเชื่อมบัญชีคณะตาม T13 ห้ามกำหนด counter เปิดจริงจาก fixture หรือ snapshot โดยอัตโนมัติ

## ผลตรวจรับ 12 พฤศจิกายน 2026

lint/typecheck/build ผ่าน; provider 9/9; MySQL rules 7/7; HTTP/browser T05 9/9 และ regression โหลดรายการล้มเหลว 1/1; T04 regression 6/6; production isolation 3/3 รวมการปฏิเสธ API ออกเลขด้วยบัญชีปลอม QA อิสระรับรองรุ่น local ไม่มี Critical/High/Medium ค้าง ตรวจภาพมือถือ `.local/t05-mobile-issuance.png` แล้ว

แก้จากผลทดสอบจริง: owner/counter ใช้ exclusive upsert เพื่อเลี่ยง shared-lock upgrade deadlock; เรียกคืนรายการเดิมก่อน gate/time; คงผลสำเร็จหากโหลดรายการล่าสุดล้มเหลว; แก้ spinner nesting เพื่อไม่เกิด hydration error ฐานสังเคราะห์ลดขนาด redo/buffer และ cleanup data หลัง process หยุด ป้องกันสะสมจนพื้นที่เต็ม

ไฟล์งานหลัก: `lib/issuance/*`, `app/api/issuance/*`, `app/workspace/issuance-panel.tsx`, workspace/CSS, `tools/issuance/*`, local runner, `tests/issuance.spec.mjs`, การแยก output ของ T04/T05 ใน Next config/test harness, lint ignores สำหรับ artifact/skill, scripts/lockfile และเอกสารติดตาม
