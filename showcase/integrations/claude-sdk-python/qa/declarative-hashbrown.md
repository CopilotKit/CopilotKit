# QA: Declarative UI — Hashbrown — Claude Agent SDK (Python)

## Prerequisites

- Demo deployed at `/demos/declarative-hashbrown`
- Agent backend healthy (`GET /api/health` returns
  `{"status":"ok","integration":"claude-sdk-python"}`)
- `ANTHROPIC_API_KEY` set in the deployment environment (`ANTHROPIC_MODEL`
  defaults to `claude-opus-4-8`)
- `AGENT_URL` (default `http://localhost:8000`) points at the FastAPI server
  exposing `POST /declarative-hashbrown` (`src/agent_server.py`, prompt in
  `src/agents/byoc_hashbrown_agent.py`)
- `@hashbrownai/core` + `@hashbrownai/react` installed in the package
  (pinned to `0.5.0-beta.4`)
- Frontend runtime: `/api/copilotkit-declarative-hashbrown`, agent name
  `declarative-hashbrown-demo`

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
- [ ] At least one Markdown heading renders inline (the prompt's worked
      example leads with `## Q4 Sales Summary`)
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

### 6. Deal card

- [ ] Ask "Show me a sample deal in the negotiation stage"
- [ ] Verify a `data-testid="hashbrown-deal-card"` renders with a stage badge
      reading `negotiation` and a `$`-formatted value

### 7. Multi-turn

- [ ] After a first render completes, send a follow-up prompt
      (e.g. "Now break it down by region")
- [ ] A new render appears alongside prior renders in the transcript

### 8. Error handling

- [ ] Empty send is a no-op (button stays disabled)
- [ ] Console remains clean during successful flows

## Expected Results

- Suggestion pills produce a hashbrown render within 45 seconds
- The backend emits the JSON envelope (`{"ui": [...]}`), NEVER the `<ui>` XML
  form — the XML in `useUiKit({ examples })` is hashbrown's prompt DSL, not
  the wire format this demo consumes
- Streaming renders assemble progressively as JSON chunks arrive
- No uncaught errors; no `HashBrownRenderMessage must be used within
HashBrownDashboard` errors
- Multi-turn works without clearing prior renders
