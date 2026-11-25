# T14 — ย้ายการติดต่อฐานข้อมูลไปไว้ที่โมดูล genbookno ของ ronaldo-service

[กลับหน้าภาพรวม](./README.md) · GitHub: (รอสร้าง)

## การติดตามงาน

| รายการ | ค่า |
|---|---|
| สถานะงาน | รอเริ่ม — เปิด ticket 24 พฤศจิกายน 2026 |
| เสร็จแล้ว | ยังไม่เสร็จ |
| ความยาก | 8/10 |
| ต้องทำก่อน | [T13](./13-faculty-identity-release-gate.md) ส่วน login ผ่าน Core identity (local ทำแล้ว) |
| เกณฑ์รับงานที่ติ๊กแล้ว | 0/7 |
| ผู้รับผิดชอบ | ยังไม่มอบหมาย |

## Parent

Part of #1

## ที่มา

ผู้ใช้กำหนด 24 พฤศจิกายน 2026 (Asia/Bangkok):

- "ส่วนที่ติดต่อ database มันควรอยู๋ใน ronaldo-service ไม่ใช่หรอ"
- "ส่วน login ด้วย username/password ใน ronaldo-service มีโมดูลกลางที่ใช้กับทุกระบบได้อยู่ หันไปใช้ตัวนี้แทน"
- "ในโปรเจค ronaldo-service มีโมดูลที่ใช้สำหรับเชื่อมต่อกับโปรเจค genbook อยู๋แล้ว ชื่อโมดูล genbookno"

ก่อนหน้านั้นในวันเดียวกัน ผู้ใช้สั่งให้ใช้ฐานเดียวคือ `genbook_db` และลบ `genbookno_db` แล้ว (backup อยู่ที่ `C:/Users/kkk/Desktop/23/backup-before-delete-20261124/`)

## สถานะตอนเปิด ticket

- Login: genbook เรียก Core identity ของ ronaldo-service (`/api/v1/identity/authenticate`, `/status`) อยู่แล้ว ไม่มีโค้ด CENTRAL ใน genbook
- ronaldo-service: `src/modules/genbookno/` อยู่ในสถานะ staged (ยังไม่ commit) เป็น API อ่านอย่างเดียว (`profile`, `overview`, `search`, `history`, `detail`) และบังคับให้ต่อเฉพาะ `genbookno_db` ซึ่งไม่มีอยู่แล้ว
- genbook: ยังติดต่อ `genbook_db` เองผ่าน `mysql2` ใน `lib/issuance/*` (`database.ts`, `service.ts`, `search.ts`, `history.ts`, `amendment.ts`, `pdf.ts`) และ route ที่เรียก `getIssuancePool()` ได้แก่ `app/api/{issuance,issuance/[id],issuance/[id]/pdf,search,history,backdated}`
- ตัวเรียก genbookno ฝั่ง genbook (`lib/books/*`, `tests/ronaldo-books.spec.mjs`) ถูกลบไปแล้วใน working tree แต่ยังอยู่ใน `HEAD`

## สิ่งที่ต้องทำ

1. ronaldo-service `genbookno`: เปลี่ยนให้ต่อ `genbook_db` (`GENBOOKNO_DATABASE_URL`) ด้วยบัญชีที่มีสิทธิ์ตามตารางเดิมของ genbook (SELECT/INSERT/UPDATE ตามที่ `tools/migration/managed-local.mjs` grant) ไม่ใช้ schema `genbookno_db`
2. ย้ายตรรกะจาก `lib/issuance/*` ไปเป็น service/controller ในโมดูล: ออกเลขแบบกันชนกัน (owner lock + counter ไม่ใช้ `MAX+1`), ออกเลขย้อนหลัง, แก้ไขพร้อม audit, ค้นหา, ประวัติ, รายละเอียด, PDF
3. คงการตรวจสิทธิ์จาก staffId ที่ revalidate กับ Core staff directory ทุกคำขอ และ service-to-server secret (`GENBOOKNO_API_SECRET`) ห้ามส่งลง browser
4. genbook: route ทุกตัวเรียก genbookno API ผ่านไคลเอนต์ฝั่งเซิร์ฟเวอร์ตัวเดียว ลบ `mysql2` และ `ISSUANCE_DATABASE_URL` ออกจาก runtime ของแอป (เครื่องมือ migration ใน `tools/` ตัดสินใจแยก)
5. ปรับ launcher `dev:ronaldo` ให้เปิด `start:genbookno` (Core identity + genbookno) แทน `identity-server.js`
6. อัปเดต `docs/genbookno/README.md`, `docs/modules.md` (ronaldo) และ `docs/specs/ronaldo-auth.md`, README (genbook)

## Acceptance criteria

- [ ] genbook ไม่มี import `mysql2` หรือการอ่าน `ISSUANCE_DATABASE_URL` ใน `app/` และ `lib/`
- [ ] genbookno ต่อ `genbook_db` บน 127.0.0.1:3306 เท่านั้น และปฏิเสธ URL อื่น
- [ ] ออกเลขพร้อมกันหลายคำขอได้เลขไม่ซ้ำ มีเทสต์ concurrency ในโมดูล และ unique constraint ใน MySQL ยังอยู่
- [ ] ค้นหา/ประวัติ/รายละเอียด/PDF/แก้ไข/ออกเลขย้อนหลังทำงานผ่าน API ด้วยผลเดียวกับก่อนย้าย (เทสต์เดิมของ genbook ผ่าน)
- [ ] คำขอไม่มี secret ได้ 401, มี `Origin` ได้ 403, ค่า config ไม่ครบได้ 503
- [ ] audit history ของการออกเลขและการแก้ไขยังครบ
- [ ] lint, typecheck, test ของทั้งสอง repo ผ่านหรือรายงานความล้มเหลว

## ข้อจำกัด

- ไม่รัน migration ทำลายข้อมูล ไม่เขียน production ไม่ commit/push โดยไม่ได้รับอนุญาต
- ไม่กู้ `genbookno_db` กลับ เว้นแต่ผู้ใช้สั่ง
- ไม่คัดลอก credential ของ CENTRAL เข้า genbook
