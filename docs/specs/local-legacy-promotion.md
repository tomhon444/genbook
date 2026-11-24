# T12 — ตรวจ mapping และซ้อมนำประวัติจาก preservation

พัฒนา 13 พฤศจิกายน 2026 (Asia/Bangkok) ต่อจาก preservation ตาม ADR 0001 รองรับประวัติ metadata ขั้นต่ำในฐานซ้อมใหม่ ไม่ใช่เครื่องมือ production และไม่ใช่การตรวจรับ mapping ข้อมูลจริง

## สิ่งที่เพิ่ม

- สร้างแบบตรวจรับ JSON จาก snapshot โดยไม่เดา target ID หรือกรอกผู้รับรอง ตรวจ source SHA และ fingerprint ทุกตารางก่อนสร้างแผน
- บังคับการตัดสินใจ map/hold/pending พร้อมผู้ตรวจ วันที่ และหลักฐานสำหรับเจ้าของ หน่วยงาน และชุดเลข รวม review ระดับไฟล์และนโยบายเลขย่อย/เลขซ้ำ/prefix/วันที่/PDF
- สร้างข้อมูลหนังสือจากต้นฉบับโดยตรง ไม่รับสำเนาเรื่อง/เลข/flags ที่แก้จากภายนอก ไม่เปลี่ยน raw ไม่ renumber/dedupe
- เพิ่ม `legacy_promotions` แยก hash mapping/แผนจาก `legacy_batches` ซึ่งยังเก็บ digest ต้นฉบับ จึงซ้อม promotion หลัง preservation ในฐานเดียวกันได้
- ตรวจต้นฉบับ/ข้อมูลกันเลข/disposition ทุกฟิลด์ แล้วนำ history/counters/links/registry เข้า transaction เดียวกันภายใต้ gate ที่ปิดอยู่ dry-run rollback เป็นค่าเริ่มต้น replay ตรวจข้อมูลและ floor ซ้ำ ไม่ซ่อมข้อมูลที่เปลี่ยนเงียบ ๆ
- ตัวนับใช้เลขสูงสุดจาก reservation ทุก source ID ในชุดที่ mapping ผ่าน รวมแถวลับ ยกเลิก หรือเก็บแยก ไม่ใช้เฉพาะจำนวนหนังสือที่เปิดอ่าน
- ไม่เปิดชุดเลข ไม่เพิ่ม grant ไม่เปิด gate ทุก PDF ที่ยังไม่ตรวจจริงยังถือว่าไม่ยืนยัน: หนังสือไม่ลับ/ไม่ยกเลิกค้าง PDF และ block เจ้าของตามกฎเดิม

## ผลตรวจ snapshot จริงรอบนี้

อ่านไฟล์เดิมที่ได้รับอนุญาต SHA-256 `78629b14b7fcc8309aea012ae145fbae6dfde3a4d48a1b07fad9e0fb97411c82` โดยไม่เชื่อม DB หรือส่งข้อมูลขึ้นแอป ผลอยู่เฉพาะเครื่องใน `.local/t12/mapping-78629b14-c361d059/`:

| รายการ | จำนวน |
|---|---:|
| Raw 6 ตาราง | 383,338 แถว |
| หนังสือ / reservation ต้นทาง | 171,506 |
| หนังสือที่เก็บแยกตาม disposition เดิม | 6 |
| เรื่องว่าง ไม่ผ่านเงื่อนไข metadata ของ importer ใหม่ | 1,845 |
| ที่เหลือรอ mapping | 169,655 |
| ประวัติจริงที่นำเข้าแอป | 0 |
| กลุ่มเลขซ้ำที่ยังรักษา source IDs แยก | 1,308 |
| ข้อค้าง review/mapping | 529 |
| ข้อค้างรวมเรื่องว่าง | 2,374 |

6 + 1,845 + 169,655 = 171,506 ครบ ไม่ลบแถวใด ทั้ง 171,506 เลขยังอยู่ในฐานกระทบยอด reservation เดิม ชุดร่างนี้มี 157 namespace ชุด (155 reference + 2 ชุดที่ reference หาย), 321 รหัสผู้ขอที่ไม่ว่าง และ 45 รหัสหน่วยงานที่ไม่ว่าง ตัวเลขต่างจากตาราง Markdown เดิมซึ่งนับกลุ่ม NULL/ว่างด้วย ไม่ใช่บัญชีคณะที่รับรองแล้ว

เรื่องว่างเป็นข้อเท็จจริง ไม่สรุปว่าเป็นหนังสือเสียหรือเลขว่างที่จงใจจองไว้ ไม่เติมชื่อเรื่องแทนหรือใช้ lastupdate แทนเวลา การเปิดประวัติกลุ่มนี้ต้องรับรองวิธีรักษา/แสดงค่าว่าง หรือ hold ราย source ID พร้อมหลักฐานก่อน ข้อมูลที่ผ่านการตรวจ metadata ไม่พบวันที่ผิดเพิ่ม แต่แถว restricted เดิมยังมีวันที่ขาดตามรายงานก่อนหน้า

ผู้ใช้ตอบในรอบนี้ว่ายังไม่ทราบว่าบัญชีคณะจะใช้รหัสเดิมหรือไม่ จึงไม่แปลงรหัสเดิมเป็น staffId/departmentId ที่ได้รับความเชื่อถือแทน T13 ไม่อนุมัติ mapping หรือ target references ในนามผู้ใช้

## สร้างแบบและตรวจความพร้อม (อ่านอย่างเดียว)

```powershell
npm.cmd run migration:check -- C:/Users/dench/Desktop/GenBookno_DB.sql.gz
npm.cmd run migration:check -- <snapshot.sql.gz> <reviewed-mapping.json>
```

ทุกครั้งสร้างโฟลเดอร์ใหม่ใต้ `.local/t12/` มี `mapping.json`, `readiness.json`, `README.md` ไม่ทับไฟล์ที่กรอกแล้ว ไม่แก้ชุด review Markdown เดิม และไม่เชื่อม DB Stdout แสดงเฉพาะยอด/hash/เส้นทาง ไม่แสดงรหัสบุคคลหรือเนื้อหาหนังสือ รายละเอียด source ID อยู่ในเครื่องเท่านั้น

review ใช้ `{ "by": "ผู้ตรวจ", "at": "YYYY-MM-DD", "evidence": "หลักฐานการรับรอง" }` ซึ่งต้องเป็นการรับรองจริงจากผู้มีหน้าที่ เครื่องมือตรวจความครบถ้วน ไม่พิสูจน์อำนาจของผู้ลงชื่อแทนองค์กร:

- ทุก source mapping ต้องมี decision เป็น `map` หรือ `hold` พร้อม review; `pending` หรือช่องว่างไม่ผ่าน
- map ต้องมี targetId ชัดเจนและ 1:1 ไม่รวมเจ้าของ/หน่วยงาน/ชุดด้วยความคล้ายชื่อ หรือเพียงเพราะรหัสเหมือนกัน
- series เก็บ sourcePrefix ตรงต้นฉบับ ใช้ yearBasis ตาม T01 (`00006=document_date`, `y` อื่นเป็น `calendar`) ชุดที่ไม่มี reference/prefix/ปี หรือใช้ fiscal ที่แอปยังไม่รองรับ ต้อง hold
- hold ต้องไม่กำหนด targetId/yearBasis สร้าง hold รายหนังสือเพิ่มได้ใน `holds` พร้อม sourceId/review; เลขยังรวมใน reservation floor
- นโยบายห้าข้อใน README ของชุดร่างต้องได้รับการตรวจรับ ไม่ถือว่าการสร้างไฟล์เป็นการอนุมัติ NULL เลขย่อยหรือ prefix ประวัติ
- การตรวจ metadata ทำก่อนรอ identity mapping เพื่อให้เห็นเรื่องว่าง/ยาวเกิน/วันที่ผิดทันที แถว restricted หรือ hold ที่รับรองแล้วไม่ถูกเปลี่ยนข้อมูลเพื่อผ่านเกณฑ์

## ซ้อมครบเส้นทางเมื่อมีเอกสารรับรองแล้ว

```powershell
npm.cmd run migration:promote:rehearse -- <snapshot.sql.gz> <reviewed-mapping.json> <reviewed-targets.json>
```

คำสั่งปฏิเสธ mapping ที่ยังไม่พร้อมก่อนเริ่ม DB ไม่รับ DB URL เริ่ม MySQL สังเคราะห์ใหม่พอร์ต 3332 เท่านั้น ไม่เปิดเว็บหรือเชื่อมบัญชีคณะ ตั้ง target references ตามไฟล์ที่ตรวจรับและปิด grants ทั้งหมด จากนั้น preserve → dry-run และยืนยัน rollback → commit ในฐานซ้อม → verified replay → ปิดและลบฐานซ้อม รายงานยอด/hash อยู่ `.local/t12/promotion-*/rehearsal.json` ไม่มีการเก็บประวัติจริงให้แอปอ่านหลังจบคำสั่ง

รูปแบบ targets (ใช้ placeholder ต้องกรอกข้อมูลที่รับรองจริง ไม่ใช้ตัวอย่างเป็น mapping):

```json
{
  "sourceSha256": "<64-hex snapshot hash>",
  "mappingFingerprint": "<จาก readiness.json ของ mapping ที่ตรวจรับ>",
  "review": { "by": "<ผู้ตรวจ reference>", "at": "2026-11-13", "evidence": "<หลักฐาน>" },
  "preservationApprovalReference": "<อ้างอิงคำรับรอง preservation>",
  "series": [{ "id": "<target seriesId>", "name": "<ชื่อชุด>", "documentType": "<ประเภทที่รับรอง>" }],
  "departments": [{ "id": "<target departmentId>", "name": "<ชื่อหน่วยงาน ณ วันออก>" }]
}
```

ต้องมี series ครบ target ที่ map และ department ครบที่ใช้ในประวัติ ไม่มีรายการเกินหรือซ้ำ prefix/yearBasis ได้จาก mapping ที่ผูกต้นฉบับ ไม่รับ override ใน targets ประวัตินี้ยังไม่มีผู้รับ/ปลายทาง/ผู้ลงนาม/PDF bytes/issuedAt ที่ normalize ครบ จึงไม่ถือว่าปิด migration เนื้อหาหรือไฟล์จริงแล้ว

## ซ้อม HTTP และหน้าอ่านกับ snapshot ที่รับรอง (AC4)

```powershell
npm.cmd run migration:http:rehearse -- <snapshot.sql.gz> <reviewed-mapping.json> <reviewed-targets.json>
```

คำสั่งนี้เป็นการซ้อมแยกจากฐานที่เว็บใช้อยู่ สร้าง MySQL ใหม่บน loopback พอร์ต 3333 และ Next.js พอร์ต 3115 โดยใช้บริการบัญชีจำลองในเครื่องเท่านั้น ไม่เชื่อม CENTRAL หรือรับ URL ฐานปลายทาง ก่อนรันต้องปิดชุดทดสอบที่ใช้ dist `t12-details` เดียวกัน

หลังตรวจ source/mapping/target binding จะ preserve และ promote พร้อมตรวจ rollback/replay จากนั้นตรวจสิทธิ์อ่านผ่าน HTTP และหน้าเว็บด้วยประวัติจริง โดยใช้ตัวตนจำลองที่ผูก owner/department จากแผน การทดสอบนี้พิสูจน์การบังคับสิทธิ์ของแอป ไม่รับรองว่าบุคคลจริงเข้าสู่ระบบหรือได้รับสิทธิ์ออกเลขแล้ว

การทดสอบเดินเลขใช้ผู้ขอเลขจำลองที่ไม่มีประวัติค้างแนบ PDF และมี department `204` ตามข้อยกเว้นเวลาเดิม เปิด grant/ชุดเลข/gate เฉพาะฐานซ้อมชั่วคราว ตรวจเลขต่อเหนือ reservation floor ของปีปัจจุบัน คำขอพร้อมกันและคำขอซ้ำ ไม่แก้ประวัติหรือปลด PDF ค้างของเจ้าของจริง หากไม่มี floor ปีปัจจุบันจะปฏิเสธการซ้อมแทนการอ้างผลต่อเลขจาก scope ว่าง

ก่อนจบต้องคืน gate เป็น blocked ปิด grants/ชุดเลข และปิดบริการพร้อมลบ datadir ที่สร้างเอง รายงาน aggregate กับ diagnostic ส่วนตัวอยู่ใต้ `.local/t12/http-*/` ไม่เผยแพร่ log, ภาพ, trace หรือข้อมูลหนังสือ การผ่าน AC4 ยังไม่แทน AC2 หรือคำอนุมัติ production/cutover

ตรวจวงจรปิดเว็บแยกจากข้อมูลจริงได้ด้วย `npm.cmd run test:migration:http:process` ซึ่งใช้ Next.js จริงบนพอร์ต/dist เดียวกัน จึงต้องรันแยกจาก rehearsal และ E2E อื่น การปิดใช้ IPC ไปยัง process ที่ runner สร้าง แล้วให้ Next.js ปิด worker ของตัวเอง รวมการรับคำสั่งปิดระหว่างเริ่มทำงาน ไม่ต้องใช้สิทธิ์ค้นหา process tree ของ Windows

## Schema และผลทดสอบเดิม

เพิ่มตาราง registry แบบ additive ใน `tools/migration/schema.sql` สำหรับฐานซ้อมใหม่ แอป DB user ไม่มีสิทธิ์อ่าน registry/raw/disposition ถ้ามี dev:local รุ่นก่อนเปิดอยู่ ให้เริ่ม runner ใหม่ ไม่มีการ ALTER ฐานเดิมหรือ migration production ในรอบนี้

ผลตรวจรอบนี้:

- `npm.cmd run test:migration`: 38/38 รวมการตรวจ mapping/source/metadata, CLI ปฏิเสธ draft ก่อนเริ่ม DB, ซ้อมครบด้วย fixture, atomic rollback, verified replay, raw/history/reservation tampering, counter rewind และสิทธิ์ DB principal
- `npm.cmd run test:e2e -- tests/migration.spec.mjs tests/preservation.spec.mjs`: 7/7 รวม source-bound promotion หลัง preservation และสิทธิ์ HTTP/หน้าเว็บของ history/search โดย gate ยังปิด
- `npm.cmd run test:issuance`: 12/12; production isolation 3/3
- lint/typecheck/build ผ่าน QA อิสระตรวจไม่เหลือ finding ในขอบเขตที่พัฒนา

บันทึกใน [ticket T12](../tickets/12-legacy-migration.md) และ [ตาราง review](t12-mapping-review.md) T12 ยังคง 3/6 เพราะ mapping บัญชีจริง/วิธีจัดการเรื่องว่าง/ไฟล์/การตรวจรับข้อมูลจริงและ cutover ยังไม่ครบ
