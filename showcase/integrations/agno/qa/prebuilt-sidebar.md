# QA: Pre-Built Sidebar — Agno

## Prerequisites

- Demo is deployed and accessible at `/demos/prebuilt-sidebar`
- Agent backend is healthy (`/api/health` or `/api/copilotkit` GET)
- The underlying Agno agent (`src/agents/main.py`) is the shared showcase agent registered to the `prebuilt-sidebar` name on the runtime route

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/prebuilt-sidebar`; verify the main content renders with heading (h1 "Sidebar demo — click the launcher") and a paragraph mentioning `<CopilotSidebar />`
- [ ] Verify the `<CopilotSidebar />` is rendered docked to one edge of the viewport and OPEN by default (`defaultOpen={true}`)
- [ ] Verify the sidebar contains a chat input and its own launcher/toggle button

### 2. Feature-Specific Checks

#### Sidebar Toggle

- [ ] Click the sidebar close button; verify the sidebar collapses and `aria-hidden` flips to `true`
- [ ] Click the launcher; verify it re-opens (`aria-hidden` returns to `false`)

#### Suggestions (`useConfigureSuggestions`)

- [ ] Verify a pill titled "Say hi" is rendered
- [ ] Click the pill; verify "Say hi!" sends and an assistant response appears within 30s

#### Chat Round-Trip

- [ ] Type "Hello" and submit; verify an assistant bubble appears

### 3. Error Handling

- [ ] Attempt to send an empty message; verify it is a no-op
- [ ] DevTools console shows no uncaught errors during any flow above

## Expected Results

- Page + sidebar render within 3 seconds
- Assistant response within 30 seconds
- Sidebar toggle is instant with no layout jank
- No uncaught console errors
