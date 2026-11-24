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
