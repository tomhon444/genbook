# ระบบออกเลขหนังสือราชการ

Next.js App Router + TypeScript + CoreUI สำหรับบุคลากรภายในคณะวิศวกรรมศาสตร์ มหาวิทยาลัยสงขลานครินทร์

## โครงสร้างระบบ (อ่านก่อนพัฒนา)

```
Client (genbook)  >  API Service (ronaldo-service โมดูล genbookno)  >  database (genbook_db)
```

- **genbook** เป็น Client เท่านั้น ไม่ต่อฐานข้อมูลเอง
- **ronaldo-service โมดูล `genbookno`** (`src/modules/genbookno`, `/api/v1/genbookno/*`) เป็นที่เดียวที่ติดต่อฐานข้อมูล
- **Login ด้วย username/password** ใช้ Core identity ของ ronaldo-service (`/api/v1/identity/*`) ซึ่งเป็นโมดูลกลางที่ใช้กับทุกระบบ
- ข้อมูลหนังสืออยู่ใน `genbookno_db` และเรียกผ่าน `lib/genbookno/client.ts` ไปที่ ronaldo-service เท่านั้น (ตั้ง `RONALDO_SERVICE_URL` และ `GENBOOKNO_API_SECRET` ฝั่งเซิร์ฟเวอร์) ดู [T15](docs/tickets/15-genbookno-db-consolidation.md) ห้ามเพิ่มโค้ดต่อฐานข้อมูลใน genbook ดูเหตุผลใน [ADR 0004](docs/adr/0004-client-api-database-layers.md)

ไม่มี server หรือฐานข้อมูลจำลองใน genbook อีกแล้ว ทุกการเชื่อมต่อ (login และข้อมูล) ผ่าน ronaldo-service ที่ตั้งค่าใน `RONALDO_SERVICE_URL`/`RONALDO_IDENTITY_SECRET`

## รันในเครื่อง

เปิด ronaldo-service ก่อน แล้วรัน (ดู [การตั้งค่า](docs/specs/ronaldo-auth.md))

```powershell
npm.cmd ci
npm.cmd run dev:ronaldo
```

เปิด **http://127.0.0.1:3000/login** (ใช้ URL นี้โดยตรง การตรวจ Origin ไม่รับ `localhost`)

## ตรวจสอบ

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:auth:ronaldo
npm.cmd run build
```

production ยังไม่เปิดให้เข้าสู่ระบบจนกว่าจะผ่าน [T13](docs/tickets/13-faculty-identity-release-gate.md)
