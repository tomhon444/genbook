import { Suspense, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { requireWorkspaceSession } from "./session";
import { LogoutButton } from "./logout-button";
import { WorkspaceNav } from "./workspace-nav";
import { ProfileAvatar } from "./profile-avatar";

// Kit rule: the department in the bar is cut to 25 characters + "..." (full name in title).
const shortDepartment = (name: string) => name.length > 25 ? `${name.slice(0, 25)}...` : name;

async function AuthenticatedWorkspace({ children }: { children: ReactNode }) {
  const { identity, expiresAt } = await requireWorkspaceSession();
  return <div className="wrapper d-flex flex-column min-vh-100 x-topnav-shell">
    <header className="header header-sticky p-0 x-topnav workspace-header">
      <div className="container-fluid px-4">
        <Link className="x-bar-brand" href="/workspace" prefetch={false}>
          <Image className="x-bar-brand-mark" src="/red-wyvern-ui-kit/img/logo.svg" alt="" width={34} height={34} unoptimized />
          <span className="x-bar-brand-name">ระบบออกเลขหนังสือ</span>
        </Link>
        <WorkspaceNav />
        <ul className="header-nav ms-auto align-items-center">
          <li className="nav-item x-account header-profile">
            <ProfileAvatar key={identity.staffId} />
            <span className="x-account-who">
              <span className="x-account-name" title={identity.displayName}>{identity.displayName}</span>
              {identity.departmentName && <span className="x-account-dept d-none d-sm-block" title={identity.departmentName}>{shortDepartment(identity.departmentName)}</span>}
            </span>
          </li>
          <li className="nav-item ms-2"><LogoutButton expiresAt={expiresAt} /></li>
        </ul>
      </div>
    </header>
    <div className="body flex-grow-1">
      <main className="container-xxl workspace-main" id="main-content">{children}</main>
    </div>
  </div>;
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <div className="workspace-shell"><a className="skip-link" href="#main-content">ข้ามไปเนื้อหาหลัก</a><Suspense fallback={<main className="container-xxl workspace-main" id="main-content"><p role="status">กำลังตรวจสอบข้อมูลผู้ใช้งาน…</p></main>}><AuthenticatedWorkspace>{children}</AuthenticatedWorkspace></Suspense></div>;
}
