# QA: Shared State (Writing) — Langroid

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the shared-state-write demo page
- [ ] Verify the chat interface loads at full viewport height (`height: 100vh`)
- [ ] Verify the chat title "Shared State (Writing)" is displayed
- [ ] Verify the chat input placeholder "Type a message..." is visible
- [ ] Send a basic message (e.g. "Hello! What can you do?")
- [ ] Verify the agent responds with an assistant role message (`[data-role="assistant"]`)

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Get started" suggestion button is visible (triggers "Hello! What can you do?")
- [ ] Click the "Get started" suggestion and verify a message is sent / input populated

#### Note: Stub Demo

- [ ] This demo is currently a stub (TODO: implement Shared State (Writing))
- [ ] Verify the basic CopilotChat loads and accepts messages
- [ ] Verify the agent responds to messages
- [ ] No custom UI components are expected beyond the chat interface

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results

- Chat loads within 3 seconds
- Agent responds within 10 seconds
- No UI errors or broken layouts

## Notes

- Stub-vs-test mismatch: the e2e spec `tests/e2e/shared-state-write.spec.ts` expects a "Sales Pipeline" dashboard, "Sales Pipeline Assistant" sidebar, "Add a deal" buttons, deal cards (`data-testid="todo-card"`), and completion toggles (`data-testid="toggle-completed"`). The page is a stub CopilotChat with a "Shared State (Writing)" title — none of those selectors exist. Tests will fail against this stub.
