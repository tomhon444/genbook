"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type PopupAlertProps = {
  children: ReactNode;
  color: "danger" | "warning" | "success" | "info";
  role?: "alert" | "status";
  id?: string;
  onClose?: () => void;
};

const presentation = {
  danger: { title: "ไม่สามารถดำเนินการได้", icon: "!" },
  warning: { title: "โปรดตรวจสอบ", icon: "!" },
  success: { title: "ดำเนินการสำเร็จ", icon: "✓" },
  info: { title: "แจ้งให้ทราบ", icon: "i" },
};

/** Native modal semantics keep keyboard focus inside and restore it on dismissal. */
export function PopupAlert({ children, color, role, id, onClose }: PopupAlertProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const titleId = `${uid}-title`;
  const bodyId = id ?? `${uid}-body`;
  const { title, icon } = presentation[color];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return <dialog ref={dialogRef} className={`popup-alert popup-alert--${color}`} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} onClose={onClose}>
    <span className="popup-alert-icon" aria-hidden="true">{icon}</span>
    <div className="popup-alert-copy">
      <h2 className="popup-alert-title" id={titleId}>{title}</h2>
      <div className="popup-alert-body" id={bodyId} role={role ?? (color === "danger" ? "alert" : "status")}>{children}</div>
    </div>
    <div className="popup-alert-actions"><button type="button" className="btn btn-primary" autoFocus onClick={() => dialogRef.current?.close()}>ปิดการแจ้งเตือน</button></div>
  </dialog>;
}
