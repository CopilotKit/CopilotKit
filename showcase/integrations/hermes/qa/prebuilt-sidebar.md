# QA: Pre-Built Sidebar — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the prebuilt-sidebar demo page
- [ ] Verify the main content heading ("Sidebar demo — click the launcher") is visible
- [ ] Verify the CopilotSidebar is rendered and open by default
- [ ] Verify the sidebar launcher toggle button is visible

### 2. Chat Interaction

- [ ] Send "Say hi" from the sidebar
- [ ] Verify the agent responds with a greeting
- [ ] Verify the "Say hi" suggestion pill renders

### 3. Error Handling

- [ ] Close and re-open the sidebar — chat state should persist
- [ ] Verify no console errors during normal usage

## Expected Results

- Sidebar renders alongside main content, open by default
- Agent responds within 10 seconds
- No UI errors or broken layouts
