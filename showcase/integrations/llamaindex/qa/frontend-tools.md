# QA: Frontend Tools — LlamaIndex

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

- [ ] Navigate to `/demos/frontend-tools`
- [ ] Verify the chat interface loads
- [ ] Verify the background-container is visible (`data-testid="background-container"`)
- [ ] Send "Change the background to a blue gradient"
- [ ] Verify the background changes from the default
- [ ] Verify the `change_background` frontend tool returns a success status
- [ ] Verify suggestions are present: "Change background", "Sunset theme"

## Expected Results

- Chat loads within 3 seconds
- Background changes within 10 seconds after tool call
