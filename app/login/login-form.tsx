"use client";

import { useState, type FormEvent } from "react";
import { CButton, CForm, CFormInput, CFormLabel, CSpinner } from "@coreui/react";
import { PopupAlert } from "@/app/components/popup-alert";

export function LoginForm({ enabled }: { enabled: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !enabled) return;
    const data = new FormData(event.currentTarget);
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
      });
      if (response.ok) {
        // Reload the document after changing credentials so no prefetched auth state is reused.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/workspace");
        return;
      }
      setError(response.status === 401 || response.status === 403
        ? "ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีไม่มีสิทธิ์เข้าใช้งาน"
        : response.status === 429 ? "มีการลองเข้าสู่ระบบหลายครั้ง กรุณารอสักครู่แล้วลองใหม่" : "ระบบยืนยันตัวตนไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง");
    } catch {
      setError("เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally { setPending(false); }
  }

  if (!enabled) return <p className="login-unavailable" role="status">ยังไม่เปิดให้เข้าสู่ระบบ กรุณาเริ่มสภาพแวดล้อมทดสอบในเครื่องตามคู่มือ การเชื่อมบัญชีคณะจริงอยู่ระหว่างดำเนินการ</p>;

  return <>
    {error && <PopupAlert color="danger" role="alert" id="login-error" onClose={() => setError("")}>{error}</PopupAlert>}
    <CForm onSubmit={handleSubmit} aria-busy={pending} aria-describedby={error ? "login-error" : undefined}>
      <div className="form-field"><CFormLabel className="visually-hidden" htmlFor="username">ชื่อบัญชีผู้ใช้</CFormLabel><CFormInput id="username" name="username" placeholder="ชื่อผู้ใช้" autoComplete="username" required maxLength={100} disabled={pending} autoCapitalize="none" spellCheck={false} /></div>
      <div className="form-field"><CFormLabel className="visually-hidden" htmlFor="password">รหัสผ่าน</CFormLabel><CFormInput id="password" name="password" placeholder="รหัสผ่าน" type="password" autoComplete="current-password" required maxLength={256} disabled={pending} /></div>
      <CButton type="submit" color="primary" className="login-submit" disabled={pending}>{pending ? <><CSpinner size="sm" aria-hidden="true" /> กำลังเข้าสู่ระบบ…</> : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 5h5v14h-5M3 12h12m-4-4 4 4-4 4" /></svg> เข้าสู่ระบบ</>}</CButton>
      <span className="visually-hidden" role="status">{pending ? "กำลังตรวจสอบบัญชีผู้ใช้" : ""}</span>
    </CForm>
  </>;
}
