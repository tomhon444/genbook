import type { Metadata } from "next";
import { Suspense } from "react";
import { requireWorkspaceSession } from "./session";
import { SearchPanel } from "./search-panel";
import { readSearchState, searchStateUrl } from "./search-state";

export const metadata: Metadata = { title: "หน้าหลัก | ระบบสารบรรณ" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

async function AuthenticatedHome({ searchParams }: Props) {
  const { identity } = await requireWorkspaceSession();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === 'string') query.set(key, value);
  const state = readSearchState(query);
  return <SearchPanel key={`${identity.staffId}:${identity.departmentId}:${searchStateUrl(state)}`} initialState={state} />;
}

export default function WorkspacePage(props: Props) {
  return <Suspense fallback={<p role="status">กำลังโหลดหน้าหลัก…</p>}><AuthenticatedHome {...props} /></Suspense>;
}
