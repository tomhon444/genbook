# ADR 0004 — genbook เป็น Client, ronaldo-service (genbookno) เป็น API, ฐานข้อมูลอยู่หลัง API

วันที่: 24 พฤศจิกายน 2026 (Asia/Bangkok)

สถานะ: ผู้ใช้กำหนดในบทสนทนา

## โครงสร้าง

```
Client (genbook)  >  API Service (ronaldo-service โมดูล genbookno)  >  database (genbook_db)
                  >  ronaldo-service Core identity                  >  CENTRAL (อ่านอย่างเดียว)
```

| ชั้น | โปรเจค / ตำแหน่ง | หน้าที่ |
|---|---|---|
| Client | `genbook` (Next.js) | หน้าจอ, Route Handler, ไคลเอนต์ฝั่งเซิร์ฟเวอร์ที่เรียก API ไม่ต่อฐานข้อมูลเอง |
| API Service | `ronaldo-service/src/modules/genbookno` (`/api/v1/genbookno/*`) | ตรรกะข้อมูลหนังสือ ออกเลข แก้ไข ประวัติ ค้นหา PDF ตรวจสิทธิ์ และติดต่อฐานข้อมูล |
| Login | `ronaldo-service/src/core/identity` (`/api/v1/identity/*`) | ตรวจ username/password กับ CENTRAL เป็นโมดูลกลางที่ใช้กับทุกระบบ |
| Database | `genbook_db` (MySQL) | เก็บข้อมูล เข้าถึงได้จาก ronaldo-service เท่านั้น |

## ข้อตัดสินใจ

- ผู้ใช้กำหนด: "ส่วนที่ติดต่อ database มันควรอยู๋ใน ronaldo-service", "ส่วน login ด้วย username/password ใน ronaldo-service มีโมดูลกลางที่ใช้กับทุกระบบได้อยู่ หันไปใช้ตัวนี้แทน" และ "ในโปรเจค ronaldo-service มีโมดูลที่ใช้สำหรับเชื่อมต่อกับโปรเจค genbook อยู๋แล้ว ชื่อโมดูล genbookno"
- ห้ามเพิ่มโค้ดต่อฐานข้อมูล (`mysql2`, connection URL, SQL) หรือโค้ดตรวจรหัสผ่าน/CENTRAL ใน genbook
- ฟีเจอร์ข้อมูลใหม่ต้องสร้าง endpoint ในโมดูล genbookno ก่อน แล้วให้ genbook เรียกผ่าน API
- secret ระหว่าง genbook กับ ronaldo-service อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น ห้ามใช้ `NEXT_PUBLIC_`

## สถานะปัจจุบัน (ช่วงเปลี่ยนผ่าน)

- Login: genbook ใช้ Core identity แล้ว
- ข้อมูลหนังสือ: `lib/issuance/*` ของ genbook ยังต่อ `genbook_db` โดยตรงผ่าน `ISSUANCE_DATABASE_URL` เป็นโค้ดเดิมที่ต้องย้ายตาม [T14](../tickets/14-genbookno-data-api.md) ระหว่างนี้ห้ามขยายโค้ดส่วนนี้เพิ่ม
- เครื่องมือ migration ใน `tools/` จะตัดสินใจแยกใน T14
