"use client";

import { useEffect, useState } from "react";
import { CButton, CSpinner } from "@coreui/react";
import CIcon from "@coreui/icons-react";
import { cilAccountLogout } from "@coreui/icons";
import { PopupAlert } from "@/app/components/popup-alert";

export function LogoutButton({ expiresAt }: { expiresAt: number }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => window.location.replace("/login?reason=session"), Math.max(0, expiresAt - Date.now()));
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", onPageShow);
    return () => { window.clearTimeout(timer); window.removeEventListener("pageshow", onPageShow); };
  }, [expiresAt]);
  async function logout() {
    if (pending) return;
    setError(""); setPending(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (response.ok) {
        // Discard client router state after revocation, including prefetched private content.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/login?loggedOut=1");
        return;
      }
      setError("ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง");
    } catch { setError("เชื่อมต่อระบบไม่ได้ กรุณาลองออกจากระบบอีกครั้ง"); }
    finally { setPending(false); }
  }
  return <div className="logout-control"><CButton color="danger" variant="outline" size="sm" onClick={logout} disabled={pending} aria-label={pending ? undefined : "ออกจากระบบ"} title="ออกจากระบบ">{pending ? <><CSpinner size="sm" aria-hidden="true" /> กำลังออกจากระบบ…</> : <><CIcon icon={cilAccountLogout} size="sm" aria-hidden="true" /><span className="d-none d-sm-inline">ออกจากระบบ</span></>}</CButton>{error && <PopupAlert color="danger" role="alert" onClose={() => setError("")}>{error}</PopupAlert>}</div>;
}
