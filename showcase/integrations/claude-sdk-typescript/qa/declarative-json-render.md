# QA: Declarative UI — json-render — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo reachable at `/demos/declarative-json-render`
- `agent_server.ts` running and healthy; it mounts the prompt-specialized
  agent at `/byoc-json-render`
- `src/app/api/copilotkit-declarative-json-render/route.ts` proxies to
  `${AGENT_URL}/byoc-json-render` (`AGENT_URL` defaults to
  `http://localhost:8000`)
- `ANTHROPIC_API_KEY` set for the agent backend
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

- The flat-spec prompt lives in `src/agent/byoc-json-render-prompt.ts`; the
  `byoc-` prefix on the backend module and HTTP mount is deliberate and stays.
- Structured output renders through `@json-render/react`'s `<Renderer />`
  against the catalog in `./catalog.ts`; the assistant bubble is swapped for
  `JsonRenderAssistantMessage` once the content parses.
