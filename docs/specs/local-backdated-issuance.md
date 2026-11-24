# T10 — ขอเลขย้อนหลัง รุ่น local

พัฒนา 13 พฤศจิกายน 2026 (Asia/Bangkok) ต่อจาก T06/T07 ใช้บัญชีสังเคราะห์และ MySQL แยก ไม่เชื่อมบัญชีคณะหรือฐานใช้งานจริง

## การใช้งาน

ในหน้าขอเลข เลือกวิธี “ย้อนหลัง” กำหนดวันที่แล้วค้นหาต้นทาง เลือกหนังสือในชุดที่ตนมีสิทธิ์ใช้ กรอกรายละเอียดและยืนยัน ระบบออกเลขย่อยทันที ไม่ต้องอนุมัติ จากนั้นเปิดรายการเดิมเพื่อแนบ/ดาวน์โหลด PDF ตาม T07 ได้

ต้นทางต้องเป็นหนังสือใหม่ที่ออกแล้ว หรือประวัติ normalized ที่ตรวจรับ mapping แล้วและไม่ยกเลิก ผู้ขอต้องอ่านต้นทางได้ตาม T02 และมี grant ชุดเลขที่ยังใช้งานอยู่ กรองสิทธิ์ก่อนแบ่งหน้า 20 รายการ ไม่แสดง raw/disposition/reservation เป็นตัวเลือก ไม่เพิ่มสิทธิ์อ่านจากการใช้ชุดเลข

รองรับทุกปีที่มีต้นทางที่อ่านได้ ไม่จำกัดปีปัจจุบัน ไม่มีต้นทางวันที่เลือกจะไม่ออกเลข ไม่สร้างเลขว่างหรือเติมช่องว่าง ห้ามใช้ต้นทางอนาคต วันที่ปัจจุบันที่มีต้นทางอยู่แล้วใช้ได้ตามกฎไม่ใช้อนาคต

## API และข้อมูล

- `GET /api/backdated?date=YYYY-MM-DD&page=1` คืน `sources`, `hasMore`, `page`, `today` เฉพาะต้นทางที่ใช้ได้ ตรวจวันที่/หน้าฝั่ง server
- `POST /api/backdated` รับฟิลด์รายละเอียดเหมือนคำขอปกติ และ `source: {kind: "issuance", id}` หรือ `{kind: "legacy", snapshot, id}` เท่านั้น ไม่รับเลขหลัก เลขย่อย ปี prefix เจ้าของ หรือเวลาออกจาก client
- `seriesId` และ `documentDate` ต้องตรงกับต้นทางที่ server อ่านซ้ำใน transaction ต้นทางไม่มี/อ่านไม่ได้/ยกเลิก/ข้อมูลไม่ตรง คืน 404 แบบเดียวกัน ไม่มีสิทธิ์ใช้ชุดคืน 403
- คงชุด ปี วันที่ prefix และเลขหลักของต้นทาง เพิ่มเลขย่อยจำนวนเต็ม `.1`, `.2`, … `.10` ภายในชุด+ปี+เลขหลักเดียวกัน เลือกต้นทางที่มีเลขย่อยแล้วก็เพิ่มใน scope เลขหลักเดิม
- `issuedAt` เป็นเวลาออกจริง UTC แยกจาก `documentDate` แสดงเวลาตาม Asia/Bangkok รายละเอียดมี `issuanceKind`, `seriesId`, `mainNumber`, `subNumber` และแสดงวิธีออกเลข
- Audit `issued_backdated` บันทึก source reference, ชุด/ปี/เลขหลัก/ย่อย, วันที่ และรายละเอียดที่กรอก ใน transaction เดียวกับหนังสือ/ตัวนับ เจ้าของอ่าน audit ได้ตามเดิม

## การจัดสรรและกู้คืน

ใช้ lock order เดิม migration gate → owner → series แล้ว share-lock ต้นทางและ exclusive-lock แถว `issuance_subcounters` ของชุด+ปี+เลขหลัก ใช้ร่วมกับ owner mutex ของคำขอปกติ/PDF เพื่อให้กฎไฟล์ค้างทำงานข้ามเส้นทาง

ตัวนับเลขย่อยแยกจาก `issuance_counters` และไม่แก้ตัวนับเลขหลัก ก่อนเพิ่มใช้ค่าสูงสุดระหว่าง high-water mark, หนังสือใหม่ทั้งหมด, normalized history ทั้งหมดรวมยกเลิก และ legacy reservations ที่มี reviewed mapping รวมรายการที่ผู้ขอมองไม่เห็น `MAX` ทำหน้าที่เป็น floor ภายใต้ scope lock ไม่ใช่ allocator ลำพัง มี unique constraint เดิม `(series_id,number_year,main_number,sub_number)` ใน MySQL กำกับอีกชั้น ปฏิเสธเมื่อเลขย่อยเกิน unsigned INT

ตรวจวันเวลาขณะได้ lock จัดสรรแล้ว ตาม T01 ทุกวัน 07:00:00–22:30:59 ยกเว้นหน่วยงาน 204 ได้ตลอดเวลา ไม่เพิ่มวันหยุดหรือขั้นอนุมัติ

ใช้ `(owner_id,request_key)` เดียวกับคำขอปกติ hash รวม source reference ที่ normalize แล้ว คำขอเดิมคืนรายการเดิมหลังตรวจสิทธิ์ก่อน gate ไฟล์/เวลา คำขอเดิมแต่ข้อมูลหรือ source ต่างกันได้ 409 รวมการใช้ key ข้ามเส้นทาง Browser เก็บเฉพาะ key/fingerprint ใน sessionStorage เพื่อรองรับ response หายและ reload โดยไม่เก็บรายละเอียดหนังสือ หากล้มเหลวก่อน commit rollback หนังสือ/ตัวนับเลขย่อย/audit ทั้งชุด retry ที่รายการเดิม ไม่คืนเลขที่ออกสำเร็จแล้ว

ไม่ลับค้าง PDF บล็อกคำขอใหม่ทั้งปกติและย้อนหลัง รวมประวัติเดิมที่ยังค้าง ไม่ลับออกเลขก่อนแนบ PDF ได้ หนังสือลับยกเว้นไฟล์ แต่ไฟล์ที่แนบยังผ่าน validation/authorization ของ T07 แนบล้มเหลวไม่ย้อนเลข

## Schema และขอบเขตเปิดจริง

เพิ่มตาราง `issuance_subcounters` แบบ additive ใน `tools/issuance/schema.sql` และสิทธิ์ SELECT/INSERT/UPDATE ให้ app user ใน runner ฐานสังเคราะห์ใหม่ เมื่อใช้ `npm.cmd run dev:local` จะสร้างฐานใหม่พร้อม schema นี้ ไม่รัน base schema ซ้ำบนฐานที่มีข้อมูลอยู่ และไม่แก้หรือลบฐานเดิมโดยอัตโนมัติ

ฐานที่เก็บไว้จากรุ่นก่อนยังไม่มีตารางใหม่นี้ ต้องเตรียม additive migration ตาม schema และตรวจรับแยกก่อนใช้ ฐานจริงยังรอ T12 mapping/cutover/กระทบยอดตัวนับ และ T13 identity; ไม่มีการรัน migration/deploy จริง งานนี้ไม่เปิด PDF ประวัติเดิมที่ยังไม่ผ่าน inventory และไม่ทำการแก้ไข/ยกเลิกของ T09/T11

## ผลตรวจ

ตรวจรับ 13 พฤศจิกายน 2026:

- T10 `npm.cmd run test:e2e -- tests/backdated.spec.mjs`: 10/10 ผ่าน ทั้ง source ปีเก่า/prefix เดิม/เลือกเลขย่อยต้นทาง, พร้อมกัน 12 คำขอ `.1`–`.12`, เลขหลักถัดไปไม่เปลี่ยน, replay/เปลี่ยน source/ใช้ key ข้ามเส้นทาง, audit rollback, ไม่พบ/อนาคต/ปลอม tuple/ถอน grant, normalized legacy/ยกเลิก/hidden reservation floor, pagination และสิทธิ์ก่อน LIMIT, PDF จริงผ่าน T07, migration gate/overflow และมือถือ
- `npm.cmd run test:e2e` ทั้งชุด: 44/44 ผ่าน รวม T04/T05/T06/T07/T10/T12
- `npm.cmd run test:issuance`: 12/12 ผ่าน รวมขอบเวลา 07:00/22:30:59/22:31 รอ subcounter แล้วหมดเวลา วันเสาร์ หน่วยงาน 204 ปีเปลี่ยนตอนเที่ยงคืนไทย และ retry หลังเวลาปิด/ถอนสิทธิ์
- `npm.cmd run test:migration`: 23/23 ผ่าน รวม preservation gate/floor และข้อมูลคงเดิม
- `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run build`: ผ่าน; `npm.cmd run test:production-auth`: 3/3 ผ่าน
- QA แยกตรวจ implementation และผลทดสอบ ไม่พบ Critical/High/Medium ค้าง ภาพ `.local/t10-mobile-backdated.png` ผ่าน ไม่มี horizontal overflow

เกณฑ์ T10 ผ่าน 7/7 สำหรับ local; GitHub #11 ยัง OPEN เพราะบันทึกเฉพาะ workspace ไม่ได้อัปเดตภายนอก ไม่มี migration/deploy ฐานจริง
