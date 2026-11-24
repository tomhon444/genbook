import "server-only";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";

// Recheck on each page: the shared layout persists across client navigation.
// APIs also continue to authorize every operation independently.
export async function requireWorkspaceSession() {
  const session = await getSession();
  if (!session) redirect("/login?reason=session");
  return session;
}
