# QA: Declarative Generative UI (A2UI — Dynamic Schema) — Google ADK

## Prerequisites

- Demo is deployed and accessible at `/demos/declarative-gen-ui` on the dashboard host
- Agent backend is healthy (`/api/health`); `GOOGLE_API_KEY` is set; `AGENT_URL` points at the ADK agent server exposing the `declarative_gen_ui` agent path (registered as agent name `declarative-gen-ui` — see `src/app/api/copilotkit-declarative-gen-ui/route.ts`)
- The demo plays a sales analyst for the fictional **Vantage Threads** company. The dataset and per-question composition rules are registered as agent context in `src/app/demos/declarative-gen-ui/sales-context.ts` — surfaces should reflect those numbers ($4.2M Q2 revenue, 4 regions, 5 reps, 3 at-risk accounts, Meridian Apparel Group as top account)
- Each custom renderer carries a stable `data-testid`: `declarative-card`, `declarative-metric`, `declarative-pie-chart`, `declarative-bar-chart`, `declarative-status-badge`, `declarative-data-table`, `declarative-info-row` (see `src/app/demos/declarative-gen-ui/a2ui/renderers.tsx`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/declarative-gen-ui`; verify the page renders within 3s and a single `CopilotChat` pane is centered (max-width ~896px, rounded-2xl, full-height)
- [ ] Verify the chat is wired to `runtimeUrl="/api/copilotkit-declarative-gen-ui"` and `agent="declarative-gen-ui"` (DevTools → Network: sending a message hits that endpoint, not `/api/copilotkit`)
- [ ] Verify all 4 suggestion pills are visible with verbatim titles:
  - "Show my sales dashboard"
  - "Team performance"
  - "Anything at risk?"
  - "Top account details"
- [ ] Verify no pill mentions a chart type — chart steering lives in the agent instruction, not the user prompt (OSS-136)
- [ ] Send "Hello" and verify an assistant text response appears within 10s (no A2UI surface rendered for plain text)

### 2. Feature-Specific Checks

#### Catalog Wiring (provider `a2ui={{ catalog: myCatalog }}`)

- [ ] DevTools → Network: on first tool-driven response, verify the response stream contains an `a2ui_operations` container with `catalogId: "declarative-gen-ui-catalog"` (matches `createCatalog(..., { catalogId: "declarative-gen-ui-catalog" })` in `a2ui/catalog.ts`)

#### Hero Pill — Composed Sales Dashboard

- [ ] Click "Show my sales dashboard"; within 60s verify ONE composed surface renders containing ALL of (no surrounding Card — the charts carry their own card chrome):
  - a bare row of 4 `declarative-metric` KPI tiles (uppercase label, large value, trend arrow with delta — green `↑` for up, red `↓` for down, e.g. "↑ 12% QoQ")
  - a `declarative-pie-chart` (recharts donut mirroring beautiful-chat: `innerRadius` 40 / `outerRadius` 80, one `.recharts-pie-sector` per slice, tooltip on hover, no legend) showing revenue by region
  - a `declarative-bar-chart` (recharts, height 200, single blue `#3b82f6` bars with rounded tops, dashed grid) showing monthly revenue
- [ ] Verify the surface is a single composed dashboard, NOT a lonely single widget — this is the regression OSS-136 was filed about
- [ ] Verify the pie slices cycle through the shared palette (`#3b82f6`, `#8b5cf6`, `#ec4899`, `#f59e0b`, `#10b981`, `#6366f1`) and bars are uniform blue `#3b82f6` — identical chrome to beautiful-chat's sales dashboard (12px-radius cards, 20px padding, soft shadow)
- [ ] Verify the chat reply text beneath the surface is one short sentence (per the agent instruction: let the UI do the talking)
- [ ] Verify metric numbers match the Vantage Threads dataset (revenue $4.2M, 186 new customers, 31% win rate, $22.6k avg deal)

#### Team Performance — DataTable

- [ ] Click "Team performance"; within 60s verify a `declarative-data-table` renders inside a Card: uppercase column headers (Rep / Attainment / Pipeline), one body row per rep (5 reps, Dana Whitfield through Elena Vasquez), tabular numerals
- [ ] Verify a quota-attainment BarChart renders alongside the table (dashboardy, not a bare table); no StatusBadge or InfoRow

#### At Risk — StatusBadge Cards

- [ ] Click "Anything at risk?"; within 60s verify a risk panel: a KPI strip of Metric tiles (ARR at risk $615k, accounts at risk 3, biggest exposure Northwind $340k) above three side-by-side account Cards (Northwind Retail, Cascadia Outfitters, Atlas Goods), each with a content-sized `declarative-status-badge` (error = high severity, warning = medium) and a one-line reason + recommended next action
- [ ] Verify no charts or tables render for this pill

#### Top Account — InfoRow Facts

- [ ] Click "Top account details"; within 60s verify a Card for Meridian Apparel Group with at least 3 `declarative-info-row` label/value rows (Owner, Region, ARR, Renewal, Last contact), each separated by a 1px bottom border
- [ ] Verify a product-line PieChart renders next to the fact card (grounded in Meridian's product mix); no DataTable or StatusBadge

#### Cross-Pill Differentiation (mirrors the D5 probe)

- [ ] Run all 4 pills in one conversation; verify each pill mounts its distinguishing component fresh (the D5 probe `showcase/harness/src/probes/scripts/d5-gen-ui-declarative.ts` asserts a newly-mounted testid per pill — leftovers from earlier pills must not be the only match)

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op (no user bubble, no assistant response)
- [ ] Send "What is 2+2?"; verify the agent replies in plain text without invoking `generate_a2ui` (no `a2ui_operations` in the response stream, no surface rendered)
- [ ] DevTools → Console: walk through all flows above; verify no uncaught errors, no React error #31, and no A2UI render-error banners ("Cannot create component root without a type", "Catalog not found")

## Expected Results

- Chat loads within 3s; plain-text response within 10s; A2UI surfaces render within 60s of prompt (secondary-LLM pass can be slow on cold start)
- `generate_a2ui` is called exactly once per surface-producing prompt; result contains a valid `a2ui_operations` container with `catalogId: "declarative-gen-ui-catalog"`
- The hero pill produces a composed dashboard (4 KPI tile metrics + 1 PieChart + 1 BarChart in one surface, with NO surrounding Card per OSS-136); pills 2-4 produce their distinguishing component (data-table / status-badge / info-row)
- Numbers are consistent with the Vantage Threads dataset across all four pills
- No UI layout breaks, no flash of unstyled content, no uncaught console errors
