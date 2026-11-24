# ADR 0001 — รักษาประวัติเดิมที่ข้อมูลไม่ครบและกันเลขแยกจากสิทธิ์อ่าน

วันที่: 13 พฤศจิกายน 2026 (Asia/Bangkok)

สถานะ: รับรองแนวทางโดยผู้ใช้ในบทสนทนา ไม่ใช่คำรับรอง mapping หรืออนุมัติ production migration

## บริบท

T12 ซ้อม snapshot เดิมพบปัญหา 55 จุดในต้นทาง 47 แถว เลขซ้ำ 1,308 กลุ่ม และ reference ชุดเลขบางชุดหาย ผู้ใช้ยืนยันว่าไม่มี backup เพิ่ม และตอบ “ยืนยัน” ต่อข้อเสนอรักษาต้นฉบับ แยกข้อมูลที่ระบุเจ้าของ/ชุดไม่ได้ รักษาเวลาที่ขาดเป็นไม่ทราบ และกันเลขเดิมจากหนังสือหลักไว้

## ข้อตัดสินใจ

- รักษา raw ทุกฟิลด์และ source ID จาก 6 ตาราง ไม่ลบ/รวม/เปลี่ยนเลขหรือสร้างตัวตน/เวลาแทนข้อมูลที่กู้ไม่ได้
- บันทึก disposition แยกจาก normalized history: 45 แถวแบบ restricted และ 2 แถวแบบ unknown_time (รวม 47 แถว/55 เหตุผล) ปัจจุบันทั้งหมดยังไม่เปิดให้แอปอ่านจนกว่า mapping ที่เกี่ยวข้องผ่าน
- กันเลขจากหนังสือหลักทุก source ID รวมเลขซ้ำ ยกเลิก เลขแทรก แถวที่ไม่มีเจ้าของ และแถวอ้างชุดหาย จำนวนใน snapshot นี้ 171,506 รายการ ไม่ใช้จำนวนแถวที่แสดงในหน้าอ่านเป็นฐาน counter
- การกันเลขคง namespace ชุดเดิมไว้แม้ reference หาย เก็บ subnumber NULL ตามต้นทาง การหาพื้นเลขหลักสูงสุดไม่ต้องสมมติว่า NULL และ 0 มีความหมายธุรกิจเดียวกัน
- คำยืนยันนี้ไม่รับรองการจับคู่เจ้าของ หน่วยงาน สิทธิ์ ชุดเลข prefix หรือ timezone และไม่ทำให้ grant ออกเลขเพิ่มขึ้น
- เฉพาะ mapping 1:1 ที่ตรวจรับแยกแล้วจึงเชื่อม reservation กับชุดปลายทางที่ปิดใช้งานได้ ไม่อนุมาน mapping จากรหัสใกล้เคียงหรือ prefix
- ระหว่าง preservation ปิด gate ออกเลขทั้งฐานใน transaction เดียวกับ raw/reservation/disposition ไม่มี endpoint หรือคำสั่ง production ที่เปิด gate การเปิดระบบจริงยังต้องผ่าน cutover และ T13

## ผลต่อ implementation

ใช้ `legacy_staging`, `legacy_preservation_batches`, `legacy_dispositions`, `legacy_number_reservations` และ `legacy_reservation_links` ใน schema สำหรับฐานซ้อม MySQL เท่านั้น แอปไม่รับสิทธิ์ SQL อ่าน raw/disposition ตารางเหล่านี้ไม่อยู่ใน history API

Issuer ใช้ shared gate lock ก่อน owner/series/counter ส่วน preservation/seeding ใช้ exclusive gate lock ตรวจ reservation floor ภายใต้ counter lock เพื่อให้ตัวนับที่ถูกย้อนหรือลบไม่จัดสรรช่องว่างต่ำกว่าเลขเดิมสูงสุด

ส่วน normalized promotion และ mapping ของ snapshot จริงยังต้องทำต่อ ไม่มีการใช้ ADR นี้เป็นเหตุข้าม validation หรือเพิ่มเกณฑ์ T12 ข้อ 2–4 โดยอัตโนมัติ ไม่มีข้อกำหนดระยะเก็บรักษาหรือข้อกฎหมายใหม่จากข้อตัดสินใจนี้
