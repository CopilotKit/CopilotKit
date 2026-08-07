# QA: Declarative Generative UI (A2UI — Dynamic Schema) (OpenClaw)

Demo source: `src/app/demos/declarative-gen-ui/page.tsx`
Route: `/demos/declarative-gen-ui` · Agent: `declarative-gen-ui`
Runtime: `/api/copilotkit-declarative-gen-ui`

## What it exercises

A page-registered A2UI catalog rendered by the built-in A2UI middleware. The
page defines a small set of branded components — `Card`, `StatusBadge`,
`Metric`, `InfoRow`, `PrimaryButton`, `PieChart`, `BarChart` — as Zod schemas
(`a2ui/definitions.ts`) plus React renderers (`a2ui/renderers.tsx`), wired into
`myCatalog` via `createCatalog(..., { catalogId: "declarative-gen-ui-catalog", includeBasicCatalog: true })`
and handed to the provider with `<CopilotKit a2ui={{ catalog: myCatalog }}>`.

On OpenClaw there is **no per-demo backend graph** — the demo talks to the
stateless ag-ui gateway. The runtime's A2UI middleware injects a
`render_a2ui` tool (default `injectA2UITool: true`) and serialises the catalog
schema into the request context. The gateway forwards that tool to the model
and relays its `render_a2ui` calls back over AG-UI; the page catalog renders the
resulting surface. This is a runtime-middleware + gateway-relay path, not a
backend that owns the tool. (Ignore the stale comment in `page.tsx` referencing
`injectA2UITool: false` and a Python `a2ui_dynamic` graph — that is copied from
the langgraph reference; the actual route uses the default gateway agent.)

The dataset is **not** grounded (unlike the langgraph/hermes Vantage Threads
demo). The model composes surfaces from generic prompts; numbers it invents are
plausible, not fixed. Custom renderers carry stable `data-testid`s:
`declarative-card`, `declarative-status-badge`, `declarative-metric`,
`declarative-pie-chart`, `declarative-bar-chart` (InfoRow / PrimaryButton render
generic markup, no testid).

## Manual steps

1. Open the demo. Confirm one `CopilotChat` pane renders (centered, rounded,
   full-height) and 4 suggestion pills appear with verbatim titles:
   - "Show a KPI dashboard"
   - "Pie chart — sales by region"
   - "Bar chart — quarterly revenue"
   - "Status report"
2. (Optional) DevTools → Network: send any message and confirm it hits
   `/api/copilotkit-declarative-gen-ui` (not `/api/copilotkit`).
3. Click **"Show a KPI dashboard"**. Expect a surface with 3-4 `Metric` KPI
   tiles (uppercase label, large tabular-nums value; `↑` green / `↓` red arrow
   when a trend is present).
4. Click **"Pie chart — sales by region"**. Expect a `declarative-pie-chart`
   (recharts donut, one sector per slice cycling the `CHART_COLORS` palette,
   tooltip on hover) with a title + description.
5. Click **"Bar chart — quarterly revenue"**. Expect a `declarative-bar-chart`
   (recharts vertical bars, title + description).
6. Click **"Status report"**. Expect a `Card` grouping `StatusBadge` pills
   (success / warning / error / info) — e.g. one per subsystem (API, database,
   workers) with a short state line.
7. Send **"Hello"**. Expect a plain assistant text reply, no A2UI surface.

## Assertion bar

- Each surface-producing prompt calls `render_a2ui` and mounts the expected
  component(s); the surface renders, it is not a "success" text stub.
- The pie/bar surfaces are recharts (hoverable), not static text or emoji.
- Plain-text prompts ("Hello") produce no A2UI surface.
- No uncaught console errors, no React error #31, no A2UI render-error banner
  ("Catalog not found", "Cannot create component root without a type").

## Known caveats

- **Ungrounded data** — there is no fixed dataset; the model fabricates
  plausible numbers/labels. Assert on _component type and structure_, not exact
  values. Different runs will show different figures.
- **Stateless gateway** — behaviour comes from the frontend catalog + runtime
  middleware, not a backend graph; the `page.tsx` header comment about a Python
  graph is stale.
- **Cold start** — the `render_a2ui` model pass can be slow on first invocation;
  allow up to ~60s for a surface before treating it as a failure.

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` carrying the
middleware-injected `render_a2ui` tool to
`http://127.0.0.1:8000/v1/ag-ui/operator` (Bearer gateway token,
`Accept: text/event-stream`) with a dashboard-style prompt, and confirm the SSE
stream contains a `render_a2ui` `TOOL_CALL_START` whose args carry
`catalogId: "declarative-gen-ui-catalog"`, followed by `RUN_FINISHED`.
