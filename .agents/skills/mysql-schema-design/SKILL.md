---
name: mysql-schema-design
description: Design or review MySQL schemas, relationships, indexes, constraints, transactions, and concurrency-safe document numbering.
---
# MySQL Schema Design
1. Inspect MySQL version, current schema/data, ORM/driver, and migration conventions.
2. Use InnoDB for transactional tables unless there is a justified alternative.
3. Define entities, types, nullability, defaults, keys, foreign keys, and deletion behavior.
4. Normalize appropriately; document denormalization.
5. Add indexes based on actual query patterns.
6. Enforce critical uniqueness with UNIQUE constraints.
7. Confirm the unique numbering scope; do not assume it.
8. Never allocate with `SELECT MAX(number) + 1` alone. Prefer a counter row keyed by the confirmed scope, updated atomically or under row lock in a transaction, plus a unique constraint on issued numbers.
9. Explain transaction boundaries, locking/isolation, deadlock retry, and rollback.
10. Preserve audit events for issue, amendment, cancellation, and privileged changes.
11. Define timestamp storage and Asia/Bangkok display conversion consistently with existing architecture.
12. Provide migration and rollback notes; never run destructive migrations without approval.

## Output
ERD; DDL/ORM schema; indexes/constraints; allocation pseudocode; migration/rollback notes.
