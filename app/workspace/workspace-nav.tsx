"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import CIcon from "@coreui/icons-react";
import { cilDescription, cilHome } from "@coreui/icons";

const items = [
  { href: "/workspace", label: "หน้าหลัก", icon: cilHome },
  { href: "/workspace/issuance", label: "หน้าออกเลขเอกสาร", icon: cilDescription },
];

export function WorkspaceNav() {
  const pathname = usePathname();
  return <nav className="x-topnav-nav" aria-label="หมวดหมู่งาน"><ul className="header-nav x-topnav-menu">{items.map(item => {
    const current = pathname === item.href || (item.href === '/workspace' && pathname.startsWith('/workspace/documents/'));
    return <li className="nav-item" key={item.href}><Link className={current ? "nav-link active" : "nav-link"} href={item.href} prefetch={false} aria-current={current ? "page" : undefined}><CIcon icon={item.icon} size="sm" aria-hidden="true" /><span>{item.label}</span></Link></li>;
  })}</ul></nav>;
}
