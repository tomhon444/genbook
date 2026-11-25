# ข้อมูลอ้างอิงระบบเดิมในเว็บทดลอง

วันที่: 16 พฤศจิกายน 2026 (Asia/Bangkok)

ใช้ไฟล์สำรอง GenBookno_DB ชุด SHA `78629b14b7fcc8309aea012ae145fbae6dfde3a4d48a1b07fad9e0fb97411c82` อ่านผ่าน parser เดิม ไม่เชื่อม CENTRAL หรือฐานเก่า ไม่ import ประวัติ เจ้าของบุคลากร สิทธิ์เดิม หรือตัวนับเปิดจริง

## สิ่งที่ใส่ให้แล้ว

- อ่าน `book`, `bookdept`, `typebook` เก็บรหัสชุดเลข คำนำหน้า ชื่อกลุ่ม/alias และประเภทตามต้นฉบับ
- ตรวจ 155 ชุด ให้บัญชี `LOCAL-001` ทดลองเลือก 72 ชุดที่ parent ยัง active, reference/type/prefix ครบ และมีกติกาปีรองรับ อีก 83 ชุดไม่เปิดเลือก รวมชุดพัก 00047
- ชุดที่ไม่ทราบกติกาปี 1 ชุดอยู่ใน catalog/report เท่านั้น ไม่เติมค่า calendar แทนเพื่อ insert ให้ผ่าน enum จึงมีรายการ source ที่เก็บลงตาราง local 154 ชุด
- แสดงรหัสหน่วยงานเดี่ยวที่พบ 35 รหัสเป็น `รหัสหน่วยงาน <ID>` ไม่ใช้ wildcard หรือรหัสรวมอย่าง `*,202` เป็นหน่วยงาน ไม่ใช้ alias ของกลุ่มงานเป็นชื่อทางการโดยอัตโนมัติ alias เก็บพร้อม provenance ในรายงานเฉพาะเครื่อง
- ชื่อหน่วยงานทางการจาก `CENTRAL.DEPT` และตำแหน่งจาก `CENTRAL.POSITION` ยังรอช่องทางเชื่อมตาม ADR 0003 ช่องผู้ลงนามยังกรอกข้อความได้ตามเดิม ไม่คัดลอก archive `endorser_tb` มาอ้างเป็นรายการตำแหน่งปัจจุบัน เพราะ static source ปัจจุบันไม่ใช้ตารางนั้น

## วิธีทดลอง

เว็บ `http://127.0.0.1:3000/workspace` ที่เปิดอยู่ได้รับ catalog แล้ว กด refresh เพื่อโหลดตัวเลือกใหม่ ไม่ได้ restart หรือล้างข้อมูลทดลองที่ผู้ใช้ทำไว้ และไม่เปลี่ยนรหัสผ่าน/session เดิม

`npm.cmd run dev:local` ครั้งถัดไปจะใช้ source จาก `.local/t12-persistent/legacy-78629b14/source.sql.gz` เมื่อมีไฟล์ หรือกำหนด `LOCAL_REFERENCE_SNAPSHOT` ให้ชี้ไฟล์ local ที่ต้องการได้ ถ้าไม่ได้กำหนดและไม่มีไฟล์ จะใช้ข้อมูลจำลองเดิม ถ้าระบุ source เองแต่ไฟล์ผิด/อ่านไม่ได้ ต้องหยุด ไม่แอบสลับ source

เมื่อ runner สร้างฐานใหม่ จะเก็บ settings เฉพาะ preview ใน `.local/preview-database.json` แยกจากไฟล์ที่ชุดทดสอบอาจเขียนทับ สามารถเติม catalog ให้เว็บทดลองที่กำลังเปิดอยู่ด้วย `npm.cmd run dev:references` ได้ คำสั่งยอมรับเฉพาะ loopback port 3315, user `genbook_test_app`, schema `genbook_test` และ gate open ที่ไม่มีประวัติย้าย/เลขกันไว้เท่านั้น ไม่รับ remote URL หรือฐาน actual preservation

อัปเดต catalog ใน transaction เดียวโดย share-lock gate และให้ update ตารางที่มีสิทธิ์อยู่แล้ว ไม่เพิ่มสิทธิ์เปิด gate ปิดรายการจำลองเก่าแต่ไม่ลบเอกสาร/ตัวนับ และไม่ seed จากเลขประวัติจริง grants ทดลองที่เปิดให้มีเฉพาะ LOCAL-001 ไม่ใช่สิทธิ์บุคลากรจริง เก็บ catalog/ผลนำเข้าใน `.local/legacy-reference-preview.json` ซึ่ง Git ไม่ติดตาม

## ผลตรวจ

- `npm.cmd run test:references`: 6/6 ผ่าน รวม pure reference validation, duplicate ID, parent/reference/year ที่ไม่พร้อม, null-year skip, grants เฉพาะ demo, ไม่ย้อน counter, replay, closed gate, rollback และปฏิเสธ remote
- Browser smoke บนเว็บที่เปิดจริงในเครื่อง: login ด้วยบัญชีทดลอง เลือกชุดเลขได้ 72 ชุด/ตัวเลือกหน่วยงาน 35 รหัส ไม่มีชุดทดสอบเดิมในเมนู ภาพเฉพาะเครื่อง `.local/legacy-reference-preview.png`
- lint/typecheck ผ่าน; QA ตรวจแก้ปีที่ไม่ทราบและ gate privilege แล้ว

นี่เป็นข้อมูลอ้างอิงสำหรับ preview เท่านั้น ไม่เปลี่ยนสถานะตรวจรับ mapping หรือ T12/T13 และไม่ใช่การอนุมัติใช้เลขเหล่านี้ใน production
