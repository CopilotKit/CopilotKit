# QA: Readonly State (Agent Context) — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the readonly-state-agent-context demo page
- [ ] Verify the context card (`data-testid="context-card"`) renders on the left
- [ ] Verify the chat renders on the right
- [ ] Verify the Name, Timezone, Recent Activity controls are populated

### 2. Context Flow

- [ ] Send "What do you know about me from my context?"
- [ ] Verify the agent references the current name, timezone, and recent activity

### 3. Context Updates

- [ ] Change the Name field to "Alice"
- [ ] Send "What is my name?"
- [ ] Verify the agent now responds with "Alice"
- [ ] Change the Timezone and ask about times — verify the agent uses the new timezone

### 4. Error Handling

- [ ] Verify no console errors during normal usage

## Expected Results

- Agent reads context on every turn via useAgentContext
- Agent cannot modify the UI state
- No UI errors or broken layouts
