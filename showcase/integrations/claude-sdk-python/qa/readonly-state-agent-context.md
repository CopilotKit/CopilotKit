# QA: Readonly State (Agent Context) — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy
- ANTHROPIC_API_KEY is set

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/readonly-state-agent-context`
- [ ] Verify the Agent Context card renders with Name, Timezone, Recent Activity controls
- [ ] Verify the published context JSON pre is visible

### 2. Context Wiring

- [ ] Edit the Name input to "Dana"
- [ ] Click the "Who am I?" suggestion
- [ ] Verify the agent greets "Dana" in its reply
- [ ] Change the timezone to "Asia/Tokyo"
- [ ] Click "Plan my morning" — verify the agent references Tokyo time

### 3. Error Handling

- [ ] Verify no console errors on context updates
- [ ] Verify the chat remains usable after multiple context changes

## Expected Results

- Agent references the current Name, Timezone, and Recent Activity
- The context card cannot be modified by the agent (agent has no write tools)
