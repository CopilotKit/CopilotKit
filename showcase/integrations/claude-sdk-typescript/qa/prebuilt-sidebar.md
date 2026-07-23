# QA: Pre-Built Sidebar — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the prebuilt-sidebar demo page
- [ ] Verify the main content area shows the sidebar demo heading
- [ ] Verify the `<CopilotSidebar />` renders with `defaultOpen={true}`
- [ ] Verify the sidebar launcher button is visible
- [ ] Close the sidebar and verify the launcher remains
- [ ] Re-open the sidebar from the launcher

### 2. Chat Interaction

- [ ] Send a basic message ("Hello") in the sidebar chat
- [ ] Verify the agent responds inside the sidebar panel
- [ ] Verify the "Say hi" suggestion is visible
- [ ] Click the suggestion and verify the agent replies

### 3. Error Handling

- [ ] Verify no console errors on page load
- [ ] Verify main content remains interactive while sidebar is open

## Expected Results

- Page renders with sidebar docked on the right
- Chat exchange works identically to the full-page chat demo
- No UI errors or broken layouts
