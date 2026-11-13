# QA: Declarative UI — Hashbrown — Google Antigravity

## Prerequisites

- Demo is deployed at `/demos/declarative-hashbrown` on the dashboard host
- Agent backend is healthy (`/api/health`); `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set (the Go harness calls Gemini itself; `GOOGLE_GEMINI_BASE_URL` points it at aimock in tests)
- The page uses its own runtime route, `/api/copilotkit-declarative-hashbrown`, which proxies agent `declarative-hashbrown-demo` to the agent server's `/declarative_hashbrown` mount, bound in `src/agents/registry.py` to `byoc_hashbrown_agent()` from `src/agents/byoc_hashbrown.py`
- How the UI is produced: the agent has no tools. Its system prompt (`src/agents/byoc_hashbrown_prompt.py`, copied from langgraph-python) makes it answer with one `{"ui": [...]}` JSON object as plain assistant text. The page's assistant-message slot (`hashbrown-renderer.tsx`) parses that text with `@hashbrownai/react`'s `useJsonParser` + `useUiKit`. There is no `response_schema` and no JSON mode: the prompt alone carries the constraint.
- `@hashbrownai/core` + `@hashbrownai/react` are installed in the package

## Test Steps

### 1. Page load

- [ ] Navigate to `/demos/declarative-hashbrown`
- [ ] Header "Declarative UI: Hashbrown" is visible
- [ ] Short description mentioning `@hashbrownai/react` is visible
- [ ] Chat composer is visible at the bottom of the chat area
- [ ] 3 suggestion pills are visible with labels "Sales dashboard", "Revenue by category", "Expense trend"
- [ ] No red console errors (amber hydration warnings tolerated)

### 2. Sales dashboard suggestion

- [ ] Click the "Sales dashboard" pill; the prompt is sent automatically
- [ ] Within 45 seconds, at least one MetricCard (`data-testid="metric-card"`) renders in the transcript
- [ ] Within 45 seconds, at least one chart (`data-testid="bar-chart"` or `data-testid="pie-chart"`) renders
- [ ] No raw JSON text is visible in the transcript
- [ ] Optional visual check: parts of the UI appear before the full response completes, as the JSON text streams in

### 3. Revenue by category

- [ ] Click "Revenue by category"
- [ ] Within 45s, a pie chart (`data-testid="pie-chart"`) renders
- [ ] Legend shows at least 4 segments with readable labels and values

### 4. Expense trend

- [ ] Click "Expense trend"
- [ ] Within 45s, a bar chart (`data-testid="bar-chart"`) renders
- [ ] Chart has at least 3 bars with month-like labels

### 5. Free-form prompt

- [ ] Type "Show me revenue trends for the last six months" and press Enter
- [ ] Verify at least one catalog component renders (metric, chart, or deal card `data-testid="hashbrown-deal-card"`)

### 6. Multi-turn

- [ ] After a first render completes, send a follow-up prompt (e.g. "Now break it down by region")
- [ ] A new render appears alongside the earlier renders in the transcript

### 7. Error handling

- [ ] Empty send is a no-op (send button stays disabled)
- [ ] Console stays clean during successful flows
- [ ] If the model ever replies with prose instead of JSON, the slot renders nothing for that message (the parser finds no value) — verify there is no crash and no stuck spinner

## Expected Results

- Suggestion pills produce a hashbrown render within 45 seconds
- Renders are built from the assistant's JSON text; no raw JSON is shown
- No uncaught errors; no `HashBrownRenderMessage must be used within HashBrownDashboard` errors
- Multi-turn works without clearing earlier renders
