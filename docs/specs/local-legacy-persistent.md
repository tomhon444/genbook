# T12 — เก็บข้อมูลเดิมในฐาน local ที่เปิดซ้ำได้

วันที่: 16 พฤศจิกายน 2026 (Asia/Bangkok)

## ขอบเขต

ทำงานจากไฟล์สำรองในเครื่องเท่านั้น ไม่เชื่อมฐานเดิมหรือ CENTRAL ไม่มีการเขียนข้อมูลต้นทาง การเก็บรอบนี้เป็น **preservation** ของ 6 ตารางและการกันเลขทุก source ID ไม่ใช่ normalized history ที่ผู้ใช้ค้นผ่านเว็บได้ ไม่ใช่การ import บัญชี/PASSWORD, PDF หรือการเปิด production

ฐานปลายทางแยกจาก `dev:local` ที่สร้างข้อมูลทดสอบใหม่ทุกครั้ง อยู่ใน `.local/t12-persistent/<ชื่อ>/` และคงไฟล์หลัง shutdown ทั้งกรณีสำเร็จและล้มเหลว ไม่เขียนทับ `.local/t05-database.json` ไม่มีข้อมูลจำลอง ชุดเลข หรือ grants ตั้งต้น ปิด issuance gate ตั้งแต่สร้าง schema บัญชีอ่านไม่มีสิทธิ์อ่าน raw/ข้อมูลเก็บแยก หรือเปิด gate

## วิธีใช้งาน

ต้องมี MySQL executable รุ่นเดียวกับเครื่องมือซ้อมเดิม (`T05_MYSQLD` กำหนดแทนได้) ใช้พอร์ต local 3336 จับเฉพาะ `127.0.0.1` ถ้าพอร์ตถูกใช้งานจะปฏิเสธ ไม่ต่อฐานอื่นแทน แต่ละคำสั่งหยุด MySQL เมื่อทำเสร็จ ข้อมูลยังอยู่

```powershell
npm.cmd run migration:local -- import C:/Users/dench/Desktop/GenBookno_DB.sql.gz legacy-78629b14
npm.cmd run migration:local -- verify legacy-78629b14
```

`import` อ่าน dump แบบ parser ไม่ execute SQL ต้นทาง เก็บ `source.sql.gz` และ `source-manifest.json` แบบไม่เขียนทับไฟล์เดิม ตรวจ compressed SHA จากนั้น dry-run/rollback, commit, replay และตรวจทุกฟิลด์ ก่อน shutdown และเปิด MySQL ใหม่จากดิสก์เพื่อตรวจซ้ำ `verify` ไม่สร้างฐานที่ไม่มีและไม่สร้าง source batch ที่หาย

ฐานเดียวรับ snapshot เดียว ต้องไม่มี app-readable history, series, grants หรือตัวนับจริง ทุกคำสั่งตรวจ gate เป็น blocked ไม่มีคำสั่งเปิด gate ในชุดนี้ ข้อมูลที่ mapping ยังไม่ผ่านคงอยู่ใน raw ซึ่งแอปอ่านไม่ได้

## กู้คืนโดยไม่ทับฐานเดิม

เมื่อฐานเป้าหมายเสียหาย แต่ source/receipt ที่เก็บไว้ยังตรวจ SHA ผ่าน ให้สร้างฐานอีกชื่อหนึ่ง:

```powershell
npm.cmd run migration:local -- recover legacy-78629b14 legacy-recovered
npm.cmd run migration:local -- verify legacy-recovered
```

คำสั่งไม่ลบหรือแก้ฐานเก่า อ่านเฉพาะ compressed source ที่ผูกกับ receipt เดิม สร้างข้อมูลใหม่ผ่านเส้นทางนำเข้าและตรวจเหมือนกัน ต้องใช้ชื่อปลายทางต่างจากต้นทาง และพอร์ต 3336 ต้องว่าง ไม่ใช่การ restore ทับ production หาก source ถูกแทนด้วย gzip อื่น แม้ parse ได้ก็ต้องหยุดเพราะ SHA ไม่ตรง receipt

หากไฟฟ้าดับหรือ process ถูกฆ่า อาจเหลือ `runtime.lock` และ MySQL เดิม ต้องให้ผู้ดูแลตรวจว่า process ของ runtime นี้หยุดแล้วก่อนจัดการ lock ห้ามลบ lock แล้วเปิดอีกตัวขณะ MySQL เดิมยังรัน และห้ามลบโฟลเดอร์ data เพื่อแก้ปัญหาเริ่มระบบ ไฟล์ metadata `ready:false` หมายถึงสร้างไม่ครบ เครื่องมือจะไม่ initialize ทับ ให้ตรวจไฟล์ที่เก็บไว้และใช้ชื่อใหม่เมื่อเหมาะสม

## ไฟล์เฉพาะเครื่อง

- `data/`: ฐานปลายทางที่คงอยู่หลังหยุดโปรแกรม
- `source.sql.gz` / `source-manifest.json`: ต้นฉบับกู้คืนและ SHA ที่ตรวจรับตอนเก็บ
- `connection.json`: รหัสผ่านสุ่มเฉพาะ MySQL local และ marker ของ instance ต้องเก็บเป็นความลับ
- `reports/`: ผลตรวจที่มีจำนวน/แฮช/สถานะ ไม่มีชื่อหรือเนื้อหาหนังสือ
- `server.log`: log สำหรับผู้ดูแล ไม่เผยแพร่ทั้งโฟลเดอร์ `.local` ซึ่งมีข้อมูลจริงและ credential local

metadata/marker ตรวจว่าฐานที่เปิดใหม่เป็น instance และ datadir เดิม ไม่ยึดว่าแค่พอร์ตว่างหรือชื่อฐานตรงก็เพียงพอ ปฏิเสธ redirect ของ datadir และไฟล์ credential/log ปฏิเสธหลาย process ใช้ runtime เดียวพร้อมกัน ไม่มีการต่อ remote URL

## ผลทดสอบ

- ชุด migration เดิม 38/38 ผ่าน รวม rollback, การกันเลขซ้ำ/ยกเลิก, counter floor, concurrent allocation และสิทธิ์อ่าน
- ชุด persistent local 3/3 ผ่าน: shutdown/reopen/replay, จำลองล้มเหลวกลางนำเข้าแล้วไม่มีข้อมูลค้าง, กู้คืนไปอีกฐานหลังจำลองข้อมูลเสีย, ตรวจทุกฟิลด์, ปฏิเสธ source ที่ถูกแทน, marker/metadata ผิด, พอร์ตชน, raw-read และ gate-write ของบัญชีอ่าน
- lint และ typecheck ผ่าน; targeted lint ผ่านหลังเพิ่ม regression เรื่อง receipt
- QA อิสระตรวจแล้ว ไม่มี Critical/High/Medium ค้างในขอบเขต preservation local

## ผลนำเข้าไฟล์จริง

คำสั่ง `migration:local import` สำเร็จ exit 0 ในวันที่ 16 พฤศจิกายน 2026 ปลายทาง `.local/t12-persistent/legacy-78629b14/` ใช้ไฟล์สำรองชุดเดิม ไม่ใช่ snapshot ล่าสุดจาก server

SHA-256 ของ compressed source: `78629b14b7fcc8309aea012ae145fbae6dfde3a4d48a1b07fad9e0fb97411c82`

| ตาราง | แถวที่เก็บและตรวจทุกฟิลด์แล้ว |
|---|---:|
| book | 78 |
| bookdept | 155 |
| genbook | 171,506 |
| genbook_inform | 173,381 |
| genbook_dept | 38,214 |
| typebook | 4 |
| รวม | 383,338 |

กันเลข 171,506 source IDs ใน 492 scope ชุด/ปีครบ รวมเลขซ้ำและยกเลิก ไม่รวม/ลบ/เปลี่ยนเลขต้นทาง เก็บ disposition 47 แถว (45 restricted และ 2 unknown-time) รวม 55 เหตุผล reference ชุดที่หาย `00096`/`00097` คงอยู่ใน raw/reservation โดยไม่สร้างชุดปลายทางแทน

รายงานสองรอบใน `reports/` ยืนยัน dry-run, replay, raw/derived every-field verification และการ shutdown/reopen ตรวจจากดิสก์ผ่านทั้งหมด QA อิสระอ่านเฉพาะ receipt/report แล้วยืนยันจำนวน/แฮช/flags ตรงกัน และไม่มี `runtime.lock` ค้างหลังปิดฐาน ไม่มีการเชื่อมฐานเดิมหรือ CENTRAL ในรอบนี้

`appHistoryImported=false`, `countersSeeded=false`, `gate=blocked`, `productionReady=false` ข้อมูลเก็บอยู่ถาวรใน local แต่ยังไม่แสดงประวัติจริงในเว็บและไม่มีสิทธิ์ออกเลขจริงจากข้อมูลชุดนี้

ผลชุดจำลองไม่ใช่หลักฐานเปิดจริง เกณฑ์ T12 คง **3/6** ยังรอ mapping/สิทธิ์/ประวัติในเว็บ ข้อมูลรอบสุดท้ายและ cutover การกู้คืนไปอีกฐานผ่านกับข้อมูลจำลอง ไม่ได้จำลองทำลายฐานข้อมูลจริงที่เก็บไว้
