# QA: State Streaming — Langroid

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the shared-state-streaming demo page
- [ ] Verify the chat interface loads at full viewport height (`height: 100vh`)
- [ ] Verify the chat title "State Streaming" is displayed
- [ ] Verify the chat input placeholder "Type a message..." is visible
- [ ] Send a basic message (e.g. "Hello! What can you do?")
- [ ] Verify the agent responds with an assistant role message (`[data-role="assistant"]`)

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Get started" suggestion button is visible (triggers "Hello! What can you do?")
- [ ] Click the "Get started" suggestion and verify a message is sent / input populated

#### Note: Stub Demo

- [ ] This demo is currently a stub (TODO: implement State Streaming)
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

- Stub-vs-test mismatch: the e2e spec `tests/e2e/shared-state-streaming.spec.ts` expects a document editor with "AI Document Editor" sidebar title, "Write whatever you want here..." placeholder, a ConfirmChanges modal (`data-testid="confirm-changes-modal"`), reject/confirm buttons (`data-testid="reject-button"`, `data-testid="confirm-button"`), and a status display (`data-testid="status-display"`). The page is a stub CopilotChat with "State Streaming" title — none of those selectors exist. Tests will fail against this stub.
