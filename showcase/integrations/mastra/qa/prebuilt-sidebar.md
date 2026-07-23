# QA: Pre-Built Sidebar — Mastra

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy

## Test Steps

- [ ] Navigate to `/demos/prebuilt-sidebar`
- [ ] Verify the main content heading is visible
- [ ] Verify the `CopilotSidebar` is rendered and open by default (launcher in corner)
- [ ] Click the launcher button; verify the sidebar can be toggled
- [ ] Send a message from the sidebar input; verify assistant responds
- [ ] Click the "Say hi" suggestion; verify it is sent

## Expected Results

- Sidebar opens docked to the page side (not floating)
- Typing works inside the sidebar input
- Suggestions render once configured
