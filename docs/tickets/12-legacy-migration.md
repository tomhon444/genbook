# T12 — นำข้อมูลเดิมเข้าและตรวจความต่อเนื่อง

[กลับหน้าภาพรวม](./README.md) · [GitHub #13](https://github.com/tomhon444/genbook/issues/13)

24 พฤศจิกายน 2569: ตรวจ [ข้อยกเว้นชื่อ/ประเภท 25 ชุด](../specs/t12-reference-investigation.md) จาก snapshot เดิมแล้ว ผู้ใช้รับรองชื่อ display-only ชุด 00069 และบันทึก receipt แยก ส่วนประเภท 24 ชุดยังรอหลักฐาน parent ที่ขาด 21 รหัส ไม่มี DB writes/grants/prefix changes; T12 คง 5/6

## การติดตามงาน

| รายการ | ค่า |
|---|---|
| สถานะงาน | กำลังทำ — AC4 ข้อมูลจริงผ่าน HTTP/หน้าเว็บ/เลขต่อพร้อมกันแล้ว; รอ AC2 และ cutover |
| เสร็จแล้ว | ยังไม่เสร็จ |
| GitHub | OPEN |
| ความยาก | 9/10 |
| ต้องทำก่อน | [T05](./Done-05-normal-issuance.md) |
| เกณฑ์รับงานที่ติ๊กแล้ว | 5/6 — ข้อ 1, 3, 4, 5, 6; ยังไม่ผ่านข้อ 2 |
| ผู้รับผิดชอบ | tomhon444 / Codex |
| ตรวจหลักฐาน local ล่าสุด | 24 พฤศจิกายน 2026 (Asia/Bangkok); ไม่ได้อัปเดต GitHub รอบนี้ |

**เหตุผลคะแนน:** ข้อมูลเดิมยังไม่ทราบคุณภาพ ต้อง mapping กระทบยอด rollback และตรวจเลขต่อเนื่อง

**เงื่อนไขเพิ่มเติม:** ผู้ใช้ยืนยันแนวทางย้ายข้อมูลใน T01 และให้ใช้ไฟล์เดิมซ้อมย้ายเมื่อ 12 พฤศจิกายน 2026 แล้ว T05 local ผ่าน QA; ต้องตรวจรับ mapping และแผน cutover/กระทบยอดก่อนเปิดใช้ การนำเข้า production ต้องได้รับอนุมัติเพิ่ม

## Parent

https://github.com/tomhon444/genbook/issues/1

## What to build

แนวทางล่าสุด 16 พฤศจิกายน 2026: ย้ายข้อมูลจาก GenBookno_DB เข้าฐานใหม่ แล้วเลิกพึ่งระบบ/ฐานเก่าในงานประจำหลัง cutover ระบบใหม่ยังใช้ CENTRAL ตรวจบัญชีโดยตรง ไม่ต้อง dump CENTRAL เป็นเงื่อนไขก่อนทำ T12 แต่ยังต้องตรวจ mapping จากรหัสที่พิสูจน์ได้ คำว่ายกเลิกใช้งานไม่ใช่คำสั่งลบฐานเดิม ดู [ADR 0003](../adr/0003-live-central-and-genbook-cutover.md)

บุคลากรค้นประวัติที่ย้ายมาและระบบออกเลขต่อจากข้อมูลเดิมได้ โดยกระทบยอดและทดลองในสภาพแวดล้อมแยกก่อน แนวทางที่ยืนยันคือคงเลข/source ID เดิม ซ้อมย้าย หยุดรับเลขระบบเก่า สำรอง/ดึงข้อมูลรอบสุดท้าย ตรวจยอดรายชุด/ปีและรับรองตัวนับ เปิดใหม่เพียงระบบเดียวโดยเก่าคงอ่านอย่างเดียว ไม่เปลี่ยนเลขประวัติอัตโนมัติหรือเปิดใช้เมื่อยอดไม่ตรง

## Acceptance criteria

- [x] ตรวจผลจากงานกติกา; หากเริ่มใหม่โดยไม่ย้าย ให้บันทึกผลและไม่ทำ migration โดยไม่จำเป็น
- [ ] หากย้าย: ยืนยันแหล่งข้อมูล mapping สิทธิ์ เลข/ชุด/รอบ และรายการผิดปกติก่อนนำเข้า
- [x] ทดลอง dry-run กระทบยอดจำนวนรายการ เลขไม่ซ้ำ ความสัมพันธ์ และตัวอย่างข้อมูล พร้อมแผน rollback
- [x] พิสูจน์ผ่านหน้าอ่านประวัติขั้นต่ำและ HTTP ว่าข้อมูลนำเข้าเข้าถึงตามสิทธิ์และออกเลขต่อไม่ชน
- [x] ไม่เปิดออกเลขจริงก่อน cutover ที่อนุมัติ; การนำเข้า production ต้องได้รับอนุมัติโดยชัดแจ้งอีกครั้ง
- [x] ทดสอบการทำซ้ำ/ความล้มเหลวของการนำเข้าในฐานข้อมูลแยก และรายงาน lint/typecheck/เทสต์/QA ตามส่วนที่เปลี่ยน

## บันทึกความคืบหน้า

- 24 พฤศจิกายน 2569: ใช้ชื่อจากแหล่งเดียวกับระบบเก่าตามคำสั่งผู้ใช้ สร้าง `.local/t12/reference-names-d5f97eb2-ded2a4ae/` โดยตรวจ hash ชุด AC2 เดิมและไม่เขียนทับ ชุดเลขใช้ `bookdept.book_number` ตามตัวเลือกเดิม เติมชื่อผ่าน 153/154, ประเภทผูกชุดผ่าน 130/154, ชื่อประเภท 4/4 แยกชุด 00069 ที่มีอักขระควบคุมและ 24 ชุดขาด parent reference การอ่านชื่อหน่วยงาน 44 รหัสผ่าน TLS หยุดที่ `HANDSHAKE_NO_SSL_SUPPORT` ก่อน query ไม่ใช้ plaintext/ไม่ถือว่ารหัสหาย จึงยังค้างชื่อหน่วยงาน เทสต์ 18/18, lint/typecheck และ QA ผ่าน ไม่มี DB/grant changes T12 คง 5/6 ดู [ผลเติมชื่อและช่องทางที่ยังขาด](../specs/t12-reference-names.md)

- 23 พฤศจิกายน 2569 (ต่อจาก AC4): เตรียมชุดตรวจรับ AC2 แบบ offline ผูก snapshot/mapping/targets/evidence เดิม ตรวจ native grant ตรงต้นทางครบ 1,844 แถว ทุก grant ยัง pending/disabled และชื่อจริงยังว่าง (154 ชุด/44 หน่วยงาน/4 ประเภท) ผู้ใช้รับรองเฉพาะแนวทางแสดงข้อความเวลาเดิมพร้อมระบุยังไม่ยืนยันเขตเวลาและคงค่าที่หายเป็นไม่ทราบ; บันทึก receipt UTF-8 ผูก hash แล้ว ไม่รับรอง timezone จริง Inventory ปัจจุบันครบ 172,131 รายการ: pending reference 168,892/missing 3,237/invalid 2; ทดลองดาวน์โหลด 3 ไฟล์ผ่าน HTTPS และตรวจ hash/PDF parse ผ่าน ไม่รับรองความครบถ้วนหรือเปลี่ยน PDF-pending 166,269 รายการใน history เทสต์ใหม่ 5/5, regression 27/27, lint/typecheck และ QA ผ่าน ชุดข้อมูลส่วนตัวอยู่ `.local/t12/ac2-d5f97eb2-7e321dd9/` T12 คง 5/6 รอชื่อ/สิทธิ์/ไฟล์/ข้อมูลรอบสุดท้าย ไม่เปิดใช้งานจริง ดู [ชุดตรวจรับ AC2](../specs/t12-ac2-review.md)

- 23 พฤศจิกายน 2569: AC4 ผ่านจาก snapshot/mapping ที่รับรองเดิมใน MySQL ใหม่ 3333 และเว็บ loopback 3115 ประวัติจริง 170,257/เก็บแยก 1,874 ตรวจ HTTP สิทธิ์ 9 กรณีและยอดค้นหา หน้าอ่าน desktop/mobile ปฏิเสธหนังสือลับสำหรับผู้อื่น พื้นตัวนับปี 2569 ของชุดที่เลือก 180; คำขอพร้อมกัน 6 รายการได้ 181–186 และคำขอเดียวกันพร้อมกัน 4 ครั้งสร้างเลข 187 ครั้งเดียว รวม 7 documents/7 audit/+7counter ไม่ชน reservation คืน gate blocked/grants 0/series disabled ปิดพอร์ตและลบ datadir ครบ Regression migration 43/43, process shutdown 2/2, issuance 12/12 และ lint/typecheck ผ่าน QA อิสระไม่เหลือ blocker จึงเป็น 5/6 เหลือ AC2 ตัวตน/grants รอบนี้เป็น fixture ไม่รับรอง CENTRAL login/สิทธิ์จริง/production ดู [หลักฐาน AC4 และข้อจำกัด](../specs/t12-http-rehearsal.md)

- 20 พฤศจิกายน 2569 หลังผู้ใช้ตอบ “ยืนยัน”: บันทึกคำรับรองที่ผูก hash ข้อเสนอ/source/evidence แล้วซ้อม preservation → promotion dry-run/rollback → commit/replay ในฐานใหม่พอร์ต 3332 สำเร็จ Raw 384,725 แถว, ประวัติ 170,257/เก็บแยก 1,874, reservations 172,131, counter floors 490 และ namespace พัก 2 scope ตรวจทุกฟิลด์/เลขเดิม/รายละเอียด ไม่มี grants active, gate blocked ปิดฐาน/ลบ datadir ที่สร้างเอง/พอร์ตปิดตรวจผ่าน Issuance regression 12/12 และ lint/typecheck ผ่าน QA รับรอง AC3 แยกจาก AC2/4 จึงเป็น 4/6 ไม่เปิดใช้งานจริง ดู [รายงานและข้อค้าง](../specs/t12-confirmed-mapping-rehearsal.md)

- 20 พฤศจิกายน 2569: เตรียมข้อเสนอ mapping จาก snapshot `d5f97eb2…` และหลักฐาน CENTRAL เดิม: เจ้าของ 318 map/3 hold, หน่วยงาน 44 map/1 hold, ชุดเลข 154 map/3 hold และเสนอพักเรื่องว่าง 1,860 รายการ ประเมินเบื้องต้น 170,257 candidate/1,874 held และพื้นตัวนับสำหรับตรวจ 490 scope โดยยังคง reservation ครบ 492 scope ทุก review เป็น null/policies pending, validator ยัง history/counter 0 และไม่พร้อม promote ไม่มีการเขียนฐาน/เพิ่มสิทธิ์/เปิด gate คง 3/6 รอคำรับรองข้อเสนอ ดู [รายละเอียดและไฟล์ตรวจรับ](../specs/t12-mapping-proposal-review.md)

- 19 พฤศจิกายน 2026: เริ่มตรวจ mapping กับ snapshot ที่เว็บใช้จริง SHA `d5f97eb2…` จำนวน 172,131 หนังสือ สร้าง workbench ใหม่และอ่าน CENTRAL ผ่าน connector/SQL guard เดิม พบเจ้าของ exact match active 224 รหัส/135,391 หนังสือ, ไม่ active 94 รหัส/36,731 หนังสือ, ไม่พบ 3 รหัส/5 หนังสือ และไม่มีเจ้าของ 4 หนังสือ ตรวจสถานะหน่วยงานและสิทธิ์ต้นทางเป็นหลักฐานแยก ไม่เพิ่ม grants/รับรอง mapping/เปลี่ยนข้อมูลหรือเปิด gate คง 3/6 ดู [ผลตรวจและขั้นตรวจรับ](../specs/t12-central-mapping-evidence.md) ตาราง CENTRAL เป็น MyISAM จึงยังต้องตรวจซ้ำก่อน cutover

- 11 พฤศจิกายน 2026: สร้างไฟล์ติดตามจาก GitHub; ยังไม่มีหลักฐานปิดงานหรือเกณฑ์รับงานที่ผ่าน
- ผลตรวจ/หลักฐานล่าสุด: [source-bound mapping และ promotion rehearsal](../specs/local-legacy-promotion.md), [แผน rollback/cutover](../specs/local-legacy-migration.md)
- อุปสรรคปัจจุบัน: ยังไม่ทราบว่ารหัสบัญชีคณะตรงรหัสเดิมหรือไม่ (ผู้ใช้ตอบในรอบต่อจาก T09); mapping/reference และวิธีรักษา/แสดงเรื่องว่าง 1,845 รายการยังไม่ตรวจรับ รวมเงื่อนไขไฟล์/เวลา/cutover เดิม ไม่ promote ประวัติจริงเข้าแอปหรือ seed counter จริง
- 12 พฤศจิกายน 2026: ผู้ใช้ตอบ “เอาตามนั้น” ใน T01 ยืนยันเลือกย้ายประวัติและเดินเลขต่อ แนวทางธุรกิจยืนยันแล้ว แต่ยังไม่ได้ดำเนิน T12 หรือทดสอบ migration จึงคง 0/6
- ก่อนเปิดจริงต้องยืนยันแหล่งข้อมูล/ไฟล์ล่าสุด mapping กลุ่มเลขผิดปกติ วันตัดระบบ ผู้รับรองยอด คำขอค้าง แผน rollback และเลขที่จะออกต่อรายชุด/ปี ห้ามกลับไปเปิดออกเลขระบบเก่าหลังระบบใหม่ออกเลขแล้วโดยไม่กระทบยอดเลขใหม่
- 12 พฤศจิกายน 2026: เริ่มตามคำขอผู้ใช้และใช้ snapshot เดิมซ้อม staging 6 ตาราง รวม 383,338 แถว ตรวจทุกฟิลด์และ replay ผ่าน; หนังสือ 171,506 รายการ เลขซ้ำ 1,308 กลุ่ม ไม่แก้เลขอัตโนมัติ เก็บ source ID/raw fields และ child rows ใน staging ที่แอปอ่านไม่ได้
- ทำ normalized history ด้วยข้อมูลจำลองแยกฐานข้อมูล: หน้า workspace ค้น/อ่านตาม T02, counter รวมรายการยกเลิก/เลขแทรก, unique constraint ของเลขใหม่ยังอยู่ และ pending PDF เดิม block เจ้าของตามกติกา; actual mapping/promotion ยังไม่ implement จึงไม่ติ๊กข้อ 2–4
- migration 10/10, HTTP/browser 3/3 และ QA อิสระ local ผ่าน รายละเอียดและข้อจำกัดในรายงาน ไม่มี production migration/deployment
- lint/typecheck/build ผ่าน; MySQL issuance regression 7/7, provider 9/9, E2E รวม T04/T05/T06/T12 23/23 และ production isolation 3/3 ผ่าน
- ผู้ใช้อนุญาตให้อัปเดตรายงานนี้ไปยัง GitHub #13 โดยชัดแจ้งในบทสนทนา หลังระบบอนุมัติอัตโนมัติขอคำยืนยันเรื่องเผยแพร่รายละเอียด migration
- 13 พฤศจิกายน 2026: จัดทำ [ตารางตรวจรับ mapping](../specs/t12-mapping-review.md) และชุดตารางข้อมูลจริงใน `.local/t12/review-78629b14-1bfc23be/`: ชุดเลข 155 แถว กลุ่มผู้ขอ 322 กลุ่ม กลุ่มหน่วยงาน 46 กลุ่ม เลขซ้ำ 1,308 กลุ่ม ปัญหา 55 รายการ และตัวนับ 492 ชุด/ปี ช่องรับรองยังว่าง ไม่อนุมานบัญชี/สิทธิ์/เวลาและไม่ seed counter คงเกณฑ์ 3/6
- 13 พฤศจิกายน 2026: [ตรวจเจาะ A02–A07 ครบ 55 ปัญหา](../specs/t12-anomaly-investigation.md) จาก snapshot และ source อย่างเดียว ครอบคลุมหนังสือหลัก 8 แถว/child 39 แถว และ parent ที่หาย 34 รหัส เติมข้อเสนอพร้อมหลักฐานในตารางเฉพาะเครื่องแล้ว แต่ยังไม่กู้ค่า/ความสัมพันธ์หรืออนุมัติ mapping คงเกณฑ์ 3/6
- ผลตรวจรอบ investigation: lint/typecheck และ migration 11/11 ผ่าน; QA อิสระตรวจครบ 55 keys/source references และยืนยันผู้รับรองยังว่าง ยังไม่แก้พฤติกรรมแอป/DB หรือเผยแพร่รายงานรายละเอียดชุดนี้ไป GitHub
- 13 พฤศจิกายน 2026: ผู้ใช้ยืนยันว่าไม่มี backup/export เก่าหรือทะเบียนเพิ่มเติม บันทึกข้อเสนอเก็บข้อมูลที่กู้ไม่ได้แยกโดยไม่สร้างค่าทดแทน และกันเลขจากหนังสือหลักเดิมไว้ รอรับรอง disposition ยังไม่ข้าม validation ของ normalized importer
- 13 พฤศจิกายน 2026: [วิเคราะห์เลขซ้ำครบ 1,308 กลุ่ม/2,632 แถว](../specs/t12-duplicate-investigation.md) พบ C1 32 กลุ่ม/74 แถว และ C3 1,276 กลุ่ม/2,558 แถว (C2 ไม่พบ) เติมข้อเสนอในตารางเฉพาะเครื่องครบ ไม่ลบ/รวมประวัติ ไม่เปลี่ยนสิทธิ์หรือสถานะ คงเกณฑ์ 3/6
- ผลตรวจรอบ duplicates: lint/typecheck, migration 14/14 และ QA อิสระผ่าน; recompute actual snapshot หลังเพิ่ม schema validation ได้ผลเท่าเดิมทุกฟิลด์ ช่องรับรองยังว่าง รอ business disposition เมื่อไม่มี backup และ mapping เจ้าของ/หน่วยงาน/ชุด/สิทธิ์ครบก่อนข้อมูลจริงเข้าแอป
- 13 พฤศจิกายน 2026: ผู้ใช้ตอบ “ยืนยัน” รับรองการเก็บต้นฉบับครบ แยกข้อมูลที่ระบุตัวตน/ชุดไม่ได้ รักษาเวลาไม่ทราบ และกันเลขเดิม บันทึก [ADR 0001](../adr/0001-preserve-unresolved-legacy-history.md) คำยืนยันนี้ไม่ครอบคลุม mapping บัญชี/หน่วยงาน/สิทธิ์/ชุดหรือ production cutover
- เพิ่ม [preservation/reservations](../specs/local-legacy-preservation.md) และซ้อม snapshot จริง: raw 383,338 แถว, reservation 171,506 source IDs, disposition 47 แถว/55 เหตุผล (restricted 45/unknown_time 2) ตรวจทุกฟิลด์และ replay ผ่าน; gate blocked, actual history 0, counter จริงไม่ seed คงเกณฑ์ 3/6
- ผลตรวจ preservation: migration 23/23, E2E รวม 26/26, issuance regression 7/7, provider 9/9, lint/typecheck/build และ production isolation 3/3 ผ่าน QA อิสระ preservation 9/9 และ actual snapshot verification ผ่าน ไม่เหลือข้อขวางในส่วน local นี้ ยังรอ mapping/normalized promotion/การตรวจรับข้อมูลจริงและ cutover

- 13 พฤศจิกายน 2026 (ต่อจาก T09): เพิ่ม source-bound mapping/readiness validator, แบบ JSON ที่ไม่เดา targets/approvals และ promotion จาก preservation ในฐานเดียวกัน ใช้ registry `legacy_promotions` แยกจาก digest raw ตรวจ source/raw/reservation/history ทุกฟิลด์และ replay ภายใต้ closed gate; history/counters/links/registry atomic, dry-run rollback เป็นค่าเริ่มต้น ไม่เพิ่มสิทธิ์หรือเปิด gate
- ซ้อมเส้นทางครบด้วยข้อมูลจำลอง ทั้ง CLI และ HTTP/browser: ข้อมูลลับ/เก็บแยกไม่รั่ว เลขซ้ำแยก source ID ตัวนับรวมแถว restricted/ยกเลิก และ PDF ที่ไม่ตรวจจริงยังค้างตามกฎ ไม่ใช้ผลจำลองเป็นหลักฐานรับรองข้อมูลจริง
- อ่าน snapshot จริงซ้ำแบบไม่เชื่อม DB: แบบล่าสุด `.local/t12/mapping-78629b14-c361d059/` มี raw 383,338 แถวและหนังสือ 171,506 รายการ; 6 restricted + 1,845 เรื่องว่าง + 169,655 รอ mapping = ครบ 171,506 ประวัติจริงเข้าแอป 0 คงเลข reservation เดิมทั้งหมด
- ชุดร่างมี 157 namespace ชุด (รวม 2 reference หาย), 321 รหัสผู้ขอไม่ว่าง และ 45 รหัสหน่วยงานไม่ว่าง ไม่ใช่จำนวนบัญชีที่รับรองแล้ว มีข้อค้าง review/mapping 529 และเรื่องว่าง 1,845 รวม 2,374 คง approvals ว่างและไม่ทับตาราง Markdown เดิม
- ผู้ใช้เลือกคำตอบ “ยังไม่ทราบ ต้องตรวจช่องทางบัญชีคณะก่อน” จึงผูกการรับรองรหัสจริงกับ T13 ไม่สมมติว่ารหัสเดิมใช้เป็น staffId/departmentId ได้ ไม่เพิ่ม AC2–4 หรือปิด T12
- ผลตรวจล่าสุด: migration 38/38, HTTP/browser migration+preservation/promotion 7/7, MySQL issuance rules 12/12, production isolation 3/3, lint/typecheck/build ผ่าน QA อิสระไม่เหลือ finding ในขอบเขต local; ตรวจข้อเรื่องว่างโดยไม่แต่งข้อความ/เปลี่ยน source แล้ว เกณฑ์ยัง 3/6
- เพิ่ม schema registry เฉพาะฐานสังเคราะห์ใหม่ ให้ restart dev:local หากต้องการ schema รุ่นนี้ ไม่มี ALTER ฐานเดิม/production migration และไม่ได้เผยแพร่รายละเอียดรอบนี้ไป GitHub

- 16 พฤศจิกายน 2026: ผู้ใช้ให้แหล่งฐานหนังสือ/บัญชีจริงและอนุญาตอ่านฐานเดิมเท่านั้นเพื่อนำเข้าใหม่ แต่ต้นทางไม่รองรับ TLS และ automatic approval review ปฏิเสธการเชื่อมไม่เข้ารหัส จึงยังไม่อ่าน snapshot หรือ import จริง คง 3/6; ต้องเตรียมฐานปลายทางที่คงข้อมูลแยกจาก synthetic runner ดู [ผลตรวจ](../specs/remote-readonly-discovery.md)

- 16 พฤศจิกายน 2026 (ต่อจากคำสั่งทำ T12 แบบ offline): เพิ่มฐาน local ถาวรแยกจาก `dev:local` และคำสั่ง import/verify/recover จากไฟล์สำรองในเครื่อง นำเข้า SHA `78629b14...` สำเร็จจริงที่ `.local/t12-persistent/legacy-78629b14/`: raw 383,338 แถว, reservations 171,506 source IDs, 492 scope, dispositions 47 แถว/55 เหตุผล ตรวจทุกฟิลด์/dry-run/replay และ shutdown/reopen ผ่าน QA อิสระตรวจ artifacts แล้ว ไม่เชื่อม/แก้ฐานเดิม ไม่มีการเพิ่ม grants/seed counter/เปิด gate หรือ import PASSWORD
- ผลตรวจรอบฐานถาวร: migration เดิม 38/38 และ persistent local 3/3 รวมจำลอง failure/กู้คืนอีกฐาน/ตรวจ source ที่ถูกแทนผ่าน lint/typecheck ผ่าน QA ไม่เหลือ C/H/M ในขอบเขตนี้ ประวัติจริงเข้าแอป 0 คง 3/6 เพราะ mapping/สิทธิ์/เรื่องว่าง/ไฟล์/เวลา/ข้อมูลล่าสุด/cutover ยังไม่ครบ ดู [หลักฐานและวิธีเปิดตรวจ/กู้คืน](../specs/local-legacy-persistent.md) ไม่ได้อัปเดต GitHub

- 16 พฤศจิกายน 2026 (ต่อ mapping/history): เพิ่มคิวผลกระทบจาก snapshot จริงครบ 171,506 รายการ: เก็บแยก 6, เรื่องว่าง 1,845, รอ mapping 169,655, ผ่านรายแถว 0 พร้อมเก็บคำรับรองเดิมและไม่พิมพ์รหัสบุคคลใน console เพิ่ม metadata ประวัติผู้รับ/ปลายทาง/ผู้ลงนาม/actor/ข้อความเวลาเดิมผ่าน sidecar ที่ promote/verify atomically และหน้าอ่านอย่างเดียว ทดสอบโดยใช้ข้อมูลจำลอง ไม่ ALTER/promotion ฐานจริง ไม่เชื่อม CENTRAL เกณฑ์ยัง 3/6 ดู [หลักฐาน](../specs/local-legacy-mapping-history.md)
