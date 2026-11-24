# T04 — เข้าสู่ระบบรุ่น local

ตรวจเมื่อ 12 พฤศจิกายน 2026 (Asia/Bangkok) ตามขอบเขต T04 และกฎ T02 ที่ผู้ใช้ยืนยัน

## วิธีใช้งาน

รัน `npm.cmd run dev:local` จาก `genbook-no` แล้วเปิด **http://127.0.0.1:3000/login** บัญชีอยู่ใน `.local/t04-account.json` เป็นข้อมูลสังเคราะห์ที่สร้างใหม่ทุกครั้ง ไม่ใช่บัญชีคณะจริง หยุดด้วย Ctrl+C การเริ่มบริการใหม่ทำให้ session เดิมทั้งหมดใช้ไม่ได้

กรอกบัญชี → ตรวจฝั่ง server → พื้นที่ส่วนตัวแสดงตัวตน/หน่วยงาน → ออกจากระบบ การเข้า `/workspace` และ `/api/me` ตรวจ session ฝั่ง server ทุกครั้ง ไม่รับ user/role/dept จาก browser เป็นสิทธิ์

## การแยก identity

- `lib/auth/server.ts` เป็น server-only adapter ปัจจุบันรองรับเฉพาะ `NODE_ENV=development`, `AUTH_PROVIDER=local`, URL ที่เป็น `http://127.0.0.1:<port>` และ secret สุ่มใน process environment
- ตัวจำลอง `tools/local-auth/provider.mjs` ทำงานเป็นบริการ loopback แยก ไม่มี import เข้า runtime ของ Next.js ใช้ secret ระหว่าง server กับ server และปฏิเสธ browser Origin
- `run.mjs` สร้างรหัสผ่าน/secret แบบสุ่ม เปิด Next.js บน 127.0.0.1 เท่านั้น ไม่พิมพ์รหัสผ่าน/cookie/secret ใน log บัญชีสังเคราะห์เขียนเฉพาะ `.local/` ที่ ignore ไว้
- production ยังไม่มี faculty adapter จึงปฏิเสธการสร้าง session; `next.config.ts` และ instrumentation ปฏิเสธ local config ไม่ fallback ไปบัญชีจำลอง
- ไม่แตะ sandbox PHP, MySQL หรือ central คณะ และไม่เพิ่ม SSO/สิทธิ์ผู้ดูแล/สิทธิ์ชุดเลขจาก login

## Session และความปลอดภัย

token สุ่ม 256 บิต ใช้เป็น opaque cookie; บริการเก็บเฉพาะ SHA-256 ของ token ในหน่วยความจำ พร้อมชื่อบัญชีและเวลา expiry ไม่ใส่ตัวตนหรือ role ใน cookie ตรวจสถานะบุคลากรภายในคณะและข้อมูลที่จำเป็นก่อนสร้าง/ใช้ session ส่งออกเพียงรหัสบุคลากร ชื่อ รหัสหน่วยงาน และชื่อหน่วยงาน

cookie เป็น HttpOnly, SameSite=Lax, Path=/ และไม่มี Domain; `Secure=false` ใช้เฉพาะ HTTP loopback ใน development โดย production ไม่สามารถสร้าง cookie นี้ได้ ข้อมูล session/API ใช้ no-store ไม่มี cache ของการตรวจสิทธิ์; หน้า Server Component อ่าน cookies หลัง Suspense ตาม cacheComponents

POST login/logout ต้องมี Origin และ Host เป็น literal 127.0.0.1 พร้อมพอร์ตตรงกัน ไม่เชื่อ forwarded headers Next.js แปลง hostname ภายในเป็น localhost จึงตรวจ port และ loopback Host/Origin โดยตรง การ login ซ้ำหมุน token และถอน token เดิม; logout ถอนบน server ก่อนล้าง cookie หาก provider ล่มไม่รายงานว่า logout สำเร็จ

เวลาอายุ session **30 นาทีแบบ absolute** เป็นค่าทางเทคนิคเฉพาะ local ไม่ใช่นโยบายที่เจ้าของรับรอง ไม่มี sliding renewal หน้าเปิดค้างเปลี่ยนกลับ login เมื่อหมดอายุ และโหลดใหม่เมื่อกลับจาก browser back cache ทุก protected request ยังตรวจ server แยกต่างหาก บริการจำกัด login รวม 30 ครั้งต่อนาทีและมี timeout ฝั่ง adapter 3 วินาที

ข้อจำกัด: ตัวจำลองเป็น process เดียว บัญชีเป็น snapshot ตอนเริ่ม ไม่มี interface แก้สถานะ/grant ระหว่างรัน ต้อง restart เพื่อเปลี่ยนข้อมูลซึ่งถอนทุก session ใช้สำหรับ local เท่านั้น การตรวจสถานะสด การพ้นสภาพ ย้ายหน่วยงาน durable revocation store, HTTPS/cookie จริง, TTL จริง และ outage contract ต้องตรวจใน T13 ก่อนเปิดใช้ การทดสอบนี้ไม่พิสูจน์ faculty integration หรือสิทธิ์หนังสือ P01–P18 ทั้งหมด

## หลักฐานตรวจรับ

| Check | ผล |
|---|---|
| `npm.cmd run test:auth` | ผ่าน 9 กลุ่ม: narrow identity, ปฏิเสธ credentials/eligibility, logout replay, rotation, absolute expiry, secret/Origin/method, malformed/forged input, rate limit, production guard |
| `npm.cmd run test:e2e` | ผ่าน 6 กลุ่ม: anonymous/spoofed identity web+HTTP, credentials/eligibility/Origin, rotation/logout replay, expiry web+HTTP, mobile/keyboard/loading/error/focus/login/logout, provider outage |
| `npm.cmd run test:production-auth` หลัง build | ผ่าน 3 กลุ่ม: build traces ไม่รวมตัวจำลอง/fixtures, startup ปฏิเสธ local config, production ปฏิเสธ synthetic credentials และ identity ปลอมทั้ง web/HTTP |
| `npm.cmd run typecheck` / `npm.cmd run build` | ผ่าน |
| `npm.cmd run lint` | ผ่าน exit 0; มี warnings เดิมใน `.agents/skills` 96 รายการ ไม่มี errors; scoped lint ของ app/lib/tests/tools/local-auth/config ไม่มี warnings |

ภาพตรวจหน้าจอ desktop login, mobile login และ mobile workspace อยู่ `.local/t04-*.png` ไม่รวมใน Git ทดสอบด้วยข้อมูลสังเคราะห์เท่านั้น ไม่มี migration หรือ deployment

QA อิสระตรวจ backend/frontend และรันทดสอบ provider ซ้ำ 9/9 ไม่พบประเด็น Critical/High/Medium ที่ต้องแก้ในขอบเขต local รุ่นนี้ การเชื่อมบัญชีจริงยังรอ T13

dependency เพิ่ม CoreUI React 5.13.1, CoreUI CSS 5.9.1, server-only 0.0.1 และ Playwright 1.65.0 ไม่เปลี่ยนรุ่นเดิมของ Next/React `npm install` รายงาน moderate advisories 7 รายการ ต้องประเมินแยกก่อนเปิดจริง ไม่รัน audit fix เพื่ออัปเกรดโดยอัตโนมัติ
