# T12 — CENTRAL identity mapping evidence

Checked 19 November 2026 (Asia/Bangkok). This is read-only evidence for review, not approval of mapping, permissions, promotion, number counters or cutover.

## Source and scope

The current native book snapshot is SHA-256 `d5f97eb2131c0ba0d7eaee8659f9c9e02f87bf092092385c6dbd4b5181e2d6bb`. It contains 172,131 main book records and 384,725 rows across the six core migration tables. Earlier T12 reports used snapshot `78629b14…` with 171,506 books; their counts must not be used to certify this snapshot.

A fresh source-bound review workbench was generated at `.local/t12/workbench-d5f97eb2-668b4dee/`. Existing approvals were not copied or overwritten. Native read APIs and the normalized migration importer are separate paths: being able to search the local native clone does not certify normalized migration readiness.

CENTRAL was queried through Ronaldo's existing Core read-only connector and SQL guard. Only referenced `STAFF_ID`, `DEPT_ID`, `ACTIVE` and department `DEPT_ID`, `STATUS` were selected. No passwords, names, login credentials, emails or broad personnel dump were queried. There were no source/target database writes or Ronaldo source changes.

The connector confirmed its read-only session flag and utf8mb4 results. Both CENTRAL reference tables use MyISAM, so the read-only transaction does **not** establish a consistent point-in-time snapshot. The evidence records collection times and must be rechecked before cutover.

## Findings

| Owner reference result | Groups | Book records |
|---|---:|---:|
| Exact CENTRAL match, active | 224 | 135,391 |
| Exact CENTRAL match, not active | 94 | 36,731 |
| No exact CENTRAL match | 3 | 5 |
| Missing source owner | 1 | 4 |
| Ambiguous CENTRAL match | 0 | 0 |
| Total | 322 | 172,131 |

Inactive references remain historical identity evidence; they are not discarded or assigned to a replacement owner. Staff status alone does not establish valid login, an active department or number-series permission.

- The 46 historical department groups comprise 40 active exact matches, four inactive exact matches, one missing match and one missing source value.
- For 73 owner references, at least one recorded historical department differs from the current CENTRAL department. This is a discrepancy to review, not proof of a transfer or authority to rewrite historical departments.
- Current CENTRAL departments for the 318 uniquely matched owners comprise 312 active department matches and six inactive matches. Four owner groups remain unresolved. Current department status is retained separately on owners, actors and other staff references.
- There are 155 unique series references and two referenced series absent from `bookdept`. Prefix, year basis and enabled/held state still require review.
- `bookdept_user` contains 1,844 legacy permission rows; 37 lack one unique series reference in the audited source namespace. These are pending source evidence, not imported grants. Manager and numeric role tables do not create issuance grants.
- Source metadata checks report 1,860 empty subjects and six held books. The remaining 170,265 books await mapping; zero are currently ready for normalized promotion. The unreviewed workbench reports 2,389 blockers and 492 unmapped reservation scopes.

## Private artifacts and commands

Detailed source identifiers remain only under ignored `.local/t12/central-evidence-d5f97eb2-*/` directories. Each run creates exclusive files and never overwrites an earlier review:

The final packet for this round is `.local/t12/central-evidence-d5f97eb2-64ae62e7-reviewed/`. It retains the collected evidence unchanged and uses the final Markdown escaping for safe review. The earlier `d2d06057` packet predates the additional current-department evidence. Final evidence SHA-256: `c334440db80eabe3a06eb901129b43e0b83100d9bd5726df29d3a8591bb0cc61`.

- `evidence.json`: exact matches, status, current/historical department distinction, source references and source SHA.
- `summary.json`: aggregate counts, collection times, engines and evidence hash.
- `review-proposals.json`: identity candidates, series and legacy grant rows. All decisions remain pending and reviews are null; this is not an executable mapping file.
- `REVIEW.md`: owner exceptions, historical department matches and current/historical discrepancies for review.

```powershell
node tools/migration/prepare-workbench.mjs .local/legacy-import/native-d5f97eb2131c/source.sql.gz
node tools/migration/audit-central-mapping.mjs .local/legacy-import/native-d5f97eb2131c/source.sql.gz ../ronaldo-service
node --test tools/migration/identity-evidence.test.mjs tools/migration/audit-central-mapping.test.mjs
```

The audit requires `IDENTITY_PROVIDER=central` and a service source SHA matching the supplied snapshot. It uses the service's private existing configuration without printing credentials. Database collation comparisons are filtered back to exact identifiers; leading zeroes and source whitespace are never silently repaired.

## Remaining decisions

1. Review the missing owner references affecting five books and the four books without an owner; retain restricted records/reservations rather than inventing a replacement identity.
2. Confirm inactive identities and historical department evidence; never replace the recorded department with the current one automatically.
3. Review series definitions, missing series references and legacy permission rows separately from ownership and read access.
4. Decide the treatment of empty subjects and other source metadata, and finish the file/time checks.
5. Record genuine reviewer/date/evidence in the workbench's source-bound `mapping.json`, then run `migration:check` against the same snapshot before any local promotion rehearsal.

T12 remains **3/6**. This work does not import normalized history, seed counters, grant permissions, open issuance or approve production migration. Counter reconciliation, actual-data permission tests and approved cutover remain required.

## Validation

The existing mapping/workbench suite plus the initial five identity tests passed 28 tests, including synthetic MySQL promotion rollback/replay. The final six identity tests and review-artifact regression passed seven tests. Lint and typecheck passed; targeted lint and the review regression passed again after escaping source Markdown/HTML. QA's current-department evidence and report-rendering findings were addressed. The actual CENTRAL run is evidence of referenced IDs/status only, not a password-login test or permission/cutover approval.
