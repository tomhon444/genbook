# Import SQL เดิมเข้า Genbookno_db

สถานะปัจจุบัน 19 พฤศจิกายน 2026: ย้าย MySQL ตัวเดิมไป **127.0.0.1:3306** แล้ว ดู [ค่าที่ใช้งานและ rollback](local-mysql-port3306.md) พอร์ต 3338 ในผลตรวจด้านล่างเป็นข้อมูลประวัติรอบนำเข้าเดิม

วันที่: 18 พฤศจิกายน 2026 (Asia/Bangkok)

ผู้ใช้ส่งไฟล์ `C:/Users/dench/Desktop/GenBookno_DB.sql.gz` และสั่งให้นำเข้าในเครื่องนี้ที่ `Genbookno_db` รอบนี้ใช้ไฟล์ที่ส่งมา ไม่ต้องเชื่อมบัญชี userGen บน server เดิม และไม่แตะข้อมูลต้นทางหรือฐาน `genbook_db` ที่เก็บ preservation ก่อนหน้า

## ผลนำเข้า

- ปลายทาง `127.0.0.1:3338/Genbookno_db` บน MySQL 8.0.30; Windows แสดง schema เป็น `genbookno_db`
- 22 ตาราง รวม 429,780 แถว ตามโครงสร้างเดิม ไม่แปลงเป็นตาราง issuance/staging
- ตาราง `genbook` 172,131 แถว, `genbook_inform` 174,017 แถว, `genbook_dept` 38,340 แถว
- SHA-256 ของไฟล์ gzip: `d5f97eb2131c0ba0d7eaee8659f9c9e02f87bf092092385c6dbd4b5181e2d6bb`
- ตรวจจำนวนและค่าทุกฟิลด์แบบ multiset จึงรักษารายการซ้ำและค่าตัวเลขเดิม ไม่เปลี่ยนเลขหนังสือ
- shutdown/reopen MySQL แล้วตรวจซ้ำครบทุกตารางผ่าน การรันซ้ำเป็น verification ไม่เขียนทับฐาน

ต้นฉบับกู้คืนและรายงานจำนวนรายตารางอยู่ `.local/legacy-import/native-d5f97eb2131c/source.sql.gz` และ `import.json` ไม่อยู่ใน Git และไม่เผยแพร่ข้อมูลในแถวหรือ credential ผ่าน log

`tools/migration/import-native.mjs` ตรวจพอร์ต รุ่น server, data directory และ UUID ของ runtime ให้ตรง receipt ก่อนสร้าง/ตรวจฐาน ปฏิเสธฐานที่มีอยู่หากไม่มีรายงาน complete ของ source SHA เดียวกัน ไม่ DROP/เขียนทับฐานเดิมเมื่อพบปัญหา

SQL input ตรวจโครงสร้างก่อนทำงาน อนุญาตเฉพาะ session settings ที่กำหนด, CREATE TABLE ของ target แบบไม่ข้ามฐาน และ INSERT ของ literal ที่ parse ได้ ไม่ execute คำสั่ง/คำแนะนำใน comments, ไม่รับ USE/GRANT/คำสั่งระบบหรือ qualified foreign key ข้ามฐาน หากนำเข้าไม่จบจะเก็บฐาน/ต้นฉบับไว้เพื่อตรวจ ไม่ลบข้อมูลอัตโนมัติ

```powershell
npm.cmd run test:migration:native
npm.cmd run migration:native -- C:/Users/dench/Desktop/GenBookno_DB.sql.gz
```

ฐานที่ 3306 เป็น MySQL 5.6 เดิมและไม่ได้ใช้สำหรับการนำเข้านี้ MySQL 8 ที่ 3338 ใช้ runtime ถาวรของโปรเจกต์ (`npm.cmd run dev:ronaldo` เปิด runtime ให้) ถ้าปิด runtime ไว้ต้องเปิดก่อนตรวจฐาน

## การเชื่อม ronaldo-service

โมดูล `src/modules/genbookno/` ใช้ `GENBOOKNO_DATABASE_URL` ชี้ local clone ด้วยบัญชี SELECT-only แยกจาก root ข้อมูลเชื่อมต่อจริงอยู่ใน `.env` ที่ Git ignore ไม่อยู่ในเอกสารนี้

Standalone `node dist/modules/genbookno/server.js` เปิด Core identity + Core health + การเชื่อมฐานหนังสือ local โดยไม่เปิด Repair ขณะตรวจ `/api/v1/health` ตอบ 200/db up/central up และ identity status ของบุคลากรเป้าหมายตอบ provider central ผ่าน Authen ยังคงอ่าน CENTRAL บน phoenix ไม่ได้คัดลอก CENTRAL เข้า Genbookno_db

โมดูลนี้เป็น connection/health เท่านั้น ไม่มี endpoint อ่านข้อมูลหนังสือหรือ CRUD ใหม่ และไม่เปลี่ยน SQL ออกเลขของ Next.js ให้ใช้ schema เดิมโดยอัตโนมัติ SQL dump มีข้อมูลอ้างอิงไฟล์ตามต้นทาง ไม่ได้รวม PDF ที่เก็บแยกบน web server

Activation check: service connection confirmed 127.0.0.1:3338/genbookno_db, 22 tables and 172131 genbook rows. Next login page returns 200. Live identity-dependent read requests currently return 503 because phoenix.eng.psu.ac.th resolves to ENOTFOUND on this machine; no fallback identity or bypass was enabled.
