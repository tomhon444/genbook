"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CIcon from "@coreui/icons-react";
import { cilCloudUpload, cilDescription, cilPaperclip, cilPeople, cilWarning } from "@coreui/icons";
import { CButton } from "@coreui/react";
import type { BookDocument } from "@/lib/genbookno/types";
import { SearchPanel } from "./search-panel";
import { searchStateUrl, scopePrefix, type SearchScope, type SearchState } from "./search-state";
import { thaiDate, thaiDayMonth } from "./thai-date";

type Doc = Pick<BookDocument, "id" | "number" | "numberYear" | "subject" | "documentDate">;
type Summary = { mine: number; department: number; pdfPending: number; pdfComplete: number };
type Overview = { documents: Doc[]; summary: Summary; departmentLatest: Doc | null; pendingDocument: Doc | null };

const tabs: { scope: SearchScope; label: string; description: string }[] = [
  { scope: "mine", label: "เลขที่คุณออก", description: "หนังสือที่คุณเป็นผู้ขอเลขเอง" },
  { scope: "department", label: "เลขของฝ่ายคุณ", description: "หนังสือที่บุคลากรในฝ่ายเดียวกับคุณออก (เฉพาะที่คุณมีสิทธิ์อ่าน)" },
];

const count = (value: number | undefined) => value === undefined ? "—" : value.toLocaleString("th-TH");

function documentHref(id: string) {
  return `/workspace/documents/issuance/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo: "/workspace" })}`;
}

type Props = { initialTab: SearchScope; mine: SearchState; department: SearchState };

/** Home dashboard: summary cards, PDF reminder, tabbed book lists and side cards. */
export function HomeDashboard({ initialTab, mine, department }: Props) {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<SearchScope>(initialTab);
  // Mount a tab's list on first visit, then keep it so its filters survive switching.
  const [visited, setVisited] = useState<Set<SearchScope>>(() => new Set([initialTab]));
  const tableRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setError("");
      try {
        const response = await fetch("/api/issuance", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { router.replace("/login?reason=session"); return; }
        if (!response.ok) throw new Error();
        const data: Overview = await response.json();
        if (!controller.signal.aborted) setOverview(data);
      } catch {
        if (!controller.signal.aborted) setError("โหลดข้อมูลสรุปไม่สำเร็จ กรุณาลองใหม่");
      }
    })();
    return () => controller.abort();
  }, [retry, router]);

  function select(scope: SearchScope) {
    setTab(scope);
    setVisited(current => new Set(current).add(scope));
    const params = new URLSearchParams(window.location.search);
    if (scope === "mine") params.delete("tab"); else params.set("tab", scope);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }

  const summary = overview?.summary;
  const pending = overview?.pendingDocument;
  const latest = overview?.departmentLatest;
  const total = (summary?.pdfComplete ?? 0) + (summary?.pdfPending ?? 0);
  const states = { mine, department };

  return <>
    {error && <div className="home-error" role="alert"><span>{error}</span><CButton type="button" color="primary" size="sm" onClick={() => setRetry(value => value + 1)}>ลองใหม่</CButton></div>}

    <div className="home-stats" aria-busy={!overview && !error}>
      <div className="home-stat">
        <div className="home-stat-head"><span>เลขที่คุณออก</span><span className="home-stat-icon"><CIcon icon={cilDescription} aria-hidden="true" /></span></div>
        <p className="home-stat-value"><strong>{count(summary?.mine)}</strong> รายการ</p>
      </div>
      <div className="home-stat">
        <div className="home-stat-head"><span>เลขของฝ่ายคุณ</span><span className="home-stat-icon"><CIcon icon={cilPeople} aria-hidden="true" /></span></div>
        <p className="home-stat-value"><strong>{count(summary?.department)}</strong> รายการ</p>
      </div>
      <div className={`home-stat${summary?.pdfPending ? " home-stat--warn" : ""}`}>
        <div className="home-stat-head"><span>รอแนบ PDF</span><span className="home-stat-icon"><CIcon icon={cilPaperclip} aria-hidden="true" /></span></div>
        <p className="home-stat-value"><strong>{count(summary?.pdfPending)}</strong> {summary?.pdfPending ? "ต้องดำเนินการ" : "รายการ"}</p>
      </div>
      <div className="home-stat home-stat--dark">
        <div className="home-stat-head"><span>เลขล่าสุดของฝ่าย</span></div>
        {latest ? <Link href={documentHref(latest.id)} prefetch={false} className="home-stat-latest"><strong>{latest.number}</strong><small>{thaiDate(latest.documentDate)}</small></Link>
          : <p className="home-stat-latest"><strong>{overview ? "ยังไม่มีเลข" : "—"}</strong></p>}
      </div>
    </div>

    {pending && <div className="home-alert" role="status">
      <span className="home-alert-icon"><CIcon icon={cilWarning} aria-hidden="true" /></span>
      <div className="home-alert-text">
        <p><strong>หนังสือ <span className="home-number">{pending.number}</span> ยังไม่ได้แนบไฟล์ PDF</strong></p>
        <p className="home-alert-sub">{pending.subject} · {thaiDate(pending.documentDate)}</p>
      </div>
      <Link href={documentHref(pending.id)} prefetch={false} className="btn home-navy-button"><CIcon icon={cilCloudUpload} aria-hidden="true" />แนบไฟล์ PDF</Link>
    </div>}

    <div className="home-columns">
      <section className="home-table" ref={tableRef} aria-label="รายการเลขหนังสือ">
        <div className="home-tabs" role="tablist" aria-label="ขอบเขตรายการ">
          {tabs.map(item => <button key={item.scope} type="button" role="tab" id={`home-tab-${item.scope}`} aria-controls={`home-panel-${item.scope}`}
            aria-selected={tab === item.scope} tabIndex={tab === item.scope ? 0 : -1} className="home-tab" onClick={() => select(item.scope)}
            onKeyDown={event => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              const next = tabs[(tabs.indexOf(item) + 1) % tabs.length].scope;
              select(next); document.getElementById(`home-tab-${next}`)?.focus();
            }}>
            {item.label}<span className="home-tab-count">{count(item.scope === "mine" ? summary?.mine : summary?.department)}</span>
          </button>)}
        </div>
        {tabs.map(item => <div key={item.scope} role="tabpanel" id={`home-panel-${item.scope}`} aria-labelledby={`home-tab-${item.scope}`} hidden={tab !== item.scope}>
          {visited.has(item.scope) && <SearchPanel key={`${item.scope}:${searchStateUrl(states[item.scope], scopePrefix[item.scope])}`} scope={item.scope}
            initialState={states[item.scope]} title={item.label} description={item.description} />}
        </div>)}
      </section>

      <aside className="home-side">
        <section className="home-card" aria-labelledby="home-files-heading">
          <h2 id="home-files-heading">สถานะไฟล์ของคุณ</h2>
          <div className="home-bar" role="img" aria-label={`ครบไฟล์ ${summary?.pdfComplete ?? 0} รายการ, รอแนบ PDF ${summary?.pdfPending ?? 0} รายการ`}>
            {total > 0 && <>
              <span className="home-bar-ok" style={{ width: `${(summary!.pdfComplete / total) * 100}%` }} />
              <span className="home-bar-warn" style={{ width: `${(summary!.pdfPending / total) * 100}%` }} />
            </>}
          </div>
          <ul className="home-legend">
            <li><span className="home-dot home-dot--ok" />ครบไฟล์<b>{count(summary?.pdfComplete)}</b></li>
            <li><span className="home-dot home-dot--warn" />รอแนบ PDF<b>{count(summary?.pdfPending)}</b></li>
          </ul>
        </section>

        <section className="home-card" aria-labelledby="home-recent-heading">
          <div className="home-card-head">
            <h2 id="home-recent-heading">ล่าสุดของคุณ</h2>
            <button type="button" className="home-link" onClick={() => { select("mine"); tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>ดูทั้งหมด</button>
          </div>
          {!overview ? <p className="home-muted">{error ? "—" : "กำลังโหลด…"}</p>
            : overview.documents.length === 0 ? <p className="home-muted">คุณยังไม่เคยออกเลขหนังสือ</p>
            : <ul className="home-recent">{overview.documents.slice(0, 4).map(document => {
              const { day, month } = thaiDayMonth(document.documentDate);
              return <li key={document.id}><Link href={documentHref(document.id)} prefetch={false}>
                <span className="home-recent-date"><b>{day}</b><small>{month}</small></span>
                <span className="home-recent-text"><span className="home-number">{document.number}</span><span>{document.subject}</span></span>
              </Link></li>;
            })}</ul>}
        </section>
      </aside>
    </div>
  </>;
}
