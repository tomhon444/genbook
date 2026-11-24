---
name: testing
description: Create and run tests for the correspondence-numbering system, including unit, integration, end-to-end, regression, and concurrency tests.
---
# Testing
1. Inspect existing test runner and conventions; avoid adding another framework without reason.
2. Derive tests from acceptance criteria.
3. Unit-test numbering rules, validation, permissions, and business services.
4. Integration-test DB constraints, transactions, rollback, and repositories against compatible MySQL when feasible.
5. Test concurrent allocation; verify no duplicate numbers and correct retry/failure behavior.
6. Test route handlers for success, malformed input, unauthenticated, unauthorized, not found, conflict, and server errors.
7. Add end-to-end tests for core workflows when infrastructure exists.
8. Avoid tests that only assert implementation details.
9. Report commands, environment, pass/fail, skipped tests, and gaps.

## Output
Test plan; test cases; results; uncovered risks.
