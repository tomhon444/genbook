-- Additive storage for an isolated local preservation target on MySQL 8.0.30+.
-- Apply only after legacy_staging exists. Do not apply to the legacy server.
-- Raw archives do not confer application download permission. No grants are added.
-- The importer verifies SHA-256 before INSERT and after reading content back;
-- the hash is not reversible and never substitutes for the original PDF bytes.
CREATE TABLE IF NOT EXISTS legacy_attachment_blobs (
  sha256 BINARY(32) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  media_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content LONGBLOB NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (sha256),
  CONSTRAINT legacy_attachment_blobs_size_ck
    CHECK (byte_size > 4 AND OCTET_LENGTH(content) = byte_size),
  CONSTRAINT legacy_attachment_blobs_media_ck
    CHECK (media_type = 'application/pdf')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One source document has one current archival association. Several documents
-- may reference one immutable content hash; original numbers/IDs never change.
-- Retain source/inventory identity and failed/missing/pending states separately
-- from the bytes. Never mark a missing file as downloaded with an empty BLOB.
CREATE TABLE IF NOT EXISTS legacy_attachment_links (
  source_sha256 CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  source_table VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
    NOT NULL DEFAULT 'genbook',
  source_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  inventory_sha256 CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  source_path VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  blob_sha256 BINARY(32) NULL,
  failure_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (source_sha256, source_table, source_id),
  KEY legacy_attachment_links_blob_idx (blob_sha256),
  CONSTRAINT legacy_attachment_links_source_fk
    FOREIGN KEY (source_sha256, source_table, source_id)
    REFERENCES legacy_staging (source_sha256, source_table, source_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT legacy_attachment_links_blob_fk
    FOREIGN KEY (blob_sha256) REFERENCES legacy_attachment_blobs (sha256)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT legacy_attachment_links_table_ck CHECK (source_table = 'genbook'),
  CONSTRAINT legacy_attachment_links_state_ck CHECK (
    (status = 'downloaded' AND blob_sha256 IS NOT NULL
      AND failure_code IS NULL AND source_path IS NOT NULL)
    OR (status = 'failed' AND blob_sha256 IS NULL
      AND failure_code IS NOT NULL AND source_path IS NOT NULL)
    OR (status = 'pending' AND blob_sha256 IS NULL
      AND failure_code IS NULL AND source_path IS NOT NULL)
    OR (status IN ('missing_reference', 'invalid_reference')
      AND blob_sha256 IS NULL AND failure_code IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Use a short transaction per verified blob/association batch. Serialize/retry
-- duplicate hashes without replacing immutable content; retain import receipts.
-- Connections use UTC for technical created_at values (display Asia/Bangkok).
-- Rollback before commit is transactional. After commit, retain archive rows and
-- restore/replay into a separate verified target if required; do not DROP/DELETE
-- preserved content or cascade source removal as an automatic rollback.
