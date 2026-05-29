# QA: Declarative Generative UI (A2UI — Dynamic Schema) — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/declarative-gen-ui` on the dashboard host
- Agent backend is healthy (`/api/copilotkit/health` or the host's `/api/health`); `OPENAI_API_KEY` is set on Railway; `LANGGRAPH_DEPLOYMENT_URL` points at a LangGraph deployment exposing the `a2ui_dynamic` graph (registered as agent name `declarative-gen-ui` — see `src/app/api/copilotkit-declarative-gen-ui/route.ts`)
- Note: the demo source contains no `data-testid` attributes. Checks below rely on verbatim visible text, DOM structure, and inline-style fingerprints declared in `src/app/demos/declarative-gen-ui/a2ui/renderers.tsx`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/declarative-gen-ui`; verify the page renders within 3s and a single `CopilotChat` pane is centered (max-width ~896px, rounded-2xl, full-height)
- [ ] Verify the chat is wired to `runtimeUrl="/api/copilotkit-declarative-gen-ui"` and `agent="declarative-gen-ui"` (DevTools → Network: sending a message hits that endpoint, not `/api/copilotkit`)
- [ ] Verify all 4 suggestion pills are visible with verbatim titles:
  - "Show a KPI dashboard"
  - "Pie chart — sales by region"
  - "Bar chart — quarterly revenue"
  - "Status report"
- [ ] Send "Hello" and verify an assistant text response appears within 10s (no A2UI surface rendered for plain text)

### 2. Feature-Specific Checks

#### Catalog Wiring (provider `a2ui={{ catalog: myCatalog }}`)

- [ ] DevTools → Network: on first tool-driven response, verify the response stream contains an `a2ui_operations` container with `catalogId: "declarative-gen-ui-catalog"` (matches `CUSTOM_CATALOG_ID` in `src/agents/a2ui_dynamic.py` and `createCatalog(..., { catalogId: "declarative-gen-ui-catalog" })` in `a2ui/catalog.ts`)

#### `render_a2ui` Tool Call (secondary-LLM pattern)

- [ ] Click "Show a KPI dashboard"; within 30s verify an A2UI surface renders in-transcript containing at least 3 `Metric` tiles (each: uppercase label with `letterSpacing: 0.12em`, large value in 1.5rem/600 weight, optional `↑`/`↓` trend arrow — green `#189370` for up, red `#FA5F67` for down)
- [ ] Verify the chat reply text beneath the surface is one short sentence (per `SYSTEM_PROMPT`: "Keep chat replies to one short sentence; let the UI do the talking.")

#### `PieChart` Renderer (catalog component + `includeBasicCatalog` merge)

- [ ] Click "Pie chart — sales by region"; within 30s verify a pie-chart card renders with:
  - a non-empty title (1rem / 600 weight, color `#010507`) and description (0.85rem, color `#57575B`)
  - a custom SVG donut (inside the card, `<svg>` with `transform: scaleX(-1)`) containing a grey background `<circle>` plus one stroked `<circle>` per slice (at least 2 slices)
  - a legend with one row per slice: coloured dot, label, comma-formatted value, percentage ending in `%`; percentages sum to 100% (rounding-tolerant)
- [ ] Verify the first slice uses brand color `#BEC2FF` and subsequent slices cycle through the `CHART_COLORS` palette (`#85ECCE`, `#FFAC4D`, `#FFF388`, …)

#### `BarChart` Renderer (Recharts + `barSlideIn` keyframe)

- [ ] Click "Bar chart — quarterly revenue"; within 30s verify a bar-chart card renders with a title + description and a recharts `ResponsiveContainer` at height 280
- [ ] Verify at least 2 `<rect>` bar elements render, X-axis tick labels match the backend `label` values, Y-axis ticks are numeric, and the scoped `@keyframes barSlideIn` animation fires on first paint (bars translate up from `translateY(40px)` to `0`)
- [ ] Verify bar fills cycle through `CHART_COLORS` and bars have rounded top corners (`radius: [6, 6, 0, 0]`)

#### `Card` + `InfoRow` + `StatusBadge` + `PrimaryButton` (catch-all custom-component coverage)

- [ ] Click "Status report"; within 30s verify the surface contains at least one `Card` (white background, 1px `#DBDBE5` border, 16px border-radius, 20px padding) with a bold title
- [ ] Verify at least one `StatusBadge` pill renders — uppercase 0.1em-tracked text, rounded-pill (`borderRadius: 999`), one of the 4 variants (`success` green, `warning` orange, `error` red `#FA5F67`, `info` lilac `#BEC2FF`)
- [ ] Verify at least one `InfoRow` renders inside a Card: label (0.85rem, color `#57575B`) on the left, value (0.9rem, 500 weight, color `#010507`) on the right, separated by a 1px bottom border `#E9E9EF`
- [ ] If the agent emits a `PrimaryButton`, verify it renders as a black (`#010507`) pill-rounded button with white text; hovering changes background to `#2B2B2B`

#### Catalog-Component Sampling (all 7 custom components exercised)

- [ ] Over the 4 suggestion runs above, confirm each catalog component has rendered at least once across the session: `Card`, `StatusBadge`, `Metric`, `InfoRow`, `PrimaryButton`, `PieChart`, `BarChart`. If any did not, send a follow-up prompt targeting the missing one (e.g. "give me a one-button call-to-action card" to force `PrimaryButton`)

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op (no user bubble, no assistant response)
- [ ] Send "What is 2+2?"; verify the agent replies in plain text without invoking `generate_a2ui` (no `a2ui_operations` in the response stream, no surface rendered)
- [ ] DevTools → Console: walk through all flows above; verify no uncaught errors and no React error #31 ("objects are not valid as a React child"), which would indicate a broken `path`-binding on a catalog renderer

## Expected Results

- Chat loads within 3s; plain-text response within 10s; A2UI surfaces render within 30s of prompt
- `render_a2ui` is called exactly once per surface-producing prompt; result contains a valid `a2ui_operations` container with `catalogId: "declarative-gen-ui-catalog"`
- All 7 custom catalog components (Card, StatusBadge, Metric, InfoRow, PrimaryButton, PieChart, BarChart) have been exercised across the suggestion sample
- Rendered UI matches the `myDefinitions` shape (Zod prop names from `a2ui/definitions.ts` line up with values visible in the DOM)
- No UI layout breaks, no flash of unstyled content, no uncaught console errors
