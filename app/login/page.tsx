import { Suspense } from "react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Icon as CIcon } from "@/app/components/core-icon";
import { cilInfo } from "@coreui/icons";
import { getSession, isIdentityEnabled } from "@/lib/auth/server";
import { LoginForm } from "./login-form";

async function SignIn() {
  const session = await getSession();
  if (session) redirect("/workspace");
  const central = process.env.AUTH_PROVIDER === 'central';
  return <>
    <p className="x-auth-sub">ลงชื่อเข้าใช้ด้วยชื่อผู้ใช้และรหัสผ่าน<br />{central ? 'ผ่านระบบยืนยันตัวตนส่วนกลาง' : 'ของบัญชีจำลองสำหรับการทดสอบ'}</p>
    <LoginForm enabled={isIdentityEnabled()} />
    {!central && <div className="x-auth-notice text-start"><CIcon icon={cilInfo} className="x-auth-notice-icon" aria-hidden="true" /><span><strong>ระบบทดสอบในเครื่อง</strong><br />การเชื่อมบัญชีบุคลากรคณะจริงอยู่ระหว่างพัฒนา</span></div>}
  </>;
}

// Red Wyvern UI Kit login, username/password variant (docs/login.md).
export default function LoginPage() {
  return (
    <main className="x-auth" id="main-content">
      <div className="x-auth-stage"><div className="container"><div className="row justify-content-center"><div className="col-md-11 col-lg-10 col-xl-9 x-auth-col">
        <div className="card-group x-auth-card">
          <section className="card x-auth-form p-4" aria-label="เข้าสู่ระบบ">
            <div className="card-body text-center d-flex flex-column justify-content-center">
              <Image className="x-auth-mark" src="/red-wyvern-ui-kit/img/psu-engineer.webp" width={3840} height={844} sizes="270px" alt="คณะวิศวกรรมศาสตร์ มหาวิทยาลัยสงขลานครินทร์" preload />
              <span className="x-auth-accent" aria-hidden="true" />
              <h2 className="x-auth-heading">เข้าสู่ระบบ</h2>
              <Suspense fallback={<p role="status">กำลังตรวจสอบสถานะการเข้าสู่ระบบ…</p>}><SignIn /></Suspense>
            </div>
          </section>
          <section className="card x-auth-brand text-white py-5" aria-labelledby="system-title">
            <div className="card-body text-center d-flex flex-column justify-content-center">
              <Image className="x-auth-logo mx-auto" src="/red-wyvern-ui-kit/img/logo.svg" width={100} height={100} alt="" unoptimized />
              <h1 className="x-auth-name" id="system-title">ระบบออกเลขหนังสือ</h1>
              <p className="x-auth-faculty mb-0">คณะวิศวกรรมศาสตร์ <span className="text-nowrap">มหาวิทยาลัยสงขลานครินทร์</span><br />วิทยาเขตหาดใหญ่</p>
              <hr className="x-auth-rule" />
              <p className="x-auth-support mb-0">พื้นที่ทำงานสำหรับบุคลากรภายในคณะ</p>
            </div>
          </section>
        </div>
      </div></div></div></div>
    </main>
  );
}
