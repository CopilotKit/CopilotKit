# QA: BYOC json-render — Google Antigravity

## Prerequisites

- Demo is deployed at `/demos/declarative-json-render` on the dashboard host
- Agent backend is healthy (`/api/health`); `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set (the Go harness calls Gemini itself; `GOOGLE_GEMINI_BASE_URL` points it at aimock in tests)
- The page uses its own runtime route, `/api/copilotkit-declarative-json-render`, which proxies agent `byoc_json_render` to the agent server's `/declarative_json_render` mount, bound in `src/agents/registry.py` to `byoc_json_render_agent()` from `src/agents/byoc_json_render.py`
- How the UI is produced: the agent has no tools. Its system prompt (copied from langgraph-python) makes it answer with one `{ root, elements }` JSON object as plain assistant text. The page's assistant-message slot (`json-render-renderer.tsx`) parses that text (tolerating code fences and a prose preamble) and renders it with `@json-render/react` against the MetricCard / BarChart / PieChart catalog. There is no `response_schema`: the prompt alone carries the constraint.
- `@json-render/core` + `@json-render/react` are present in `package.json`

## Test Steps

### 1. Page load

- [ ] Navigate to `/demos/declarative-json-render`
- [ ] Chat composer is visible in a centered full-height pane
- [ ] Three suggestion pills appear with titles "Sales dashboard", "Revenue by category", "Expense trend"
- [ ] No console errors

### 2. Sales dashboard suggestion

- [ ] Click "Sales dashboard" (sends "Show me the sales dashboard with metrics and a revenue chart")
- [ ] Within 60 seconds, a `data-testid="json-render-root"` wrapper appears in the assistant message
- [ ] A `data-testid="metric-card"` renders inside the wrapper
- [ ] A chart (`data-testid="bar-chart"` or `data-testid="pie-chart"`) renders inside the wrapper
- [ ] No raw JSON text is shown once rendering finishes — the streamed JSON is replaced by components

### 3. Revenue by category

- [ ] Click "Revenue by category" (sends "Break down revenue by category as a pie chart")
- [ ] Within 60 seconds, a `data-testid="pie-chart"` renders with multiple category slices and a legend

### 4. Expense trend

- [ ] Click "Expense trend" (sends "Show me monthly expenses as a bar chart")
- [ ] Within 60 seconds, a `data-testid="bar-chart"` renders with month labels

### 5. Free-form prompt

- [ ] Type "Show me a metric for quarterly revenue" and send
- [ ] Verify at least one `metric-card` renders; no console errors

### 6. Multi-turn

- [ ] With a previous render visible, send a follow-up ("Now break that down by region")
- [ ] A new assistant message appears with a new json-render rendering — earlier renders stay in the transcript

### 7. Malformed output handling

- [ ] Ask "tell me a joke"; if the agent replies with non-JSON text, the chat falls back to the default assistant bubble showing that text. No crash, no stuck spinner.
- [ ] While a JSON reply is still streaming (not yet a complete object), the default bubble shows the partial text, then swaps to rendered components once the spec parses

## Expected Results

- Suggestion renders land within 60 seconds
- No uncaught errors in the console
- Streaming shows plain text until the JSON parses, then swaps to rendered components
