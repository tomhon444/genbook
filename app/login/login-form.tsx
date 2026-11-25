"use client";

import { useState, type FormEvent } from "react";
import { CButton, CForm, CFormInput, CInputGroup, CInputGroupText, CSpinner } from "@coreui/react";
import CIcon from "@coreui/icons-react";
import { cilAccountLogout, cilLockLocked, cilUser } from "@coreui/icons";

export function LoginForm({ enabled }: { enabled: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [validated, setValidated] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !enabled) return;
    const form = event.currentTarget;
    setValidated(true);
    if (!form.checkValidity()) return;
    const data = new FormData(form);
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
      setError(response.status === 403
        ? "ไม่สามารถเข้าสู่ระบบจากที่อยู่เว็บนี้ได้ กรุณาเปิดระบบผ่านที่อยู่ที่กำหนดไว้"
        : response.status === 401
        ? "ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีไม่มีสิทธิ์เข้าใช้งาน"
        : response.status === 429 ? "มีการลองเข้าสู่ระบบหลายครั้ง กรุณารอสักครู่แล้วลองใหม่" : "ระบบยืนยันตัวตนไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง");
    } catch {
      setError("เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่");
    } finally { setPending(false); }
  }

  if (!enabled) return <p className="alert alert-secondary text-start" role="status">ยังไม่เปิดให้เข้าสู่ระบบ กรุณาเริ่มสภาพแวดล้อมทดสอบในเครื่องตามคู่มือ การเชื่อมบัญชีคณะจริงอยู่ระหว่างดำเนินการ</p>;

  return <>
    <CForm className={validated ? "text-start was-validated" : "text-start"} noValidate onSubmit={handleSubmit} aria-busy={pending} aria-describedby={error ? "login-error" : undefined}>
      <CInputGroup className="mb-3 has-validation">
        <CInputGroupText><CIcon icon={cilUser} aria-hidden="true" /></CInputGroupText>
        <CFormInput id="username" name="username" aria-label="ชื่อบัญชีผู้ใช้" placeholder="ชื่อผู้ใช้" autoComplete="username" required maxLength={100} disabled={pending} autoCapitalize="none" spellCheck={false} />
        <div className="invalid-feedback">กรุณากรอกชื่อผู้ใช้</div>
      </CInputGroup>
      <CInputGroup className="mb-3 has-validation">
        <CInputGroupText><CIcon icon={cilLockLocked} aria-hidden="true" /></CInputGroupText>
        <CFormInput id="password" name="password" aria-label="รหัสผ่าน" placeholder="รหัสผ่าน" type={showPassword ? "text" : "password"} autoComplete="current-password" required maxLength={256} disabled={pending} />
        <button className="input-group-text" type="button" aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? "ซ่อน" : "แสดง"}</button>
        <div className="invalid-feedback">กรุณากรอกรหัสผ่าน</div>
      </CInputGroup>
      <CButton type="submit" size="lg" className="w-100 x-auth-submit d-flex align-items-center justify-content-center gap-2" disabled={pending}>{pending ? <><CSpinner size="sm" aria-hidden="true" /> กำลังเข้าสู่ระบบ…</> : <><CIcon icon={cilAccountLogout} aria-hidden="true" /> เข้าสู่ระบบ</>}</CButton>
      {error && <p className="text-danger text-center small mt-2 mb-0" role="alert" id="login-error">{error}</p>}
      <span className="visually-hidden" role="status">{pending ? "กำลังตรวจสอบบัญชีผู้ใช้" : ""}</span>
    </CForm>
  </>;
}
