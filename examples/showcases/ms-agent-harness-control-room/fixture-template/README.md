# Agent Harness Demo Workspace

This is a small TypeScript workspace for demonstrating agent-focused work in the
Microsoft Agent Harness control room. It contains source code, tests, scripts,
and seed CSV data that an agent can inspect before rendering generative UI or
running approval-gated commands.

## Useful paths

- `src/metrics.ts` parses and summarizes sample revenue data.
- `data/revenue.csv` contains monthly product revenue and user counts.
- `data/incidents.csv` contains weekly incident counts by severity and owner.
- `scripts/summarize-data.mjs` prints a JSON summary of the revenue CSV.
- `test/metrics.test.ts` verifies the parser and summary helpers.

## Commands

- `pnpm run data:summary`
- `pnpm run test`
- `pnpm run test:coverage`
- `pnpm run typecheck`
