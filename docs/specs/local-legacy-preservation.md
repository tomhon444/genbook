# T12 — เก็บข้อมูลแยกและกันเลขตามแนวทางที่ยืนยัน

วันที่ 13 พฤศจิกายน 2026 (Asia/Bangkok) · [Ticket T12](../tickets/12-legacy-migration.md) · [ADR 0001](../adr/0001-preserve-unresolved-legacy-history.md)

ผู้ใช้ยืนยันแนวทางแล้ว: เก็บต้นฉบับครบ ไม่ลบหรือเปลี่ยนเลข แยกข้อมูลที่ระบุเจ้าของ/ชุดไม่ได้จากหน้าอ่านปกติ รักษาเวลาที่ขาดเป็นไม่ทราบ และกันเลขเดิมจากหนังสือหลักไว้ นี่เป็นการรับรอง disposition เมื่อไม่มี backup เพิ่ม **ยังไม่รับรอง mapping ข้อมูลจริงหรือ cutover**

## สิ่งที่ทำในฐานซ้อม

`npm.cmd run migration:preserve -- C:/Users/dench/Desktop/GenBookno_DB.sql.gz` อ่าน snapshot ที่อนุญาต สร้าง MySQL ใหม่บน loopback พอร์ต 3323 และทำ transaction เดียวครอบคลุมข้อมูลดิบ นโยบายที่รับรอง disposition และรายการกันเลข พร้อมปิด migration gate ไม่มีการเชื่อมฐานระบบเก่าหรือ production และไม่ execute SQL ใน dump CLI ผูกคำยืนยันครั้งนี้กับ hash ของ snapshot เดิม หากใช้ไฟล์คนละ hash ต้องตรวจรับแยก ไม่อ้างคำยืนยันเดิมให้อัตโนมัติ

| ส่วนที่กระทบยอด | ผลจาก snapshot เดิม |
|---|---:|
| raw book / bookdept / genbook / inform / dept / typebook | 78 / 155 / 171,506 / 173,381 / 38,214 / 4 |
| รวม raw ทุกแถวและทุกฟิลด์ | 383,338 |
| reservation แยกตาม document source ID | 171,506 |
| source series/year scopes | 492 |
| แถวที่มี disposition | 47 |
| restricted / unknown_time | 45 / 2 |
| เหตุผลปัญหาของ disposition รวม | 55 |
| ชุดเดิมที่ไม่มี reference และยังไม่ mapped | 00096, 00097 |
| ประวัติจริงที่ส่งเข้า legacy_documents | 0 |
| counter จริงที่ seed อัตโนมัติ | 0 |
| gate ในฐานซ้อมหลัง transaction | blocked |

ตรวจเทียบทุกฟิลด์ใน raw, reservation, disposition, policy/reference และรายงาน แล้วนำเข้าซ้ำผ่าน ไม่มีการแทน datetime NULL ด้วยเวลาอื่น สำรองรายงาน aggregate ที่ `.local/t12/preservation-rehearsal.json` ฐานซ้อมถูกปิดและลบหลังจบเพื่อไม่ทิ้งสำเนาข้อมูลจริงเพิ่มไว้ ผลนี้เป็นการซ้อม ไม่ใช่การย้ายข้อมูลจริงขึ้นใช้งาน

## การแยกสิทธิ์และข้อมูลที่ไม่ครบ

`legacy_dispositions` มีคีย์ snapshot/table/source ID โดยเก็บเหตุผลแยกเป็น array จึงไม่ทำให้ 55 เหตุผลกลายเป็นข้อมูลซ้ำ 55 แถว ประเภท restricted ครอบคลุม 4 แถวที่ขาดตัวตน/วันที่/เนื้อหา, 2 แถวยกเลิกอ้างชุดหาย และ child 39 แถวที่ parent หาย อีก 2 แถวเก็บเป็น unknown_time โดย raw datetime ยัง NULL

การมี source/reference ไม่เท่ากับ mapping ที่รับรอง: หนังสือที่เหลือใน snapshot ก็ยังไม่เข้า history เช่นกันจนกว่าจะรับรองบัญชี หน่วยงาน ชุดเลข และสิทธิ์ แอปใช้ SQL principal ที่ไม่มี SELECT บน raw/batch/preservation/disposition และไม่มี UPDATE บน gate/reservations/links จึงไม่สามารถอ่านหรือเปลี่ยนข้อมูลเก็บแยกผ่าน connection ของแอป

History API ยังค้นเฉพาะ `legacy_documents` ตาม T02 รายการที่อยู่ในส่วนเก็บแยกไม่ปรากฏในผลค้น และอ่าน detail ตอบ 404 แม้รหัสต้นทางจะเป็นของผู้ใช้ที่ล็อกอินอยู่ ไม่มี API เปิดเผย raw, orphan หรือเหตุผลปัญหาข้ามสิทธิ์

## การกันเลขและการจัดสรร

- ทุก genbook source ID มี reservation แม้มีเลขซ้ำกัน ไม่ใช้ UNIQUE business number กับประวัติเดิม รวมสถานะยกเลิกและเลขแทรกในการหาพื้นเลขหลัก
- reservation ใช้รหัสชุดเดิมแยกจาก FK ของ issuance_series จึงเก็บ 00096/00097 ได้โดยไม่สร้าง prefix หรือ mapping แทน
- ทั้งฐานถูกปิดการออกเลขระหว่าง preservation คำขอที่แข่งกับ transaction ต้องรอ lock แล้วเห็น gate blocked ไม่มีการออกเลขหลุดเข้ามาระหว่างนำเข้า
- การสร้างชุดชื่อเดียวกับชุดที่หายหรือ alias ไม่ทำให้ข้าม gate ได้ และ `seedReservedCounters` ปฏิเสธ source series ที่ reference หาย
- ฟังก์ชัน seed ใช้ได้เฉพาะฐาน local แยก รับ dump/reference การยืนยัน policy และ mapping 1:1 พร้อมผู้ตรวจ mapping แบบ explicit ต้องตรวจ raw/derived ทุกฟิลด์ซ้ำก่อน seed เป้าหมายต้องปิดและไม่มีหนังสือ/ประวัติ อ่านแล้วตั้ง counter อย่างน้อยเท่าเลขหลักสูงสุดที่กันไว้ ไม่ลดค่าที่สูงกว่า
- การ seed ไม่เปิด gate และไม่มี CLI/HTTP สำหรับเปิด gate ในโค้ดนี้ การเปิดในเทสต์เป็น SQL fixture เฉพาะข้อมูลจำลอง
- เมื่อจำลอง cutover ในเทสต์ Issuer ยังคงล็อก counter ตาม T05 และตรวจว่าไม่ต่ำกว่า floor ของ reservation ก่อนจัดสรร ตัวนับที่ถูกย้อนหรือลบจึงถูกปฏิเสธ 409 แม้เลขถัดไปเป็นช่องว่างที่ยังไม่มีเอกสารชนอยู่
- ไม่ใช้ MAX เป็น allocator ใหม่ ค่า MAX ของ reservation เป็นพื้นข้อมูลนำเข้าที่ไม่เปลี่ยนภายใต้ gate/series locks การจัดสรรยังเพิ่มจาก counter row ที่ล็อกและมี unique constraint ตามเดิม

## Transaction และ replay

`stageDump` รองรับ outer transaction สำหรับ preservation แต่พฤติกรรม standalone เดิมยังจัดการ transaction เอง ถ้าขั้น raw/reservation/disposition ล้มเหลว ทุกส่วนรวมถึงการปิด gate ถูก rollback ไม่มี batch ที่ดูเหมือนพร้อมแต่เก็บข้อมูลเพียงครึ่งเดียว

การ replay ไม่ใช่เพียงเทียบยอด ต้องเทียบ source fingerprint/raw ทุกฟิลด์, reservation ทุก source ID/ชุด/ปี/หลัก/แทรก/สถานะ/reference, disposition เหตุผล/handling และ policy approval reference หากพบ tampering จะหยุด ไม่ซ่อมค่าทับเงียบ ๆ หากมี mapping แล้วจะตรวจ floor ของ counter ด้วย

## ขอบเขตที่ยังทำต่อ

1. รับรอง mapping บัญชี/หน่วยงาน/ชุด/prefix/สิทธิ์จริงและวิธีอ่าน unknown time โดยใช้ [ตาราง review](t12-mapping-review.md) คำยืนยัน disposition ไม่ลงชื่อแทนผู้ตรวจ mapping แต่ละแถว
2. ใช้ [เส้นทาง promotion จาก preservation](local-legacy-promotion.md) ที่เพิ่มหลัง T09 เมื่อ mapping/reference ผ่าน แยก registry และตรวจ raw/reservations/history ทุกฟิลด์ในฐานซ้อมเดียวกันได้แล้ว ไม่อ้างว่าคำสั่ง preserve ทำ promotion ให้อัตโนมัติ และยังไม่นำข้อมูลจริงเข้าแอป
3. ตรวจ inventory PDF/คำขอค้าง และ HTTP/UI ด้วยข้อมูลจริงที่ mapping ผ่าน แล้วรับรอง counter จาก export รอบสุดท้ายหลังหยุดระบบเก่า
4. ตรวจ cutover/T13 และขออนุมัติ production migration แยก ไม่มีการสร้างเครื่องมือ production หรือเปิดใช้จากรอบนี้

## ผลตรวจรอบสุดท้าย

- `npm.cmd run test:migration`: 23/23 ผ่าน รวม preservation 9/9, atomic rollback, raw/derived tampering, replay, คำขอแข่งกับ preservation, explicit mapping, source series ที่หาย และ 8 allocations พร้อมกันเหนือ reservation floor
- `npm.cmd run test:e2e`: 26/26 ผ่าน รวม HTTP/browser preservation 3/3: ข้อมูลเก็บแยกไม่หลุดเข้า history, gate ปฏิเสธการออกเลข, counter ถูกย้อน/ลบแล้วไม่ reuse เลข
- issuance regression 7/7 และ auth provider 9/9 ผ่าน
- lint/typecheck/build และ production isolation 3/3 ผ่าน
- QA อิสระรัน preservation 9/9 และตรวจ actual snapshot summary/reservation source IDs ครบ ไม่พบข้อขวางค้างในขอบเขต local

Schema เป็น additive สำหรับฐานจำลองใหม่ที่ runner สร้าง ถ้ามี dev:local รุ่นก่อนเปิดอยู่ ให้เริ่ม runner ใหม่เพื่อสร้าง schema ชุดนี้ ไม่ได้รัน ALTER กับฐานเดิมและไม่มี migration production จากรอบนี้
