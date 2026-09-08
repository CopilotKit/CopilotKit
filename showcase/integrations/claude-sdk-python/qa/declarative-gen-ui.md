# QA: Declarative Generative UI (A2UI — Dynamic Schema) — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/declarative-gen-ui` on the dashboard host
- Next.js host is healthy (`GET /api/health`) and the Python backend is reachable (`GET /api/copilotkit` reports `agent_status: "reachable"`, derived from `${AGENT_URL}/health`)
- `ANTHROPIC_API_KEY` is set — this cell's model calls go to Anthropic, not OpenAI. `ANTHROPIC_MODEL` is optional; `.env.example` sets `claude-opus-4-8` and `src/agents/a2ui_dynamic.py` falls back to the same id for BOTH the outer agent call and the inner design call
- `AGENT_URL` (default `http://localhost:8000`) points at the FastAPI agent server `src/agent_server.py`, which exposes `@app.post("/declarative-gen-ui")` → `run_a2ui_dynamic_agent`. There is **no** LangGraph deployment and no graph registration in this integration
- Backend-owned wiring: `src/app/api/copilotkit-declarative-gen-ui/route.ts` sets `injectA2UITool: false` (the backend owns `generate_a2ui`) plus `defaultCatalogId: "declarative-gen-ui-catalog"`. `generate_a2ui(context)` in `src/agents/a2ui_dynamic.py` runs a SECOND Claude call forced onto the `render_a2ui` schema via `tool_choice`, then converts the args with `build_a2ui_operations_from_tool_call` from `tools/generate_a2ui.py` (a symlink to `showcase/shared/python/tools/generate_a2ui.py`)
- The demo plays a sales analyst for the fictional **Vantage Threads** company. The dataset and per-question composition rules are registered as agent context in `src/app/demos/declarative-gen-ui/sales-context.ts` — surfaces should reflect those numbers ($4.2M Q2 revenue, 4 regions, 5 reps, 3 at-risk accounts, Meridian Apparel Group as top account)
- Each custom renderer carries a stable `data-testid`: `declarative-card`, `declarative-metric`, `declarative-pie-chart`, `declarative-bar-chart`, `declarative-status-badge`, `declarative-data-table`, `declarative-info-row` (see `src/app/demos/declarative-gen-ui/a2ui/renderers.tsx`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/declarative-gen-ui`; verify the page renders within 3s and a single `CopilotChat` pane is centered (max-width ~896px / `max-w-4xl`, `rounded-2xl`, full viewport height)
- [ ] Verify the chat is wired to `runtimeUrl="/api/copilotkit-declarative-gen-ui"` and `agent="declarative-gen-ui"` (DevTools → Network: sending a message hits that endpoint, not `/api/copilotkit`)
- [ ] Verify all 4 suggestion pills are visible with verbatim titles:
  - "Show my sales dashboard"
  - "Team performance"
  - "Anything at risk?"
  - "Top account details"
- [ ] Verify no pill mentions a chart type — chart steering lives in `SYSTEM_PROMPT` (`src/agents/a2ui_dynamic.py`) and in the `COMPOSITION_RULES` context entry, not in the user prompt (OSS-136)
- [ ] Send "Hello" and verify an assistant text response appears within 10s (no A2UI surface rendered for plain text)

### 2. Feature-Specific Checks

#### Catalog Wiring (provider `a2ui={{ catalog: myCatalog }}`)

- [ ] DevTools → Network: on the first tool-driven response, verify the `generate_a2ui` tool result contains an `a2ui_operations` container with `catalogId: "declarative-gen-ui-catalog"` (matches `createCatalog(..., { catalogId: "declarative-gen-ui-catalog" })` in `a2ui/catalog.ts` and the route's `defaultCatalogId`)
- [ ] Verify only ONE `generate_a2ui` tool call is emitted per surface-producing prompt — the runtime must not inject a second A2UI tool on top of the backend's (that is what `injectA2UITool: false` prevents)

#### Hero Pill — Composed Sales Dashboard

- [ ] Click "Show my sales dashboard" ("Show me my sales dashboard for this quarter."); within 60s verify ONE composed surface renders containing ALL of (no surrounding `declarative-card` — the charts carry their own card chrome):
  - a bare row of 4 `declarative-metric` KPI tiles (uppercase label, 1.5rem value, trend arrow with delta — green `↑` `#059669` for up, red `↓` `#dc2626` for down, e.g. "↑ +12% QoQ")
  - a `declarative-pie-chart` (recharts donut, `innerRadius` 40 / `outerRadius` 80, `paddingAngle` 2, one `.recharts-pie-sector` per slice, tooltip on hover, no legend) showing revenue by region
  - a `declarative-bar-chart` (recharts, 200px tall, single blue `#3b82f6` bars with rounded tops `[4,4,0,0]`, dashed `3 3` grid) showing monthly revenue for all six months Jan–Jun
- [ ] Verify the surface is a single composed dashboard, NOT a lonely single widget — this is the regression OSS-136 was filed about
- [ ] Verify the pie slices cycle through `CHART_COLORS` (`#3b82f6`, `#8b5cf6`, `#ec4899`, `#f59e0b`, `#10b981`, `#6366f1`) and bars are uniform blue `#3b82f6`; every chart sits in the shared `CardShell` chrome (12px radius, 20px padding, soft shadow)
- [ ] Verify the chat reply text beneath the surface is one short sentence (per `SYSTEM_PROMPT`: "Keep chat replies to one short sentence; let the UI do the talking.")
- [ ] Verify metric numbers match the Vantage Threads dataset (revenue $4.2M, 186 new customers, 31% win rate, $22.6k avg deal)

#### Team Performance — DataTable

- [ ] Click "Team performance" ("How are our sales reps performing against quota?"); within 60s verify a `declarative-data-table` renders inside a `declarative-card`: uppercase column headers (rep / attainment / pipeline), one body row per rep (5 reps, Dana Whitfield 124% through Elena Vasquez 71%), tabular numerals
- [ ] Verify a quota-attainment `declarative-bar-chart` renders alongside the table (dashboardy, not a bare table); no `declarative-status-badge` or `declarative-info-row`

#### At Risk — StatusBadge Cards

- [ ] Click "Anything at risk?" ("Are any accounts or pipeline deals at risk this quarter?"); within 60s verify a risk panel: a strip of 3 `declarative-metric` tiles (ARR at risk $615k, accounts at risk 3, biggest exposure Northwind $340k) above three side-by-side `declarative-card`s (Northwind Retail, Cascadia Outfitters, Atlas Goods), each with a content-sized `declarative-status-badge` (`error` for high severity, `warning` for medium) and a one-line reason + recommended next action
- [ ] Verify the badges are content-sized pills (not full-width banners) and that no chart or table renders for this pill

#### Top Account — InfoRow Facts

- [ ] Click "Top account details" ("Pull up the details on our biggest account."); within 60s verify a `declarative-card` for Meridian Apparel Group with at least 3 `declarative-info-row` label/value rows (owner, region, ARR $612k, renewal Sep 30, last contact), each separated by a 1px bottom border with no trailing border on the last row
- [ ] Verify a product-line `declarative-pie-chart` renders next to the fact card (grounded in Meridian's product mix: Outerwear $260k, Footwear $180k, Accessories $112k, Custom $60k); no data table or status badge

#### Cross-Pill Differentiation (mirrors the D5 probe)

- [ ] Run all 4 pills in one conversation; verify each pill mounts its distinguishing component fresh (the D5 probe `showcase/harness/src/probes/scripts/d5-gen-ui-declarative.ts` asserts a newly-mounted testid per pill — leftovers from earlier pills must not be the only match)

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op (no user bubble, no assistant response)
- [ ] Send "What is 2+2?"; verify the agent replies in plain text without invoking `generate_a2ui` (no `a2ui_operations` in the response stream, no surface rendered)
- [ ] DevTools → Console: walk through all flows above; verify no uncaught errors, no React error #31, no A2UI render-error banners ("Cannot create component root without a type", "Catalog not found"), and no `Invalid chart value` warnings (the chart renderers log that when the model emits a non-numeric `value`)

## Expected Results

- Chat loads within 3s; plain-text response within 10s; A2UI surfaces render within 60s of prompt (the inner `render_a2ui` Claude call can be slow on cold start)
- `generate_a2ui` is called exactly once per surface-producing prompt; result contains a valid `a2ui_operations` container with `catalogId: "declarative-gen-ui-catalog"`
- The hero pill produces a composed dashboard (4 KPI tile metrics + 1 PieChart + 1 BarChart in one surface, with NO surrounding Card per OSS-136); pills 2–4 produce their distinguishing component (data-table / status-badge / info-row)
- Numbers are consistent with the Vantage Threads dataset across all four pills
- No UI layout breaks, no flash of unstyled content, no uncaught console errors
