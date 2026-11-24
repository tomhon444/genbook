# T12 — เติมชื่ออ้างอิงจากระบบเก่า

24 พฤศจิกายน 2569 (Asia/Bangkok) · [ชุดตรวจรับ AC2](t12-ac2-review.md)

ผู้ใช้ให้ใช้ชื่อจากแหล่งเดียวกับระบบเก่าและสั่งดำเนินการแล้ว รอบนี้เติมข้อมูลลงชุดตรวจรับใหม่ ไม่แก้ฐานที่เว็บใช้ ไม่เปิดสิทธิ์ และไม่อนุมัติ AC2/cutover เพิ่ม

## แหล่งชื่อที่ตรวจจากโค้ดเดิม

- ตัวเลือกชุดเลขและชื่อหนังสือที่ใช้ในหน้าขอเลขมาจาก `bookdept.book_number` โดยตรง (`application/controllers/genbook.php:719,728,1095`) จึงใช้ค่า `sourceCandidate.provenance.originalPrefix` ที่ผูก snapshot เดิม ไม่แทนด้วย `sub_dept` หรือ `alias_dept` ซึ่งเป็นบริบท/ชื่อเรียกที่แก้ได้
- ประเภทมาจาก `typebook.typebook` ผ่าน `bookdept.book_idbook → book.typebook_idtypebook`
- ชื่อหน่วยงานเต็มมาจาก `CENTRAL.DEPT.DEPT_NAME_TH` จับคู่ `DEPT_ID` (`application/models/central/dept_model.php:14`) คงรหัสหน่วยงานบนประวัติเดิม ไม่ใช้ชื่อปัจจุบันย้ายรหัสย้อนหลัง
- หน้าที่ตรวจใน `book`/`genbook` ตรวจ session `logged_in` ก่อนใช้งาน จึงไม่ถือว่ามีหน้าอ้างอิง HTTPS สาธารณะให้อ่านชื่อแทนการเชื่อมฐานได้โดยไม่เข้าสู่ระบบ

## ผลข้อมูลจริง

ตรวจหลักฐานต่อ 24 พฤศจิกายน 2569: [ผลข้อยกเว้นชื่อ/ประเภท](t12-reference-investigation.md) ยืนยันชื่อผิดปกติเป็น TAB ท้ายข้อความ และ 24 ชุดอ้าง parent ที่หาย 21 รหัส ยังไม่เปลี่ยน display name/prefix หรือรับรองประเภท

ชุดตั้งต้น: `.local/t12/ac2-d5f97eb2-7e321dd9/` Source SHA-256 `d5f97eb2131c0ba0d7eaee8659f9c9e02f87bf092092385c6dbd4b5181e2d6bb`

ชุดผลลัพธ์ใหม่: `.local/t12/reference-names-d5f97eb2-ded2a4ae/` ตรวจ hash ทั้ง 8 ไฟล์ของชุดตั้งต้นก่อนสร้างผลใหม่ ไม่เขียนทับชุดเก่า

| รายการ | ผล |
|---|---:|
| ชื่อชุดเลขที่เติมได้จากข้อความเดิม | 153 / 154 |
| ประเภทที่ผูกกับชุดเลขและเติมได้ | 130 / 154 |
| ชื่อประเภทจากตารางประเภทโดยตรง | 4 / 4 |
| ชื่อหน่วยงานเต็มที่ดึงได้ | 0 / 44; ยังไม่ได้ query ข้อมูลชื่อ |

ข้อยกเว้นจาก snapshot:

- ชุด `00069` มีอักขระควบคุมใน prefix/ข้อความชื่อเดิม จึงเก็บค่าต้นฉบับใน provenance แต่ไม่คัดลอกเป็น display name ที่ผ่านการตรวจ ไม่ลบอักขระหรือแก้ prefix ให้เอง
- 24 ชุดไม่มี parent reference ที่ใช้จับคู่ประเภทใน source จึงคงประเภทว่างและระบุข้อยกเว้น ไม่เดาประเภทจาก prefix หรือจากชุดข้างเคียง การมีชื่อประเภทครบ 4 รายการไม่ได้แปลว่าผูกประเภทได้ครบทุกชุด
- รายละเอียดรหัสและช่องที่มีปัญหาอยู่ใน `exceptions.json` และ `REFERENCES.md` ภายในชุดส่วนตัว

## ผลการเข้าถึง CENTRAL

รัน collector แบบอ่านอย่างเดียวและบังคับ TLS พร้อม certificate/hostname verification ผ่านสิทธิ์เครือข่ายแล้ว ได้ `HANDSHAKE_NO_SSL_SUPPORT` ก่อนอ่านชื่อ ไม่ retry แบบ plaintext และไม่ใช้ connector เก่าที่ไม่บังคับ TLS เป็นทางเลี่ยง ตามขอบเขต [ADR 0003](../adr/0003-live-central-and-genbook-cutover.md)

จึงสร้างผลส่วน local ด้วย:

```powershell
npm.cmd run migration:review:names -- .local/t12/ac2-d5f97eb2-7e321dd9 --offline --department-blocker TLS_NOT_AVAILABLE
```

`central-names.json` ระบุ `departmentCollection.status=not-collected` และเหตุผลเป็น operator-reported จาก probe แยก ไม่อ้างว่า query แล้วไม่พบ 44 หน่วยงาน ชื่อย่อที่มีใน snapshot ยังเป็นบริบท ไม่ถูกเปลี่ยนเป็นชื่อทางการ

เมื่อมีช่องทาง TLS ที่ใช้งานได้ ใช้:

```powershell
npm.cmd run migration:review:names -- .local/t12/ac2-d5f97eb2-7e321dd9 ../ronaldo-service
```

อ่านเฉพาะ `DEPT_ID, DEPT_NAME_TH, STATUS` ของรหัสที่ต้องใช้ พร้อมตรวจ engine และเวลารวบรวม ไม่อ่านข้อมูลบุคลากร/รหัสผ่านจากตาราง ไม่เปิดให้เลือก DB URL หรือ downgrade TLS หากต้องใช้ export แทน ต้องมีรหัส/ชื่อและหลักฐานแหล่งที่มาเพื่อผูกตรวจรับแยก

## ไฟล์และการตรวจสอบ

- `references.json`, `REFERENCES.md`: ชื่อที่เติมแล้วและช่องที่ยังค้าง ทุก decision ยัง pending/review null ไม่ใช่ config เปิดใช้งาน
- `exceptions.json`: ปัญหารายรหัส/รายช่อง ไม่ซ่อมหรือรวมรหัสเอง
- `central-names.json`: ขอบเขตการดึงชื่อและสถานะไม่ได้ query ในโหมด offline
- `summary.json`, `manifest.json`: ยอดรวม/hash ผลลัพธ์ 5 ไฟล์ และ hash ชุดตั้งต้น/สิทธิ์เดิมที่คงไว้
- เทสต์ names 7/7, remote-source 6/6 และ AC2 regression 5/5 รวม 18/18 ผ่าน
- Lint/typecheck ผ่าน และ QA อิสระตรวจ source binding/hash/ข้อยกเว้น/ขอบเขต offline

สิทธิ์เดิม 1,844 แถวไม่เปลี่ยน ไม่มี DB writes/grants ใหม่ `ac2Approved=false`, `productionReady=false` T12 คง 5/6 ชื่อหน่วยงานที่เหลือต้องใช้ช่องทางเข้ารหัสถึง CENTRAL หรือข้อมูล export ที่ตรวจแหล่งที่มาได้ ก่อนเติมให้ครบ
