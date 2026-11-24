# Workspace appearance

The login and workspace share a burgundy primary color (`#800020`) with pale rose surfaces and neutral text. Warning, error, and success alerts keep their semantic colors.

Workspace navigation sits at the top with two links: Home (`/workspace`) and document issuance (`/workspace/issuance`). The same two links remain visible on narrow screens. The header displays the signed-in name, department, and logout without a profile link.

Home combines search and historical records in one table and loads readable records immediately. The issuance form follows the legacy field order and radio choices, with add/remove recipient rows and an account-scoped series selector. See [the confirmed requirements](specs/workspace-legacy-layout.md). Issuance rules, permissions, and API behavior are unchanged.

Theme and responsive styles live in `app/globals.css`; navigation links live in `app/workspace/workspace-nav.tsx`.
