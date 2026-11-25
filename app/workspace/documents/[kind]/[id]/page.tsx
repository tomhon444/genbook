import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireWorkspaceSession } from '@/app/workspace/session';
import { DocumentPage } from '../../document-page';

export const metadata: Metadata = { title: 'รายละเอียดหนังสือ | ระบบออกเลขหนังสือ' };

type Props = {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function safeReturn(value: string | string[] | undefined) {
  if (typeof value !== 'string' || value.length > 4096 || /[\\\u0000-\u001f]/.test(value)) return '/workspace';
  try {
    const url = new URL(value, 'https://workspace.invalid');
    return value.startsWith('/workspace') && url.origin === 'https://workspace.invalid' && url.pathname === '/workspace'
      ? `${url.pathname}${url.search}` : '/workspace';
  } catch { return '/workspace'; }
}

async function AuthenticatedDetail({ params, searchParams }: Props) {
  const { identity } = await requireWorkspaceSession();
  const [{ kind, id }, query] = await Promise.all([params, searchParams]);
  const snapshot = typeof query.snapshot === 'string' ? query.snapshot : '';
  if ((kind !== 'legacy' && kind !== 'issuance') ||
      (kind === 'legacy' && (!/^\d{1,64}$/.test(id) || !/^[a-f0-9]{64}$/.test(snapshot))) ||
      (kind === 'issuance' && !/^\d{1,11}$/.test(id))) notFound();
  return <DocumentPage key={`${identity.staffId}:${identity.departmentId}:${kind}:${snapshot}:${id}`} kind={kind} id={id} snapshot={snapshot} ownerId={identity.staffId} returnTo={safeReturn(query.returnTo)} />;
}

export default function Page(props: Props) {
  return <Suspense fallback={<p role="status">กำลังเตรียมหน้ารายละเอียดหนังสือ…</p>}><AuthenticatedDetail {...props} /></Suspense>;
}
