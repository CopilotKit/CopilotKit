# QA: Pre-Built Popup — Mastra

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy

## Test Steps

- [ ] Navigate to `/demos/prebuilt-popup`
- [ ] Verify the main content heading is visible
- [ ] Verify the `CopilotPopup` floating launcher is visible
- [ ] Verify the popup is open by default
- [ ] Verify input placeholder reads "Ask the popup anything..."
- [ ] Send a message; verify assistant responds in the popup
- [ ] Click "Say hi" suggestion; verify it is sent

## Expected Results

- Popup renders as a floating window over page content
- Popup can be minimized/closed via its header controls
