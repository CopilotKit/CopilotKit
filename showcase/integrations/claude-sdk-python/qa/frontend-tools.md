# QA: Frontend Tools — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- ANTHROPIC_API_KEY is set

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/frontend-tools`
- [ ] Verify a chat surface renders in the centered card
- [ ] Send a message: "Change the background to a blue-to-purple gradient."
- [ ] Verify the agent calls the `change_background` frontend tool
- [ ] Verify the page background updates to the requested gradient

### 2. Feature-Specific Checks

- [ ] Click the "Sunset theme" suggestion — background changes to a sunset gradient
- [ ] Ask "Change the background back to default." — background resets
- [ ] Verify no errors in the console

### 3. Error Handling

- [ ] Verify the chat remains usable after multiple background changes

## Expected Results

- Background element with `data-testid="background-container"` reflects the CSS background value returned by the tool handler
- Agent calls the tool and produces a short confirmation message
