# ระบบออกเลขหนังสือราชการ

Next.js App Router + TypeScript + CoreUI สำหรับบุคลากรภายในคณะวิศวกรรมศาสตร์ มหาวิทยาลัยสงขลานครินทร์

ฐาน local ที่ใช้งานปัจจุบันอยู่ที่ **127.0.0.1:3306**: `genbook_db` เก็บข้อมูลนำเข้าและไฟล์ BLOB, `genbookno_db` สำหรับ `ronaldo-service` และ `t05_synthetic` ของเครื่องมือเดิม ดู [การย้ายพอร์ตและวิธีย้อนกลับ](docs/specs/local-mysql-port3306.md) โหมดบัญชีจำลองด้านล่างใช้ฐานทดสอบแยกต่างหาก

## ทดลองระบบ local ในเครื่อง

เชื่อมการยืนยันตัวตนผ่าน Core CENTRAL ของ `ronaldo-service` ได้แล้ว ดู [การตั้งค่าและวิธีทดลองสองโปรเจกต์](docs/specs/ronaldo-auth.md) ใช้ `npm.cmd run dev:ronaldo:demo` เพื่อทดลองด้วยบัญชีจำลอง หรือ `npm.cmd run dev:ronaldo` เพื่อเรียก service ที่ตั้งค่าไว้

```powershell
npm.cmd ci
npm.cmd run dev:local
```

เปิด **http://127.0.0.1:3000/login** และอ่านบัญชีจำลองที่สร้างใหม่แต่ละครั้งจาก `.local/t04-account.json` (ไม่อยู่ใน Git) ใช้ URL นี้โดยตรง การตรวจ Origin ไม่รับ `localhost` หรือชื่อเครื่องแทน

หากเว็บบัญชีคณะใช้ 3000 และบริการกลางใช้ 3001 อยู่แล้ว เปิดเว็บจำลองแยกด้วย PowerShell: `$env:LOCAL_WEB_PORT='3002'; $env:NEXT_TEST_DIST='t04'; npm.cmd run dev:local` แล้วเข้า **http://127.0.0.1:3002/login** การตั้ง `NEXT_TEST_DIST=t04` แยก dev output จากเว็บหลัก ห้ามใช้ output นี้พร้อม E2E T04 บัญชีจำลองใช้ฐานใหม่ที่ 3315 ไม่โหลดประวัติหรือตัวนับจริง และสร้างรหัสผ่านใหม่ทุกครั้งที่เปิด

เข้าสู่ระบบแล้วจะเห็นหน้าหลัก `/workspace` รวมค้นหาและประวัติหนังสือ เมนูด้านบนมีหน้าหลักและหน้าออกเลขเอกสาร (`/workspace/issuance`) ฟอร์มเรียงช่องตามระบบเดิมและเลือกชุดเลขตามสิทธิ์บัญชี ดู [ข้อสรุปหน้าทำงาน](docs/specs/workspace-legacy-layout.md) ระบบ local ใช้ MySQL 8 แยกใหม่บนพอร์ต 3315 พร้อมข้อมูลสังเคราะห์ ไม่เชื่อมฐานหนังสือเดิมหรือบริการบัญชีคณะ ดู [คู่มือ T05](docs/specs/local-normal-issuance.md) สำหรับการติดตั้ง MySQL และ [คู่มือ PDF T07](docs/specs/local-pdf-attachments.md) สำหรับการจัดเก็บและกู้คืนไฟล์

การขอเลขย้อนหลัง T10 เลือกวันที่และต้นทางจากหน้าขอเลข ระบบคงปี/วันที่/เลขหลักเดิมและเพิ่มเลขย่อย ดู [คู่มือ T10](docs/specs/local-backdated-issuance.md) สำหรับกติกา การส่งซ้ำ และ schema ตัวนับเลขย่อย

ค้นหาหนังสือ T08 ใน workspace ด้วยปีเลข พ.ศ. ประเภท เลข ช่วงวันที่หนังสือ เรื่อง และรหัสผู้ขอเลข รวมประวัติเดิมที่ตรวจรับแล้ว ผลและยอดรวมกรองตามสิทธิ์บน server ดู [คู่มือ T08](docs/specs/local-document-search.md)

เจ้าของแก้ข้อมูลหนังสือ T09 จากหน้ารายละเอียดหรือผลค้นหาได้ พร้อมประวัติก่อน–หลัง ผู้แก้ และเวลาไทย ใช้ version ร่วมกับ PDF เพื่อป้องกันเขียนทับการแก้จากอีกแท็บ ดู [คู่มือ T09](docs/specs/local-document-amendments.md)

รายละเอียด session ขอบเขต local และผลตรวจอยู่ใน [คู่มือ T04](docs/specs/local-sign-in.md) และ [ticket](docs/tickets/Done-04-sign-in.md)

## ตรวจสอบ

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:auth
npm.cmd run test:issuance
npm.cmd run test:migration
npx.cmd playwright install chromium
npm.cmd run test:e2e
npm.cmd run build
npm.cmd run test:production-auth
```

E2E เปิด Next.js บน loopback พอร์ต 3104 (T04), 3106 (T05/T06), 3108 (T12), 3109 (T07), 3110 (T10/การเก็บข้อมูลเดิม), 3111 (T08) และ 3112 (T09) พร้อมบริการบัญชีจำลองและ MySQL แยกโดยอัตโนมัติ ตรวจ production ใช้พอร์ต 3105 หลัง build ห้ามรัน E2E หลายชุดพร้อมกัน ภาพและ log อยู่ใน `.local/` ส่วน trace เมื่อผิดพลาดอยู่ใน `test-results/` ใช้เฉพาะข้อมูลสังเคราะห์

T12 มีหน้าอ่านประวัติเดิมใน workspace และเครื่องมือซ้อม staging/promotion จาก snapshot ที่อนุมัติ ดู [คู่มือ T12](docs/specs/local-legacy-migration.md) รอบรับรอง 20 พฤศจิกายน 2569 ซ้อมประวัติจริง 170,257 รายการ/เก็บแยก 1,874 และพื้นตัวนับ 490 ชุด/ปี ผ่าน rollback/replay แล้ว รอบ 23 พฤศจิกายนพิสูจน์ HTTP/หน้าอ่านจริงและเดินเลขต่อผ่านคำขอพร้อมกัน/ส่งซ้ำในฐานซ้อมใหม่สำเร็จ คืน gate/สิทธิ์และลบฐานซ้อมครบ ไม่เปลี่ยนฐานที่เว็บใช้หรือเปิดออกเลขจริง T12 ผ่าน 5/6 เหลือ AC2 ดู [ผลตรวจและข้อค้างล่าสุด](docs/specs/t12-http-rehearsal.md)

แนวทางเก็บข้อมูลที่กู้ไม่ได้และกันเลขเดิมได้รับการยืนยันแล้ว ใช้ `npm.cmd run migration:preserve -- <snapshot.sql.gz>` เพื่อซ้อมใน MySQL ใหม่ที่แยกจากระบบเดิม ดู [คู่มือ preservation](docs/specs/local-legacy-preservation.md) คำสั่งนี้ปิดการออกเลขในฐานซ้อม เก็บ raw/disposition/reservations และตรวจ replay โดยไม่เปิดข้อมูลจริงในหน้าอ่านหรือ seed counter อัตโนมัติ

T12 มี `npm.cmd run migration:check -- <snapshot.sql.gz>` สำหรับสร้างแบบ mapping ที่ยังไม่อนุมัติและรายงานข้อค้างเฉพาะเครื่อง เมื่อ mapping/target references ผ่าน จึงใช้ `migration:promote:rehearse` ซ้อม preservation → promotion → rollback/replay ในฐานใหม่ที่ลบทิ้งหลังจบ ดู [คู่มือ promotion T12](docs/specs/local-legacy-promotion.md) คำสั่ง promotion นี้ไม่เปิด gate และไม่รับ DB production URL

สำหรับ AC4 ใช้ `npm.cmd run migration:http:rehearse -- <snapshot.sql.gz> <reviewed-mapping.json> <reviewed-targets.json>` เพื่อซ้อม HTTP/หน้าอ่านประวัติจริงใน MySQL ใหม่พอร์ต 3333 และเว็บ 3115 พร้อมบัญชีจำลอง การเปิด gate/grants ชั่วคราวเพื่อทดสอบเลขต่อและคำขอพร้อมกันจำกัดอยู่ในฐานซ้อม แล้วคืน gate/ปิดสิทธิ์และลบฐานก่อนจบ ไม่รับรองบัญชีหรือสิทธิ์จริงตาม AC2 ดู [ขั้นตอนและข้อจำกัด](docs/specs/local-legacy-promotion.md#ซ้อม-http-และหน้าอ่านกับ-snapshot-ที่รับรอง-ac4)

ขั้น AC2 มี `npm.cmd run migration:review:ac2 -- <snapshot.sql.gz> <approved-mapping.json> <reviewed-targets.json> <CENTRAL-evidence-directory>` สำหรับสร้างตารางชื่อ/สิทธิ์/inventory/เวลาและรายการตรวจรับแบบ offline ในโฟลเดอร์ใหม่ ไม่เขียน DB หรือเปิด grants รองรับ `--time-display-approval <receipt.json>` เฉพาะคำรับรองการแสดงข้อความเวลาเดิมที่ผูก source/mapping โดยไม่ยืนยัน timezone จริง ดู [ผลเตรียมตรวจรับและข้อค้าง AC2](docs/specs/t12-ac2-review.md)

เติมชื่อในตารางตรวจรับด้วย `npm.cmd run migration:review:names -- <ac2-packet-directory> <ronaldo-service-root>` โดยดึงชื่อหน่วยงานผ่าน TLS แบบอ่านอย่างเดียว หรือใช้ `<ac2-packet-directory> --offline` เพื่อเติมเฉพาะข้อความจาก snapshot ทุกครั้งสร้างชุดใหม่และคงสิทธิ์เดิมไว้ ผล 24 พฤศจิกายนเติมชื่อชุดเลข 153/154 และชื่อประเภท 4/4 แยกข้อยกเว้น/ชื่อหน่วยงานที่ยังติด TLS ไว้ใน [ผลเติมชื่อระบบเก่า](docs/specs/t12-reference-names.md)

`npm.cmd run dev` ปกติไม่เปิดบัญชีจำลอง; production ปฏิเสธ local adapter config และยังไม่เปิดให้เข้าสู่ระบบจนกว่าจะผ่าน [T13](docs/tickets/13-faculty-identity-release-gate.md)
