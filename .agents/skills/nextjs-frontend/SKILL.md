---
name: nextjs-frontend
description: Build pages, layouts, forms, tables, and client interactions with Next.js App Router, React, TypeScript, and CoreUI.
---
# Next.js Frontend
1. Inspect Next.js version, router structure, TS settings, and conventions.
2. Use App Router. Keep pages/layouts as Server Components by default.
3. Add `'use client'` only for state, event handlers, effects, or browser APIs.
4. Fetch on the server when appropriate; avoid unnecessary client fetching.
5. Keep UI state, server data, and form state distinct.
6. Use typed props and shared domain types; do not duplicate API shapes.
7. Handle loading, error, empty, success, and validation states.
8. Never expose secrets, stack traces, or unauthorized data in the browser.
9. Follow `$coreui-design-system`.
10. Test responsive layouts and keyboard navigation.

## Output
Page/component structure; implementation summary; API dependencies; accessibility/responsive checks.
