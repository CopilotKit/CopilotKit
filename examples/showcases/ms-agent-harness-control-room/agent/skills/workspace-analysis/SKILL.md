---
name: workspace-analysis
description: |
  Read-first workflow for the generic Agent Harness demo workspace. Use this
  when the operator asks you to inspect the repo, explain the code, summarize
  seed data, plan a small change, or prepare a generative UI preview grounded
  in workspace files.
---

# Workspace analysis

The demo workspace is exposed to Harness file tools as the current file
sandbox. Paths are workspace-relative. Do not prefix paths with
`.control-room-fixture/`, `/app/`, or an absolute path.

Useful paths:

- `README.md`
- `src/metrics.ts`
- `test/metrics.test.ts`
- `data/revenue.csv`
- `data/incidents.csv`
- `scripts/summarize-data.mjs`

## Procedure

Follow the operator's current prompt and keep the interaction complete.

1. Start with the smallest useful inspection: usually `README.md`, a targeted
   source file, or one CSV file.
2. For multi-step work, create a short todo list so the Harness state is visible.
3. If the operator asks for a chart, table, calendar, form, or summary card,
   render exactly one relevant `show...` component as the final action.
4. If the operator asks to run tests, typecheck, coverage, or data summary, use
   `pnpm_run`. The approval card is part of the demo; do not bypass it.
5. Save to file memory only when the operator asks for persistence, a handoff,
   or a durable note.

## Command notes

Allowed `pnpm_run` commands are `install`, `test`, `test:coverage`,
`typecheck`, and `data:summary`.
