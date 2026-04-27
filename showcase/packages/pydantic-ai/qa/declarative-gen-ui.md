# QA: Declarative Generative UI (A2UI — Dynamic Schema) — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- `OPENAI_API_KEY` set — the secondary LLM inside `generate_a2ui` calls
  the OpenAI API directly.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/declarative-gen-ui`
- [ ] Verify the chat interface loads and suggestion pills render

### 2. Dynamic A2UI

- [ ] Click "Show a KPI dashboard"
- [ ] Verify the agent calls `generate_a2ui` and a dashboard with KPI
      metric cards (revenue / signups / churn) renders inline
- [ ] Click "Pie chart — sales by region" and verify a donut chart renders
      with a legend
- [ ] Click "Bar chart — quarterly revenue" and verify a bar chart renders

### 3. Error Handling

- [ ] Verify no console errors during normal usage
- [ ] Verify no duplicate `render_a2ui` tool appears (confirms
      `injectA2UITool: false` is wired correctly)

## Expected Results

- The backend PydanticAI `generate_a2ui` tool generates a surface via a
  secondary LLM and returns an `a2ui_operations` container
- The runtime's A2UI middleware detects the container and streams the
  surface to the frontend's catalog renderer
