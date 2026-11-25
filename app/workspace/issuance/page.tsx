import type { Metadata } from "next";
import { Suspense } from "react";
import { requireWorkspaceSession } from "../session";
import { IssuancePanel } from "../issuance-panel";
import { Breadcrumbs } from "@/app/components/breadcrumbs";

export const metadata: Metadata = { title: "หน้าออกเลขเอกสาร | ระบบออกเลขหนังสือ" };

async function AuthenticatedIssuance() {
  const { identity } = await requireWorkspaceSession();
  return <><Breadcrumbs items={[{ label: "หน้าออกเลขเอกสาร" }]} /><h1 className="visually-hidden">หน้าออกเลขเอกสาร</h1><IssuancePanel key={`${identity.staffId}:${identity.departmentId}`} ownerId={identity.staffId} displayName={identity.displayName} /></>;
}

export default function IssuancePage() {
  return <Suspense fallback={<p role="status">กำลังโหลดหน้าออกเลขเอกสาร…</p>}><AuthenticatedIssuance /></Suspense>;
}
