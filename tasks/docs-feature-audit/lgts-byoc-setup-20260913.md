# LangGraph TypeScript Showcase-agent setup reproduction — 2026-09-13

Scope: the TypeScript branch of `/langgraph-typescript/quickstart` after its
copy-path correction. It now distinguishes an existing-agent reference from
the complete runnable Showcase sample.

The earlier attempt copied `src/agent` and `shared-tools` directly. That did
not reproduce the guide because it included existing `node_modules` and named
an undocumented partial layout. It is retained as a rejected observation, not
as setup evidence.

## Reproduction

`tasks/docs-feature-audit/reproduce-lgts-byoc-setup.sh` creates a fresh
temporary copy of the complete checked-in
`showcase/integrations/langgraph-typescript` directory, excluding installed
dependencies. This mirrors the guide's complete-sample clone layout. It then:

1. copies `.env.example` to `.env` at the integration root, matching the
   selected `langgraph.json` `../../.env` path;
2. runs `npm ci --ignore-scripts --no-audit --no-fund` in `src/agent` from the
   checked-in lockfile; and
3. type-checks the selected `graph.ts` with strict TypeScript settings, without
   starting a server.

The rendered package, configuration, and graph snippets remain reference
material for an **existing** TypeScript agent. They do not form a standalone
copy path: the graph imports `openai-headers`, shared tools, and its full
configuration registers other sample graphs.

## Result

Clean rerun passed on 2026-09-13:

```text
added 204 packages in 1s
```

The strict graph check completed with no diagnostics. Before this rerun, the
selected `graph.ts` reported three real source errors: the two sales-tool
schemas accepted arbitrary `stage` strings although the shared implementation
uses `SalesStage`, and the flight schema made fields optional although its
shared implementation accepts complete `Flight` values. The source now uses
the declared sales-stage values and requires every `Flight` field, so the
strict check passes in the clean sample layout.

No LangGraph or Next server is started by this reproduction; graph-load/start
validation requires a separate runtime slot.
