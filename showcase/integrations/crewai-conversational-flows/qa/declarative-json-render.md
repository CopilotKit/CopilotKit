# QA: Declarative UI — json-render — CrewAI Conversational Flows

## Prerequisites

- Demo reachable at `/demos/declarative-json-render`
- `agent_server.py` running and healthy; it mounts the crew at
  `/conversational_flows/byoc-json-render`
- A Next.js runtime route at `/api/copilotkit-declarative-json-render` —
  the page mounts that URL, but only
  `src/app/api/copilotkit-byoc-json-render/route.ts` exists today, so the
  demo 404s on its runtime URL until that is reconciled (see Integration
  notes)
- `OPENAI_API_KEY` set for the agent backend
- `@json-render/core` + `@json-render/react` present in `package.json`
  (pinned to `0.18.0`)

## Test Steps

### 1. Page load

- [ ] Navigate to `/demos/declarative-json-render`.
- [ ] Chat composer is visible.
- [ ] Three suggestion pills appear with titles: "Sales dashboard", "Revenue by category", "Expense trend".
- [ ] No console errors.

### 2. Sales dashboard suggestion

- [ ] Click the "Sales dashboard" suggestion.
- [ ] Within 60 seconds, a `data-testid="json-render-root"` wrapper appears in the assistant bubble.
- [ ] A `data-testid="metric-card"` renders inside the wrapper.
- [ ] A chart (`data-testid="bar-chart"` or `data-testid="pie-chart"`) renders inside the wrapper.
- [ ] Nested children of the MetricCard (the BarChart in the Sales Dashboard worked example) render — they are NOT silently dropped.
- [ ] No raw JSON text is shown once rendering finishes — the streaming JSON is replaced by components.

### 3. Revenue by category

- [ ] Click the "Revenue by category" suggestion.
- [ ] Within 60 seconds, a `data-testid="pie-chart"` renders with multiple category slices + legend.
- [ ] No `useVisibility must be used within a VisibilityProvider` console error (`<JSONUIProvider>` must wrap `<Renderer>`).

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

- [ ] If the agent ever replies with non-JSON text (force it by asking "tell me a joke"), the chat falls back to rendering that raw text via the default assistant bubble. No crash, no stuck spinner.

## Expected Results

- Suggestion renders land within 60 seconds. Budget is slightly higher than the hashbrown demo because a JSON `{ root, elements }` spec is more verbose than hashbrown's token stream.
- No uncaught errors in the console.
- Streaming falls back to plain text until the JSON parses, then swaps to rendered components.

## Integration notes

- The flat-spec prompt lives in `src/agents/byoc_json_render_agent.py`; the
  `byoc_` prefix on the backend module is deliberate and stays.
- **Known break (pre-existing, not a QA regression):** the demo page is the
  north-star copy and mounts
  `runtimeUrl="/api/copilotkit-declarative-json-render"`, but this package
  only ships `src/app/api/copilotkit-byoc-json-render/route.ts`. Until the
  API route is renamed (or an alias added), every step below fails at the
  network layer. File that as its own fix, not as a QA finding.
- There is no `byoc-json-render-root` test id and no `/demos/byoc-json-render`
  route — assert `data-testid="json-render-root"` on the canonical route only.
