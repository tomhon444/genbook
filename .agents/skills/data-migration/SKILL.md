---
name: data-migration
description: Plan and validate safe migration of existing correspondence-numbering data into MySQL, including mapping, cleanup, reconciliation, and rollback.
---
# Data Migration
1. Inventory source tables/files, row counts, encodings, date formats, duplicates, nulls, and orphan references.
2. Preserve original identifiers and source references where possible.
3. Create explicit source-to-target mappings and document transformations.
4. Profile duplicates and gaps. Never silently renumber historical official documents.
5. Define dry-run, backup, import, validation, reconciliation, cutover, and rollback.
6. Reconcile row counts and key totals before/after migration.
7. Make scripts repeatable where practical and record migration version/status.
8. Protect confidential data in logs and temporary files.
9. Require owner approval before production migration or destructive cleanup.

## Output
Source inventory; mapping; data quality findings; migration steps; reconciliation queries; rollback plan.
