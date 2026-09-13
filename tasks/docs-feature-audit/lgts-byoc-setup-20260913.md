# LangGraph TypeScript bring-your-own setup reproduction — 2026-09-13

Scope: the corrected `/langgraph-typescript/quickstart` TypeScript
bring-your-own branch. This validation copied the selected Showcase agent
layout into `/private/tmp/lgts-byoc-setup-20260913`, installed from the exact
shown `src/agent/package.json`, and did not start a LangGraph or Next server.

## Result

`npm install --ignore-scripts --no-audit --no-fund` completed successfully
(`up to date in 267ms`). Its package configuration and imports therefore
resolve in an isolated app layout containing `src/agent` and the selected
`shared-tools` dependency.

The focused graph typecheck used:

```bash
NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/tsc --noEmit \
  --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck graph.ts
```

It reaches the graph and reports three type errors at lines 75, 98, and 136:
two `string` versus `SalesStage` schema mismatches and one optional-field
versus `Flight` mismatch. The exact command run in the checked-in selected
source reports the same three errors. This is an existing Showcase graph type
error, not an isolated-install or documented-config failure.

The reproduction script is
`tasks/docs-feature-audit/reproduce-lgts-byoc-setup.sh`. It creates and removes
its own `/private/tmp` directory and intentionally does not run `npm run dev`.
CLI graph-load/start validation needs the dedicated runtime slot after the
active Built-in Agent matrix ends.
