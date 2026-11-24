# T12 — ตรวจหลักฐานข้อยกเว้นชื่อและประเภท

24 พฤศจิกายน 2569 (Asia/Bangkok) · [รายการตรวจรับ](t12-decision-review.md)

ตรวจแบบ offline จาก snapshot `d5f97eb2131c0ba0d7eaee8659f9c9e02f87bf092092385c6dbd4b5181e2d6bb` กับชุดตรวจรับ `.local/t12/decision-review-d5f97eb2-ab47693c/` สร้างผลใหม่ `.local/t12/reference-investigation-d5f97eb2-95b5a4a1/` ไม่เขียนทับต้นทางหรือคำรับรองเดิม

## ผลและข้อเสนอ

ผู้ใช้ตอบ **“รับรองชื่อแสดงผลตามข้อเสนอ”** เมื่อ 24 พฤศจิกายน 2569 สำหรับชุด `00069` เฉพาะ displayName `อว 6801.1001(2)` บันทึก receipt `.local/t12/display-name-approval-d5f97eb2-64b05401/approval.json` ผูก hash manifest/findings ของชุดตรวจนี้ และตรวจ UTF-8/hash หลังเขียนแล้ว ไม่ระบุชื่อผู้รับรองแทนผู้ใช้ที่ยังไม่ได้แจ้งชื่อ ไม่เปลี่ยน prefix `อว 6801.1001(2)\t` สถานะชุด ประเภท หรือฐานข้อมูล ชุดตรวจตั้งต้นยังคง pending ตามเดิมเพื่อรักษาหลักฐาน คำรับรองล่าสุดอยู่ใน receipt แยก

| รายการ | ข้อเท็จจริง | ข้อเสนอที่ยังรอรับรอง |
|---|---|---|
| ชื่อผิดปกติ 1 ชุด | prefix มี TAB U+0009 ต่อท้ายเพียงตัวเดียว parent มีสถานะ 0 และพบประเภทจริงผ่าน parent | ตัด TAB เฉพาะชื่อแสดงผล คง prefix/provenance/สถานะชุดเดิม ไม่เปิดใช้ชุดเลข |
| ประเภทขาด 24 ชุด | อ้างถึง book.idbook ที่ไม่มีใน snapshot รวม 21 รหัส | ขอหลักฐาน parent→type ที่ตรวจที่มาได้ หรือเสนอพักรอหลักฐาน ไม่เดาจาก prefix |

ชุดชื่อผิดปกติมีประวัติต้นทาง 127 รายการ ชุดขาดประเภทมีประวัติรวม 331 รายการ รวม 458 รายการ ตัวเลขนับ raw snapshot ทั้งหมด ไม่ใช่ยอด normalized history หรือการรับรองสิทธิ์ และจำนวนศูนย์ไม่ใช่เหตุอนุมัติลบชุดเลข

## หลักฐานโค้ดเดิม

ตรวจแบบอ่านอย่างเดียวที่ `C:/laragon/www/book-number`:

- `application/models/genbook/bookdept_model.php:115–118`: join จาก bookdept.book_idbook → book.idbook → book.typebook_idtypebook → typebook.idtypebook
- `application/controllers/genbook.php:767–775`: ใช้ผล lookup ดังกล่าวเพื่ออ่าน typesecret
- `bookdept_model.php:176–196`: เส้นทางแก้ชุดเลขไม่มีช่องประเภททางเลือกที่ใช้กู้ relation ได้
- `application/models/genbook/book_model.php:187–197`: พบเส้นทางลบ parent โดยไม่มี child check ที่เห็นในฟังก์ชันนี้ แต่ไม่ใช่ข้อพิสูจน์ว่ารหัสที่หายถูกลบด้วยเส้นทางนี้

ชื่อย่อ ชุดที่คล้ายกัน prefix และระดับความลับของหนังสือไม่ยืนยัน relation ที่หายไป การที่โค้ดเดิมคืน secret ว่างเมื่อ join ไม่พบไม่ใช่หลักฐานประเภท

## ไฟล์ส่วนตัวสำหรับตรวจรับ

- `REVIEW.md`: ชื่อเดิมแบบ JSON escaped ข้อเสนอ display-only ประวัติแยกปี และรายการ parent ที่ต้องขอหลักฐาน
- `findings.json`: source fields ที่จำเป็น control code point สถานะ parent/type ที่พบ จำนวนประวัติ และคำตัดสิน pending/review null
- `summary.json`, `manifest.json`: ยอดรวม hash ผลลัพธ์ 3 ไฟล์ hash snapshot และ hash manifest ของชุดตรวจรับเดิม

ขอหลักฐาน book.idbook, book.typebook_idtypebook และ typebook.idtypebook/typebook ของ 21 parent ที่ขาด พร้อมแหล่งที่มา วัน และผู้รับรอง หรือให้เจ้าของระบบตัดสินใจโดยระบุเหตุผล/หลักฐานจริง ชื่อและประเภทต้องรับรองแยก field ไม่มี DB apply หรือเพิ่มสิทธิ์จากเครื่องมือนี้

## ทำซ้ำและตรวจสอบ

```powershell
npm.cmd run migration:review:investigate -- .local/legacy-import/native-d5f97eb2131c/source.sql.gz .local/t12/decision-review-d5f97eb2-ab47693c
node --test tools/migration/reference-investigation.test.mjs tools/migration/decision-review.test.mjs tools/migration/reference-names.test.mjs tools/migration/ac2-review.test.mjs
```

เครื่องมือ parse SQL literals โดยไม่ execute SQL ตรวจ source/hash ทั้ง 4 ไฟล์ของชุดตรวจรับก่อนสร้างผลแบบ exclusive ตรวจ pending state และไม่เชื่อมฐาน/เครือข่าย ไม่มีข้อมูลบุคลากรหรือเรื่องหนังสือในผลตรวจ

เทสต์ 20/20, lint และ typecheck ผ่าน QA ตรวจอิสระไม่พบ blocker ในขอบเขต offline และตรวจ hash ชุดจริง 3/3 ตรง คำรับรองชื่อแสดงผล 1 รายการบันทึกหลัง QA ตามคำตอบจริง ส่วนประเภท 24 รายการยัง pending; T12 คง 5/6 และ T13/สิทธิ์จริง/ชื่อหน่วยงาน/ไฟล์/ข้อมูลรอบสุดท้ายยังต้องตรวจรับ ไม่ได้อัปเดต GitHub
