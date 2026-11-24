-- T12 local rehearsal only. Raw staging is never exposed by application routes.
CREATE TABLE legacy_batches (
  source_sha256 CHAR(64) COLLATE utf8mb4_bin PRIMARY KEY,
  manifest_sha256 CHAR(64) COLLATE utf8mb4_bin NOT NULL,
  report JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Shared by allocation and preservation. Local fixtures start open; preserving
-- an actual snapshot closes it. No application endpoint can reopen this gate.
CREATE TABLE issuance_migration_gate (
  id TINYINT PRIMARY KEY,
  state ENUM('open','blocked') NOT NULL,
  CHECK(id=1)
) ENGINE=InnoDB;
INSERT INTO issuance_migration_gate(id,state) VALUES (1,'open');

CREATE TABLE legacy_staging (
  source_sha256 CHAR(64) COLLATE utf8mb4_bin NOT NULL,
  source_table VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  source_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  payload JSON NOT NULL,
  PRIMARY KEY(source_sha256, source_table, source_id),
  FOREIGN KEY(source_sha256) REFERENCES legacy_batches(source_sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Intentionally no business-number UNIQUE: historical duplicates stay intact.
-- No attachment paths are served, no legacy grants are inferred.
CREATE TABLE legacy_documents (
  source_sha256 CHAR(64) COLLATE utf8mb4_bin NOT NULL,
  source_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  owner_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  owner_department_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  series_id VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  number_year SMALLINT UNSIGNED NOT NULL,
  main_number INT UNSIGNED NOT NULL,
  sub_number INT UNSIGNED NOT NULL,
  prefix VARCHAR(100) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  document_date DATE NOT NULL,
  confidential BOOLEAN NOT NULL,
  published BOOLEAN NOT NULL,
  cancelled BOOLEAN NOT NULL,
  pdf_pending BOOLEAN NOT NULL,
  PRIMARY KEY(source_sha256,source_id),
  KEY legacy_owner(owner_id,source_id),
  KEY legacy_scope(series_id,number_year,main_number),
  FOREIGN KEY(source_sha256) REFERENCES legacy_batches(source_sha256),
  FOREIGN KEY(series_id) REFERENCES issuance_series(id),
  FOREIGN KEY(owner_department_id) REFERENCES issuance_departments(id),
  CHECK(main_number > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Allowlisted source-derived metadata only; no raw payload or attachment paths.
-- Optional for older reviewed minimal-history imports. Promotion writes this
-- atomically with its parent, never as a separate visibility operation.
CREATE TABLE legacy_document_details (
  source_sha256 CHAR(64) COLLATE utf8mb4_bin NOT NULL,
  source_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  schema_version TINYINT UNSIGNED NOT NULL,
  payload JSON NOT NULL,
  PRIMARY KEY(source_sha256,source_id),
  FOREIGN KEY(source_sha256,source_id) REFERENCES legacy_documents(source_sha256,source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE legacy_preservation_batches (
  source_sha256 CHAR(64) COLLATE utf8mb4_bin PRIMARY KEY,
  policy VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  approval_reference VARCHAR(200) NOT NULL,
  report JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY(source_sha256) REFERENCES legacy_batches(source_sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE legacy_dispositions (
  source_sha256 CHAR(64) COLLATE utf8mb4_bin NOT NULL,
  source_table VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  source_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  handling ENUM('restricted','unknown_time') NOT NULL,
  reasons JSON NOT NULL,
  PRIMARY KEY(source_sha256,source_table,source_id),
  FOREIGN KEY(source_sha256,source_table,source_id)
    REFERENCES legacy_staging(source_sha256,source_table,source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A reservation per source document, including duplicates/canceled records.
-- No FK to current series: missing legacy references must stay identifiable.
-- NULL subnumbers stay NULL; reservation floors use main numbers conservatively.
CREATE TABLE legacy_number_reservations (
  source_sha256 CHAR(64) COLLATE utf8mb4_bin NOT NULL,
  source_table VARCHAR(32) COLLATE utf8mb4_bin NOT NULL DEFAULT 'genbook',
  source_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  legacy_series_id VARCHAR(5) COLLATE utf8mb4_bin NOT NULL,
  number_year SMALLINT UNSIGNED NOT NULL,
  main_number INT UNSIGNED NOT NULL,
  sub_number INT UNSIGNED NULL,
  original_status VARCHAR(32) NULL,
  series_reference_present BOOLEAN NOT NULL,
  PRIMARY KEY(source_sha256,source_id),
  KEY legacy_reservation_floor(source_sha256,legacy_series_id,number_year,main_number),
  FOREIGN KEY(source_sha256,source_table,source_id)
    REFERENCES legacy_staging(source_sha256,source_table,source_id),
  CHECK(source_table='genbook'),
  CHECK(main_number>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Separate registry: raw batches retain the source manifest hash, while
-- normalized promotions retain the reviewed mapping and derived plan hashes.
CREATE TABLE legacy_promotions (
  source_sha256 CHAR(64) COLLATE utf8mb4_bin PRIMARY KEY,
  mapping_sha256 CHAR(64) COLLATE utf8mb4_bin NOT NULL,
  plan_sha256 CHAR(64) COLLATE utf8mb4_bin NOT NULL,
  report JSON NOT NULL,
  FOREIGN KEY(source_sha256) REFERENCES legacy_preservation_batches(source_sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Only explicit reviewed mappings can connect preserved floors to allocation.
-- Unique target prevents silently merging independent legacy series/snapshots.
CREATE TABLE legacy_reservation_links (
  source_sha256 CHAR(64) COLLATE utf8mb4_bin NOT NULL,
  legacy_series_id VARCHAR(5) COLLATE utf8mb4_bin NOT NULL,
  series_id VARCHAR(32) COLLATE utf8mb4_bin NOT NULL UNIQUE,
  reviewed_by VARCHAR(200) NOT NULL,
  PRIMARY KEY(source_sha256,legacy_series_id),
  FOREIGN KEY(source_sha256) REFERENCES legacy_preservation_batches(source_sha256),
  FOREIGN KEY(series_id) REFERENCES issuance_series(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
