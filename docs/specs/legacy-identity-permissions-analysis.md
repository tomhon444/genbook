# หลักฐานบัญชีและสิทธิ์จากระบบเดิม — T02

ตรวจ 12 พฤศจิกายน 2026 (Asia/Bangkok) ตามแนวทางยึดระบบเดิมและปรับ UI เป็นหลัก รอบแรกอ่าน source ต่อมาตรวจ config/HTTP GET ตาม HTTP-01/02 โดยไม่ล็อกอิน หลังผู้ใช้อนุมัติจึงสร้าง localhost-only sandbox และทดสอบ login ด้วยข้อมูลสังเคราะห์ตามส่วนท้าย ไม่ติดต่อบัญชีคณะ ไม่แสดงข้อมูลบัญชีจริง/รหัสผ่าน และไม่แก้ source ระบบเดิม

## ขอบเขตหลักฐาน

- Source: `C:/laragon/www/book-number`, HEAD `51458d1f8470c53aed8e687a83027478c36789ee`; working tree มีการแก้ login, library และ config/runtime จึงไม่ใช่หลักฐาน production
- เทียบ diff `user.php` รอบนี้: working tree เพิ่มการปฏิเสธ input ว่าง/ชนิดไม่ถูกต้อง แต่เส้นทางฐานข้อมูลบุคลากรโดยตรงและ SOAP ที่คอมเมนต์ไว้มีอยู่ใน HEAD แล้ว ไม่คัดลอก config secrets ลงรายงาน
- [T02](../tickets/02-identity-permissions.md) เป็นบันทึกคำยืนยันและเกณฑ์รับงาน; รายงานนี้บอกพฤติกรรมที่ตรวจพบ ไม่เปลี่ยนคำยืนยันทางธุรกิจ

## การล็อกอินและข้อมูลตัวตน

| ประเด็น | หลักฐาน source | ข้อสรุปและข้อจำกัด |
|---|---|---|
| ทางเข้า | [user.php:30](C:/laragon/www/book-number/application/controllers/user.php:30) | รับ username/password ผ่าน POST; [บรรทัด 46](C:/laragon/www/book-number/application/controllers/user.php:46) คอมเมนต์ SOAP แล้ว query `STAFF_INFO` ด้วย `LOGIN`, `PASSWORD`, `ACTIVE=1` ไม่ใช่ SSO และไม่พิสูจน์รูปแบบการเก็บรหัสผ่านต้นทาง |
| บุคลากรที่ผ่านขั้นถัดไป | [staff_info_model.php:10](C:/laragon/www/book-number/application/models/central/staff_info_model.php:10) | `STAFF_ID`, `ACTIVE='1'`, `START_DATE IS NOT NULL` และ join `PREFIX`; ต้องยืนยันว่ากฎสถานะ/สังกัดนี้ยังใช้จริง |
| เจ้าของและหน่วยงาน | [user.php:61](C:/laragon/www/book-number/application/controllers/user.php:61) | `STAFF_ID` → `user_id`, `DEPT_ID` → `user_dept` ใน session; ไม่ยืนยันว่า ID ไม่เปลี่ยนหรือไม่ถูกนำกลับมาใช้ |
| บทบาทเมื่อเข้าใช้ | [user.php:66](C:/laragon/www/book-number/application/controllers/user.php:66) | ถ้ามี `userlevel` ใช้ค่านั้น ก่อน fallback เป็นระดับ 3 เมื่อมี `userbook`; หากไม่มีทั้งคู่ยัง logged_in ได้แต่ระดับว่าง ต้องแยกผู้เข้าสู่ระบบได้จากผู้มีสิทธิ์ชุดเลข |
| ออกจากระบบ | [user.php:117](C:/laragon/www/book-number/application/controllers/user.php:117) | ล้าง user/department/role/logged_in และทำลาย session ของผู้ใช้ที่ logout ไม่ใช่การเพิกถอน session ของบัญชีอื่น |
| ตรวจคำขอถัดไป | [genbook.php:5](C:/laragon/www/book-number/application/controllers/genbook.php:5), [genbooklist.php:5](C:/laragon/www/book-number/application/controllers/genbooklist.php:5) | constructor ที่ตรวจดู `logged_in` ไม่ได้ตรวจสถานะบุคลากรหรือ refresh department/role ทุกคำขอ การ lookup บุคลากรเพื่อแสดงชื่อในฟอร์มที่ [genbook.php:596](C:/laragon/www/book-number/application/controllers/genbook.php:596) ไม่ใช่หลักฐานว่าระงับ session |
| เวลา session ใน local config | `application/config/config.php:249–256` | expiration 7200 วินาที, ไม่หมดเมื่อปิด browser, ไม่เก็บ session ใน DB, update interval 300 วินาที เป็นค่า config ไม่ใช่ผลทดสอบ runtime และ update interval ไม่ได้พิสูจน์ว่าโหลดสิทธิ์ใหม่ |

ระบบใหม่ต้องรักษาประสบการณ์บัญชีเดิม แต่ต้องตรวจช่องทางเชื่อมที่คณะอนุญาตจริงก่อนนำไปใช้ ไม่เพิ่มฐานรหัสผ่านในแอปใหม่หรือคัดลอกการตรวจรหัสผ่านที่ไม่ปลอดภัยโดยอ้างว่าเป็นระบบเดิม

## ย้ายหน่วยงาน พ้นสภาพ และประวัติหนังสือ

### ผู้จัดการชุดเลขกับผู้มีสิทธิ์ขอเลข

| ข้อมูล/หน้าจอ | หลักฐาน | ความหมายที่ตรวจพบ |
|---|---|---|
| `userlevel` | [userlevel_model.php:39](C:/laragon/www/book-number/application/models/genbook/userlevel_model.php:39), [user.php:66](C:/laragon/www/book-number/application/controllers/user.php:66) | login lookup ด้วย `staff_id` แล้วตั้ง role จากค่า `userlevel` |
| `userbook` | [bookdept_model.php:157](C:/laragon/www/book-number/application/models/genbook/bookdept_model.php:157), [frmall.php:72](C:/laragon/www/book-number/application/views/bookmanage/frmall.php:72) | mapping ผู้มีสิทธิ์จัดการชุดเลข: `staff_id`, `bookdept_bookdeptid`, `userlevel_iduserlevel` ไม่ใช่ตาราง grant ขอเลข |
| `bookdept_user` | [bookdept_user_model.php:57](C:/laragon/www/book-number/application/models/genbook/bookdept_user_model.php:57) | grant ผู้ใช้เลขรายชุดเป็นคู่ `staff_id` + `bookdept_id`; `staff_list` และ `agent_list` ในฟอร์มนี้เป็นผู้รับ grant ไม่ใช่ manager |
| ขอบเขตเลือกชุด | [bookdept.php:36](C:/laragon/www/book-number/application/controllers/bookdept.php:36), [178](C:/laragon/www/book-number/application/controllers/bookdept.php:178) | role 0/1 เห็นทุกชุด คนอื่นเลือกชุดจาก `userbook`; ค่า 0 ปรากฏในเงื่อนไขแต่หน้าที่และการแต่งตั้งยังไม่ชัด ห้ามตั้งเป็น superadmin เอง |
| ให้สิทธิ์ข้ามหน่วยงาน | [bookdept.php:266](C:/laragon/www/book-number/application/controllers/bookdept.php:266), [viewstaff.php:77](C:/laragon/www/book-number/application/views/bookdept/viewstaff.php:77) | มีตัวเลือกบุคลากรหน่วยงานอื่นสำหรับ grant ใช้เลข ไม่ได้ให้สิทธิ์อ่านหนังสือไม่เผยแพร่ข้ามหน่วยงาน |
| ถอน grant ใช้เลข | [bookdept.php:339](C:/laragon/www/book-number/application/controllers/bookdept.php:339), [bookdept_user_model.php:111](C:/laragon/www/book-number/application/models/genbook/bookdept_user_model.php:111) | ลบแถวตาม `bookdept_user_id` ที่รับจาก URL ต้องตรวจขอบเขตผู้กระทำในระบบใหม่ |

`userbook.userlevel_iduserlevel='2'` ไม่ใช่ session role โดยตรง เพราะ login fallback ตั้งระดับ 3 เมื่อพบ `userbook` ต้องทำ mapping อย่างชัดเจนแทนการนำตัวเลขจากทุกตารางมาปนกัน

### ข้อจำกัดการจัดการสิทธิ์ที่ต้องแก้เมื่อพัฒนา

- **High — ตรวจสิทธิ์ mutation ไม่ครบ:** [userlevel.php:8](C:/laragon/www/book-number/application/controllers/userlevel.php:8), [bookdept.php:9](C:/laragon/www/book-number/application/controllers/bookdept.php:9), [bookmanage.php:9](C:/laragon/www/book-number/application/controllers/bookmanage.php:9) ตรวจ login แต่ `userlevel/save:60`, `userlevel/del:95`, `bookdept/save:315`, `bookdept/del:339`, `bookmanage/save:278` ไม่พบการตรวจ role/ขอบเขตซ้ำในเส้นทางที่อ่าน การซ่อนเมนูจึงไม่ใช่หลักฐานว่า server บังคับสิทธิ์แล้ว
- **Medium — ถอน manager คนสุดท้าย:** [bookdept_model.php:198](C:/laragon/www/book-number/application/models/genbook/bookdept_model.php:198) ข้ามการเปลี่ยน mapping เมื่อ `agent_list` ว่าง จึงไม่รับรองว่าล้าง manager ทั้งหมดสำเร็จ
- **Medium — cleanup mapping:** [userbook_model.php:42](C:/laragon/www/book-number/application/models/genbook/userbook_model.php:42) ใช้ `book_idbook` ใน `set_null` ขณะที่ mapping ส่วนอื่นใช้ `bookdept_bookdeptid`; ต้องตรวจ schema/ทดสอบก่อนยืนยันผลจริง
- UI/CRUD ที่ [userlevel_model.php:54](C:/laragon/www/book-number/application/models/genbook/userlevel_model.php:54) เพิ่มเพียงค่าระดับ และ update ด้วย `iduserlevel`; ยังไม่พบ workflow แต่งตั้ง `staff_id` เป็น admin ที่ครบในหน้าที่ตรวจ จึงต้องให้เจ้าของระบุผู้มีอำนาจแต่งตั้ง
- ไม่พบ audit ผู้มอบถอน/เหตุผล/ก่อนหลังใน mutation paths ที่ตรวจ ไม่อ้างว่าไม่มี audit ทั้งระบบ และไม่อ้างว่าได้ exploit ช่องโหว่ใน production

กรณีตรวจรับเพิ่ม: P13 admin มอบถอน manager ได้แต่ผู้ใช้ทั่วไปไม่ได้; P14 manager ชุด A มอบถอนผู้ใช้ใน A ได้แต่ปลอมชุด B ไม่ได้; P15 ถอน grant แล้วคำขอเลขถัดไปปฏิเสธแม้ session ยังอยู่; P16 ลบ manager คนสุดท้ายมีผลตาม policy ไม่คง grant เงียบ ๆ; P17 grant ข้ามหน่วยงานไม่เพิ่มสิทธิ์อ่านลับ/แก้แทนและต้องมี audit ทุกกรณี ผู้ใช้รับรองขอบเขต manager แล้ว 12 พฤศจิกายน 2026 พร้อมกฎย้ายหน่วยงาน/พ้นสภาพ ดูผลคาดหวังปัจจุบัน P12–P18 ใน T02 ไม่ใช่ผลรันจริง

| เหตุการณ์ | พฤติกรรมที่ไล่จากโค้ดได้ | สิ่งที่ยังสรุปเป็นนโยบายไม่ได้ |
|---|---|---|
| เปลี่ยน `DEPT_ID` ระหว่างมี session | session เก็บค่าตอน login; ไม่พบการ refresh ในเส้นทาง constructor ที่ตรวจ | ความเร็วในการเปลี่ยนสิทธิ์จริง; ไม่รับรองว่า session เดิมต้องคงหน่วยงานเก่าในระบบใหม่ |
| พ้นสภาพ/`ACTIVE` เปลี่ยน | login ใหม่ต้องผ่านตัวกรองบุคลากร; session เดิมในเส้นทางที่ตรวจยังผ่าน `logged_in` ได้ | ไม่พบกลไก revoke ครบทั้งระบบ จึงยืนยันการตัดสิทธิ์ทันทีไม่ได้ |
| ออกหนังสือ | [genbook_model.php:280](C:/laragon/www/book-number/application/models/genbook/genbook_model.php:280), [บรรทัด 360](C:/laragon/www/book-number/application/models/genbook/genbook_model.php:360) เก็บ `user_request`, `user_dept`, `user_login` แยกกัน | `user_request` รับจาก POST ได้ ไม่ใช่หลักฐานอนุมัติขอแทน; ต้องแยกผู้ขอเลขกับผู้ทำรายการใน migration |
| แก้หนังสือ | [genbook_model.php:614](C:/laragon/www/book-number/application/models/genbook/genbook_model.php:614) และ [642](C:/laragon/www/book-number/application/models/genbook/genbook_model.php:642) อาจเขียนเจ้าของ/หน่วยงานใหม่ตาม POST | ห้ามถือว่า `user_dept` เป็น snapshot ที่ไม่เปลี่ยนตลอดไป; ต้องตรวจข้อมูลจริงใน T12 และไม่เปิดโอนเจ้าของโดยไม่มี policy |
| แสดงชื่อ/หน่วยงาน | [genbook.php:1164](C:/laragon/www/book-number/application/controllers/genbook.php:1164) lookup หน่วยงานปัจจุบันของผู้ขอ แต่การกรองใช้หน่วยงานที่เก็บกับหนังสือ | ชื่อหน่วยงานที่แสดงอาจต่างจากหน่วยงานที่ใช้ตัดสินสิทธิ์ ห้ามสรุปนโยบายจากหน้าจอเพียงอย่างเดียว |

## ความต่างจากตารางสิทธิ์ที่ผู้ใช้ยืนยัน

| รหัส | พฤติกรรม source / หลักฐาน | กติกาที่ต้องคงในระบบใหม่ |
|---|---|---|
| D1 | [genbook.php:1204](C:/laragon/www/book-number/application/controllers/genbook.php:1204) ให้ระดับ 1/2 ผ่านการกรองไม่ลับ/ไม่เผยแพร่แม้ต่างหน่วยงาน | สิทธิ์ผู้ดูแลข้อมูลอ้างอิงไม่ข้ามกฎหน่วยงานของหนังสือโดยอัตโนมัติ |
| D2 | [genbook.php:1224](C:/laragon/www/book-number/application/controllers/genbook.php:1224) เมื่อเผยแพร่เพิ่มรายการโดยไม่ตรวจ secret ซ้ำใน branch นี้ | ลับมีลำดับเหนือเผยแพร่ เฉพาะเจ้าของเห็นตามคำยืนยัน |
| D3 | [genbook.php:1313](C:/laragon/www/book-number/application/controllers/genbook.php:1313), [genbook_model.php:5](C:/laragon/www/book-number/application/models/genbook/genbook_model.php:5) นับรายการตามระดับ/หน่วยงาน/ผู้ขอ โดยไม่ใช้กฎลับ/เผยแพร่ครบ | รายการและจำนวนต้องผ่านกฎอ่านเดียวกันก่อนแบ่งหน้า |
| D4 | [view_search.php:112](C:/laragon/www/book-number/application/views/genbook/view_search.php:112) และ [viewall.php:58](C:/laragon/www/book-number/application/views/genbook/viewall.php:58) สร้างลิงก์ `uploads/<year>/<file>` โดยตรง | ระบบใหม่ตรวจสิทธิ์เมื่อดาวน์โหลดทุกครั้ง การเปิดไฟล์เดิมโดย URL จริงยังไม่ได้ทดสอบ และการป้องกันระดับ web server ยังไม่ยืนยัน |
| D5 | [genbook.php:1015](C:/laragon/www/book-number/application/controllers/genbook.php:1015) เรียก model update; [genbook_model.php:584](C:/laragon/www/book-number/application/models/genbook/genbook_model.php:584) รับ ID จาก POST และไม่พบ owner predicate ในเส้นทางที่ตรวจ | เฉพาะเจ้าของแก้ได้ ตรวจสิทธิ์ server ทั้งหนังสือและไฟล์ ไม่รับ owner/department ที่ปลอมมาเป็นสิทธิ์ |
| D6 | **High — ความเสี่ยง SQL injection จาก static source:** [genbook_model.php:631](C:/laragon/www/book-number/application/models/genbook/genbook_model.php:631) ประกอบ raw UPDATE จาก POST รวม title และ ID โดยไม่ใช้ parameter binding ในเส้นทางที่ตรวจ | ระบบใหม่ใช้ parameterized SQL/ตัว query ที่ปลอดภัยร่วมกับ authorization ไม่คัดลอก raw SQL นี้ ไม่รัน exploit หรือยืนยันผลกระทบ production |

ข้อ D1–D6 เป็นข้อค้นพบ static สำหรับการออกแบบระบบใหม่ ไม่อ้างว่าทดสอบโจมตีหรือยืนยันการรั่วใน production แล้ว ต้องไม่คัดลอกเงื่อนไขเหล่านี้ข้ามคำยืนยัน T02

## วิธีใช้ identity สำหรับทดสอบ (ข้อกำหนดการทดสอบ T02)

- Unit/integration: ใช้บุคลากรสังเคราะห์ A–E ตาม T02 และสลับตัวอ่าน identity ภายใน test harness เท่านั้น ไม่เพิ่ม endpoint/header/query สำหรับเลือกผู้ใช้ในแอปจริง
- E2E: แยกกระบวนการทดสอบและข้อมูลออกจาก production artifact; ทดสอบการเชื่อมจริงเฉพาะบัญชี/สภาพแวดล้อมที่ได้รับอนุญาต หากใช้ตัวจำลองให้รายงานว่าไม่พิสูจน์บัญชีคณะจริง
- production: ไม่มี mock provider, master password หรือ fallback login; หาก config เลือก test adapter ใน production ต้องปฏิเสธการเริ่มระบบหรือ build ตามวิธีที่ T04 เลือก ไม่ใช้เพียงการซ่อนเมนู
- กรณีต้องทดสอบใน T04: login สำเร็จ/รหัสผิด/ระงับ/ไม่พบ ID/หน่วยงาน; provider fault; logout แล้ว session ใช้ซ้ำไม่ได้; ปลอม identity header/cookie/role ไม่เพิ่มสิทธิ์; ถอน grant แล้วขอเลขไม่สำเร็จ; provider ล่มไม่สร้าง session ใหม่
- **Blocker integration ปัจจุบัน:** ผู้ใช้เลือกทดสอบเฉพาะ localhost ด้วยข้อมูลจำลอง มี runtime compatibility pass ตามส่วน sandbox ด้านท้ายแล้ว ไม่เชื่อมปลายทาง `central` ใน config เดิม และยังไม่มีหลักฐาน faculty integration/ID ถาวรที่รับรอง จึงยังไม่ผ่าน AC1

ส่วนนี้ทำให้ AC5 มีวิธีทดสอบที่ระบุชัดและรายงาน blocker แล้ว ไม่ได้หมายความว่าเขียนหรือรันทดสอบเหล่านี้ผ่านแล้ว งาน implementation/ตรวจ artifact จริงอยู่ใน T04

## ผลตรวจและงานต่อ (รอบก่อนสร้าง synthetic sandbox)

### ตรวจ config และ HTTP ของสภาพแวดล้อมที่ผู้ใช้ระบุ (12 พฤศจิกายน 2026)

ผู้ใช้ระบุ `http://localhost/book-number/genbook/form` และ `C:/laragon/www/book-number/application/config` แล้วสั่งดำเนินการตรวจต่อ รอบนี้อ่านไฟล์ config แบบปิดบังค่า credential ในผลลัพธ์ ไม่รันไฟล์ PHP/config และไม่คัดลอกรหัสผ่าน username DB หรือ host ของระบบบุคลากรลง repository ตรวจโครงสร้าง active config โดยตัด block comments ออกก่อนสรุป

| สิ่งที่ตรวจ | ผลที่ได้ | ขอบเขตหลักฐาน |
|---|---|---|
| [database.php:48](C:/laragon/www/book-number/application/config/database.php:48) และ [51](C:/laragon/www/book-number/application/config/database.php:51) | default group `genbook`, ฐานหนังสือ `GenBookno_DB`, host loopback, driver `mysqli` | เป็นค่าจากไฟล์ local ไม่ได้ query ฐานข้อมูลหรือยืนยันว่า DB ใช้งานได้ |
| [database.php:67](C:/laragon/www/book-number/application/config/database.php:67) | group `central` ใช้ `CENTRAL`/`mysqli` และ host ไม่ใช่ loopback มีการกำหนด credential ไว้แต่ไม่เปิดเผยค่า | เว็บ localhost ไม่ได้แปลว่าฐานบัญชีเป็น sandbox บนเครื่องเดียวกัน ต้องยืนยันปลายทางและสิทธิ์ทดสอบก่อนส่งข้อมูลบัญชี |
| [autoload.php:55](C:/laragon/www/book-number/application/config/autoload.php:55) | active libraries `template`, `session`, `extralib`; รายการที่มี `database` ใน comment ไม่ใช่ค่า active | เชื่อม DB ใน controller/model ตามเส้นทางที่ตรวจ ไม่สรุปจาก comment |
| [routes.php:41](C:/laragon/www/book-number/application/config/routes.php:41) | default controller `welcome` | ระบุหน้าทางเข้าเดิม |
| HTTP-01: `GET /book-number/genbook/form` โดยไม่มี Cookie/credentials | HTTP 302, Location กลับ origin เดิม path `/book-number/`; ไม่พบ PHP/DB error ใน response | พิสูจน์เส้นทางปฏิเสธ unauthenticated ของ route นี้หนึ่งกรณี ไม่ใช่ทุก endpoint หรือผล login |
| HTTP-02: `GET /book-number/` โดยไม่มี Cookie/credentials | HTTP 200, มี form POST ไป `/book-number/user/authen` ที่ origin เดิม มีช่อง `uname`/`upass` และ input แบบ password; ไม่พบ PHP error ใน response | หน้าล็อกอินตอบสนองและ action ตรง source ไม่ส่งฟอร์ม ไม่อ่านค่าที่กรอก และไม่สร้าง session ที่ยืนยันตัวตน |

HTTP checks ใช้คำขออ่านผ่าน Node HTTP fetch แยกจาก browser ไม่ใช้ Cookie/session ของผู้ใช้ ไม่บันทึก raw HTML/headers/Set-Cookie ลงไฟล์หรือรายงาน และไม่เรียก `user/authen` จึงไม่ส่งรหัสผ่านไปยัง `central` ไม่ออกเลข ไม่อัปโหลดไฟล์ ไม่แก้ข้อมูล

**ผลต่อ AC1:** ยังไม่ผ่าน — ยืนยัน config และหน้าทางเข้าได้ แต่ยังไม่มีผล login สำเร็จหรือหลักฐาน mapping `STAFF_ID`/`DEPT_ID` ใน runtime ต้องให้ผู้ใช้ยืนยันว่า `central` ที่ config อ้างถึงเป็นปลายทางที่ทดสอบได้ และใช้บัญชีทดสอบที่ผู้ใช้กรอกเอง จากนั้นตรวจหลักฐานแบบไม่คัดลอกข้อมูลบุคลากรจริง ระยะเวลารับรู้การเปลี่ยนสถานะจากต้นทางยังไม่ยืนยัน

- ไม่มีโค้ดแอป/ฐานข้อมูลเปลี่ยน ไม่รัน login, concurrency หรือ migration; ตรวจ unauthenticated rejection เฉพาะ HTTP-01 ยังไม่ทดสอบสิทธิ์หลังล็อกอินหรือสิทธิ์รายรายการ ใช้ผล lint/typecheck รอบก่อนเพราะรอบนี้เปลี่ยน Markdown เท่านั้น
- ต้องเทียบการจัดการ `userlevel`, `userbook`, `bookdept_user` และบันทึกผู้มอบถอนสิทธิ์ที่ตั้งใจอนุญาตแยกจากช่องโหว่ใน controller
- AC2/AC4 มีคำยืนยันผู้มอบถอนสิทธิ์และกฎย้ายหน่วยงาน/พ้นสภาพแล้วตามบันทึก T02; เหลือ AC1 เอกสารรับรองหรือผลทดสอบเชื่อม identity ที่ได้รับอนุญาต ไม่ปิดจาก source เพียงอย่างเดียว
- QA รอบนี้ตรวจลิงก์ local ในรายงาน/T02/README และเทียบหลักฐานตัวอย่างกับ source ไม่พบ Medium ขึ้นไปในเอกสารหรือข้อมูลลับรั่ว; ยืนยัน AC5 เป็นเกณฑ์ระบุวิธีทดสอบ/รายงาน blocker ไม่ใช่ runtime pass พบความเสี่ยง SQL injection เดิมเพิ่มเติมจึงบันทึก D6 ไว้ส่งต่อ implementation ข้อเสี่ยง High/Medium ในรายงานเป็นของ source เดิม ยังไม่ได้แก้โค้ดระบบเก่าหรืออ้างว่าระบบใหม่ผ่านแล้ว
- QA รอบ config/HTTP: ไม่พบ Medium ขึ้นไปหรือ secrets ในเอกสาร AC1 ยังคงไม่ผ่านถูกต้อง แก้ถ้อยคำ Low ให้แยก HTTP unauthenticated check ออกจากการทดสอบสิทธิ์หลัง login และแยกบันทึกก่อน/หลังผู้ใช้ให้ URL แล้ว

## Localhost-only sandbox ที่ผู้ใช้อนุมัติ

12 พฤศจิกายน 2026 ผู้ใช้ตอบ “เอาตามที่แนะนำ” ต่อการแยกฐานบัญชีจำลองในเครื่อง จัดทำ [เครื่องมือและคู่มือ](../../tools/legacy-sandbox/README.md) โดยใช้ PHP login/query เดิมในสำเนา testing และข้อมูลใหม่ทั้งหมด:

- เว็บ `http://127.0.0.1:18082/` bind เฉพาะ loopback; config สำเนาชี้ `127.0.0.1:3306` ทั้ง `central` และ `genbook` ไม่คัดลอก database.php เดิมไปใช้ในเว็บสำเนา
- สร้างฐานใหม่ `t02_central`/`t02_genbook` กับผู้ใช้ใหม่ `t02_fixture` มีเพียง SELECT ไม่อ่าน/คัดลอกข้อมูลจากฐานเดิม; bootstrap ใช้ข้อมูลการเชื่อมต่อ group genbook เดิมเฉพาะในหน่วยความจำหลังตรวจ loopback เพื่อสร้าง fixture ใหม่เท่านั้น ไม่ใช้ group central เดิม
- เก็บ runtime สำเนาและรหัสสุ่มของบัญชีจำลองใน `.local/legacy-sandbox` ซึ่ง Git ignore ไม่มี secrets ใน source หรือผลทดสอบ ไม่มี endpoint ทดสอบเพิ่มใน Next.js app
- ใช้ MySQL 5.6.51 ที่มีอยู่พร้อม PHP 5.3.29 CGI; DDL เป็น subset สังเคราะห์ที่เข้ากับ query ไม่ใช่ schema คณะจริง; collation `utf8mb4_unicode_ci` รองรับ runtime เดิม
- ก่อนหน้านี้พยายามเริ่ม MySQL อีก instance แล้วพบดิสก์ไม่พอ จึงลบเฉพาะไฟล์ sandbox ที่สร้างล้มเหลวหลังตรวจ absolute paths ว่าอยู่ใต้ `.local` แล้วเปลี่ยนมาใช้ MySQL local ที่มีอยู่กับ schemas ใหม่ ไม่แก้ Apache/Laragon หรือข้อมูลใน schemas เดิม

### ผลตรวจ runtime ด้วยข้อมูลจำลอง

คำสั่ง `node tools/legacy-sandbox/test.mjs`: **12 กลุ่มผ่าน**

| กรณี | ผล |
|---|---|
| ไม่มี session เปิดฟอร์ม/identity | ฟอร์ม redirect ไป login; identity ตอบ 401 |
| หน้าล็อกอินเดิม | render password form ได้ |
| owner / other / manager | POST ผ่านโค้ด user/authen เดิม, redirect genbook, เปิด dashboard ได้ |
| mapping owner | `STAFF_ID=T02-OWNER`, `DEPT_ID=T01`, role ว่าง |
| mapping other | `STAFF_ID=T02-OTHER`, `DEPT_ID=T02`, role ว่าง |
| mapping manager | `STAFF_ID=T02-MANAGER`, `DEPT_ID=T01`, role 3 ตาม fallback userbook แม้ mapping userbook เก็บค่า 2 |
| รหัสผิด / inactive / START_DATE ว่าง / PREFIX ไม่พบ | ไม่สร้าง authenticated session |
| เส้นทาง save/debug/config, บัญชีที่ไม่ใช่ t02_, Host ต่าง origin | wrapper ตอบ 403 |
| NODE_ENV production | launcher ปฏิเสธก่อนเปิด listener/เชื่อม DB |
| logout | cookie ใหม่เข้าไม่ได้; cookie เก่าที่ replay ถูกปฏิเสธโดย wrapper sandbox เท่านั้น ดูข้อจำกัดด้านล่าง |

คำสั่ง `php tools/legacy-sandbox/verify.php <private-settings>`: ตรวจ MySQL **5.6.51**, staff สังเคราะห์ **6 แถว**, หนังสือ **0 แถว**, INSERT ของบัญชีแอปถูกปฏิเสธ code 1142 ภายใน transaction ที่ rollback และ SOAP adapter ที่ไม่ได้ใช้คืน FALSE แบบไม่ติดต่อภายนอก

### ข้อจำกัดและการส่งต่อ

- พบจริงใน sandbox ก่อนเพิ่ม wrapper mitigation ว่า cookie เดิมก่อน logout ยัง replay แล้ว authenticated ได้ เนื่องจาก session เดิมอยู่ฝั่ง client เป็นความเสี่ยงของโค้ดเดิม ไม่รับรองว่า production ถูกแก้แล้ว
- wrapper ทดสอบเก็บ hash ของค่า session ที่ logout แล้วเพื่อปฏิเสธ replay และหมุน encryption key เมื่อ resume; การแก้ production ต้องใช้ server-side invalidation ใน T04 แยกจาก test harness
- SOAP ของสำเนาถูกแทนด้วย deny-only adapter ถ้า source เปลี่ยนกลับไปเรียก SOAP จะถูกปฏิเสธ ไม่กลายเป็น login ปลอมสำเร็จและไม่ติดต่อ WSDL เดิม
- ไม่เปิด save/issue/upload routes และ DB user ไม่มีสิทธิ์เขียน ไม่มีการทดสอบออกเลข concurrency หรือย้ายประวัติ
- เว็บเดิม `http://localhost/book-number/` และ config เดิมยังเหมือนเดิม ผู้ทดสอบต้องใช้ URL port 18082 และบัญชีสังเคราะห์ที่สร้างใน `.local` เท่านั้น
- รหัสผ่านใน fixture ใช้รูปแบบที่ query เดิมต้องการเพื่อทดสอบ compatibility ไม่ใช่ข้อเสนอการเก็บรหัสผ่าน production
- ผลนี้ทำให้ทดสอบในเครื่องได้ตามที่ผู้ใช้ขอ แต่ไม่ยืนยัน protocol/contract และรหัสบุคลากรถาวรของบริการบัญชีคณะ จึงคง T02 4/5 และไม่ปิด AC1 จากข้อมูลสังเคราะห์
- หยุดเฉพาะเว็บด้วย `node tools/legacy-sandbox/start.mjs --stop`; เปิดใหม่ใช้ `--resume` ซึ่งไม่ seed ซ้ำ ไม่มี DROP/DELETE/TRUNCATE schema เดิมหรือ fixture อัตโนมัติ
- ผลตรวจสุดท้าย: 12 กลุ่ม runtime ผ่าน, verify ฐานข้อมูลผ่าน, PHP syntax ผ่าน, `npm.cmd run lint` และ `npx.cmd tsc --noEmit` ผ่าน QA ทบทวน sandbox แล้วไม่พบ Critical/High/Medium ค้างหลังแก้ replay coverage, SOAP deny adapter และการสร้าง config/index/key ใหม่ทุก resume ตรวจ hash adapter ที่ติดตั้งจริงก่อนเปิดเว็บแล้ว
- แก้หน้าไม่มีสไตล์หลังผู้ใช้ส่งภาพ dashboard: regression เดิมพบ `/css/templatemo_style.css` ตอบ403 จึงเพิ่ม static handler แบบ extension allowlist/GET-HEAD/realpath confinement/nosniff และ aliases สองจุดที่พาธเดิมคลาดเคลื่อนตามคู่มือ sandbox ไม่เปิด PHP/config/เส้นทางแก้ข้อมูล ทดสอบ template assets19รายการรวมภาพจากCSSผ่าน และคำขอ traversal/PHP/POST/cross-Origin ถูกปฏิเสธ ไม่ได้ตรวจภาพหน้าจอหลังแก้ด้วยเบราว์เซอร์
