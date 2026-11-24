import { Suspense, type ReactNode } from "react";
import { requireWorkspaceSession } from "./session";
import { LogoutButton } from "./logout-button";
import { WorkspaceIcon } from "./workspace-icon";
import { WorkspaceNav } from "./workspace-nav";
import { ProfileAvatar } from "./profile-avatar";

async function AuthenticatedWorkspace({ children }: { children: ReactNode }) {
  const { identity, expiresAt } = await requireWorkspaceSession();
  return <div className="workspace-frame">
    <div className="workspace-stage">
      <header className="workspace-header">
        <div className="header-context"><span className="header-context-mark" aria-hidden="true"><WorkspaceIcon name="document" /></span><div>ระบบออกเลขหนังสือราชการ</div></div>
        <div className="header-actions"><div className="header-profile"><ProfileAvatar key={identity.staffId} name={identity.displayName} /><span>{identity.displayName}</span></div><LogoutButton expiresAt={expiresAt} /></div>
      </header>
      <WorkspaceNav />
      <main className="workspace-main" id="main-content">{children}</main>
    </div>
  </div>;
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <div className="workspace-shell"><a className="skip-link" href="#main-content">ข้ามไปเนื้อหาหลัก</a><Suspense fallback={<main className="workspace-main" id="main-content"><p role="status">กำลังตรวจสอบข้อมูลผู้ใช้งาน…</p></main>}><AuthenticatedWorkspace>{children}</AuthenticatedWorkspace></Suspense></div>;
}
