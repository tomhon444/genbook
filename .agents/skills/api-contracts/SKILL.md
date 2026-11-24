---
name: api-contracts
description: Define and review API contracts between Next.js frontend and backend, including schemas, authorization, errors, and pagination.
---
# API Contracts
1. Agree path, method, purpose, authentication, authorization, request/response schema, and errors before integration.
2. Use consistent naming and JSON shapes.
3. Define pagination, sorting, filtering, and search behavior.
4. Validate body, query, and path parameters on the server.
5. Do not return database internals, secrets, or unauthorized fields.
6. Define conflict behavior for duplicate numbers and concurrent allocation.
7. Define retry/idempotency behavior for number-issuing operations.
8. Keep shared types/schemas in a shared location if architecture supports it.
9. Update docs and tests when contracts change.

## Output
Endpoint table; request/response examples; error/status mapping; auth requirements; frontend notes.
