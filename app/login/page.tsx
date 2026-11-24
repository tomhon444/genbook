import { Suspense } from "react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getSession, isIdentityEnabled } from "@/lib/auth/server";
import { LoginForm } from "./login-form";

async function SignIn() {
  const session = await getSession();
  if (session) redirect("/workspace");
  const central = process.env.AUTH_PROVIDER === 'central';
  return <>
    <p className="text-secondary login-description">ลงชื่อเข้าใช้ด้วยชื่อผู้ใช้และรหัสผ่าน<br />{central ? 'ผ่านระบบยืนยันตัวตนส่วนกลาง' : 'ของบัญชีจำลองสำหรับการทดสอบ'}</p>
    <LoginForm enabled={isIdentityEnabled()} />
    <p className="login-footnote"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v2" /></svg><span><strong>{central ? 'ยืนยันตัวตนผ่านบริการกลาง' : 'ระบบทดสอบในเครื่อง'}</strong><br />{central ? 'สิทธิ์ใช้งานเป็นไปตามที่ระบบกำหนด' : 'การเชื่อมบัญชีบุคลากรคณะจริงอยู่ระหว่างพัฒนา'}</span></p>
  </>;
}

export default function LoginPage() {
  return (
    <div className="login-stage"><main className="login-shell" id="main-content">
      <section className="login-panel" aria-label="เข้าสู่ระบบ">
        <div className="login-content">
          <Image className="login-logo" src="/psu-engineer.webp" width={3840} height={844} sizes="220px" alt="คณะวิศวกรรมศาสตร์ มหาวิทยาลัยสงขลานครินทร์" preload />
          <span className="login-divider" aria-hidden="true" />
          <h2>เข้าสู่ระบบ</h2>
          <Suspense fallback={<p role="status">กำลังตรวจสอบสถานะการเข้าสู่ระบบ…</p>}><SignIn /></Suspense>
        </div>
      </section>
      <section className="login-intro" aria-labelledby="system-title">
        <div className="login-system-icon" aria-hidden="true"><svg width="50" height="50" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M28 7H13a3 3 0 0 0-3 3v28a3 3 0 0 0 3 3h22a3 3 0 0 0 3-3V17L28 7Z" /><path d="M28 7v10h10M18 25h12M18 32h8" /><path d="M18 7h7" stroke="#ffd778" strokeWidth="4" /></svg></div>
        <h1 id="system-title">ระบบออกเลขหนังสือราชการ</h1>
        <p className="intro-description">คณะวิศวกรรมศาสตร์ มหาวิทยาลัยสงขลานครินทร์<br />วิทยาเขตหาดใหญ่</p>
        <span className="intro-divider" aria-hidden="true" />
        <p className="intro-footer">พื้นที่ทำงานสำหรับบุคลากรภายในคณะ</p>
      </section>
    </main></div>
  );
}
