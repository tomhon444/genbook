-- T05 additive schema, MySQL 8 / InnoDB. Apply only to the isolated synthetic
-- database. Production counters must be reconciled and approved under T12.
-- UTC timestamps; business dates and number years use Asia/Bangkok in the app.
CREATE TABLE issuance_departments (
  id VARCHAR(64) COLLATE utf8mb4_bin PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE issuance_series (
  id VARCHAR(32) COLLATE utf8mb4_bin PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  document_type VARCHAR(100) NOT NULL,
  prefix VARCHAR(100) NOT NULL,
  year_basis ENUM('calendar','document_date') NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE issuance_grants (
  owner_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  series_id VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (owner_id, series_id),
  FOREIGN KEY (series_id) REFERENCES issuance_series(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Lock this row before the pending-PDF check, even across different series.
CREATE TABLE issuance_owner_locks (
  owner_id VARCHAR(64) COLLATE utf8mb4_bin PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE issuance_counters (
  series_id VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  number_year SMALLINT UNSIGNED NOT NULL,
  last_number INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (series_id, number_year),
  FOREIGN KEY (series_id) REFERENCES issuance_series(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- T10: mutex and high-water mark per main number, independent of normal counter.
CREATE TABLE issuance_subcounters (
  series_id VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  number_year SMALLINT UNSIGNED NOT NULL,
  main_number INT UNSIGNED NOT NULL,
  last_sub_number INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (series_id, number_year, main_number),
  FOREIGN KEY (series_id) REFERENCES issuance_series(id),
  CHECK (main_number > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE issuance_documents (
  id CHAR(36) COLLATE utf8mb4_bin PRIMARY KEY,
  owner_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  owner_department_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  request_key CHAR(36) COLLATE utf8mb4_bin NOT NULL,
  payload_hash CHAR(64) COLLATE utf8mb4_bin NOT NULL,
  series_id VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  number_year SMALLINT UNSIGNED NOT NULL,
  main_number INT UNSIGNED NOT NULL,
  sub_number INT UNSIGNED NOT NULL DEFAULT 0,
  prefix VARCHAR(100) NOT NULL,
  document_date DATE NOT NULL,
  issued_at DATETIME(3) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  recipients JSON NOT NULL,
  recipient_department_ids JSON NOT NULL,
  external_organization VARCHAR(500) NOT NULL DEFAULT '',
  signer VARCHAR(200) NOT NULL,
  confidential BOOLEAN NOT NULL,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  pdf_path VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY issuance_request_unique (owner_id, request_key),
  UNIQUE KEY issuance_number_unique (series_id, number_year, main_number, sub_number),
  KEY issuance_owner_recent (owner_id, issued_at, id),
  KEY issuance_pending_pdf (owner_id, confidential, pdf_path),
  FOREIGN KEY (series_id) REFERENCES issuance_series(id),
  CHECK (main_number > 0),
  CHECK (version > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE issuance_audit (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id CHAR(36) COLLATE utf8mb4_bin NOT NULL,
  actor_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  event VARCHAR(32) NOT NULL,
  details JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY issuance_audit_document (document_id, id),
  FOREIGN KEY (document_id) REFERENCES issuance_documents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
