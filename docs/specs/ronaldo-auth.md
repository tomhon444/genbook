# ยืนยันตัวตนผ่าน ronaldo-service

ขอบเขตที่ผู้ใช้อนุมัติ 18 พฤศจิกายน 2026: เพิ่ม HTTP API ใน Core identity ของ ronaldo-service และให้ genbook-no ใช้ตัวเชื่อม CENTRAL เดิม ไม่ใช้ login หรือฐานข้อมูลของ Repair ไม่เพิ่มสิทธิ์ออกเลขจากผลยืนยันตัวตน

## การเชื่อมต่อ

Browser → Next.js `/api/auth/login` → Ronaldo `/api/v1/identity/authenticate` → Core `IDENTITY_PROVIDER` → CENTRAL แบบอ่านอย่างเดียว

Next.js `/api/me` และทุก protected operation → ตรวจ session → Ronaldo `/api/v1/identity/status` → ตรวจบุคลากรและหน่วยงานที่ยัง active ทุกครั้ง

| API ของ Ronaldo | Body | ผลสำเร็จ |
| --- | --- | --- |
| POST `/api/v1/identity/authenticate` | `{ username, password }` | `{ provider, identity }` |
| POST `/api/v1/identity/status` | `{ staffId }` | `{ provider, identity }` |

`identity` มีเฉพาะ `staffId`, `displayName`, `departmentId`, `departmentName` โดยใช้ CENTRAL STAFF_ID/DEPT_ID ไม่เดาจากชื่อหรืออีเมล ผล 401 คือไม่ผ่านการยืนยัน, 429 จำกัดการลอง, 503/timeout คือบริการไม่พร้อม ไม่มี fallback ไปบัญชีจำลอง อนุญาต `provider=fake` เฉพาะ development/test

## ค่าตั้ง

ดู `.env.example` ของทั้งสองโปรเจกต์ กำหนด `AUTH_PROVIDER=central`, `AUTH_ORIGIN` เป็น origin ของเว็บ, `RONALDO_SERVICE_URL` เป็น origin ของ service, `RONALDO_IDENTITY_SECRET` ให้ตรงกับ `IDENTITY_API_SECRET` ของ service (ค่าสุ่มอย่างน้อย 32 ตัว) และ `AUTH_SESSION_DIRECTORY` เป็น absolute path ของพื้นที่ส่วนตัวที่เขียนได้ ห้ามส่ง secret ลง browser หรือใช้ `NEXT_PUBLIC_`

ใช้ HTTPS ทั้งสองฝั่งในการใช้งานจริง HTTP อนุญาตเฉพาะ loopback ใน development/test ของตัวเชื่อม genbook-no Service เลือก `IDENTITY_PROVIDER=central` และใช้ `.env.legacy`/`LEGACY_ENV_FILE` ตาม connector เดิม ไม่คัดลอก credential ของ CENTRAL เข้า genbook-no

รัน service แบบเต็มตามคู่มือ ronaldo-service หรือรันเฉพาะ identity ที่ build แล้ว (`node dist/core/identity/identity-server.js`) ตัวหลังไม่เปิด Repair/ฐาน Repair; bind loopback โดยตั้ง reverse proxy HTTPS เมื่อต้องเข้าจากเครื่องอื่น

สำหรับพัฒนา genbook-no ให้ตั้ง `.env.local` แล้วใช้ `npm.cmd run dev:ronaldo` คำสั่งนี้ใช้ฐาน local ตัวเดียว `genbook_db` บน 127.0.0.1:3306 ตาม `ISSUANCE_DATABASE_URL` ใน `.env.local` (ถ้าชี้ที่อื่นจะหยุดทันที) และเปิด Next.js พอร์ต 3000; ไม่รัน migration ส่วน `dev:ronaldo:demo` สร้างฐานทดสอบชั่วคราว `genbook_test` แทน ronaldo-service ทำหน้าที่ตรวจ `LOGIN`/`PASSWORD` กับ `CENTRAL.STAFF_INFO` บน phoenix เท่านั้น ไม่มีการเชื่อมฐานหนังสือ (ยกเลิก `BOOK_DATA_PROVIDER=ronaldo` และโมดูล genbookno แล้วเมื่อ 24 พฤศจิกายน 2026)

## ทดลองเชื่อมสองโปรเจกต์โดยไม่ติดต่อ CENTRAL จริง

1. ใน ronaldo-service: `npm.cmd ci` แล้ว `npm.cmd run build`
2. ใน genbook-no: `npm.cmd run dev:ronaldo:demo`
3. เปิด `http://127.0.0.1:3000/login` บัญชีจำลองสุ่มใหม่อยู่ `.local/ronaldo-account.json`

โหมดนี้เปิด Core identity จริงของ ronaldo-service บนพอร์ต 3001 โดยใช้ FakeDirectory จาก fixture ใต้ `.local/ronaldo-demo/` ไม่เปิดหรือเขียนฐาน Repair/CENTRAL ผลทดสอบนี้ยืนยันการเชื่อม HTTP แต่ไม่ใช่การตรวจรับบัญชีคณะจริง

## Session

genbook-no สร้าง token สุ่ม 256 บิต เก็บ cookie แบบ HttpOnly/SameSite=Lax และ Secure เมื่อ `AUTH_ORIGIN` เป็น HTTPS เก็บเฉพาะชื่อไฟล์ SHA-256 ของ token และ record STAFF_ID/expiry ในพื้นที่ส่วนตัว ไม่มี password หรือ token ดิบในไฟล์ อายุ absolute 30 นาทีเป็นค่าทางเทคนิคเดิมสำหรับการพัฒนา ยังต้องรับรองก่อนเปิดใช้จริง

session คงอยู่ข้ามการเริ่ม Next.js ใหม่ภายใน 30 นาที หมุนและลบ session เดิมเมื่อ login สำเร็จ logout เพิกถอนใน genbook-no ได้แม้ Ronaldo ล่ม; ถ้าลบไฟล์ไม่สำเร็จจะรายงาน 503 และไม่อ้างว่า logout สำเร็จ การย้ายหน่วยงานอัปเดตจากสถานะล่าสุด; บุคลากร/หน่วยงานที่ไม่ผ่านจะเพิกถอน session การตรวจ remote ล่มจะปฏิเสธ request แต่ไม่แปลงเป็นผู้ใช้อื่น

พื้นที่ session ต้องเป็น private local disk ของ deployment เดียว ห้ามเผยแพร่ผ่าน static server หรือติด Git หากรันหลายเครื่องต้องจัด shared session store/ทบทวนการเพิกถอนก่อน deploy มีการกวาด record หมดอายุขณะ login และขีดจำกัด 10,000 record เพื่อปฏิเสธเมื่อพื้นที่เต็ม ไม่ใช่การกำหนดนโยบายเก็บข้อมูลทางกฎหมาย

## ตรวจสอบ

`npm.cmd run test:auth:ronaldo`, `npm.cmd run test:auth`, `npm.cmd run lint`, `npm.cmd run typecheck` และ `npm.cmd run build`; Core HTTP tests ใน ronaldo-service ใช้ injected fixtures ไม่เชื่อม CENTRAL จริง T13 ยังต้องมีผลบัญชีคณะจริง/การจับคู่รหัส/สิทธิ์/การตรวจรับก่อน deploy

เมื่อเปิดโหมด demo แล้ว รัน `node tools/ronaldo-auth/smoke.mjs` เพื่อตรวจ HTTP login/rotation/protected API/logout/replay และ `node tools/ronaldo-auth/browser-smoke.mjs` เพื่อตรวจเข้าจาก browser ผ่าน service จริงด้วยบัญชีจำลอง ทั้งสองคำสั่งไม่รับ credential คณะจริง

ผลตรวจ 18 พฤศจิกายน 2026: ตั้งค่า local ให้ Core ใช้ `IDENTITY_PROVIDER=central` แล้ว ตรวจ `/api/v1/identity/status` ของบุคลากรเป้าหมายที่ผู้ใช้ระบุได้ 200/provider central และยืนยันว่ารหัสบุคลากรตรงกับ login และยัง active โดยใช้ connector แบบอ่านอย่างเดียว หน้า login ของแอปตอบ 200 และเปิดให้กรอกบัญชีได้ ยังไม่ได้ทดสอบรหัสผ่านบัญชีบุคคลจริงหรือรับรองสิทธิ์ออกเลข ไม่เก็บ credential หรือข้อมูลบุคคลจากผลตรวจในเอกสารนี้ และยังไม่ถือว่า T13 ผ่านครบ

## รูปผู้ใช้ในแถบบน (19 พฤศจิกายน 2569)

รูปข้างชื่อผู้ใช้และปุ่มออกจากระบบใช้ `https://apis.eng.psu.ac.th/personnel/v1/photo/{user}.jpg` โดย `{user}` มาจาก `CENTRAL.STAFF_INFO.UNI_STAFF_ID` เท่านั้น ไม่ใช้ `STAFF_ID` หรือ username แทน

Core identity ของ ronaldo-service แนบ `uniStaffId` (จาก `STAFF_INFO.UNI_STAFF_ID` เฉพาะเมื่อมีค่า) ไปกับ identity ที่ตอบตอน login/status และ genbook เก็บไว้ใน session; client เรียก `GET /api/profile` หลังแสดงหน้า Route ตรวจ session แล้วคืน `{ uniStaffId: string | null }` จาก session โดยไม่เรียก service เพิ่ม การเรียกโดยไม่มี session คืน 401; ทุก response ใช้ `no-store`

รูปโหลดโดยตรงจาก URL ที่กำหนดโดย encode รหัสเป็น path segment และไม่ส่ง referrer หากไม่มีรหัส รูปเสีย หรือบริการไม่พร้อม จะแสดงอักษรแรกของชื่อเดิมโดยไม่ขัดขวางการใช้งานระบบ โหมด local สังเคราะห์ไม่เรียก CENTRAL

ตรวจด้วย `npm.cmd run test:auth:ronaldo` (validation ของ `uniStaffId` ใน identity) และเทสต์ Core identity ของ ronaldo-service



