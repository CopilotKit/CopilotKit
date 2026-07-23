# QA: Declarative Generative UI (A2UI) — Langroid

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy
- `/api/copilotkit-declarative-gen-ui` is configured with `injectA2UITool: false`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/declarative-gen-ui`
- [ ] Verify the chat interface loads in a centered full-height layout
- [ ] Click the "Show a KPI dashboard" suggestion
- [ ] Verify the agent's `generate_a2ui` tool-call completes
- [ ] Verify one or more A2UI-rendered MetricCard/PieChart/BarChart surfaces
      appear in the transcript
