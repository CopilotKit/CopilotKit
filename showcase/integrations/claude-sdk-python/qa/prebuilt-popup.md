# QA: Pre-Built Popup — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/prebuilt-popup`
- [ ] Verify the main content heading "Popup demo — look for the floating launcher" is visible
- [ ] Verify `<CopilotPopup />` opens by default (popup overlay is visible)
- [ ] Verify the chat input placeholder reads "Ask the popup anything..."
- [ ] Send a basic message (e.g. "Say hi from the popup!")
- [ ] Verify the agent responds in the popup

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify the "Say hi" suggestion button is visible inside the popup
- [ ] Click the suggestion and verify it sends the message

#### Popup Toggle

- [ ] Close the popup via its toggle/launcher
- [ ] Verify the floating launcher bubble remains on the page
- [ ] Reopen the popup and verify the conversation is preserved

### 3. Error Handling

- [ ] Verify no console errors during normal usage
- [ ] Verify closing/opening the popup does not break the chat state

## Expected Results

- Page loads within 3 seconds
- Popup opens with floating launcher
- Agent responds within 10 seconds
