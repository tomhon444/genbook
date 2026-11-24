---
name: security-audit
description: Review Next.js and MySQL security, especially authentication, authorization, SQL injection, secrets, audit logs, and sensitive correspondence data.
---
# Security Audit
1. Inspect authentication/session handling, role checks, route handlers, Server Actions, DB access, uploads, logs, and environment config.
2. Check server-side authorization on every protected operation; test IDOR and privilege escalation.
3. Check SQL injection, unsafe raw queries, mass assignment, CSRF where applicable, XSS, open redirects, and unsafe deserialization.
4. Ensure secrets are server-only and absent from source control, browser bundles, errors, and logs.
5. Check data minimization, audit-log integrity, historical-document access, and safe export/download.
6. Check rate limits and abuse controls for login, search, and number allocation.
7. Check dependency/configuration versions against supported guidance.
8. Prioritize Critical/High/Medium/Low/Informational with evidence, reproduction, impact, and remediation.
9. Do not claim compliance or certification from code review alone.

## Output
Findings by severity; evidence/reproduction; remediation; residual risks and review scope.
