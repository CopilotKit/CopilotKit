# QA: Declarative Generative UI (A2UI — Dynamic Schema) — Google Antigravity

## Prerequisites

- Demo is deployed and accessible at `/demos/declarative-gen-ui` on the dashboard host
- Agent backend is healthy (`/api/health`); `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set (the Go harness calls Gemini itself, and `generate_a2ui` makes its own Gemini call; `GOOGLE_GEMINI_BASE_URL` points both at aimock in tests)
- The page uses its own runtime route, `/api/copilotkit-declarative-gen-ui`, which proxies agent `declarative-gen-ui` to the agent server's `/declarative_gen_ui` mount, bound in `src/agents/registry.py` to `declarative_gen_ui_agent()` from `src/agents/a2ui_dynamic.py`. The route sets `injectA2UITool: false` and `defaultCatalogId: "declarative-gen-ui-catalog"`.
- Backend-owned A2UI: `generate_a2ui(request)` is an Antigravity server tool. It reads the page's sales context and the catalog's A2UI schema with `experimental_get_context()`, makes its own forced `render_a2ui` Gemini call, validates the result (structural checks only), retries up to 3 times with the errors in the prompt, and returns an `a2ui_operations` envelope. The runtime's A2UI middleware paints that envelope from the `TOOL_CALL_RESULT`. The surface arrives whole, with no progressive streaming. `injectA2UITool: false` is load-bearing: an injected `render_a2ui` frontend tool would park in the harness.
- The agent plays a sales analyst for the fictional **Vantage Threads** company. The dataset and composition rules are published as agent context in `src/app/demos/declarative-gen-ui/sales-context.ts` — surfaces should reflect those numbers ($4.2M quarterly revenue, 186 new customers, 31% win rate, $22.6k avg deal, 5 reps, 3 at-risk accounts, Meridian Apparel Group as top account)
- Each custom renderer carries a stable `data-testid`: `declarative-card`, `declarative-metric`, `declarative-pie-chart`, `declarative-bar-chart`, `declarative-status-badge`, `declarative-data-table`, `declarative-info-row` (see `src/app/demos/declarative-gen-ui/a2ui/renderers.tsx`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/declarative-gen-ui`; verify the page renders within 3s with a single `CopilotChat` pane centered (max-width 4xl, rounded-2xl, full height)
- [ ] Verify the chat is wired to `runtimeUrl="/api/copilotkit-declarative-gen-ui"` and `agent="declarative-gen-ui"` (DevTools → Network: sending a message hits that endpoint, not `/api/copilotkit`)
- [ ] Verify all 4 suggestion pills are visible with verbatim titles:
  - "Show my sales dashboard"
  - "Team performance"
  - "Anything at risk?"
  - "Top account details"
- [ ] Verify no pill mentions a chart type — component choice lives in the composition rules, not the user prompt
- [ ] Send "Hello" and verify a response appears within 10s

### 2. Feature-Specific Checks

#### Catalog Wiring (provider `a2ui={{ catalog: myCatalog }}`)

- [ ] DevTools → Network: on the first surface-producing reply, verify the `generate_a2ui` tool result contains an `a2ui_operations` container with `catalogId: "declarative-gen-ui-catalog"`

#### Hero Pill — Composed Sales Dashboard

- [ ] Click "Show my sales dashboard" (sends "Show me my sales dashboard for this quarter."); within 60s verify ONE composed surface renders containing ALL of (no surrounding Card — the charts carry their own card chrome):
  - a row of 4 `declarative-metric` KPI tiles (label, large value, trend arrow with delta — green up, red down)
  - a `declarative-pie-chart` showing revenue by region
  - a `declarative-bar-chart` showing monthly revenue (Jan–Jun)
- [ ] Verify the surface is a composed dashboard, not a single lonely widget
- [ ] Verify the metric numbers match the Vantage Threads dataset (revenue $4.2M, 186 new customers, 31% win rate, $22.6k avg deal)
- [ ] Verify the chat reply beneath the surface is one short sentence

#### Team Performance — DataTable

- [ ] Click "Team performance"; within 60s verify a `declarative-data-table` inside a Card with Rep / Attainment / Pipeline columns and one row per rep (Dana Whitfield, Marcus Lee, Priya Sharma, Tom Okafor, Elena Vasquez)
- [ ] Verify a quota-attainment `declarative-bar-chart` renders alongside the table; no StatusBadge or InfoRow

#### At Risk — StatusBadge Cards

- [ ] Click "Anything at risk?"; within 60s verify a row of Metric tiles (ARR at risk $615k, accounts at risk 3, biggest exposure Northwind $340k) above one Card per at-risk account (Northwind Retail, Cascadia Outfitters, Atlas Goods), each with a `declarative-status-badge` (error for high severity, warning for medium) and a one-line reason plus next action
- [ ] Verify no charts or tables render for this pill

#### Top Account — InfoRow Facts

- [ ] Click "Top account details"; within 60s verify a Card for Meridian Apparel Group with at least 3 `declarative-info-row` label/value rows (owner, region, ARR, renewal, last contact)
- [ ] Verify a product-line `declarative-pie-chart` renders next to the fact card; no DataTable or StatusBadge

#### Cross-Pill Differentiation (mirrors the D5 probe)

- [ ] Run all 4 pills in one conversation; verify each pill mounts its distinguishing component fresh (the D5 probe `showcase/harness/src/probes/scripts/d5-gen-ui-declarative.ts` asserts a newly-mounted testid per pill)

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op (no user bubble, no assistant response)
- [ ] DevTools → Console: walk through all flows above; verify no uncaught errors, no React error #31, and no A2UI render-error banners ("Cannot create component root without a type", "Catalog not found")
- [ ] Verify no run hangs waiting on a frontend `render_a2ui` tool (a hang would mean the runtime injected the A2UI tool)

## Expected Results

- Chat loads within 3s; A2UI surfaces render within 60s of the prompt (the inner Gemini call adds latency; a retry adds more)
- `generate_a2ui` is called once per surface-producing prompt; its result carries a valid `a2ui_operations` container with `catalogId: "declarative-gen-ui-catalog"`
- The hero pill produces a composed dashboard (4 Metric tiles + PieChart + BarChart in one surface, with no surrounding Card); pills 2-4 produce their distinguishing component (data-table / status-badge / info-row)
- Numbers are consistent with the Vantage Threads dataset across all four pills
- No UI layout breaks, no uncaught console errors
