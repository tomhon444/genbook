"use client";

import Link from "next/link";
import CIcon from "@coreui/icons-react";
import { cilPlus } from "@coreui/icons";

// CIcon uses React state but its package has no "use client" directive.
export function IssueAction() {
  return <Link href="/workspace/issuance" prefetch={false} className="btn btn-primary search-issue-action"><CIcon icon={cilPlus} aria-hidden="true" />ออกเลขหนังสือ</Link>;
}
