# Local synthetic login sandbox

ใช้โค้ด login/query/session เดิมกับบัญชีสังเคราะห์ เพื่อทดสอบ compatibility ของ `STAFF_ID`, `DEPT_ID` และ role โดยไม่ติดต่อฐานบัญชีคณะ เครื่องมือนี้ไม่ใช่ระบบล็อกอิน production และไม่พิสูจน์ faculty integration

## เปิดใช้

เตรียม Laragon/MySQL ในเครื่องที่ port 3306 และ runtime ที่ติดตั้งอยู่แล้ว:

- PHP 5.3.29 CGI สำหรับโค้ดเดิม
- PHP 8.1 CLI สำหรับเตรียม fixture/ตรวจ DB
- Node.js สำหรับ HTTP wrapper และ tests

รันครั้งแรกจาก root โปรเจกต์:

```powershell
node tools/legacy-sandbox/start.mjs
```

เปิด **http://127.0.0.1:18082/** ใช้ username `t02_owner` กับรหัสที่สร้างใน `.local/legacy-sandbox/test-accounts.txt` ไม่ใช้บัญชีคณะจริง Browser ต้องใช้ URL นี้ตรง ๆ เพราะ Host/Origin อื่นถูกปฏิเสธ CSS/JS/ภาพ/font โหลดจากโฟลเดอร์ static เดิมแบบอ่านอย่างเดียว โดยตรวจชนิดไฟล์และ real path ไม่เปิด PHP/config/upload ผ่านเส้นทาง static

มี compatibility alias เฉพาะ `css/table-images/` → `images/table-images/` และ `js/jquery-1.7.1.js` → `js/jquery-1.7.1.min.js` เพราะชื่อที่ template/CSS เดิมอ้างไม่ตรงกับไฟล์ที่มีอยู่ ไม่แก้ไฟล์ต้นฉบับ หลัง restart ต้องล็อกอินใหม่เพราะ sandbox หมุน session key

มีบัญชี `t02_other`, `t02_manager` และบัญชีที่ตั้งใจให้เข้าไม่ได้ `t02_inactive`, `t02_no_start`, `t02_no_prefix` รหัสทุกบัญชีสุ่มใหม่และเก็บเฉพาะ `.local` ที่ Git ignore ไม่อยู่ใน source/issue tracker

หยุดหรือเปิดใหม่โดยไม่ seed ซ้ำ:

```powershell
node tools/legacy-sandbox/start.mjs --stop
node tools/legacy-sandbox/start.mjs --resume
```

`--resume` ตรวจ fixture/read-only grants ก่อนเปิดเว็บ หมุน encryption key ของ sandbox เพื่อไม่ใช้ session ก่อน restart ส่วน start ปกติปฏิเสธ directory/schema/user ที่มีอยู่ ไม่เขียนทับหรือ reset ข้อมูลเดิม หากการเตรียมครั้งแรกไม่ครบให้ตรวจผลก่อนแก้ ห้ามลบฐานข้อมูลอัตโนมัติ

## การแยกข้อมูล

- สร้างเฉพาะฐานใหม่ `t02_central`, `t02_genbook` และ user ใหม่ `t02_fixture` บน MySQL ในเครื่อง ไม่คัดลอกข้อมูลจาก `GenBookno_DB` หรือ `CENTRAL`
- bootstrap ใช้ credential ของ group `genbook` ใน config เดิมเฉพาะในหน่วยความจำและตรวจ loopback ก่อนเชื่อม ไม่ใช้ group `central` ของเดิม ไม่บันทึกค่า credential เดิม
- เว็บสำเนาใช้ config สร้างใหม่สอง group ที่ชี้ `127.0.0.1:3306` เท่านั้น โดย user มี `SELECT` เฉพาะฐานทดสอบ ไม่มีสิทธิ์เขียน แม้เรียก model mutation ก็เขียนไม่ได้
- เก็บสำเนา application และ config ที่สร้างใหม่ใต้ `.local/legacy-sandbox/web`; อ้าง framework จากระบบเดิมแบบอ่านอย่างเดียว ไม่แก้ `C:/laragon/www/book-number` และไม่เปลี่ยน Apache/Laragon settings
- HTTP ฟังเฉพาะ `127.0.0.1:18082` ตรวจ Host/Origin, ปฏิเสธ endpoint แก้ข้อมูล/ออกเลข/debug/config, บังคับ username ทดสอบ และ CSP ปิดการส่ง form/โหลด resource ไป origin อื่น
- SOAP adapter ที่ไม่ได้ใช้ถูกแทนด้วยตัวปฏิเสธในสำเนาทดสอบ ถ้า source เปลี่ยนกลับมาเรียก SOAP จะ login ไม่ผ่านแทนการติดต่อภายนอก ไม่ใช่ mock ที่ยืนยันตัวตนสำเร็จ
- `/sandbox_identity` อ่านเฉพาะ session ที่มี synthetic `T02-` ID ใช้เก็บหลักฐาน mapping ไม่สร้าง session และไม่มีใน Next.js app
- launcher ปฏิเสธ `NODE_ENV=production`; test-only controller/config ปฏิเสธนอก `ENVIRONMENT=testing` เครื่องมือและ `.local` ต้องไม่ติดตั้งใน production

## ตรวจผล

```powershell
node tools/legacy-sandbox/test.mjs
node tools/legacy-sandbox/test-assets.mjs
& C:/laragon/bin/php/php-8.1.10-Win32-vs16-x64/php.exe tools/legacy-sandbox/verify.php .local/legacy-sandbox/private-settings.json
```

ทดสอบ login สำเร็จ/mapping/role, รหัสผิด, inactive, ไม่มีวันเริ่มงาน, ไม่มี prefix, ปฏิเสธคนไม่ login และ route อันตราย, production guard และ read-only grants ทดสอบ INSERT ที่ต้องถูกปฏิเสธภายใน transaction และ rollback ใน fixture เท่านั้น ไม่ทดสอบจัดสรรเลข

**ข้อค้นพบ session เดิม:** พบว่า cookie เก่าก่อน logout replay แล้วเข้าได้ใน legacy cookie session จึงไม่อ้างว่าระบบเดิม revoke session ได้ Wrapper sandbox ปฏิเสธ cookie ที่ logout แล้วในหน่วยความจำ ส่วน production ต้องทำ server-side revocation ใน T04; mitigation sandbox ไม่ใช่การแก้ระบบเดิม

DDL fixture เป็น compatibility subset ที่สร้างตาม query ไม่ใช่ schema dump ที่คณะรับรอง ใช้ `utf8mb4_unicode_ci` เพราะ runtime จริงเป็น MySQL 5.6.51 รูปแบบ `PASSWORD` ใน fixtureมีไว้รองรับ query เดิมเท่านั้น ไม่ใช่คำแนะนำการเก็บรหัสผ่านสำหรับระบบใหม่

## การหยุดและย้อนกลับ

ใช้ `--stop` เพื่อหยุดเฉพาะเว็บ sandbox MySQL เดิมยังทำงานตามเดิม ฐานและบัญชีสังเคราะห์คงไว้สำหรับตรวจสอบ/เปิดซ้ำ ไม่มี DROP/DELETE/TRUNCATE อัตโนมัติ การลบ fixture schemas/user ภายหลังต้องได้รับอนุมัติแยก ไม่ลบ `.local` ก่อนหยุดเว็บและตัดสินใจว่าจะเก็บผลทดสอบหรือไม่
