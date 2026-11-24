---
name: workflow-planning
description: Plan implementation phases, dependencies, ownership, and handoffs across Codex subagents for this correspondence numbering system.
---
# Workflow Planning
1. Read project guidance and requirement analysis.
2. Break work into discovery, architecture, schema, API contracts, UI, implementation, testing, migration, and deployment.
3. Identify dependencies; agree schema and API contracts before dependent implementation.
4. Assign one owner per file/directory; avoid concurrent edits to shared files.
5. Parallelize independent read-only discovery and review; sequence write-heavy tasks.
6. Require each agent to report assumptions, decisions, files touched, risks, tests, and blockers.
7. Maintain decision log and implementation checklist.
8. Do not authorize deployment, destructive migration, or production writes without explicit approval.

## Output
Phased plan, dependencies, ownership, risks, mitigations, acceptance checklist.
