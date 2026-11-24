# T12 — คิว mapping และรายละเอียดประวัติเดิม

วันที่: 16 พฤศจิกายน 2026 (Asia/Bangkok)

## สิ่งที่เพิ่ม

ทำคิวตรวจ mapping ที่ผูกกับ SHA/fingerprint ของ snapshot และ mapping ที่ส่งมา คิวรวมผลกระทบตามเจ้าของ หน่วยงาน ณ วันออก ชุดเลข และผู้ทำรายการเดิม แยกจำนวนเก็บแยก/ข้อมูลไม่ผ่าน/รอ mapping/ผ่านเงื่อนไขรายแถว พร้อม reference ที่เกี่ยวข้องและ source ID ตัวอย่าง ไม่มีการใส่ target หรือคำรับรองแทนผู้ตรวจ ไม่ใช้เจ้าของประวัติเป็นสิทธิ์ออกเลข

ผลที่ผ่านรายแถวยังไม่ใช่ความพร้อม promotion ทั้งชุด ต้องผ่าน manifest/นโยบายและ mapping ที่กำหนดทั้งหมด สร้าง packet ใหม่ทุกครั้ง ไม่ทับไฟล์ที่กรอกไว้ และพิมพ์เฉพาะยอดรวม/แฮช/ชื่อโฟลเดอร์ทาง console รหัสบุคคลอยู่เฉพาะไฟล์ที่ Git ไม่ติดตาม ไม่ต้อง dump CENTRAL: ตรวจเฉพาะรหัสจำเป็นผ่านช่องทางที่ได้รับอนุญาตเมื่อพร้อมตาม ADR 0003

```powershell
npm.cmd run migration:workbench -- .local/t12-persistent/legacy-78629b14/source.sql.gz
npm.cmd run migration:workbench -- <snapshot.sql.gz> <mapping.json ที่กำลังตรวจ>
npm.cmd run migration:check -- <snapshot.sql.gz> <mapping.json ที่ตรวจแล้ว>
```

packet มี `README.md` สำหรับอ่านตาราง, `queue.json` สำหรับ reference/เหตุผลค้าง และ `mapping.json` ที่เก็บผลตัดสินเดิมครบ การสร้างคิวไม่มีคำสั่งเชื่อม DB, promote, เพิ่ม grants หรือเปิด gate

## ผลจาก snapshot จริง

สร้าง packet ล่าสุดที่ `.local/t12/workbench-78629b14-21d91676/` จาก compressed source SHA `78629b14b7fcc8309aea012ae145fbae6dfde3a4d48a1b07fad9e0fb97411c82`

| สถานะหนังสือ | จำนวน |
|---|---:|
| เก็บแยกตามข้อมูลผิดปกติเดิม | 6 |
| เรื่องว่าง ต้องตรวจวิธีจัดการ | 1,845 |
| รอ mapping | 169,655 |
| พร้อมตามเงื่อนไขรายแถว | 0 |
| รวม | 171,506 |

คิวเจ้าของ 322 กลุ่ม หน่วยงาน 46 กลุ่ม ชุดที่ถูกอ้างในหนังสือ 112 กลุ่ม และผู้ทำรายการเดิม 313 กลุ่ม แต่ละคิวกระทบยอดครบ 171,506 รายการ ตัวเลขรวมกลุ่ม NULL/ว่าง ไม่ใช่จำนวนบัญชี/หน่วยงานที่รับรองแล้ว มีอีก 45 reference ชุดที่ไม่มีหนังสืออ้างใน snapshot ให้พิจารณา ไม่อนุมานว่ายังเปิดใช้งาน

พบ reference ผู้ทำรายการต่างจากผู้ขอ 2,716 รายการเมื่อทั้งสองค่าไม่ว่าง และผู้ทำรายการว่าง/ไม่มี 1,351 รายการ เก็บแยกประเด็นนี้จาก missing owner เพื่อไม่ใช้ actor แทน owner โดยอัตโนมัติ

manifest review ยังว่าง นโยบายยัง pending เงื่อนไขค้างรวม 2,374 ข้อ `readyForLocalPromotion=false`, `productionReady=false` ข้อมูลจริงในฐานถาวรยังมีเฉพาะ raw/reservations ประวัติจริงในแอปยังเป็น 0 ไม่มีการเชื่อม CENTRAL หรือฐานเดิม

## หน้าอ่านประวัติและ metadata

เพิ่มตาราง `legacy_document_details` สำหรับข้อมูลที่ derive จากต้นฉบับโดยตรง ผูก FK กับ normalized history แต่ละ snapshot/source ID และอยู่ใน transaction เดียวกับ history/counters/links/registry การ replay เปรียบเทียบทุกฟิลด์และ fingerprint รวมรายละเอียด หากขาด/เปลี่ยน metadata ต้องหยุด ไม่ certify ว่าผ่าน

รายละเอียดประกอบด้วยผู้รับ (`genbook_inform`), ปลายทาง (`genbook_dept`: 1=รหัสหน่วยงานภายใน, 2=ข้อความภายนอก, อื่น=ไม่ทราบ), ผู้ลงนาม (1=ตำแหน่ง, 2=บุคลากร, อื่น=ไม่ทราบ), actor และข้อความเวลาเดิม เรียง child ตาม numeric source ID อย่างคงที่ ไม่อ้างว่ามีลำดับอื่นที่ source ไม่บันทึก

ยังไม่ lookup ชื่อจากรหัสที่ไม่ยืนยัน ไม่แปลงเวลาเดิมเป็น UTC/Asia-Bangkok หรือเติมเวลาที่ขาด สถานะไฟล์เป็นยังไม่ตรวจย้าย ไม่มี URL/path ของไฟล์เดิมส่งให้ client ไม่มี raw payload/รหัสผ่าน/เหตุผลยกเลิกใน detail API

API ตรวจสิทธิ์ parent ก่อนโหลด metadata รายการค้นหาคืนเฉพาะ metadata ขั้นต่ำ หนังสือลับแม้เผยแพร่ยังอ่านได้เฉพาะเจ้าของ หน้าเว็บแสดงอ่านอย่างเดียวและรองรับข้อมูลรุ่นก่อนที่ยังไม่มี metadata row ล้างข้อมูลเก่าเมื่อ session ถูกปฏิเสธหรือเปลี่ยนคำค้น และยกเลิก response ที่ล้าสมัย

schema/grant ใหม่ใช้กับฐานที่สร้างใหม่ รอบนี้ไม่ ALTER ฐาน actual-preservation ที่เก็บไว้ ไม่ promote ข้อมูลจริง ก่อนใช้กับฐานรุ่นก่อนต้องเตรียม schema ใหม่อย่างควบคุม (เช่น recover ไปชื่อใหม่จากต้นฉบับที่ตรวจ SHA) และตรวจ mapping ให้ครบ รุ่น dev จำลองที่เปิดค้างต้อง restart เพื่อรับ schema ใหม่

## การตรวจสอบ

- Workbench 6/6: ตรวจ source binding, ยอดทุกกลุ่ม, แยก actor/owner/ค่าหาย, global/unused mapping blockers, escaping และ CLI ไม่ทับคำรับรองเดิม/ไม่พิมพ์ reference บุคคล
- Migration 40/40: รวม derive metadata, projection กัน raw/path, authorization ก่อนโหลดรายละเอียด, sidecar rollback, replay และตรวจการแก้ metadata ผิดจาก source
- Persistent local 3/3: preservation/restart/recovery และสิทธิ์บัญชีอ่านยังผ่านกับ schema ใหม่
- Targeted browser/HTTP **11/11** ผ่าน ตรวจรายละเอียด สิทธิ์หนังสือลับ/เผยแพร่ การตัด response เก่า การหมด session และ compatibility ของ history เดิม ตรวจภาพมือถือ 390px แล้วข้อความไม่ล้นแนวนอน
- lint/typecheck ผ่าน QA อิสระไม่พบ Critical/High/Medium ในขอบเขตที่ตรวจ

ชุดทดสอบ MySQL ที่ใช้ไฟล์ตั้งค่าจำลองร่วมกันให้รันเรียงลำดับ ปรับ script migration เป็น `--test-concurrency=1` และไม่เปิดชุด persistent กับชุด bootstrap อื่นพร้อมกัน ไม่ใช้ผลทดสอบจำลองเป็นหลักฐาน mapping CENTRAL หรือการตรวจรับ production

## ยังเหลือ

ยืนยัน mapping ตัวตน/หน่วยงานจาก CENTRAL, ตรวจรับชุดเลข/นโยบาย/เรื่องว่าง, ตรวจไฟล์จริงและข้อมูลรอบสุดท้าย และ cutover ตาม T12/T13 คงเกณฑ์ T12 **3/6** ไม่กรอกคำรับรองแทนเจ้าของและไม่เปิดประวัติจริงก่อน mapping ผ่าน
