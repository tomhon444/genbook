# T12 — ซ้อมย้ายข้อมูลเดิมและเงื่อนไข cutover

วันที่ 12 พฤศจิกายน 2026 (Asia/Bangkok) · [T12](../tickets/12-legacy-migration.md)

สถานะ: local staging และต้นแบบประวัติจากข้อมูลจำลองผ่าน QA; **ยังไม่ตรวจรับ mapping ของข้อมูลจริง ไม่เปิดออกเลขจริง**

อัปเดต 13 พฤศจิกายน 2026: ผู้ใช้ยืนยันนโยบายเมื่อไม่มี backup แล้ว เพิ่ม [การเก็บข้อมูลแยกและกันเลข](local-legacy-preservation.md) ในฐานซ้อมพร้อม migration gate และสิทธิ์ SQL ที่จำกัด ข้อมูลจริงยังไม่ promote เข้า history/counter ของแอป

## ขอบเขตที่อนุมัติและผลซ้อมไฟล์เดิม

ผู้ใช้ยืนยันในบทสนทนาให้ใช้ `C:/Users/dench/Desktop/GenBookno_DB.sql.gz` สำหรับซ้อมย้าย ใช้ SHA-256 `78629b14b7fcc8309aea012ae145fbae6dfde3a4d48a1b07fad9e0fb97411c82` ตรง snapshot ที่วิเคราะห์ T01 ไม่ถือเป็น export รอบสุดท้ายก่อนเปิดจริง

คำสั่งซ้อม:

```powershell
npm.cmd run migration:rehearse -- C:/Users/dench/Desktop/GenBookno_DB.sql.gz
```

เครื่องมืออ่าน gzip และ parse SQL literals โดยไม่ execute SQL จาก dump สร้าง MySQL ใหม่บน loopback พอร์ต 3319 ภายใต้ `.local/test-mysql/` นำข้อมูลเข้า `legacy_staging` ใน transaction ตรวจทุกแถว/ทุกฟิลด์เทียบต้นทาง และนำเข้าซ้ำเพื่อตรวจ idempotency ปิดและลบฐานข้อมูลเฉพาะ instance ที่สร้างหลังจบ เก็บรายงาน aggregate ที่ `.local/t12/rehearsal.json` ซึ่ง gitignore แล้ว ไม่มีเนื้อหาหนังสือหรือชื่อบุคคลใน repository

| ตาราง | แถวที่กระทบยอดผ่าน |
|---|---:|
| book | 78 |
| bookdept | 155 |
| genbook | 171,506 |
| genbook_inform | 173,381 |
| genbook_dept | 38,214 |
| typebook | 4 |
| รวม | 383,338 |

ผลผิดปกติด้านล่างเป็นกลุ่มที่อาจซ้อนกัน ไม่ใช่ยอดแถวที่ต้องลบ:

| รายการ | จำนวน |
|---|---:|
| กลุ่มเลขซ้ำ (ชุด normalize เป็นตัวเลข, ปี, เลขหลัก, เลขแทรก NULL=0) | 1,308 กลุ่ม / 1,324 แถวเกิน |
| สถานะยกเลิก | 1,369 |
| หนังสืออ้างชุดที่ไม่มี | 2 |
| secret/publish/status ไม่ตรงค่าที่รู้จัก | 4 |
| ผู้ขอหรือหน่วยงานขาด | 4 |
| datetime ขาดหรือปีศูนย์ | 6 |
| genbook_inform อ้างหนังสือที่ไม่มี | 35 |
| genbook_dept อ้างหนังสือที่ไม่มี | 4 |
| ชุด prefix/กติกาปีไม่ครบ | 00047 |

ไม่เปลี่ยนเลข ลบแถว เติมสิทธิ์ หรืออนุมาน timezone ให้ข้อมูลเหล่านี้ staging เก็บ raw columns/source ID เดิม รวมผู้กรอก เหตุผลยกเลิก เวลาเดิมและ child rows ไว้ครบตาม 6 ตารางนี้ ไม่อ้างว่าครอบคลุม 22 ตารางของ dump หรือไฟล์ PDF จริง

## Mapping ที่ต้องตรวจรับก่อนนำประวัติจริงเข้าแอป

ใช้ [ตารางตรวจรับ mapping และรายการผิดปกติ](t12-mapping-review.md) เพื่อกรอกผลพิจารณา มีตารางรายชุด/ผู้ขอ/หน่วยงาน/เลขซ้ำ/ปัญหา/ตัวนับจาก snapshot จริงเก็บเฉพาะใน `.local/` พร้อมช่องรับรองที่ยังไม่กรอก

| ต้นทาง | ปลายทาง / การตรวจ |
|---|---|
| gen_book_id | source_id แยก snapshot SHA; ห้ามใช้เลขหนังสือเป็น ID |
| bookdept | canonical series_id ผ่านตาราง mapping ที่ตรวจรับ; ต้องแยกชุดแม้หน่วยงาน/ประเภทเดียวกัน |
| gen_book_year, book_number, book_number_insert | number_year/main/sub; รักษาปีเดิม; NULL กับ 0 ของเลขแทรก normalize ได้เมื่อรับรอง mapping โดย raw ยังอยู่ใน staging |
| bookdept.book_number | prefix; เป็นคนละความหมายกับ genbook.book_number; ประวัติ prefix ที่เปลี่ยนต้องยืนยันเพิ่มเติม |
| user_request | owner_id จากบัญชีที่ตรวจรับ; user_login เป็นผู้กรอก ไม่ให้เป็นเจ้าของแทน |
| user_dept | หน่วยงานของเจ้าของ ณ วันออก ต้องมี reference mapping |
| secret, publish | confidential/published เป็น boolean ที่ยืนยันแล้ว; ไม่ default ค่าไม่รู้จักเป็นสาธารณะ |
| status_genbook, reason_cancel | เก็บสถานะยกเลิกในประวัติและเหตุผลต้นฉบับใน staging; ไม่ reuse เลข |
| date_request, user_datetime, lastupdate | วันที่หนังสือและเวลาเดิม; ยังไม่แปลง datetime เป็น UTC จนยืนยัน timezone ของระบบเก่า |
| genbook_inform, genbook_dept, endorser | ต้องตรวจ child relationships, รหัสผู้ลงนามและค่าปลายทางก่อนทำ promotion จริง; ต้นแบบหน้าอ่านแสดงเฉพาะ metadata ขั้นต่ำ |
| document_file/extension | ตรวจ inventory และไฟล์จริงแยก; ไม่ใช้ path เก่าเป็น URL หรือถือว่ามี PDF เพราะมีชื่อไฟล์ |
| สิทธิ์ชุดเดิม | ตรวจรับ grants แยก; สิทธิ์อ่านไม่เท่ากับสิทธิ์ออกเลข |

ต้องมีบัญชีข้อยกเว้นที่ระบุ disposition ทุกกลุ่มเลขซ้ำและ reference ขาด พร้อมผู้รับรอง ห้ามใช้การ renumber/dedupe อัตโนมัติเพื่อให้ผ่าน unique constraint

## ต้นแบบ normalized history (ข้อมูลจำลอง)

`tools/migration/import.mjs` รับ manifest ที่ผ่านการทบทวน มี sourceSha256, reviewedBy และ documents ตามตัวอย่างสังเคราะห์ `fixture.mjs` ตรวจชนิด/ขนาดข้อมูล วันที่ ความสัมพันธ์ prefix และชุดที่ปิดใช้งาน ใช้ transaction และตั้ง counter เป็นเลขหลักสูงสุดรวมเลขแทรกและรายการยกเลิกจาก manifest **ในชุดว่างเท่านั้น** dryRun เป็นค่าเริ่มต้นและ rollback ทั้งหมด ไม่มี CLI รับ production URL หรือคำสั่งเปิดชุดเลข

ต้นแบบ `importHistory` เดิมยังใช้ registry ของ manifest คนละความหมายกับ raw จึงใช้สำหรับ fixture ในฐานใหม่แยกกันเท่านั้น รอบต่อจาก T09 เพิ่ม [promotion ที่ผูก snapshot และ mapping](local-legacy-promotion.md) พร้อม registry `legacy_promotions` แยกแล้ว เส้นทางใหม่นี้ซ้อม preservation → promotion ใน instance เดียวกันได้เมื่อเอกสาร mapping/reference ตรวจรับครบ การซ้อม raw ที่สำเร็จยังไม่ใช่การรับรอง mapping และไม่ทำให้ข้อมูลจริงปรากฏในแอปเอง

`legacy_documents` แยกจาก `issuance_documents` เพื่อรักษาเลขซ้ำและสถานะเดิม มี unique เฉพาะ snapshot/source ID ส่วนเลขใหม่ยังมี MySQL unique business key ตาม T05 ตรวจ replay ทุกฟิลด์และ counter ไม่ต่ำกว่า maximum เดิม ไม่ rewind หลังออกเลขใหม่

`GET /api/history` ค้นเรื่อง เลข หรือ source ID และแบ่งหน้า 20 รายการ บังคับ T02 ก่อน LIMIT: เจ้าของอ่านของตัวเองได้ หน่วยงานปัจจุบันอ่านหนังสือไม่ลับของหน่วยงานเดิม และหนังสือไม่ลับที่เผยแพร่อ่านข้ามหน่วยงานได้ หนังสือลับแม้เผยแพร่จำกัดเจ้าของ การอ่านรายละเอียดที่ไม่มีสิทธิ์ตอบ 404 ไม่ส่ง raw staging เหตุผลยกเลิกหรือ file paths ให้ client

หนังสือเดิมสถานะปกติที่ไม่ลับและยังค้าง PDF จะ block การออกเลขใหม่ของเจ้าของ รายการยกเลิกไม่ block ยังไม่เปิดการแก้ flag/แนบ PDF ใน T12 ต้องจัดการไฟล์และคำขอค้างก่อนเปิดจริงร่วมกับ T07 ไม่ตั้ง pdfPending=false เพียงเพื่อให้เดินเลขได้

## แผน cutover และ rollback ที่เสนอให้ตรวจรับ

1. ผู้รับผิดชอบยืนยัน export ล่าสุด/hash, mapping เจ้าของ/หน่วยงาน/ชุด/ปี/prefix, timezone, รายการผิดปกติ, inventory PDF และคำขอค้าง ซ้อมเต็มในฐานข้อมูลแยกและเก็บรายงานยอดรายชุด/ปี ตัวอย่างข้อมูลที่เจ้าของ/ผู้อื่นอ่านได้และอ่านไม่ได้
2. กำหนดวันเวลา ผู้หยุดรับเลขเก่า ผู้สำรอง ผู้ตรวจยอด และผู้อนุมัติเปิดใหม่ T13 ต้องผ่านก่อนใช้บัญชีคณะจริง
3. หยุดออกเลข/แก้ไขระบบเก่า ระบายหรือจดคำขอค้าง สำรองฐานข้อมูลและไฟล์ ตรวจ restore ได้ แล้ว export รอบสุดท้าย เก็บ hash/เวลาตัดระบบและทำเก่าเป็นอ่านอย่างเดียว
4. ขออนุมัติ **production migration โดยชัดแจ้งเพิ่มเติม** หลังเห็น mapping รายงาน rehearsal และแผนนี้ ใช้เครื่องมือ production ที่ผ่าน review แยกต่างหาก (ยังไม่ implement ใน T12 รุ่น local)
5. นำเข้าใน maintenance mode กระทบยอดจำนวน/status/relationships/sample data รายชุด/ปี ตรวจเลขซ้ำเดิมตรงบัญชีข้อยกเว้น ไม่มีเลขซ้ำใหม่ counter รวมรายการยกเลิกและเลขแทรก ยืนยันเลขถัดไปของทุกชุดที่เปิดโดยผู้รับรอง
6. ถ้ายอดไม่ตรง ห้ามเปิดออกเลข rollback transaction หรือ restore backup ในช่วงที่ยังไม่รับเลขใหม่ ตรวจกลับก่อนยกเลิก maintenance mode
7. เปิดระบบใหม่เพียงระบบเดียวหลังลงชื่อรับรอง ระบบเก่ายังอ่านอย่างเดียว เฝ้าตรวจเลขแรก/คำขอซ้ำ/สิทธิ์/ไฟล์และเก็บ audit
8. ถ้าต้อง rollback หลังระบบใหม่ออกเลขแล้ว ให้หยุดรับทั้งสองระบบ เก็บ export เลขและ audit ที่ออกใหม่ กระทบยอดและ reserve เลขทั้งหมดก่อนเลือกเปิดระบบใด ห้าม restore แล้วเปิดเก่าทันทีจนเลขใหม่สูญหายหรือถูก reuse

ส่วนที่ยังต้องผู้ใช้ระบุ/รับรอง: วันตัดระบบและรายชื่อผู้รับผิดชอบ, export รอบสุดท้าย, mapping บัญชีจริง/ข้อมูลผิดปกติ/เวลาเดิม, PDF และคำขอค้าง, เลขถัดไปรายชุด/ปี ไม่มีการถือว่ารายงาน local นี้เป็นอนุมัติเปิดจริง

## หลักฐานทดสอบ

- `npm.cmd run test:migration`: 10/10 ผ่าน รวม SQL literals/unsupported INSERT, atomic failure, dry-run rollback, replay/tampering, เลขซ้ำ/ยกเลิก, สิทธิ์, 8 คำขอพร้อมกันเดินต่อจาก 70 และกฎ PDF
- `npx.cmd playwright test tests/migration.spec.mjs`: 3/3 ผ่าน HTTP permission matrix, concurrent issuance 4 คำขอ, browser ค้นเลขซ้ำ/เปิดสถานะยกเลิก และ mobile ไม่มี horizontal overflow
- ตรวจภาพ desktop/mobile ที่ `.local/t12/history-desktop.png` และ `history-mobile.png` แล้ว
- QA อิสระตรวจพบและแก้ 2 จุด: parser เคยข้าม INSERT IGNORE และ normalized replay เคยเทียบเฉพาะยอด ปัจจุบันสแกน statement นอก strings/comments และเทียบฟิลด์/counter ครบ QA rerun migration 10/10 ผ่าน ไม่พบ finding ระดับ critical/high/medium ค้างในขอบเขต local
- lint/typecheck/build ผ่าน; MySQL issuance regression 7/7, identity provider 9/9, E2E รวม T04/T05/T06/T12 23/23 และ production isolation 3/3 ผ่าน

ไม่ใช้ผล synthetic HTTP/UI เป็นหลักฐานว่าข้อมูลจริงผ่านสิทธิ์หรือเดินเลขเปิดจริงแล้ว เกณฑ์ T12 ข้อ 2–4 ยังรอ mapping และ rehearsal ฉบับตรวจรับครบ
