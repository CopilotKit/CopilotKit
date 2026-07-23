# QA: Pre-Built Popup — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the prebuilt-popup demo page
- [ ] Verify the main content area shows the popup demo heading
- [ ] Verify the `<CopilotPopup />` floats over the page with `defaultOpen={true}`
- [ ] Verify the popup launcher (floating bubble) is visible
- [ ] Close the popup and verify the launcher remains
- [ ] Re-open the popup from the launcher

### 2. Chat Interaction

- [ ] Send a basic message in the popup chat
- [ ] Verify the agent responds inside the popup overlay
- [ ] Verify the "Say hi" suggestion is visible
- [ ] Click the suggestion and verify the agent replies

### 3. Error Handling

- [ ] Verify no console errors on page load
- [ ] Verify main page content remains scrollable while popup is open

## Expected Results

- Popup floats over page content with a custom chat input placeholder
- Chat exchange works identically to the full-page chat demo
- No UI errors or broken layouts
