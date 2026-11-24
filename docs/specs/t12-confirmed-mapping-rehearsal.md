# T12 — ผลซ้อมนำเข้าหลังรับรอง mapping

20 พฤศจิกายน 2569 (Asia/Bangkok)

อัปเดต 23 พฤศจิกายน 2569: [AC4 ผ่านการซ้อม HTTP/หน้าอ่าน/เลขต่อจากประวัติจริงแล้ว](t12-http-rehearsal.md) T12 เป็น **5/6** เหลือ AC2 และ cutover ข้อสรุป 4/6 และรายการค้าง AC4 ด้านล่างเป็นสถานะ ณ รอบซ้อม 20 พฤศจิกายน

ผู้ใช้ตอบ “ยืนยัน” ต่อ [ข้อเสนอ mapping และการเก็บแยก](t12-mapping-proposal-review.md) โดยรวมการพักเรื่องว่าง 1,860 รายการและการซ้อมนำเข้าในฐาน local แยก คำรับรองนี้ไม่ใช่การอนุมัติ production migration, cutover, grants หรือการเปิดออกเลขจริง

## การผูกคำรับรอง

- Snapshot SHA-256: `d5f97eb2131c0ba0d7eaee8659f9c9e02f87bf092092385c6dbd4b5181e2d6bb`
- หลักฐาน CENTRAL SHA-256: `c334440db80eabe3a06eb901129b43e0b83100d9bd5726df29d3a8591bb0cc61`
- ข้อเสนอที่รับรอง: `.local/t12/proposal-d5f97eb2-1675f390/`
- คำรับรอง/mapping/target references: `.local/t12/approved-d5f97eb2-2697c184/`
- Approved mapping fingerprint: `acb329c374318dbaa07e59287e5ccdb93542acecb8f92c566ca2df5b2e686996`
- Plan fingerprint: `82aeecb73c3671797d524e56bbab68e7c361f3e56b0d5b391946063ba2ad6c01`

ตรวจ hash ต้นฉบับ/หลักฐานและ fingerprint ข้อเสนอก่อนบันทึกคำรับรองทุกระดับ เมื่อถอด review และคืน policies เป็น pending ไฟล์ที่รับรองยังตรงกับข้อเสนอเดิมทุก decision ไม่เปลี่ยน owner/department/series/hold ระหว่างรับรอง ไม่เขียนทับไฟล์รอบก่อน

ผู้รับรองใน artifact ระบุเป็น `user (explicit conversation confirmation)` พร้อมวันที่และ reference ไป `approval.json` ซึ่งเก็บคำตอบจริง ไม่สมมติชื่อบุคลากรหรือใช้คำรับรองจำลองกับข้อมูลจริง

## ขอบเขตฐานซ้อม

ใช้ `tools/migration/rehearse-promotion.mjs` เดิม สร้าง MySQL ใหม่บน `127.0.0.1:3332` ไม่รับ URL ฐานปลายทางจากผู้ใช้ ไม่เชื่อม CENTRAL หรือฐานหนังสือต้นทาง ไม่เปลี่ยนฐานที่เว็บใช้บน 3306

Target references ประกอบด้วย 154 ชุดเลขและ 43 หน่วยงานที่ปรากฏจริงในประวัติที่นำเข้ารอบซ้อม จาก 44 หน่วยงานที่รับรอง mapping ชื่อหน่วยงาน ชื่อชุดและประเภทในฐานซ้อมใช้ label ที่ขึ้นต้น `T12 rehearsal` อย่างชัดเจน เพราะยังไม่ได้รับรองชื่อแสดงผลครบทุก reference ไม่ใช้ label นี้เป็นชื่อหน่วยงาน/ประเภทจริง Prefix และ year basis ยังคงค่าที่รับรองตาม source mapping

## ผลกระทบยอดจริง

| รายการ | จำนวน |
|---|---:|
| Raw source rows ที่ตรวจทุกฟิลด์ | 384,725 |
| หนังสือต้นทาง / source reservations | 172,131 |
| ประวัติที่นำเข้าในฐานซ้อม | 170,257 |
| หนังสือเก็บแยกตาม mapping ที่รับรอง | 1,874 |
| รายการ unresolved / invalid ในแผน | 0 / 0 |
| Metadata/details ที่ตรวจคู่กับประวัติ | 170,257 |
| พื้นตัวนับเลขหลักที่ seed และตรวจในฐานซ้อม | 490 ชุด/ปี |
| Reservation scopes ที่ยังอยู่ใน namespace เดิมที่พัก | 2 |
| กลุ่มเลขซ้ำเดิมที่รักษา source IDs | 1,308 |
| ประวัติที่คงเวลาไม่ทราบตามต้นฉบับ | 2 |
| Grants ที่เปิดใช้ | 0 |

170,257 + 1,874 = 172,131 เลขซ้ำเดิมยังรักษาเป็นข้อยกเว้น ไม่อ้างว่าประวัติทั้งหมดมีเลขไม่ซ้ำกัน การเทียบทุก field/source ID/number tuple ยืนยันว่าไม่เปลี่ยนเลขหรือรวมประวัติ พื้นตัวนับรวม reservation ของหนังสือที่พัก ยกเลิก และเลขแทรก ไม่ใช้จำนวนแถวที่ค้นเจอเป็นฐาน

ขั้นซ้อมผ่านครบ:

1. Preservation เก็บ raw/reservations/dispositions และตรวจทุกฟิลด์
2. Promotion แบบ dry-run แล้ว rollback; จำนวน history/promotion registry/counters/reservation links ที่เกิดใหม่กลับเป็นศูนย์
3. Commit ในฐานซ้อม และเทียบ history/รายละเอียด/reference/counter floors กับแผนทุกฟิลด์
4. Replay mapping/source เดิม ตรวจว่าข้อมูลครบและไม่สร้างซ้ำ
5. ตรวจ gate เป็น `blocked`, grants ที่ active เป็นศูนย์ และชุดที่ map ยัง disabled
6. ปิดฐานซ้อม ลบเฉพาะ datadir ที่ bootstrap สร้างไว้ภายใต้ `.local/t05-mysql/<id>/data` และตรวจพอร์ต 3332 ปิดแล้ว

## หลักฐานเฉพาะเครื่อง

- `.local/t12/promotion-d5f97eb2-9f2bd982/rehearsal.json`: aggregate report จาก runner
- `.local/t12/approved-d5f97eb2-2697c184/rehearsal-result.json`: report พร้อมผลตรวจ datadir ถูกลบและพอร์ต 3332 ปิด
- `.local/t12/approved-d5f97eb2-2697c184/approval.json`: ขอบเขตคำรับรองจริง
- `.local/t12/approved-d5f97eb2-2697c184/rehearsal-console.log`: log ส่วนตัว ไม่เผยแพร่เพราะ diagnostic อาจมีข้อมูล source

ไฟล์รายงานคงอยู่ แต่ฐานซ้อมถูกลบหลังตรวจสำเร็จ จึงไม่ถือว่าประวัติชุดนี้เข้าแอปถาวรแล้ว ไม่มีการเปิด legacy download API หรือรับรองว่า PDF ย้ายครบ

## การตรวจสอบและสถานะ T12

- Actual-data rehearsal exit 0; `dryRunVerified`, `replayVerified`, `rawAndHistoryEveryFieldVerified`, `dataDirectoryRemoved`, `isolatedPortClosed` เป็น true
- Lint/typecheck ผ่าน
- Issuance/backdated regression 12/12 ผ่านในฐานสังเคราะห์แยกหลังจบซ้อม ทดสอบกติกาเวลา การรอ lock ข้ามปี rollback/replay ผลนี้ไม่แทนการทดสอบ HTTP/คำขอพร้อมกันบนประวัติจริงตาม AC4
- QA อิสระตรวจคำรับรอง/source binding/ขอบเขตฐานแยก และผล rehearsal/cleanup

T12 ผ่าน **4/6 ข้อ (AC1, AC3, AC5, AC6)**: AC3 มีผล dry-run กระทบยอด/ความสัมพันธ์/เลขเดิม rollback และ replay จาก snapshot จริง พร้อมแผน rollback เดิมใน [คู่มือ migration](local-legacy-migration.md)

ยังไม่ผ่าน:

- **AC2:** ตรวจรับข้อมูลรอบสุดท้าย สิทธิ์ชุดเลข รายละเอียด target references/ชื่อแสดงผล ไฟล์และเวลาที่เกี่ยวข้องให้ครบก่อนเปิดจริง Mapping/การเก็บแยกที่รับรองรอบนี้ไม่แทนสิทธิ์และข้อมูลที่ยังไม่ตรวจรับ
- **AC4:** หลักฐานหน้าเว็บ/HTTP ว่าประวัติที่นำเข้าจริงอ่านตามสิทธิ์ และเดินเลขต่อโดยไม่ชน รวมกรณีคำขอพร้อมกัน/ส่งซ้ำในฐานแยก

`readyForLocalPromotion=true` หมายถึงแผนที่รับรองพร้อมซ้อมเฉพาะ local ไม่ใช่ production readiness; `productionReady=false`, gate blocked และไม่มีการเปิดออกเลขจริง
