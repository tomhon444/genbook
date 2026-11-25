# Local MySQL: port 3306

> **24 November 2026 — single local database.** genbook now uses only `genbook_db` on 127.0.0.1:3306. `genbookno_db`, `t05_synthetic`, Ronaldo's Genbookno module and `BOOK_DATA_PROVIDER=ronaldo` were removed; sign-in goes through ronaldo-service Core identity against CENTRAL `STAFF_INFO`. The sections below are historical records.

19 November 2026 (Asia/Bangkok): the owner changed the requested local endpoint from 3336 to **127.0.0.1:3306**. The target port was confirmed unused before cutover. This relocates the existing MySQL **8.0.30** instance and its existing data directory `.local/t12-persistent/genbook-db/data/`; it does not import into, upgrade, or alter Laragon's separate MySQL 5.6 data directory/configuration.

| Database | Tables | Exact rows |
| --- | ---: | ---: |
| `genbook_db` | 21 | 726,492 |

## Current operation

Run `npm.cmd run dev:ronaldo` in this project. It requires `ISSUANCE_DATABASE_URL` in `.env.local` to point at `127.0.0.1:3306/genbook_db` and refuses any other target. Run ronaldo-service (full service or `node dist/core/identity/identity-server.js`) for CENTRAL sign-in; it has no book-database connection.

The runtime metadata and private `genbook-local8.json` receipt record port 3306. No passwords/users/grants were changed. The app reads and writes `genbook_db` directly (the former read-only `BOOK_DATA_PROVIDER=ronaldo` mode was removed). Files outside MySQL under `.local/private-pdf` remain at the same path.

The persistent launcher allows 3306 only for reopening the exact `genbook-db` runtime with `createIfMissing: false`. It still requires its private ready metadata, correct data directory, port and instance UUID, and refuses an occupied port. Other runtimes and all new-instance creation on 3306 are refused. Generic test/legacy runtimes keep their previous port rules; they cannot silently attach to this instance. The managed migration capability additionally verifies `genbook_db` and its instance marker.

Only one MySQL server may listen on 3306. Keep Laragon's separate MySQL service stopped while this managed instance is running. A collision is refused; the runner never stops or adopts Laragon automatically. Use `127.0.0.1`, port `3306`, and the existing private MySQL 8 account credentials in HeidiSQL. Credentials are not the unrelated Laragon default account.

## Backup and verification

Before cutover, shut down MySQL cleanly and confirm its processes and ports stopped. A new offline physical backup was made at `.local/port3306-backup-20261119/`; all 276 runtime files (768,560,903 bytes) passed SHA-256 copy verification. It also contains the original private environment/receipt files and external PDFs when present. Keep this backup private. The earlier 3338-to-3336 backup is retained separately.

`.local/port3306-before.json` and `.local/port3306-after.json` match for all 62 tables: exact counts, extended table checksums, schema hashes, server UUID, users/grants fingerprints, routines, triggers and events. All 91 PDF BLOBs (7,818,787 bytes) passed length/SHA-256 checks and link status totals matched. Counters, audits, unique/FK constraints and migration gates are included in these comparisons.

Validation: lint/typecheck passed; target/native/runner regression tests 10 passed; retained database integration tests 3 passed. Service health returned API/database/CENTRAL up, and `/login` returned 200.

## Rollback

Stop the web app; cleanly shut down MySQL and confirm 3306/mysqld are stopped. Restore the previous runtime `connection.json` and receipt from the 3306 backup, then revert only the active endpoint/guard changes to 3336 and restart the same data directory. Do not restore the older data files over later writes; configuration-only rollback preserves them. Restoring a physical backup requires reconciling any later writes first. Retire runtime locks only after their owning process is confirmed stopped.

Historical import receipts retain the ports recorded when imports happened. CENTRAL, production data and other Ronaldo modules are outside this move.
