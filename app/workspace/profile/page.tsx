import type { Metadata } from "next";
import { requireWorkspaceSession } from "../session";
import { PageHeading } from "../page-heading";
import { Breadcrumbs } from "@/app/components/breadcrumbs";

export const metadata: Metadata = { title: "ข้อมูลผู้ใช้งาน | ระบบออกเลขหนังสือ" };

export default async function ProfilePage() {
  const { identity } = await requireWorkspaceSession();
  return <>
    <Breadcrumbs items={[{ label: "ข้อมูลผู้ใช้งาน" }]} />
    <PageHeading eyebrow="บัญชีของคุณ" title="ข้อมูลผู้ใช้งาน" description="ตรวจสอบข้อมูลบัญชีและหน่วยงานที่ใช้ในการขอเลขหนังสือ" />
    <section className="identity-card" aria-labelledby="identity-heading"><div className="identity-card-header"><span className="profile-avatar" aria-hidden="true">{identity.displayName.slice(0, 1)}</span><div><h2 id="identity-heading">ข้อมูลบัญชี</h2><p>ข้อมูลจากบัญชีจำลองสำหรับพัฒนา</p></div><span className="session-label"><span aria-hidden="true" /> เข้าสู่ระบบแล้ว</span></div><dl className="identity-details"><div><dt>ชื่อผู้ใช้งาน</dt><dd>{identity.displayName}</dd></div><div><dt>รหัสบุคลากร</dt><dd>{identity.staffId}</dd></div><div><dt>หน่วยงาน</dt><dd>{identity.departmentName}</dd></div><div><dt>รหัสหน่วยงาน</dt><dd>{identity.departmentId}</dd></div></dl></section>
    <div className="workspace-note"><span className="note-icon" aria-hidden="true">i</span><div><h2>ข้อมูลบัญชีสำหรับทดสอบ</h2><p>ข้อมูลบัญชีนี้ใช้ในสภาพแวดล้อมจำลอง การเชื่อมต่อบัญชีบุคลากรคณะจริงอยู่ระหว่างดำเนินการ</p></div></div>
  </>;
}
