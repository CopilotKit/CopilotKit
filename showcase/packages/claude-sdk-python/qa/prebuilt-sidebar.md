# QA: Pre-Built Sidebar — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/prebuilt-sidebar`
- [ ] Verify the main content heading "Sidebar demo — click the launcher" is visible
- [ ] Verify `<CopilotSidebar />` opens by default (sidebar is visible)
- [ ] Verify the sidebar has a chat input
- [ ] Send a basic message (e.g. "Say hi")
- [ ] Verify the agent responds in the sidebar

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify the "Say hi" suggestion button is visible inside the sidebar
- [ ] Click the suggestion and verify it sends the message

#### Sidebar Toggle

- [ ] Close the sidebar via its toggle/launcher
- [ ] Reopen the sidebar and verify the conversation is preserved

### 3. Error Handling

- [ ] Verify no console errors during normal usage
- [ ] Verify closing/opening the sidebar does not break the chat state

## Expected Results

- Page loads within 3 seconds
- Sidebar renders with launcher
- Agent responds within 10 seconds
