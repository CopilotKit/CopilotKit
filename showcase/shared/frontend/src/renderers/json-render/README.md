# json-render Renderer Adapter

> **Status: Deferred** — Requires Zod 4 isolated sub-package. Will be implemented
> after the initial 4-renderer PR ships.

## Why deferred

json-render (`@json-render/react`) depends on Zod 4, while the monorepo uses Zod 3.
The isolation requires:

- Separate sub-package with its own `package.json` declaring `zod@^4`
- Bundled separately (webpack externals or separate build step)
- JSON boundary — no Zod schemas cross between packages
- AG-UI to json-render bridge (`createAGUIToJsonRenderTransform`)

## Architecture (when implemented)

1. Define `salesDashboardCatalog` using `defineCatalog(schema, { components: {...} })`
2. Agent produces JSONL patches in ```spec fences (prompt-driven)
3. Frontend uses `createMixedStreamParser` to classify text vs patches
4. `Renderer` component renders the spec incrementally
5. Built-in state bindings ($state, $bindState) for interactive dashboard

## Current status

No `JsonRenderDashboard` component exists yet. Consumer pages should fall back
to the tool-based renderer when json-render is selected. No "coming soon" banner
is implemented — the fallback is handled in each consumer's mode switch.
