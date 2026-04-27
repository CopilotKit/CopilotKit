# QA: Readonly State (Agent Context) — Agno

## Prerequisites

- Demo deployed at `/demos/readonly-state-agent-context`
- Agent backend healthy

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/readonly-state-agent-context`
- [ ] Verify the `data-testid="context-card"` is visible (left sidebar)
- [ ] Verify the JSON preview (`data-testid="ctx-state-json"`) shows the initial context

### 2. Feature-Specific Checks

- [ ] Change the name input (`data-testid="ctx-name"`) to "Alice"
- [ ] Verify the JSON preview updates to show "Alice"
- [ ] Ask the assistant "What do you know about me?" and verify it references the context

### 3. Error Handling

- [ ] No uncaught console errors
