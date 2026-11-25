"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CIcon from '@coreui/icons-react';
import { cilArrowLeft, cilHome } from '@coreui/icons';

export type Crumb = { label: string; href?: string };

/**
 * Red Wyvern UI Kit breadcrumb (docs/breadcrumb.md). "หน้าแรก" is always added.
 * `backHref` makes the back control a real link (e.g. to restore search state);
 * otherwise it uses history.back() with the parent crumb as fallback.
 */
export function Breadcrumbs({ items, backHref }: { items: Crumb[]; backHref?: string }) {
  const router = useRouter();
  const parent = [...items].reverse().find(item => item.href)?.href ?? '/workspace';
  const back = <><CIcon icon={cilArrowLeft} size="sm" aria-hidden="true" /><span>ย้อนกลับ</span></>;
  return <div className="x-crumbs-bar">
    {items.length > 0 && <>
      {backHref
        ? <Link href={backHref} prefetch={false} className="x-crumbs-back">{back}</Link>
        : <button type="button" className="x-crumbs-back" onClick={() => window.history.length > 1 ? window.history.back() : router.push(parent)}>{back}</button>}
      <span className="x-crumbs-sep-v" aria-hidden="true" />
    </>}
    <nav aria-label="breadcrumb"><ol className="x-crumbs">
      <li>{items.length
        ? <Link className="x-crumb" href="/workspace" prefetch={false}><CIcon icon={cilHome} size="sm" aria-hidden="true" />หน้าแรก</Link>
        : <span className="x-crumb x-crumb-current" aria-current="page"><CIcon icon={cilHome} size="sm" aria-hidden="true" />หน้าแรก</span>}</li>
      {items.map((item, index) => <li key={`${index}:${item.label}`}>
        <span className="x-crumb-sep" aria-hidden="true">›</span>
        {index === items.length - 1 || !item.href
          ? <span className={index === items.length - 1 ? 'x-crumb x-crumb-current' : 'x-crumb'} aria-current={index === items.length - 1 ? 'page' : undefined}>{item.label}</span>
          : <Link className="x-crumb" href={item.href} prefetch={false}>{item.label}</Link>}
      </li>)}
    </ol></nav>
  </div>;
}
