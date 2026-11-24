"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WorkspaceIcon, type WorkspaceIconName } from "./workspace-icon";

const items: { href: string; label: string; description: string; icon: WorkspaceIconName }[] = [
  { href: "/workspace", label: "หน้าหลัก", description: "ค้นหาและประวัติหนังสือ", icon: "search" },
  { href: "/workspace/issuance", label: "หน้าออกเลขเอกสาร", description: "ออกเลขหนังสือราชการ", icon: "document" },
];

export function WorkspaceNav() {
  const pathname = usePathname();
  return <nav className="workspace-topnav" aria-label="หมวดหมู่งาน">{items.map(item => <Link key={item.href} href={item.href} prefetch={false} aria-current={pathname === item.href || (item.href === '/workspace' && pathname.startsWith('/workspace/documents/')) ? "page" : undefined}><WorkspaceIcon name={item.icon} /><span>{item.label}</span></Link>)}</nav>;
}
