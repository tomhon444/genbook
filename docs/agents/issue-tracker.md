# Issue tracker: GitHub

Issues and specs live in https://github.com/tomhon444/genbook.
Use the GitHub CLI (`gh`) for tracker operations.

## Windows

If `gh` is unavailable on PATH, use:
& "C:\Program Files\GitHub CLI\gh.exe" <arguments>

## Conventions

- Before the first write, verify the target with:
  gh repo view --json nameWithOwner
- Target only `tomhon444/genbook`.
- Create: gh issue create --repo tomhon444/genbook --title "..." --body-file <file>
- Read: gh issue view <number> --repo tomhon444/genbook --json number,title,body,labels,comments
- List: gh issue list --repo tomhon444/genbook --state open
- Use UTF-8 files with --body-file for multiline content.
- Link child issues using GitHub sub-issues.
  If unavailable, add `Part of #<parent>` to the child body.
- Record blockers using native issue dependencies.
  If unavailable, add `Blocked by: #<number>` to the issue body.
- Work is unblocked when all its blockers are closed.
- Append explanations as comments before closing issues.

## Pull requests as a triage surface

PRs as a request surface: no.

## Skill operations

- "Publish to the issue tracker": create a GitHub issue.
- "Fetch the relevant ticket": read the referenced GitHub issue.

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`.
- Children: sub-issues labelled `wayfinder:<type>`,
  where type is research, prototype, grilling, or task.
- Frontier: open, unblocked, unassigned children in map order.
- Claim: assign the ticket to the driving developer before work.
- Resolve: comment with the answer, close the ticket,
  and append a context pointer to the map.
