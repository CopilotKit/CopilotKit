# QA: Declarative UI — json-render — Claude Agent SDK (Python)

## Prerequisites

- Demo deployed at `/demos/declarative-json-render`
- Agent backend healthy (`GET /api/health` returns
  `{"status":"ok","integration":"claude-sdk-python"}`)
- `ANTHROPIC_API_KEY` set in the deployment environment (`ANTHROPIC_MODEL`
  defaults to `claude-opus-4-8`)
- `AGENT_URL` (default `http://localhost:8000`) points at the FastAPI server
  exposing `POST /declarative-json-render` (`src/agent_server.py`, prompt in
  `src/agents/byoc_json_render_agent.py`)
- `@json-render/core` + `@json-render/react` present in `package.json`
  (pinned to `0.18.0`)
- Frontend runtime: `/api/copilotkit-declarative-json-render`, agent name
  `byoc_json_render`

## Test Steps

### 1. Page load

- [ ] Navigate to `/demos/declarative-json-render`.
- [ ] The chat surface loads inside the centered `max-w-4xl` container.
- [ ] Chat composer is visible.
- [ ] Three suggestion pills appear with titles: "Sales dashboard", "Revenue by category", "Expense trend".
- [ ] No console errors.

### 2. Sales dashboard suggestion

- [ ] Click the "Sales dashboard" suggestion.
- [ ] Within 60 seconds, a `data-testid="json-render-root"` wrapper appears in the assistant bubble.
- [ ] A `data-testid="metric-card"` renders inside the wrapper.
- [ ] A chart (`data-testid="bar-chart"` or `data-testid="pie-chart"`) renders inside the wrapper.
- [ ] No raw JSON text is shown once rendering finishes — the streaming JSON is replaced by components.

### 3. Revenue by category

- [ ] Click the "Revenue by category" suggestion.
- [ ] Within 60 seconds, a `data-testid="pie-chart"` renders with multiple category slices + legend.

### 4. Expense trend

- [ ] Click the "Expense trend" suggestion.
- [ ] Within 60 seconds, a `data-testid="bar-chart"` renders with month labels.

### 5. Free-form prompt

- [ ] Type "Show me a metric for quarterly revenue" and send.
- [ ] Verify at least one `metric-card` renders; no console errors.

### 6. Multi-turn

- [ ] After a previous render is visible, send a follow-up prompt ("Now break that down by region").
- [ ] A new assistant message appears with a new json-render rendering — prior renders stay in the transcript.

### 7. Malformed output handling

- [ ] Force non-spec output by asking "tell me a joke". The renderer's
      `parseSpec` returns null for anything that is not a `{ root, elements }`
      object whose element `type`s are all in `MetricCard` / `BarChart` /
      `PieChart`, so the chat falls back to the default
      `CopilotChatAssistantMessage` bubble. No crash, no stuck spinner.

## Expected Results

- Suggestion renders land within 60 seconds. Budget is slightly higher than the hashbrown demo because a JSON `{ root, elements }` spec is more verbose than hashbrown's token stream.
- No uncaught errors in the console.
- Streaming falls back to plain text until the JSON parses, then swaps to rendered components wrapped in a single `<JSONUIProvider>` (no missing-provider crashes).
