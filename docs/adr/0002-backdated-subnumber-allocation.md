# ADR 0002 — แยกตัวนับเลขย่อยและอ้างอิงต้นทางย้อนหลัง

วันที่: 13 พฤศจิกายน 2026 (Asia/Bangkok)

สถานะ: ใช้ใน implementation รุ่น local ตามกติกา T03 ที่ผู้ใช้รับรอง ไม่ใช่การอนุมัติ production migration

T03 รับรองให้เลือกต้นทางที่อ่านได้ทุกปี คงชุด/ปี/วันที่/prefix/เลขหลัก แล้วเพิ่มเลขย่อย โดยตัวนับเลขปกติไม่เปลี่ยน คำขอพร้อมกันต้องไม่ซ้ำ และต้องไม่ใช้เลขยกเลิกหรือเลขเก่าที่กันไว้กลับเงียบ ๆ

ใช้ `issuance_subcounters` มี primary key `(series_id,number_year,main_number)` เป็น scope mutex และ high-water mark แยกจาก counter เลขหลัก ตรวจ floor ของ issuance, normalized history และ mapped legacy reservations ภายใต้ lock นี้ก่อนเพิ่มเลขย่อย เก็บ unique business-number constraint ที่หนังสือไว้ ไม่ใช้ MAX+1 โดยไม่มี lock

ต้นทางใหม่ใช้ document UUID ส่วน normalized legacy ใช้ snapshot/source ID ตรวจสิทธิ์ซ้ำใน transaction ไม่รับ tuple เลขจาก client และไม่ใช้ raw/disposition/reservation เป็นแหล่งสิทธิ์ อ่าน reservation เพื่อกันเลขเท่านั้นตาม ADR 0001

ใช้ request key เดียวกับคำขอปกติและ hash รวม source ป้องกันส่งซ้ำและ key ข้ามเส้นทาง การออกเลข/ตัวนับ/audit เป็น atomic transaction ร่วมกับ owner mutex สำหรับกฎ PDF ค้าง ไม่เปลี่ยนเวลาออกจริงให้เป็นวันที่ต้นทาง

ผลตามมา: เพิ่มตารางและ grant สำหรับฐานจำลอง ต้องเตรียม additive migration ก่อนใช้ฐานเก่าที่คงอยู่ ไม่เพิ่มกติกาธุรกิจหรืออนุมาน mapping/สิทธิ์จริงจาก source code เดิม
