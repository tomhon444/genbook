<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


# Project Guidance — Government Correspondence Numbering System

## Stack
- Next.js App Router + TypeScript
- MySQL
- CoreUI for React
- Follow installed dependency versions; do not upgrade without approval.

## Architecture (required — read before changing data or auth code)

```
Client (genbook, Next.js) ──HTTP──> API service (ronaldo-service, module genbookno) ──> database (genbook_db)
                          └─HTTP──> ronaldo-service Core identity ──> CENTRAL (read-only)
```

- genbook is the **client only**: UI, Route Handlers and server-side API clients. It must not open DB connections, import `mysql2`, or hold DB/CENTRAL credentials.
- All reads/writes of book, numbering, amendment, history and PDF data go through the `genbookno` module in `F:/Work/project/ronaldo-service/src/modules/genbookno/` (`/api/v1/genbookno/*`). New data features are built there first, then called from genbook.
- Username/password login uses ronaldo-service Core identity (`/api/v1/identity/authenticate`, `/status`), shared by every system. Do not implement login or CENTRAL access in genbook.
- Service secrets stay server-side; never `NEXT_PUBLIC_`.
- Book data lives in `genbookno_db` and is reached only via `lib/genbookno/client.ts` (`RONALDO_SERVICE_URL` + server-only `GENBOOKNO_API_SECRET`); see [T15](docs/tickets/15-genbookno-db-consolidation.md). Do not add direct DB code. Decision record: [ADR 0004](docs/adr/0004-client-api-database-layers.md).

## Domain rules
- Inspect the existing system before proposing changes.
- Never assume numbering rules. Confirm scope (department, document type, year basis, prefix, reset, cancellation).
- Number allocation must be concurrency-safe. Never rely on `SELECT MAX(number) + 1` alone.
- Enforce uniqueness in MySQL constraints as well as application validation.
- Preserve audit history for issuance, amendments, cancellations, and privileged changes.
- Never silently reuse cancelled/failed numbers; follow the confirmed business rule.
- Use Asia/Bangkok for business display unless the owner specifies otherwise.
- Do not invent legal or retention requirements.

## Engineering rules
- Inspect repository conventions before editing.
- Keep Server Components by default; put interactive CoreUI components behind small `'use client'` boundaries.
- Keep DB access and secrets server-side.
- Validate inputs and authorize every protected operation on the server.
- Use parameterized SQL or the existing safe ORM/query builder.
- Add tests for behavior changes; run lint, typecheck, and relevant tests.
- Do not run destructive migrations, production writes, or deployment without explicit approval.
- Never place real secrets in source control; use placeholders in `.env.example`.

## Multi-agent workflow
- The primary Codex thread coordinates the work; custom agents are subagent profiles, not always-on processes.
- Use parallel agents for independent discovery/review. Avoid parallel edits to overlapping files.
- Database owns schema/migration proposals; Backend owns server logic/API; Frontend owns UI; QA owns tests/review.
- Require assumptions, decisions, files changed, risks, tests, and blockers in each report.
- QA reviews after implementation. Do not claim completion if tests failed or were not run.

## Definition of done
- Requirements and acceptance criteria are clear.
- No unresolved critical security/data-integrity findings.
- Number uniqueness and concurrent allocation are tested.
- Lint, typecheck, and relevant tests pass or failures are reported.
- Documentation and migration notes are updated.

## Agent skills

### Issue tracker

Use GitHub Issues in `tomhon444/genbook`.
See `docs/agents/issue-tracker.md`.

### Domain docs

Use a single-context layout: root `GLOSSARY.md` and `docs/adr/`.
See `docs/agents/domain.md`.

<!-- red-wyvern-ui-kit:start -->
## UI — Red Wyvern UI Kit v0.5.0 (บังคับ)

โปรเจคนี้ใช้ Theme และ Style จาก **Red Wyvern UI Kit** ที่ `node_modules/red-wyvern-ui-kit`
ก่อนสร้างหรือแก้ UI ใดๆ ให้อ่าน `node_modules/red-wyvern-ui-kit/AGENTS.md` และทำตามกฎในนั้น

- ฟอนต์: **TH Sarabun** ในรูปแบบ `'Sarabun'` จาก `public/red-wyvern-ui-kit/css/font.css` (family เดียว เลือกน้ำหนักด้วย font-weight)
- Component: **CoreUI 5** (`@coreui/coreui` / `@coreui/react`) + class `.x-*` จาก `kit.css`
- ตาราง: **ทุก section ใน Content ที่แสดงข้อมูลแบบตารางใช้ AG Grid Community 36** ใน `.x-grid` + `gridTheme()` ของ kit (รวมตารางเล็ก/สรุป) — ห้าม `<table>` / `.table` / `CTable` / DataTables
- ไอคอน: **CoreUI Icons**
- App shell: เมนูหลัก ≤ 3 หน้า → ไม่มี Left Sidebar ใช้ top-nav `.x-topnav` · มากกว่า 3 หน้า → Sidebar สี primary `.sidebar.x-sidebar` + header `.x-appbar` · แถบบนทั้งสองแบบแสดงรูป + ชื่อ + หน่วยงานผู้ login (`.x-account`) ไม่แสดงตำแหน่ง · หน่วยงาน ≤ 25 ตัวอักษร เกินให้ตัดแล้วต่อ `...`
- สีหลัก `#b33939`, พื้นแอปเทา `#f1f4f6`, การ์ด/ตารางขาว
- Assets ของ kit อยู่ที่ `public/red-wyvern-ui-kit` — เป็นสำเนาจาก kit ที่ `npx red-wyvern-ui-kit init` เขียนทับได้ทุกครั้ง จึงแก้ style ที่ repo ของ kit แล้วอัปเดตเวอร์ชัน
<!-- red-wyvern-ui-kit:end -->
