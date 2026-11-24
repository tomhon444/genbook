import type { Metadata } from "next";
import { Suspense } from "react";
import { requireWorkspaceSession } from "../session";
import { IssuancePanel } from "../issuance-panel";

export const metadata: Metadata = { title: "หน้าออกเลขเอกสาร | ระบบสารบรรณ" };

async function AuthenticatedIssuance() {
  const { identity } = await requireWorkspaceSession();
  return <><h1 className="visually-hidden">หน้าออกเลขเอกสาร</h1><IssuancePanel key={`${identity.staffId}:${identity.departmentId}`} ownerId={identity.staffId} displayName={identity.displayName} /></>;
}

export default function IssuancePage() {
  return <Suspense fallback={<p role="status">กำลังโหลดหน้าออกเลขเอกสาร…</p>}><AuthenticatedIssuance /></Suspense>;
}
