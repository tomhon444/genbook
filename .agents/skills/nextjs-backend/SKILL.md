---
name: nextjs-backend
description: Implement secure server-side functionality with Next.js App Router Route Handlers, Server Actions, services, and MySQL.
---
# Next.js Backend
1. Inspect Next.js version and existing architecture before choosing Route Handlers or Server Actions.
2. Keep database clients, credentials, and privileged logic server-only.
3. Validate all untrusted input at server boundaries.
4. Authenticate and authorize every protected operation; never trust browser-supplied role/user IDs.
5. Keep handlers thin: parse/validate, authorize, call service, map response.
6. Put business rules in server-side services, not React components.
7. Use parameterized SQL or established ORM; never concatenate untrusted input into SQL.
8. Use transactions for multi-step operations. For numbering follow `$mysql-schema-design`.
9. Return consistent status codes and safe errors; log diagnostics server-side without secrets.
10. Test success, validation failure, unauthorized access, conflict, and transaction failure.

## Output
Endpoint/action contract; service/repository boundaries; validation/auth rules; error behavior; tests.
