# Local MySQL: port 3336

Superseded later on 19 November 2026: the owner requested **127.0.0.1:3306**. See [the current endpoint and rollback notes](local-mysql-port3306.md). The report below records the earlier 3338-to-3336 move.

19 พฤศจิกายน 2026 (Asia/Bangkok): ย้าย endpoint ของ MySQL 8.0.30 ตัว local จาก `127.0.0.1:3338` เป็น `127.0.0.1:3336` ตามคำขอเจ้าของ ใช้ data directory เดิม `.local/t12-persistent/genbook-db/data/` และคง server UUID เดิม ไม่มีการสร้างข้อมูลใหม่หรือรวมข้อมูลกับฐานอื่น

| Database | Tables | Exact rows | Purpose |
| --- | ---: | ---: | --- |
| `genbook_db` | 21 | 726,492 | Preservation/staging, PDF LONGBLOB, numbering/audit structures |
| `genbookno_db` | 22 | 429,780 | Native legacy clone read by Ronaldo Genbookno |
| `t05_synthetic` | 19 | 2 | Existing bootstrap marker and synthetic structures |

## Runtime and configuration

- Start the retained MySQL runtime and Next.js with `npm.cmd run dev:ronaldo` from this project. Current `BOOK_DATA_PROVIDER=ronaldo` keeps book access read-only.
- Start Ronaldo's existing standalone entry `node dist/modules/genbookno/server.js` from `ronaldo-service`. Its private `.env` has `GENBOOKNO_DATABASE_URL` pointing at `127.0.0.1:3336/genbookno_db`. The service needs network access to CENTRAL as before.
- Runtime `connection.json`, `.local/genbook-local8.json` and `.local/genbookno-service.json` now record port 3336. These private files contain credentials and must stay outside Git.
- Local guards in `managed-local.mjs`, `local-target.mjs` and `import-native.mjs` require port 3336 plus the same instance identity. Port alone never authorizes writes.
- Use `127.0.0.1` in connection URLs (the local host), matching the existing bind address and accounts. It avoids an IPv6 `localhost` resolution mismatch.
- The old, stopped `.local/t12-persistent/legacy-78629b14` archive also records port 3336. Its files remain untouched. Do not start that historical runtime alongside the current application; the port-occupied check refuses a second server.
- Generic `migration:local` commands for the old archive and `dev:ronaldo` are mutually exclusive on port 3336. Use the managed `migration:local:files` workflow for `genbook_db` after stopping the app, with the required verified snapshot/archive; do not repoint the older archive at this instance.
- Historical import receipts mentioning port 3338 remain historical evidence. Future imports use 3336.
- CENTRAL, Repair and production databases were not migrated. PDF files in `.local/private-pdf` remain at their existing path.

## Backup and reconciliation

Stopped the app/service, requested MySQL `SHUTDOWN`, and confirmed both ports and all mysqld processes were stopped before the physical backup. `.local/port3336-backup-20261119/` contains the complete runtime, original private configurations/receipts and the external PDF folder if present. SHA-256 comparison verified all 275 runtime files (768,559,395 bytes). This backup contains private data and credentials; do not publish it.

Before/after reports `.local/port3336-before.json` and `.local/port3336-after.json` match for all 62 tables: exact row counts, `CHECKSUM TABLE ... EXTENDED`, schema hashes, server UUID, user authentication fingerprints, grants, routines, triggers and events. Numbering counters, audit rows, migration gates and constraints are included in these comparisons.

All 91 unique PDF blobs (7,818,787 bytes) passed length and SHA-256 validation; attachment link status totals matched. The move retains the same MySQL system tables/users/grants and the same database files. No SQL data transformations or restored table overwrites were needed.

Validation after cutover: `lint` and `typecheck` passed; destination/native import tests 8 passed; persistent local database integration tests 3 passed; Ronaldo auth/book/runner tests 12 passed; issuance rules/backdated tests 12 passed. Live service health reported API/database/CENTRAL up. A service-authenticated overview read for an existing active session returned 200/readOnly; its service account connected to `genbookno_db` on 3336 and a no-op UPDATE was rejected with `ER_TABLEACCESS_DENIED_ERROR`. Independent QA found no remaining blockers. No Ronaldo source/Core changes or schema migrations were required; only the module's private connection URL changed.

## Rollback

Stop the web and Genbookno service, cleanly shut down the relocated MySQL runtime, and confirm port 3336/mysqld are stopped. Restore only the original connection metadata, two receipts and service configuration from the private backup, and revert the scoped runtime port/guard changes to 3338. Then start the same data directory on 3338 and verify the service URL and health.

Preserve the current data directory for a configuration-only rollback. Restoring the older physical data backup would lose later writes; reconcile those first if an actual data restore is needed. Never remove a runtime lock while its process is still running. The offline backup contains the complete instance for recovery; it is not a second runtime to start concurrently.
