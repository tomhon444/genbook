# T12 — ชุดตรวจรับ AC2 ก่อนเปิดใช้งานจริง

23 พฤศจิกายน 2569 (Asia/Bangkok) · [T12](../tickets/12-legacy-migration.md) · [ผล AC4](t12-http-rehearsal.md)

สถานะ: **เตรียมตรวจรับ ยังไม่ผ่าน AC2**; T12 คง 5/6 การซ้อม HTTP ใช้บัญชีและ grants จำลอง จึงไม่แทนสิทธิ์ใช้งานจริง รายงานนี้ไม่อนุมัติ production migration หรือ cutover

อัปเดต 24 พฤศจิกายน 2569: [เติมชื่อจากระบบเก่าลงชุดตรวจรับใหม่แล้ว](t12-reference-names.md) ชื่อชุดเลขผ่าน 153/154 ชุด ประเภทผูกชุดได้ 130/154 และชื่อประเภท 4/4 อีก 1 ชื่อมีอักขระควบคุม/24 ชุดขาด parent reference ส่วนชื่อหน่วยงาน 44 รหัสยังไม่ได้ดึง เพราะ CENTRAL ไม่รองรับ TLS ไม่มีการ fallback เป็น plaintext หรือแทนชื่อย่อเป็นชื่อทางการ

## หลักฐานที่ใช้ได้แล้ว

24 พฤศจิกายน 2569: สร้าง [รายการตรวจรับทีละกลุ่ม](t12-decision-review.md) แล้ว ข้ออ้างอิง 202 รายการ/มีข้อยกเว้น 69 และสิทธิ์เดิม 1,844 แถวแบ่งเป็น 9 กลุ่มไม่ซ้ำแถว พร้อมตัวเลือก/ช่องผู้รับรองที่ยัง pending ไม่เปลี่ยนสิทธิ์หรือรับรอง AC2

- Snapshot SHA-256: `d5f97eb2131c0ba0d7eaee8659f9c9e02f87bf092092385c6dbd4b5181e2d6bb`
- Mapping/การเก็บแยกที่รับรอง: `.local/t12/approved-d5f97eb2-2697c184/` ประวัติ 170,257/เก็บแยก 1,874 จากต้นทาง 172,131 รายการ
- CENTRAL evidence วันที่ 19 พฤศจิกายน: `.local/t12/central-evidence-d5f97eb2-64ae62e7-reviewed/` SHA-256 `c334440db80eabe3a06eb901129b43e0b83100d9bd5726df29d3a8591bb0cc61` เป็นหลักฐานรหัส/สถานะ ไม่มีชื่อหน่วยงานทางการ และตาราง MyISAM ไม่ให้ consistent snapshot ต้องตรวจซ้ำก่อน cutover
- ชุดเลขที่ map 154 ชุด และหน่วยงานที่ map 44 รหัส โดยมี 43 รหัสที่ใช้ในประวัตินำเข้า ชื่อใน targets เดิมเป็น `T12 rehearsal` ไม่ใช่ชื่อที่รับรองสำหรับเปิดจริง
- `bookdept_user` ปัจจุบันมี 1,844 แถวสิทธิ์เดิม ต้องตรวจรับแยกจากเจ้าของหนังสือและสิทธิ์อ่าน ไม่สร้างสิทธิ์จากบทบาท `userbook`/`userlevel`/`user_tb` แทน

## ชุดตรวจรับที่สร้างแล้ว

เครื่องมือ `tools/migration/prepare-ac2-review.mjs` สร้างชุดใหม่ `.local/t12/ac2-d5f97eb2-7e321dd9/` แบบ exclusive ไม่เขียนทับรอบก่อน ตรวจ hash ของ snapshot/mapping/targets/evidence receipt และเทียบ grant/group กับ native source ก่อนสร้างไฟล์ โดยไม่เชื่อม DB หรือเครือข่าย

| ไฟล์ส่วนตัว | ใช้ตรวจรับ |
|---|---|
| `REVIEW.md` | ภาพรวมและสิ่งที่ต้องตัดสินใจ |
| `REFERENCES.md`, `references.json` | ชื่อชุดเลข 154 ชุด ประเภท 4 รายการ หน่วยงาน 44 รหัส; source candidates/aliases แยกจากช่องชื่อจริงที่ยังว่าง |
| `grants-review.json` | สิทธิ์เดิมครบ 1,844 แถว พร้อมรหัสต้นทาง/ปลายทาง สถานะ CENTRAL และเหตุผลให้ตรวจ ทุกแถวยัง pending/disabled |
| `attachments-inventory.json` | Inventory references ของ snapshot ปัจจุบัน ไม่คัดลอกผลเก่าหรือผลตัวอย่างมาเป็นการรับรองทั้งหมด |
| `time-review.json` | ค่าที่หาย/คุณภาพข้อความเวลา raw เทียบ history และคำรับรองเฉพาะการแสดงเวลา |
| `acceptance.json` | แยกคำตัดสินแต่ละหมวด; accepted เฉพาะ time-display-policy |
| `manifest.json` | Hash ของ inputs/outputs และ reference/hash ของ receipt คำตอบจริง |

คำสั่งที่รันสำเร็จ:

```powershell
npm.cmd run migration:review:ac2 -- .local/legacy-import/native-d5f97eb2131c/source.sql.gz .local/t12/approved-d5f97eb2-2697c184/mapping.json .local/t12/approved-d5f97eb2-2697c184/targets.json .local/t12/central-evidence-d5f97eb2-64ae62e7-reviewed --time-display-approval .local/t12/time-display-d5f97eb2-utf8-20261123/approval.json
```

Grant review พบ 37 แถวไม่มีชุดต้นทางที่ตรงหนึ่ง reference/ยังไม่มี mapping ชุด, 572 แถว staff ไม่ active, 423 แถวไม่มี approved historical-owner mapping และ 23 แถวหน่วยงานปัจจุบันของ staff ไม่ active จำนวนเหตุผลซ้อนกันได้ ไม่ใช่ยอดที่นำมาบวกเป็นจำนวนบุคคลหรือจำนวนสิทธิ์ที่ต้องเพิกถอน

`bookdept_user.dept_id` เป็น NULL ทั้ง 1,844 แถว จึงแสดง source-department-unresolved ไม่ใช้ค่าว่างนี้เป็นเหตุเพิกถอนสิทธิ์เดิมหรือเลือกหน่วยงานแทนเอง ส่วน staff ที่ไม่มี mapping เจ้าของประวัติไม่ใช่ข้อพิสูจน์ว่าเข้าสู่ระบบไม่ได้ ต้องตรวจรับตัวตน/สิทธิ์ปัจจุบันแยก

ประวัติที่นำเข้า 166,269 รายการยัง PDF-pending ตามนโยบายเดิม Inventory ของ history มี pending reference 167,126, missing 3,129 และ invalid 2; ฝั่งเก็บแยกมี pending reference 1,766 และ missing 108 ตัวเลข reference ไม่เท่ากับ PDF-pending เพราะพิจารณาความลับ/ยกเลิกแยกกัน ไม่ล้าง pending เพื่อให้เจ้าของออกเลขผ่าน

เวลาที่ไม่ทราบมี raw 6 รายการ และอยู่ใน history ที่นำเข้า 2 รายการ คง source ID/ค่าต้นฉบับครบ `historical-timezone=pending` ใน acceptance หมายถึงหลักฐาน timezone จริงยังไม่ทราบ ไม่ใช่ให้รับรองแนวทางแสดงเวลาซ้ำ และไม่จำเป็นต้องแปลงเป็น instant เพื่อรับรองแนวทางเก็บข้อความเดิม

## Inventory ไฟล์ของ snapshot ปัจจุบัน

สร้างแบบ offline ด้วยเครื่องมือเดิม ไม่เชื่อมเซิร์ฟเวอร์ไฟล์และไม่ดาวน์โหลด:

```powershell
node tools/migration/attachments.mjs inventory .local/legacy-import/native-d5f97eb2131c/source.sql.gz .local/legacy-import/attachments-d5f97eb2-ac2-20261123
```

ผล ณ ขั้นสร้าง inventory ก่อนดาวน์โหลด:

| รายการ | จำนวน |
|---|---:|
| หนังสือทั้งหมด | 172,131 |
| หนังสือที่มี reference ไฟล์รูปแบบผ่านและรอตรวจ bytes | 168,892 |
| path ไฟล์ที่อ้างถึงไม่ซ้ำ | 168,884 |
| หนังสือไม่มี file reference | 3,237 |
| หนังสือมี file reference ไม่ผ่านรูปแบบ | 2 |
| ไฟล์ที่พยายามดาวน์โหลดในรอบนี้ | 0 |
| หนังสือที่ยืนยัน PDF bytes จากรอบนี้ | 0 |

Inventory SHA-256: `e8ed5d8bbeb1b09993ffd9aaa2a8d38751df17a16a9a35cae78ec0c34008f661` รายงานอยู่ `.local/legacy-import/attachments-d5f97eb2-ac2-20261123/{inventory.json,summary.json}`

จำนวนหนังสือที่อ้างไฟล์กับจำนวน path ไม่ใช่จำนวนเดียวกัน และ reference รูปแบบผ่านยังไม่พิสูจน์ว่ามีไฟล์จริง/เป็น PDF ที่อ่านได้/เป็นไฟล์ของหนังสือนั้น Archive เดิม `attachments-78629b14` ผูกกับ snapshot เก่า จึงไม่นำผลดาวน์โหลดเดิมมารับรอง snapshot ปัจจุบันโดยอัตโนมัติ ต้องตรวจการจับคู่และ content hash แยกก่อนใช้ซ้ำ

### ผลตัวอย่างไฟล์ปัจจุบัน

รัน `download` แบบจำกัด 3 ไฟล์ผ่าน HTTPS เดิมโดยไม่ลดการตรวจ certificate/TLS สำเร็จ 3 ไฟล์ไม่ซ้ำ รวม 368,696 bytes / 4 หน้า ตรวจ source ID/path กับ inventory, SHA-256/ขนาดกับ journal และ parse ด้วย `pdf-lib` ผ่าน เก็บหลักฐานเฉพาะเครื่องที่ `.local/legacy-import/attachments-d5f97eb2-ac2-20261123/sample-verification.json`

รอบแรกใน sandbox ได้ `EACCES`; หลังรันผ่านสิทธิ์เครือข่ายดาวน์โหลดได้ 3 ไฟล์ `summary.json` ล่าสุดจึงมี downloaded documents 3, pending 168,888 และ failed 1 ที่เป็นผล sandbox ค้างจากอีก source ID ไม่ใช่หลักฐานว่าเซิร์ฟเวอร์ตอบว่าไฟล์หาย ไม่ดาวน์โหลดเพิ่มเพื่ออ้างความครบถ้วนจากตัวอย่าง

ผล parse นี้ไม่ตรวจเนื้อหาที่มองเห็นหรือรับรองความสัมพันธ์ทางธุรกิจของไฟล์กับหนังสือ ยังไม่เปิด download API หรือเปลี่ยน `pdf_pending` ในฐานแอป และไม่แทนการตรวจ PDF ทั้งหมด

## เวลาเดิม

ตรวจ source local แบบอ่านอย่างเดียว ไม่ execute PHP:

- `application/config/config.php:332` ใช้ `time_reference = 'local'` แต่ไม่ระบุ named timezone
- `application/models/genbook/genbook_model.php:370–371` ใช้ `date("Y-m-d H:i:s")` และบางเส้นทางบันทึก/แก้ไขที่ 493–494, 515–516 กำหนด timestamp ทั้งสองช่อง ส่วน 631 กำหนด lastupdate
- ไม่พบการตั้ง timezone ชัดเจนใน application/index ที่ตรวจ การตั้ง export SQL `time_zone='+00:00'` ไม่พิสูจน์ความหมาย DATETIME เดิม และ source ปัจจุบันไม่พิสูจน์ runtime ทุกช่วงประวัติ

จึงคง timestamp เป็นข้อความต้นฉบับและ `timestampTimeZone=unverified` ตาม implementation เดิม ไม่ตีความ `user_datetime` เป็นเวลาออกเลขที่แก้ไม่ได้สำหรับประวัติทั้งหมด ไม่ใช้ lastupdate/เวลา import แทนเวลาที่หาย

ผู้ใช้รับรองแนวทางแสดงเวลาเมื่อ 23 พฤศจิกายน 2569 ด้วยคำตอบจริงว่า “แสดงข้อความเวลาเดิมพร้อมระบุว่ายังไม่ยืนยันเขตเวลา และคงค่าที่หายเป็นไม่ทราบ (แนะนำ)” บันทึก receipt UTF-8 ที่ผูก source SHA/mapping fingerprint ใน `.local/t12/time-display-d5f97eb2-utf8-20261123/approval.json` ผู้รับรองระบุเป็น `user (explicit conversation confirmation)` ไม่สมมติชื่อบุคลากร คำรับรองมีขอบเขตเฉพาะการแสดงเวลา ไม่ยืนยัน timezone จริง ไม่ให้สิทธิ์หรืออนุมัติ cutover

Receipt รอบแรก `time-display-d5f97eb2-222f737a` มีคำตอบภาษาไทยเสียรูปจาก native stdin encoding ของ PowerShell ตัวตรวจปฏิเสธก่อนสร้าง packet เก็บไฟล์นั้นเป็นหลักฐานที่ไม่ผ่านเท่านั้น สร้าง receipt UTF-8 ใหม่โดยไม่ผ่อนตัวตรวจ และ QA ตรวจคำตอบ/hash ของไฟล์ใหม่ตรงแล้ว

## เงื่อนไขตรวจรับที่ยังต้องมีคำตัดสินจริง

| หมวด | เงื่อนไขที่ตรวจซ้ำได้ | สถานะ |
|---|---|---|
| แหล่งข้อมูลรอบสุดท้าย | ระบุวัน export/ขอบเขต/hash และผู้รับรอง แยกรอบซ้อมจากรอบตัดจริง | รอ |
| ชื่ออ้างอิง | ตรวจชื่อชุด/ประเภท/หน่วยงานรายรหัส พร้อมหลักฐานชื่อทางการ ไม่ใช้ alias หรือ placeholder แทนโดยเงียบ | รอ |
| สิทธิ์ชุดเลข | ตัดสินใจทุกแถวสิทธิ์เดิมและข้อยกเว้นโดยผู้รับผิดชอบ ตรวจ active/หน่วยงาน/ชุดที่พัก/รหัสไม่ตรง ไม่อนุมานสิทธิ์จากการมีประวัติ | รอ |
| ไฟล์ | ตรวจ bytes/ความสัมพันธ์/สิทธิ์ไฟล์ และรับรองวิธีจัดการไม่มีไฟล์/ไฟล์เสีย/ตรวจไม่ได้ รายการที่ยังไม่ยืนยันคง pending และกฎ block เจ้าของตามเดิม | รอ |
| การแสดงเวลาเดิม | เก็บ/แสดงข้อความเดิมพร้อมระบุยังไม่ยืนยันเขตเวลา และคงค่าที่หายเป็นไม่ทราบ ไม่แต่ง instant ทดแทน | ผู้ใช้รับรองแล้ว 23 พฤศจิกายน |
| หลักฐาน timezone จริง | หากจะแปลง datetime เก่าเป็น instant ต้องมีหลักฐานใหม่และตรวจรับแยก ระหว่างนี้คง unverified | ยังไม่ทราบ; ไม่แปลง |
| บัญชีและสิทธิ์ปัจจุบัน | ตรวจข้อมูลบุคคลจริง/สิทธิ์จริงร่วมกับ T13 ก่อนเปิดใช้ ไม่ใช้ผลบัญชีจำลองจาก AC4 | รอ |

ทุกคำรับรองต้องระบุผู้รับรอง วันที่ และหลักฐานจริง ผูกกับ snapshot/mapping ชุดเดียวกัน การแก้ไฟล์ข้อเสนอไม่ใช่การนำเข้าหรือเปิดสิทธิ์

## การตรวจสอบ

- Actual-source AC2 packet CLI: exit 0; QA เทียบ hash outputs ทั้ง 8 ไฟล์กับ manifest และตรวจ source/grants/receipt/inventory ผ่าน
- `npm.cmd run test:migration:ac2`: 5/5 รวมการปฏิเสธคำตอบภาษาไทยที่ถูกแปลงเป็น `?`
- Identity evidence/mapping proposal/attachment regression: 27/27
- Lint/typecheck ผ่าน QA อิสระไม่มี finding ค้างที่ขวางงานเตรียมชุดนี้
- ไม่มี DB writes/grants ใหม่ ไม่มีการเปิด gate ไม่มีการอนุมัติ AC2 หรือ production และไม่ได้อัปเดต GitHub
