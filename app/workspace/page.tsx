import type { Metadata } from "next";
import { Suspense } from "react";
import { Breadcrumbs } from "@/app/components/breadcrumbs";
import { requireWorkspaceSession } from "./session";
import { SearchLoading } from "./search-loading";
import { HomeDashboard } from "./home-dashboard";
import { IssueAction } from "./issue-action";
import { readSearchState, scopePrefix } from "./search-state";

export const metadata: Metadata = { title: "หน้าหลัก | ระบบออกเลขหนังสือ" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

async function AuthenticatedHome({ searchParams }: Props) {
  const { identity } = await requireWorkspaceSession();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === 'string') query.set(key, value);
  const mine = readSearchState(query, scopePrefix.mine);
  const department = readSearchState(query, scopePrefix.department);
  const owner = `${identity.staffId}:${identity.departmentId}`;
  return <div className="workspace-home">
    <Breadcrumbs items={[]} />
    <div className="search-page-heading">
      <div>
        <h1>เลขหนังสือ</h1>
        <p>รวมหนังสือจากระบบเดิมและระบบใหม่ · ปีเลข พ.ศ.</p>
      </div>
      <IssueAction />
    </div>
    <HomeDashboard key={owner} initialTab={query.get("tab") === "department" ? "department" : "mine"} mine={mine} department={department} />
  </div>;
}

export default function WorkspacePage(props: Props) {
  return <Suspense fallback={<SearchLoading label="กำลังโหลดหน้าหลัก…" />}><AuthenticatedHome {...props} /></Suspense>;
}
