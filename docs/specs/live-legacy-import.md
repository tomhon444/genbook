# นำเข้าฐานหนังสือและไฟล์จากระบบเดิม

สถานะปัจจุบัน 19 พฤศจิกายน 2026: ฐาน local ถาวรย้ายไป **127.0.0.1:3306** แล้ว ดู [การตั้งค่าปัจจุบันและ rollback](local-mysql-port3306.md) พอร์ต 3338 ในบันทึกผลเดิมเป็นข้อมูลประวัติ ไม่ใช่ค่าปัจจุบัน

วันที่ตรวจ: 18 พฤศจิกายน 2026 (Asia/Bangkok)

ผู้ใช้สั่งให้นำข้อมูลระบบเดิมพร้อมไฟล์ดาวน์โหลดเข้าระบบใหม่ ขอบเขตดำเนินการปัจจุบันคือสำรองและนำเข้าในพื้นที่ local แยก ไม่เขียนฐานต้นทาง ไม่เปลี่ยนเลขเดิม ไม่เปิด production หรือรับรอง mapping ที่ยังไม่ได้ตรวจ

## ต้นทางฐานข้อมูล

ผู้ใช้ระบุฐาน `Genbook_DB` บน `infor.eng.psu.ac.th` แต่เครื่องมือ/สำรองก่อนหน้านี้อ้าง `GenBookno_DB` ต้องตรวจชื่อจริงจาก metadata ผ่านช่องทางที่ได้รับอนุญาตก่อนเลือก schema ห้ามเปลี่ยนไปใช้ชื่ออื่นเงียบ ๆ Credential อยู่เฉพาะไฟล์ local ที่ Git ignore และไม่ปรากฏในรายงาน

การตรวจ TLS ตอบ `HANDSHAKE_NO_SSL_SUPPORT` ช่วงแรกผู้ใช้เลือก VPN/SSH ต่อมาผู้ใช้ยืนยันว่าไม่ต้องใช้ VPN จึงอนุญาตโหมดอ่านโดยตรงในเครือข่ายภายในอย่างชัดเจน เครื่องมือตรวจ DNS ว่าเป็น private IP และ pin ปลายทางก่อนใช้ `--private-network-no-tls` ไม่มี automatic downgrade การลองบัญชีต้นทางยังถูกปฏิเสธด้วย `ER_ACCESS_DENIED_ERROR` (1045) และยังไม่มี snapshot สดจากรอบนี้

`tools/migration/source-snapshot.mjs` เตรียมส่งออก BASE TABLES ทุกตาราง โดยใช้ session/transaction อ่านอย่างเดียว เก็บ schema metadata จำนวนแถว และ SHA-256 พร้อม gzip ที่นำเข้า core 6 ตารางด้วย parser เดิมได้ ไม่ execute SQL ใน dump การส่งออกที่มีตาราง non-transactional ต้องระบุข้อจำกัดความสอดคล้องขณะต้นทางยังมีการแก้ไข

## พบไฟล์เก่าที่ใด

- URL เว็บ: `https://infor.eng.psu.ac.th/generate_bookno/book`
- รูปแบบไฟล์: `https://infor.eng.psu.ac.th/generate_bookno/book/uploads/<gen_book_year>/<document_file><document_extension>`
- พาธ physical ที่พบใน log ปี 2020: `/opt/www/generate_bookno/book/uploads/<ปี>/` ยังไม่ใช่ผลตรวจ filesystem ของ server ปัจจุบัน
- สำเนา `C:/laragon/www/book-number` ในเครื่องไม่มีโฟลเดอร์ uploads

หลักฐาน source: `application/controllers/genbook.php:1035` กำหนด upload_path, `:1057` อ้าง realpath, `application/models/genbook/genbook_model.php:573` เก็บชื่อไฟล์และนามสกุลผูก source ID และ `application/views/genbook/viewall_list.php:52` สร้างลิงก์ตรง ข้อมูล physical path อยู่ `application/logs/log-2020-09-03.php:181`

HTTPS ของเว็บเดิมใช้ค่า default แล้วพบ `ERR_SSL_DH_KEY_TOO_SMALL` การตัด cipher DHE ออกจากรายการ (`DEFAULT:!DHE`) เชื่อมสำเร็จด้วย TLS 1.2 / `TLS_RSA_WITH_AES_256_GCM_SHA384` และยังตรวจใบรับรองตามปกติ ไม่ใช้ `rejectUnauthorized=false`

## หลักฐานและขนาดเบื้องต้น

ตัวเลขนี้อ้าง snapshot เดิม SHA-256 `78629b14b7fcc8309aea012ae145fbae6dfde3a4d48a1b07fad9e0fb97411c82` ไม่ใช่ยอดฐานสด:

- หนังสือ 171,506 แถว จาก core 6 ตารางรวม 383,338 แถว
- มีค่า document_file 168,280 รายการ; รูปแบบอ้างอิง PDF ที่ตรวจเบื้องต้นได้ 168,278 รายการ
- HEAD ตัวอย่างกระจาย 40 ไฟล์: พบ PDF 39 รายการ, 404 จำนวน 1 รายการ
- ขนาดเฉลี่ยตัวอย่างประมาณ 144,707 ไบต์ ประเมินคร่าว ๆ 22.68 GiB ไม่ใช่ขนาดที่ยืนยันครบทุกไฟล์
- พื้นที่ C ว่างขณะตรวจประมาณ 22.72 GiB จึงต้องกำหนดพื้นที่เก็บที่มีระยะเผื่อสำหรับไฟล์ ฐานข้อมูล และ temp ก่อนดาวน์โหลดทั้งชุด

ไฟล์หายจะคงสถานะและ source ID ใน manifest ไม่สร้างไฟล์เปล่ามาแทน และไม่ถือว่า PDF พร้อมเพียงเพราะต้นทางมีชื่อไฟล์ หนังสือลับเก็บใน archive ส่วนตัวเช่นเดียวกับไฟล์อื่น ไม่เผยแพร่เป็น static download

ทดลอง GET แบบจำกัด 100 ไฟล์จาก snapshot เดิมแล้ว: เก็บสำเร็จ 93 รายการ อีก 7 รายการไม่ผ่านและมีเหตุผลแยกใน journal จำนวนเอกสารที่ยังไม่ดำเนินการ 168,178 รายการ อ้างอิงที่ไม่มีชื่อไฟล์ 3,226 รายการ และอ้างอิงที่รูปแบบไม่ถูกต้อง 2 รายการ เก็บ inventory/journal/summary และ blobs แบบ SHA-256 ใต้ `.local/legacy-import/attachments-78629b14/` ผลนี้เป็นเพียงตัวอย่าง archive จาก snapshot เดิม ไม่ใช่การนำเข้าฐานสดหรือไฟล์ทั้งชุด และยังไม่เปิดดาวน์โหลดในแอป

## การเก็บตัวไฟล์ในฐานข้อมูล

ผู้ใช้เลือกให้เก็บตัวไฟล์ใน `LONGBLOB` พร้อม SHA-256 เมื่อ 18 พฤศจิกายน 2026 ไม่ใช้ค่า hash แทนตัวไฟล์ เพราะ hash แปลงกลับเป็น PDF ไม่ได้

- `legacy_attachment_blobs.content` เก็บ bytes ของ PDF ใน LONGBLOB พร้อม `sha256` แบบ BINARY(32), `byte_size` และ `media_type` เนื้อหา hash เดียวกันเก็บครั้งเดียวและต้องตรวจ bytes/hash ก่อนเขียนและหลังอ่านกลับ
- `legacy_attachment_links` เชื่อม snapshot/source table/source ID กับ blob ผ่าน foreign key ไปยัง raw source ที่เก็บไว้เดิม พร้อม inventory hash, original source path และสถานะ downloaded/failed/pending/missing_reference/invalid_reference
- รายการที่หาไฟล์ไม่พบคงสถานะ/เหตุผล ไม่มี BLOB เปล่าหรือปลอมสถานะว่าดาวน์โหลดได้ ทุกการเขียนเป็น additive ในฐาน local แยก ไม่มีการเขียนฐานเก่าหรือเพิ่มสิทธิ์ออกเลข
- การเก็บ LONGBLOB ไม่ใช่การบีบอัดไฟล์ และยังต้องเผื่อพื้นที่ InnoDB/transaction/backup ฐานข้อมูลทั้งชุดจึงต้องมีพื้นที่มากกว่าขนาด PDF รวม การทดลอง local ใช้เพียงตัวอย่างที่ดาวน์โหลดแล้วก่อนยืนยันพื้นที่ปลายทางเต็มชุด

DDL สำหรับฐานนำเข้า local อยู่ `tools/migration/attachment-blobs.sql` การมี BLOB ใน archive ไม่ได้เปิดให้ browser ดาวน์โหลดเอง ต้องเชื่อม normalized history และตรวจสิทธิ์เจ้าของ/หน่วยงาน/หนังสือลับใน API ก่อน

## ฐาน local ถาวร

ตรวจแล้วแอปเดิมใช้ `t05_synthetic` บน 3315 ไม่ใช่ genbook_db พอร์ต 3306 เป็น MySQL 5.6.51 ที่ไม่รองรับ JSON schema รุ่นปัจจุบัน การสร้างเริ่มต้นไว้ 6 ตารางยังไม่มีข้อมูล และไม่ถูกนำมาใช้โดยแอป/ไม่ถูกลบทิ้งอัตโนมัติ

ใช้ MySQL 8.0.30 ที่ติดตั้งอยู่แล้วใน runtime แยก `127.0.0.1:3338/genbook_db` โดยไม่อัปเกรด/แทนบริการที่ 3306 ข้อมูลอยู่ `.local/t12-persistent/genbook-db/data/` และ receipt ฝั่งแอปอยู่ `.local/genbook-local8.json` (มี credential local ต้องไม่เข้า Git)

`tools/migration/managed-local.mjs` ตรวจ runtime UUID/พอร์ต/ชื่อฐานและ gate ก่อนผูก connection เป็นปลายทางที่อนุมัติใน `local-target.mjs` ฐานชื่อเหมือนกันหรือ marker ไม่ตรงไม่ทำให้ผ่านการตรวจ การซ้อม `t05_synthetic` เดิมยังคงข้อจำกัดเดิม ไม่ปลดล็อกฐานอื่นที่ 3306

`import-local-files.mjs <snapshot.sql.gz> <private-archive>` ทำ preservation dry-run/commit/replay และนำไฟล์ที่ตรวจ bytes/hash แล้วเข้า LONGBLOB ด้วย association ครบ source IDs จากนั้น shutdown/reopen และตรวจ SHA จาก bytes ใน DB อีกครั้ง ไม่มีการเปิด issuance gate หรือเพิ่ม grants จากการนำเข้า

ผลตรวจจริงของ snapshot เดิม: raw 383,338 แถว/6 ตาราง, กันเลข 171,506 รายการ, dispositions 47 รายการ, source links 171,506 รายการ ไฟล์ตัวอย่าง 93 association เก็บเป็น BLOB เนื้อหาไม่ซ้ำ 91 แถว รวม 7,818,787 ไบต์ ตรวจ SHA ใน DB และ restart ผ่าน สถานะอื่นคือ failed 7 (HTTP 404), pending 168,178, ไม่มีชื่อไฟล์ 3,226 และ reference ไม่ถูกต้อง 2 รายการ ยังไม่มี app-readable history, legacy download API, grants หรือ counters ที่เปิดใช้

แอปตั้ง `ISSUANCE_DATABASE_URL` ใน `.env.local` ให้ตรงกับ receipt ของ `127.0.0.1:3338/genbook_db` แล้ว `npm.cmd run dev:ronaldo` เปิด runtime ถาวรให้อัตโนมัติและปิดเมื่อหยุดแอป ไม่สร้างฐานทดสอบใหม่ทับ หากต้องนำเข้าเพิ่มให้หยุดแอปก่อนใช้ `migration:local:files` เพราะ runtime มี lock กันเปิดซ้อน แล้วเปิดแอปใหม่หลังตรวจเสร็จ user ของแอปไม่มีสิทธิ์อ่าน raw staging หรือ LONGBLOB archive โดยตรง

ตรวจเครื่องมือด้วย `npm.cmd run test:migration:files` และ regression `test:migration`/`test:migration:local` ผลผ่านไม่ได้หมายความว่าฐานสดถูกส่งออกสำเร็จหรือไฟล์ทั้งหมดถูกย้ายแล้ว

## ขั้นนำเข้า

1. ตรวจชื่อฐาน/โครงสร้าง/จำนวนแถวจากช่องทาง VPN/SSH ที่ยืนยันแล้ว
2. ส่งออก snapshot ใหม่และตรวจ hash/จำนวนทุกตาราง เก็บ originals แบบไม่เขียนทับ
3. ใช้ `migration:local import` ลง target ชื่อใหม่แยกจาก snapshot ก่อนหน้า พร้อม dry-run, replay, ตรวจทุกฟิลด์และเปิดฐานซ้ำจากดิสก์
4. สร้าง inventory ของไฟล์ผูก source SHA/ID ดาวน์โหลดแบบ resume เก็บ bytes/SHA และรายงาน downloaded/missing/failed/blocked ให้ครบ
5. ทำ mapping เจ้าของ/หน่วยงาน/ชุดเลข ตรวจสิทธิ์ และเชื่อมไฟล์กับ normalized history ก่อนเปิดอ่านผ่านเว็บ ระบบออกเลขยังถูกปิดไว้จนตรวจรับครบ

คำสั่งเมื่อมีช่องทางและพื้นที่ปลายทางพร้อม (ไม่ใส่ password ใน command line):

```powershell
# ตรวจชื่อฐานผ่าน SSH forward ที่เปิดไว้แล้ว; เปลี่ยน port ให้ตรงของจริง
node tools/migration/export-live.mjs --env-file .local/legacy-import/source.env --inspect --tunnel 127.0.0.1 --port 13306
# เมื่อยืนยันว่า VPN เปิดอยู่และคุ้มครองเส้นทางไปต้นทาง จึงใช้ --vpn แทน --tunnel/--port
node tools/migration/export-live.mjs --env-file .local/legacy-import/source.env --output .local/legacy-import/source-20261118.sql.gz --tunnel 127.0.0.1 --port 13306
npm.cmd run migration:local -- import .local/legacy-import/source-20261118.sql.gz genbook-20261118
node tools/migration/attachments.mjs download .local/legacy-import/source-20261118.sql.gz <absolute-private-directory>
```

ไฟล์ `.env` ระบุชื่อฐานตามที่ผู้ใช้ให้มา หากตรวจ metadata แล้วพบชื่ออื่นต้องเลือก `--schema` อย่างชัดเจน ไม่ fallback การรันซ้ำไม่เขียนทับ snapshot เดิม; downloader ใช้ manifest/journal และตรวจ bytes/SHA ก่อนข้ามไฟล์ที่เคยสำเร็จ มี storage floor 2 GiB บวกเผื่อไฟล์ที่กำลังโหลดพร้อมกันก่อนหยุดรอพื้นที่เพิ่ม

ฐาน preservation เดิมเก็บ raw และกันเลขได้แล้ว แต่ไม่ได้เปิดประวัติหรือไฟล์ในแอป การนำเข้า snapshot ใหม่หรือได้ archive ของไฟล์ไม่ใช่หลักฐานว่า normalized history, grants, counters หรือ legacy download API พร้อมใช้งาน ต้องรายงานแยกตามผลจริง
