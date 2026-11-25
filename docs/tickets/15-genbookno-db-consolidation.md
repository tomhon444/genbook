# T15 — ใช้ genbookno_db (โครงสร้างระบบเดิม) เป็นฐานเดียว ยุบตารางซ้ำ ลบหนังสือก่อน 2569 และเก็บไฟล์เป็น BLOB

[กลับหน้าภาพรวม](./README.md) · GitHub: (รอสร้าง)

## การติดตามงาน

| รายการ | ค่า |
|---|---|
| สถานะงาน | เสร็จ — ทดสอบเขียนผ่าน HTTP แล้ว รอผู้ใช้ทดสอบผ่าน UI (ต้อง login CENTRAL) และยังไม่ commit |
| ความยาก | 7/10 |
| ต้องทำก่อน | — |
| เกณฑ์รับงานที่ติ๊กแล้ว | 6/7 |

## ที่มา

ผู้ใช้กำหนด 24 พฤศจิกายน 2026:

- "ให้ ronaldo-service มาเชื่อมต่อกับ database นี้เท่านั้นไม่ต้องไปสร้าง database อื่น"
- "โครงสร้าง Database และ Tables หลักๆ ให้ยังคงเดิมแค่ยุบตารางซ้ำให้ออกให้เหลือแค่อันเดียว"
- "แรกเริ่มโปรเจคนี้ผมแค่ต้องการ Renovate UI/UX เท่านั้น"

## สภาพปัจจุบัน (ตรวจ 24 พ.ย. 2026 จากไฟล์ใน C:/laragon/data/mysql-8)

- `genbookno_db` (MyISAM, 23 ตาราง) — โครงสร้างระบบเดิม เป็นฐานที่ต้องคงไว้
- `genbook_db` (InnoDB, `issuance_*` 9 ตาราง + `legacy_*`/`migration_*` 12 ตาราง) — schema ใหม่ที่ผู้พัฒนาก่อนหน้าออกแบบเอง (T01–T12) ไม่ใช่โครงสร้างเดิม genbook `lib/issuance/*` ใช้ฐานนี้อยู่
- ronaldo-service โมดูล `genbookno` รองรับเฉพาะ `genbookno_db` แบบอ่านอย่างเดียว และ `.env` ยังไม่มี `GENBOOKNO_DATABASE_URL` จึงยังไม่ได้เปิดใช้

## ตารางที่ต้องสงสัยว่าซ้ำ (คอลัมน์เหมือนกัน — ต้องพิสูจน์ด้วยข้อมูลก่อนยุบ)

| ตารางหลัก (คงไว้) | ตารางซ้ำ | หลักฐานจาก schema |
|---|---|---|
| `genbook` | `genbook61`, `gen_book_tb` (รุ่นเก่า คอลัมน์น้อยกว่า) | คอลัมน์ genbook61 ตรงกันทุกตัว |
| `genbook_inform` | `gen_book_inform`, `gen_book_to` | id, gen_book_id, inform/name_to |
| `bookdept` | `bookdept61`, `bookdept_tb` | คอลัมน์ตรงกัน (`_tb` ไม่มี book_idbook/sub_dept) |
| `bookdept_user` | `bookdept_user61`, `bookdept_user_tb` | คอลัมน์ตรงกัน |

วิธียุบ: พิสูจน์ด้วย LEFT JOIN บน PK สองทาง → แถวที่ไม่มีในตารางหลักและ PK ไม่ชนให้ INSERT เข้าตารางหลัก → แถวที่ PK ชนแต่ค่าต่างให้รายงานผู้ใช้ ไม่เดา → ย้ายตารางซ้ำไป `genbookno_archive` ด้วย `RENAME TABLE` (ไม่ DROP) ตรวจ `gen_book_tb`/`*_tb` ว่าโค้ดระบบเดิมบน Y: ยังอ้างถึงหรือไม่ก่อนย้าย

## ขั้นตอน

1. `mysqldump --single-transaction --hex-blob` ทั้ง `genbookno_db` และ `genbook_db` เก็บนอก repo
2. รายงานผลพิสูจน์ตารางซ้ำ → ยุบตามตารางด้านบน
3. ลบ `genbook` ที่ `gen_book_year < 2569` (เดิม < 2567 ผู้ใช้เปลี่ยน 25 พ.ย. 2026) และแถวลูกใน `genbook_inform`/`genbook_dept` ที่อ้างถึงหนังสือเหล่านั้น
4. สร้าง `genbook_file (gen_book_file_id PK, gen_book_id INT NOT NULL → genbook.gen_book_id, file_name, extension, mime, size, sha256, content LONGBLOB, created_at)` ENGINE=InnoDB
5. นำเข้าไฟล์จาก `Y:/ln_generate_bookno/book/uploads/<gen_book_year>/<document_file>` เฉพาะปี ≥ 2569 รายงานไฟล์ที่หาไม่เจอ ไม่แตะไฟล์บน Y:
6. ronaldo-service `genbookno`: เปิด CRUD บนตาราง `genbookno_db` (ยกเลิกข้อจำกัดอ่านอย่างเดียว) — แยก ticket ย่อยเมื่อถึงขั้นนี้
7. genbook: ย้าย `lib/issuance/*` ไปเรียก API ของ ronaldo-service และเลิกใช้ `genbook_db` (ไม่ลบจนกว่าผู้ใช้สั่ง)

## เกณฑ์รับงาน

- [x] มี dump สำรองก่อนแก้ทั้งสองฐาน
- [ ] (ไม่ทำตามแบบเดิม — ผู้ใช้อนุมัติให้ลบตารางซ้ำแทนย้ายไป archive ดู 2026-11-24; ข้อมูลเดิมอยู่ใน dump) ตารางซ้ำแต่ละคู่มีหลักฐาน และไม่มีข้อมูลหาย (fingerprint ตาราง main + archive = ก่อนแก้)
- [x] ไม่เหลือ `genbook.gen_book_year < 2569`
- [x] `genbook_file` มีไฟล์ปี ≥ 2569 พร้อม sha256 ตรงกับไฟล์ต้นฉบับ
- [x] ronaldo-service ต่อ `genbookno_db` เท่านั้น ผ่าน `GENBOOKNO_DATABASE_URL`
- [x] genbook ไม่ต่อฐานข้อมูลโดยตรง
- [x] lint, typecheck, test ผ่านทั้งสอง repo

## ความคืบหน้า 2026-11-24
- เชื่อมต่อได้ด้วย `GENBOOKNO_DATABASE_{URL(host),PORT,USERNAME,PASSWORD,DATABASE}` (โค้ด ronaldo ยังอ่าน URL แบบเต็ม ต้องปรับ)
- สำรองแล้ว: `F:/Work/project/db-backup/{genbookno_db,genbook_db}-20261124-before-T15.sql`
- ลบตารางซ้ำ/ระบบเก่าแล้ว (ผู้ใช้อนุมัติ): genbook61, bookdept61, bookdept_user61, gen_book_tb, gen_book_inform, gen_book_to, bookdept_tb, bookdept_user_tb — ไม่สร้างฐาน archive
- ลบ genbook ปี < 2567 แล้ว 115,454 แถว + genbook_inform 116,560 + genbook_dept 27,318 (รวมแถวกำพร้าเดิม) คงเหลือ genbook 57,060 / inform 57,839 / dept 11,082 ไม่มีแถวกำพร้า
- ค้าง: ตาราง BLOB + ย้ายไฟล์ uploads 2567–2569, ปรับโมดูล genbookno ให้อ่านตัวแปรแยกและรองรับเขียน

## ความคืบหน้า 2026-11-25
- สร้าง `genbookno_db.genbook_file` แล้ว (InnoDB, utf8mb4) — DDL: ronaldo-service `database/genbookno/migrations/20261125100000_genbook_file/migration.sql`
  - ไม่มี FK ไป `genbook` เพราะ `genbook` เป็น MyISAM (คงโครงสร้างเดิม) ตัวนำเข้า/API ต้องตรวจ gen_book_id เอง
  - `UNIQUE(gen_book_id)` หนึ่งไฟล์ต่อหนังสือตามระบบเดิม และทำให้นำเข้าซ้ำได้ปลอดภัย · CHECK `size = LENGTH(content)` ทดสอบแล้ว
  - ข้อจำกัด: `innodb_redo_log_capacity` = 100MB → ไฟล์เดียวใส่ได้ราว ≤ 10MB ต่อ transaction
- ข้อมูลที่ต้องนำเข้า: ปี 2567 = 18,776 · 2568 = 19,310 · 2569 = 18,139 แถวที่มี document_file (ชื่อไฟล์ = `document_file` + `document_extension`)
- ไดรฟ์ Y: ช้ามาก (`du`/`find` ทั้งโฟลเดอร์ปีเกิน 5 นาที) ตัวนำเข้าต้องทำทีละไฟล์ ทำต่อจากจุดค้างได้ และไม่ list ทั้งโฟลเดอร์ซ้ำ
- สคริปต์นำเข้า: ronaldo-service `scripts/genbookno/import-files.ts` (+ spec) ทำต่อจากจุดค้างได้ ตรวจ SHA2 ใน MySQL หลังนำเข้า รายงานปัญหาเป็น JSONL ที่ `F:/Work/project/db-backup/T15-file-import/`
- ทดลองนำเข้าแล้ว 50 ไฟล์ (ปี 2567) sha256 ตรงทั้งหมด และตรงกับ `sha256sum` ไฟล์ต้นฉบับ
- **นำเข้าไฟล์ปี 2569 เสร็จ (25 พ.ย. 2026)** หลังลบปี < 2569 ปัญหาพื้นที่ดิสก์หมดไป: `--skip-binlog` นำเข้า 18,139/18,139 ไฟล์ 2,892 MB (ใหญ่สุด 2.0 MB) verify `sha_mismatch=0 size_mismatch=0` ไม่มีไฟล์ missing/oversize; tablespace อยู่ datadir C: (เหลือ 14 GB) ไม่ได้ใช้ `innodb_directories` ใน my.ini; log: `F:/Work/project/db-backup/T15-import-2569.log`
- ผู้ใช้เปลี่ยนขอบเขต (25 พ.ย. 2026): ลบ genbook ทุกปี < 2569 → สำรองแถวที่จะลบไว้ที่ `F:/Work/project/db-backup/genbookno_db-20261125-year-lt-2569.sql` (47.5 MB) แล้วลบ genbook 38,635 + inform 39,084 + dept 7,659 + genbook_file 50 (ไฟล์ทดลองปี 2567)
- คงเหลือ: genbook 18,425 (ปี 2569 เท่านั้น) · inform 18,755 · dept 3,423 · genbook_file 0 · ไม่มีแถวกำพร้า
- ตัวนำเข้าเปลี่ยนค่าเริ่มต้นเป็น `--years 2569` ไฟล์ต้องนำเข้า 18,139 ไฟล์ ≈ 2.7 GB (ประมาณจากค่าเฉลี่ย) — พื้นที่ C: 7.5 GB พอ ไม่ต้องย้าย tablespace ไป F:
- my.ini ถูกเพิ่ม `innodb_directories="F:/mysql-data/genbookno"` แล้ว (สำรองเดิมที่ db-backup/my.ini.20261125-before-T15) ยังไม่ได้ใช้งาน

## ความคืบหน้า 2026-11-25 (งานที่ 6–7)

ronaldo-service โมดูล `genbookno` (เขียนได้แล้ว):
- อ่านค่าเชื่อมต่อจาก `GENBOOKNO_DATABASE_URL` (URL เต็ม หรือ host อย่างเดียว + `GENBOOKNO_DATABASE_{PORT,USERNAME,PASSWORD,DATABASE}`) ต่อได้เฉพาะ `genbookno_db` บน loopback
- apply migration `20261125120000_genbook_write_support` บน local แล้ว (additive): `genbook_number` 18,382 แถว (seed จาก genbook), `genbook_request`, `genbook_audit` — ตารางเดิมไม่เปลี่ยนโครงสร้าง
- API ใหม่ `POST /api/v1/genbookno/books/{overview,detail,sources,issue,issue-backdated,amend,pdf}` และ `PUT /books/:id/pdf` (`src/modules/genbookno/book-write.ts`) ใช้ guard เดิม (Bearer `GENBOOKNO_API_SECRET`, ตรวจ staffId กับ Core ทุกคำขอ)
- กฎออกเลขตามระบบเดิม (`genbook.php`/`genbook_model.php`): ชุดเลข = `bookdept.dept_id='*'` + `bookdept_user` ของผู้ใช้ (book.status='1'); ปีเลข `book_year='b'` = ปีงบประมาณ (1 ต.ค.), อื่น ๆ ปีปฏิทิน, ชุด 00006 ใช้ปีของวันที่หนังสือ; ขอเลขได้ 07:00–22:30 ยกเว้นหน่วยงาน 204; ขอเลขใหม่ไม่ได้ถ้าหนังสือไม่ลับฉบับล่าสุดยังไม่แนบ PDF; ชุดเลข typesecret='n' ออกหนังสือลับไม่ได้; ผู้ลงนาม = รหัสบุคลากร (endorser_type 2) หรือ `position:<endorser_id>` (1) หรือว่าง (0)
- ความปลอดภัยการออกเลข: MySQL named lock (owner → ชุดเลข/ปี → หนังสือ) + PK ของ `genbook_number` กันเลขซ้ำ; เลขที่จองแล้วบันทึกไม่สำเร็จจะค้างใน ledger ไม่นำกลับมาใช้; idempotency ด้วย (staff_id, requestId)
- แก้ไข: เทียบ `version` (= 1 + จำนวน audit ที่ไม่ใช่การออกเลข), เขียน audit ทุกครั้ง; PDF เก็บใน `genbook_file` (≤ 2 MiB ตามระบบเดิม) และอัปเดต `genbook.document_file` เป็นชื่อสุ่ม 32 hex
- ยกเลิกเลข: `POST books/cancel` `{staffId,id,input:{version,reason}}` ตั้ง `status_genbook='c'` + `reason_cancel` (≤500) ตามฟอร์มแก้ไขเดิม (`btnCancel`/`reason_cancel`) เฉพาะเจ้าของ เลขที่ยกเลิกไม่ถูกนำกลับมาใช้ หนังสือที่ยกเลิกแล้วแก้ไข/แนบ PDF/ยกเลิกซ้ำไม่ได้ (409) และเขียน audit `cancelled`; genbook มีปุ่ม "ยกเลิกเลขหนังสือ" + route `app/api/issuance/[id]/cancel`
- ค้นหา (`/search`) คืน `kind:'issuance'` ทุกแถว เพราะทุกหนังสือแก้ไขผ่าน books/* ได้แล้ว

genbook:
- ลบ `lib/issuance/*` และ dependency `mysql2`; route `app/api/{issuance,backdated,search,history}` เรียก ronaldo ผ่าน `lib/genbookno/client.ts` (server-only, `RONALDO_SERVICE_URL` + `GENBOOKNO_API_SECRET`)
- รหัสหนังสือใน URL เปลี่ยนเป็น `gen_book_id` (ตัวเลข) แทน UUID; ช่องผู้ลงนามมีรายการตำแหน่งจาก `endorser_tb`
- `.env.example` เลิกใช้ `ISSUANCE_DATABASE_URL`; ต้องตั้ง `GENBOOKNO_API_SECRET` ให้ตรงกับ ronaldo-service

ทดสอบ:
- ronaldo-service: `npm run lint` ผ่าน (มีแต่ warning เดิม + warning template literal ใน spec), `npm test` 435 ผ่าน / 1 ข้าม, `npm run build` ผ่าน; `book-write.spec.ts` ทดสอบ 25 คำขอพร้อมกันได้เลขไม่ซ้ำเรียงกัน, PK ปฏิเสธเลขซ้ำเมื่อไม่มี lock, replay/409, PDF ค้าง, ช่วงเวลา
- ทดสอบสดกับ `genbookno_db` + CENTRAL จริง (อ่าน): overview/detail/sources/search ได้ข้อมูล, ดาวน์โหลด PDF id 172556 sha256 ตรงกับ `genbook_file`, ไม่มี Bearer ได้ 401
- ทดสอบเขียนกับ `genbookno_db` local (ผู้ใช้อนุมัติ 2026-11-25 เป็นฐานทดสอบ) staff 1039 ชุด 00129 `อว 68102.1.3` ปี 2569 ผ่าน HTTP :3010:
  - ออกเลข 172557 = /0008; ส่ง requestId ซ้ำได้เล่มเดิม (replayed), payload ต่างได้ 409; ขอเลขใหม่ระหว่าง PDF ค้างได้ 409
  - แนบ PDF mock 200 (version 1→2), version เก่า 409, ดาวน์โหลด sha256 ตรง, ไฟล์ > 2 MiB 413, ไม่ใช่ PDF 400
  - ขอเลขพร้อมกัน 6 คำขอ: ผ่าน 1 (172558 = /0009) อีก 5 ได้ 409 จากกฎ PDF ค้าง
  - แก้ไข 172558 (signer = staff → endorser_type 2) แล้วยกเลิก → `status_genbook='c'`, `reason_cancel` บันทึก; แก้ไข/ยกเลิกซ้ำได้ 409
  - ออกเลขถัดไป 172559 = /0010 (ไม่นำ /0009 ที่ยกเลิกกลับมาใช้); เลขย้อนหลัง 172560 = /0008.1
  - ไม่มี Bearer 401, staff ที่ไม่มีใน Core 401
  - ตรวจฐาน: `genbook_number` มี 4 แถวใหม่ตรงกับ genbook, audit ครบ (issued/pdf_attached/amended/cancelled/issued_backdated), `genbook_file` 3 ไฟล์; ไม่มีเลขใหม่ซ้ำกับเลขเดิม (ฐานเดิมมีเลขซ้ำอยู่แล้ว 86 แถว id 155245–172269 ซึ่งเกิดก่อน T15)
  - แถวทดสอบ 172557–172560 (หัวเรื่องขึ้นต้น `[ทดสอบ T15]`) ยังอยู่ในฐาน
- genbook: `npm run typecheck`, `npm run lint`, `npm run test:auth:ronaldo` ผ่าน; ยังไม่ได้ทดสอบผ่านเบราว์เซอร์ (ต้อง login CENTRAL)
- ลบ `genbook_db` แล้ว 2026-11-25 ตามที่ผู้ใช้สั่ง (สำรองที่ `db-backup/genbook_db-20261124-before-T15.sql`)
- ตั้งค่า local แล้ว: ronaldo `.env` มี `GENBOOKNO_API_SECRET`, `IDENTITY_API_SECRET` (สุ่ม 64 hex), `GENBOOKNO_SOURCE_SHA256` (sha256 ของ dump `genbookno_db-20261124-before-T15.sql`), `GENBOOKNO_PORT=3010`; genbook `.env.local` มี `RONALDO_SERVICE_URL=http://127.0.0.1:3010` และ secret ชุดเดียวกัน (ลบ `ISSUANCE_DATABASE_URL` แล้ว) — production ต้อง generate ใหม่
