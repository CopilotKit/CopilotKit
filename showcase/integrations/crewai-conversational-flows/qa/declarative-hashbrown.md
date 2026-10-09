# QA: Declarative UI — Hashbrown — CrewAI Conversational Flows

## Prerequisites

- Demo reachable at `/demos/declarative-hashbrown`
- `agent_server.py` running and healthy; it mounts the crew at
  `/conversational_flows/byoc-hashbrown`
- `src/app/api/copilotkit-byoc-hashbrown/route.ts` proxies to
  `${AGENT_URL}/conversational_flows/byoc-hashbrown` (`AGENT_URL` defaults to
  `http://localhost:8000`)
- `OPENAI_API_KEY` set for the agent backend
- `@hashbrownai/core` + `@hashbrownai/react` (`0.5.0-beta.4`) installed in the
  package

## Test Steps

### 1. Page load

- [ ] Navigate to `/demos/declarative-hashbrown`
- [ ] Header "Declarative UI: Hashbrown" visible
- [ ] Short description mentioning `@hashbrownai/react` visible
- [ ] Chat composer visible at the bottom of the chat area
- [ ] 3 suggestion pills visible inside the composer with labels:
      "Sales dashboard", "Revenue by category", "Expense trend"
- [ ] No red console errors (amber hydration warnings tolerated)

### 2. Sales dashboard suggestion

- [ ] Click the "Sales dashboard" pill
- [ ] The prompt is dispatched automatically (useConfigureSuggestions sends
      the message on pill click)
- [ ] Within 45 seconds, at least one MetricCard (`data-testid="metric-card"`)
      renders in the transcript
- [ ] Within 45 seconds, at least one chart
      (`data-testid="bar-chart"` or `data-testid="pie-chart"`) renders
- [ ] Rendered content streams progressively — partial UI appears before the
      full response completes (optional visual check)

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
- [ ] Verify at least one catalog component renders (metric, chart, or deal)

### 6. Multi-turn

- [ ] After a first render completes, send a follow-up prompt
      (e.g. "Now break it down by region")
- [ ] A new render appears alongside prior renders in the transcript

### 7. Error handling

- [ ] Empty send is a no-op (button stays disabled)
- [ ] The raw JSON envelope is never visible to the user — only the rendered
      catalog components appear in the message list
- [ ] Console remains clean during successful flows

## Expected Results

- Suggestion pills produce a hashbrown render within 45 seconds
- Streaming renders assemble progressively as JSON chunks arrive
- No uncaught errors; no `useHashBrownKit must be used within
HashBrownDashboard` errors
- Multi-turn works without clearing prior renders

## Integration notes

- The hashbrown envelope prompt lives in
  `src/agents/byoc_hashbrown_agent.py`; the `byoc_` prefix on the backend
  module is deliberate and stays.
- This integration has NOT been renamed on the runtime side yet: the page
  still mounts `runtimeUrl="/api/copilotkit-byoc-hashbrown"` with
  `agent="byoc-hashbrown-demo"`, and the page root carries
  `data-testid="byoc-hashbrown-root"` (absent from the north star). A legacy
  `/demos/byoc-hashbrown` route re-exports the same page, so both URLs
  render identically.
- The assistant also emits a Markdown heading above the dashboard; that is
  expected, not a catalog violation.
